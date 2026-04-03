const http = require('http');
const https = require('https');
const { URL } = require('url');

const GlpiConfig = require('../models/GlpiConfig');
const { decrypt } = require('./encryption');
const { sendEmail } = require('./email');
const { auditSystem } = require('./audit');
const { logger } = require('./logger');
const { assertOutboundUrlSafe } = require('./outbound-url-guard');

const DEFAULT_EMAIL_SUBJECT = '[SOC] Cierre de turno {{date}}';
const MAX_DISPATCH_ATTEMPTS = 2;

const withDefaultPath = (baseUrl) => {
  const parsed = new URL(baseUrl);
  const pathname = parsed.pathname || '/';
  if (!pathname.endsWith('/apirest.php')) {
    parsed.pathname = pathname.replace(/\/$/, '') + '/apirest.php';
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed;
};

const glpiRequest = ({ method = 'GET', url, headers = {}, timeoutMs = 8000, verifyTls = true, body = null }) => {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request({
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search || ''}`,
      headers,
      timeout: timeoutMs,
      rejectUnauthorized: verifyTls
    }, (response) => {
      let raw = '';
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (_) {
          parsed = null;
        }

        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve({
            statusCode: response.statusCode,
            data: parsed || raw
          });
          return;
        }

        const message = parsed?.[0] || parsed?.message || raw || `HTTP ${response.statusCode}`;
        const error = new Error(`GLPI ${method} ${url.pathname} falló: ${message}`);
        error.statusCode = response.statusCode;
        reject(error);
      });
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new Error('Timeout conectando a GLPI'));
    });

    if (body) {
      request.write(body);
    }

    request.end();
  });
};

const fillTemplate = (template, values = {}) => {
  return String(template || DEFAULT_EMAIL_SUBJECT).replace(/{{\s*(\w+)\s*}}/g, (_, key) => {
    return values[key] !== undefined && values[key] !== null ? String(values[key]) : '';
  });
};

const sanitizeGlpiConfig = (doc) => ({
  _id: doc._id,
  enabled: doc.enabled,
  mode: doc.mode,
  dispatchMode: doc.dispatchMode,
  api: {
    baseUrl: doc.api?.baseUrl || '',
    verifyTls: doc.api?.verifyTls ?? true,
    timeoutMs: doc.api?.timeoutMs || 8000,
    appTokenConfigured: Boolean(doc.api?.appToken),
    userTokenConfigured: Boolean(doc.api?.userToken)
  },
  email: {
    collectorAddress: doc.email?.collectorAddress || '',
    subjectTemplate: doc.email?.subjectTemplate || DEFAULT_EMAIL_SUBJECT
  },
  lastTestDate: doc.lastTestDate,
  lastTestSuccess: doc.lastTestSuccess,
  lastTestMessage: doc.lastTestMessage,
  lastDispatchDate: doc.lastDispatchDate,
  lastDispatchSuccess: doc.lastDispatchSuccess,
  lastDispatchMessage: doc.lastDispatchMessage,
  lastDispatchMode: doc.lastDispatchMode,
  lastDispatchEvent: doc.lastDispatchEvent,
  lastDispatchChannel: doc.lastDispatchChannel,
  updatedAt: doc.updatedAt
});

const ensureGlpiConfig = async () => {
  let config = await GlpiConfig.findOne();
  if (!config) {
    config = await GlpiConfig.create({});
  }
  return config;
};

const persistDispatchStatus = async (config, status) => {
  config.lastDispatchDate = new Date();
  config.lastDispatchSuccess = Boolean(status.success);
  config.lastDispatchMessage = String(status.message || '');
  config.lastDispatchMode = status.dispatchMode || config.dispatchMode || 'unknown';
  config.lastDispatchEvent = status.sourceEvent || '';
  config.lastDispatchChannel = status.channel || 'none';
  await config.save({ validateModifiedOnly: true });
};

const dispatchViaApi = async (config, payload) => {
  const baseUrl = String(config.api?.baseUrl || '').trim();
  const appToken = decrypt(config.api?.appToken || '');
  const userToken = decrypt(config.api?.userToken || '');

  if (!baseUrl || !appToken || !userToken) {
    throw new Error('Configuración GLPI API incompleta');
  }

  const apiBase = withDefaultPath(baseUrl);
  await assertOutboundUrlSafe(apiBase.toString(), { requireHttps: true });
  const initSessionUrl = new URL(`${apiBase.toString().replace(/\/$/, '')}/initSession`);
  const timeoutMs = config.api?.timeoutMs || 8000;
  const verifyTls = config.api?.verifyTls !== false;

  const initResult = await glpiRequest({
    method: 'GET',
    url: initSessionUrl,
    timeoutMs,
    verifyTls,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `user_token ${userToken}`,
      'App-Token': appToken
    }
  });

  const sessionToken = initResult?.data?.session_token;
  if (!sessionToken) {
    throw new Error('GLPI no devolvió session_token en initSession');
  }

  try {
    const ticketUrl = new URL(`${apiBase.toString().replace(/\/$/, '')}/Ticket`);
    const body = JSON.stringify({
      input: {
        name: payload.title,
        content: payload.text,
        status: 1,
        type: 1
      }
    });

    const createResult = await glpiRequest({
      method: 'POST',
      url: ticketUrl,
      timeoutMs,
      verifyTls,
      body,
      headers: {
        'Content-Type': 'application/json',
        'Session-Token': sessionToken,
        'App-Token': appToken,
        'Content-Length': Buffer.byteLength(body)
      }
    });

    return {
      channel: 'api',
      externalId: createResult?.data?.id || createResult?.data?.ID || null,
      raw: createResult.data
    };
  } finally {
    const killSessionUrl = new URL(`${apiBase.toString().replace(/\/$/, '')}/killSession`);
    await glpiRequest({
      method: 'GET',
      url: killSessionUrl,
      timeoutMs,
      verifyTls,
      headers: {
        'Content-Type': 'application/json',
        'Session-Token': sessionToken,
        'App-Token': appToken
      }
    }).catch((error) => {
      logger.warn({ err: error }, 'Unable to close GLPI session cleanly');
    });
  }
};

const dispatchViaEmail = async (config, payload, dispatchContext = {}) => {
  const collectorAddress = String(config.email?.collectorAddress || '').trim().toLowerCase();
  if (!collectorAddress) {
    throw new Error('Collector email GLPI no configurado');
  }

  await sendEmail({
    to: collectorAddress,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    auditContext: {
      sourceModule: 'glpi-dispatch',
      triggerType: String(dispatchContext.sourceEvent || 'glpi-collector'),
      triggerContext: 'dispatchViaEmail',
      shiftId: dispatchContext.context?.shiftId || null,
      extra: {
        sourceEvent: dispatchContext.sourceEvent || null,
        dispatchMode: config.dispatchMode,
        glpiMode: config.mode,
        ...(dispatchContext.context || {})
      }
    }
  });

  return {
    channel: 'email',
    externalId: collectorAddress
  };
};

const dispatchGlpiPayload = async ({ expectedDispatchMode, title, subject, text, html, sourceEvent, context = {} }) => {
  const config = await ensureGlpiConfig();
  if (!config.enabled) {
    return { success: false, dispatched: false, skippedReason: 'disabled' };
  }

  if (expectedDispatchMode && config.dispatchMode !== expectedDispatchMode) {
    return {
      success: false,
      dispatched: false,
      skippedReason: 'dispatch-mode-mismatch',
      configuredDispatchMode: config.dispatchMode
    };
  }

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_DISPATCH_ATTEMPTS; attempt += 1) {
    try {
      const result = config.mode === 'api'
        ? await dispatchViaApi(config, { title, text })
        : await dispatchViaEmail(config, { subject, text, html }, { sourceEvent, context });

      const successMessage = config.mode === 'api'
        ? `Ticket GLPI creado${result.externalId ? ` (#${result.externalId})` : ''}`
        : 'Correo collector GLPI enviado correctamente';

      await persistDispatchStatus(config, {
        success: true,
        message: successMessage,
        dispatchMode: config.dispatchMode,
        sourceEvent,
        channel: result.channel
      });

      await auditSystem({
        event: 'glpi.dispatch.success',
        level: 'info',
        result: { success: true, reason: successMessage },
        metadata: {
          sourceEvent,
          dispatchMode: config.dispatchMode,
          channel: result.channel,
          attempt,
          externalId: result.externalId,
          title,
          ...context
        }
      });

      return {
        success: true,
        dispatched: true,
        channel: result.channel,
        externalId: result.externalId,
        message: successMessage
      };
    } catch (error) {
      lastError = error;
      logger.warn({ err: error, sourceEvent, attempt }, 'GLPI dispatch attempt failed');
    }
  }

  const failureMessage = lastError?.message || 'Fallo desconocido en despacho GLPI';
  await persistDispatchStatus(config, {
    success: false,
    message: failureMessage,
    dispatchMode: config.dispatchMode,
    sourceEvent,
    channel: config.mode || 'none'
  });

  await auditSystem({
    event: 'glpi.dispatch.fail',
    level: 'warn',
    result: { success: false, reason: failureMessage },
    metadata: {
      sourceEvent,
      dispatchMode: config.dispatchMode,
      channel: config.mode,
      attempts: MAX_DISPATCH_ATTEMPTS,
      title,
      ...context
    }
  });

  return {
    success: false,
    dispatched: false,
    message: failureMessage,
    error: lastError
  };
};

module.exports = {
  DEFAULT_EMAIL_SUBJECT,
  dispatchGlpiPayload,
  ensureGlpiConfig,
  fillTemplate,
  glpiRequest,
  sanitizeGlpiConfig,
  withDefaultPath
};
