/**
 * File Purpose: backend/src/utils/glpi-dispatch.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

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

// Se agrega a todo followup que la bitácora escribe en GLPI. Es un comentario HTML (invisible
// en el visor de GLPI) que la importación entrante usa para reconocer y descartar sus propios
// followups al leerlos de vuelta — sin este marcador, cada push generaría un pull infinito.
const GLPI_SYNC_MARKER = '<!-- bitacora-soc-sync -->';

/*
 * QA — integración saliente GLPI:
 * - URL API: `assertOutboundUrlSafe` exige HTTPS en API (mitiga SSRF hacia redes internas según política del guard).
 * - Tokens: app/user token se descifran en memoria para cada request; no exponer en logs (solo errores agregados).
 * - API: initSession → POST Ticket → killSession en `finally` (fuga de sesión = advertencia, no fallo duro).
 * - Email: usa `sendEmail` al collector; auditar plantillas y destino en SMTP.
 * - Reintentos: hasta MAX_DISPATCH_ATTEMPTS; fallos parciales pueden duplicar tickets si GLPI creó y la respuesta se cortó
 *   (probar timeouts y verificar en GLPI antes de subir reintentos).
 */

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
  manualLinkFieldEnabled: doc.manualLinkFieldEnabled || false,
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
  entityMappings: (doc.entityMappings || []).map((mapping) => ({
    _id: mapping._id,
    entitiesId: mapping.entitiesId,
    label: mapping.label || '',
    clientId: mapping.clientId || null,
    defaultEntryType: mapping.defaultEntryType,
    categoryOverrides: (mapping.categoryOverrides || []).map((override) => ({
      itilCategoriesId: override.itilCategoriesId,
      entryType: override.entryType
    })),
    enabled: mapping.enabled
  })),
  inbound: {
    enabled: doc.inbound?.enabled || false,
    pollingIntervalMinutes: doc.inbound?.pollingIntervalMinutes || 5,
    importUserId: doc.inbound?.importUserId || null,
    lastPollAt: doc.inbound?.lastPollAt || null,
    lastPollSuccess: doc.inbound?.lastPollSuccess ?? null,
    lastPollMessage: doc.inbound?.lastPollMessage || '',
    lastImportedCount: doc.inbound?.lastImportedCount || 0
  },
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

const openGlpiSession = async (config) => {
  const baseUrl = String(config.api?.baseUrl || '').trim();
  const appToken = decrypt(config.api?.appToken || '');
  const userToken = decrypt(config.api?.userToken || '');

  if (!baseUrl || !appToken || !userToken) {
    throw new Error('Configuración GLPI API incompleta');
  }

  const apiBase = withDefaultPath(baseUrl);
  await assertOutboundUrlSafe(apiBase.toString(), { requireHttps: true });
  const timeoutMs = config.api?.timeoutMs || 8000;
  const verifyTls = config.api?.verifyTls !== false;
  const initSessionUrl = new URL(`${apiBase.toString().replace(/\/$/, '')}/initSession`);

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

  return { apiBase, appToken, sessionToken, timeoutMs, verifyTls };
};

const closeGlpiSession = async (session) => {
  const killSessionUrl = new URL(`${session.apiBase.toString().replace(/\/$/, '')}/killSession`);
  await glpiRequest({
    method: 'GET',
    url: killSessionUrl,
    timeoutMs: session.timeoutMs,
    verifyTls: session.verifyTls,
    headers: {
      'Content-Type': 'application/json',
      'Session-Token': session.sessionToken,
      'App-Token': session.appToken
    }
  }).catch((error) => {
    logger.warn({ err: error }, 'Unable to close GLPI session cleanly');
  });
};

// Abre sesión GLPI, ejecuta `fn(session)` y garantiza el killSession incluso si `fn` lanza error.
const withGlpiSession = async (config, fn) => {
  const session = await openGlpiSession(config);
  try {
    return await fn(session);
  } finally {
    await closeGlpiSession(session);
  }
};

const dispatchViaApi = async (config, payload) => withGlpiSession(config, async (session) => {
  const ticketUrl = new URL(`${session.apiBase.toString().replace(/\/$/, '')}/Ticket`);
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
    timeoutMs: session.timeoutMs,
    verifyTls: session.verifyTls,
    body,
    headers: {
      'Content-Type': 'application/json',
      'Session-Token': session.sessionToken,
      'App-Token': session.appToken,
      'Content-Length': Buffer.byteLength(body)
    }
  });

  return {
    channel: 'api',
    externalId: createResult?.data?.id || createResult?.data?.ID || null,
    raw: createResult.data
  };
});

// Agrega un seguimiento (ITILFollowup) a un ticket GLPI ya existente — usado para vincular
// o reenviar el contenido de una entrada de bitácora sin duplicar el ticket.
const addTicketFollowup = async (config, { ticketId, content, isPrivate = false }) => {
  if (!config.enabled) {
    throw new Error('La integración GLPI está deshabilitada');
  }
  if (config.mode !== 'api') {
    throw new Error('Vincular entradas a tickets solo está disponible en modo "API REST GLPI"');
  }

  const numericTicketId = String(ticketId || '').trim();
  if (!numericTicketId) {
    throw new Error('ticketId es obligatorio');
  }

  return withGlpiSession(config, async (session) => {
    const followupUrl = new URL(`${session.apiBase.toString().replace(/\/$/, '')}/ITILFollowup`);
    const body = JSON.stringify({
      input: {
        itemtype: 'Ticket',
        items_id: Number(numericTicketId),
        content: `${content}\n\n${GLPI_SYNC_MARKER}`,
        is_private: isPrivate ? 1 : 0
      }
    });

    const result = await glpiRequest({
      method: 'POST',
      url: followupUrl,
      timeoutMs: session.timeoutMs,
      verifyTls: session.verifyTls,
      body,
      headers: {
        'Content-Type': 'application/json',
        'Session-Token': session.sessionToken,
        'App-Token': session.appToken,
        'Content-Length': Buffer.byteLength(body)
      }
    });

    return {
      followupId: result?.data?.id || result?.data?.ID || null,
      raw: result.data
    };
  });
};

// La API de búsqueda de GLPI identifica columnas por un id numérico de "search option" que
// depende de la versión/plugins instalados (no es estable entre instancias). En vez de
// hardcodear esos ids, se resuelven en caliente vía `listSearchOptions/:itemtype` y se
// cachean en memoria — así el poll de tickets funciona en cualquier GLPI 9.x-11.x.
const SEARCH_OPTIONS_TTL_MS = 15 * 60 * 1000;
const searchOptionsCache = new Map();

const fetchSearchOptionIds = async (session, itemtype, table, fieldNames) => {
  const cacheKey = itemtype;
  const cached = searchOptionsCache.get(cacheKey);
  if (cached && (Date.now() - cached.resolvedAt) < SEARCH_OPTIONS_TTL_MS) {
    return cached.byField;
  }

  const url = new URL(`${session.apiBase.toString().replace(/\/$/, '')}/listSearchOptions/${itemtype}`);
  const result = await glpiRequest({
    method: 'GET',
    url,
    timeoutMs: session.timeoutMs,
    verifyTls: session.verifyTls,
    headers: {
      'Content-Type': 'application/json',
      'Session-Token': session.sessionToken,
      'App-Token': session.appToken
    }
  });

  const byField = new Map();
  Object.entries(result.data || {}).forEach(([optionId, option]) => {
    if (!option || typeof option !== 'object' || !option.field) {
      return;
    }
    // Prioriza el campo propio de la tabla base del itemtype (evita colisiones con
    // columnas del mismo nombre provenientes de tablas relacionadas/joins).
    const isOwnTable = !table || option.table === table;
    if (isOwnTable || !byField.has(option.field)) {
      byField.set(option.field, Number(optionId));
    }
  });

  searchOptionsCache.set(cacheKey, { resolvedAt: Date.now(), byField });

  const missing = fieldNames.filter((name) => !byField.has(name));
  if (missing.length > 0) {
    throw new Error(`GLPI no expone los campos de búsqueda: ${missing.join(', ')} (${itemtype})`);
  }

  return byField;
};

const toGlpiDateTime = (date) => {
  // GLPI espera "YYYY-MM-DD HH:mm:ss" en la zona horaria del servidor GLPI.
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const SEARCH_PAGE_SIZE = 50;
const MAX_SEARCH_RESULTS = 500;

// Pagina automáticamente `search/:itemtype` hasta agotar `totalcount` o hasta `maxResults`
// (cap de seguridad para no quedar en un loop de horas si hay un backlog enorme). Cuando el cap
// se alcanza antes de terminar, `truncated: true` le avisa al caller que NO debe avanzar su
// cursor hasta "ahora" — debe retomar desde el último registro realmente procesado, o se pierden
// silenciosamente los que quedaron fuera del rango leído en este ciclo.
const runPaginatedSearch = async (session, { itemtype, criteria, forcedisplayIds, sortId, order = 'ASC', maxResults = MAX_SEARCH_RESULTS }) => {
  const allRows = [];
  let start = 0;
  let truncated = false;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = new URLSearchParams();
    criteria.forEach((criterion, index) => {
      if (criterion.link) params.set(`criteria[${index}][link]`, criterion.link);
      params.set(`criteria[${index}][field]`, String(criterion.field));
      params.set(`criteria[${index}][searchtype]`, criterion.searchtype);
      params.set(`criteria[${index}][value]`, String(criterion.value));
    });
    forcedisplayIds.forEach((id, index) => {
      params.set(`forcedisplay[${index}]`, String(id));
    });
    params.set('sort', String(sortId));
    params.set('order', order);
    params.set('range', `${start}-${start + SEARCH_PAGE_SIZE - 1}`);

    const searchUrl = new URL(`${session.apiBase.toString().replace(/\/$/, '')}/search/${itemtype}?${params.toString()}`);
    const result = await glpiRequest({
      method: 'GET',
      url: searchUrl,
      timeoutMs: session.timeoutMs,
      verifyTls: session.verifyTls,
      headers: {
        'Content-Type': 'application/json',
        'Session-Token': session.sessionToken,
        'App-Token': session.appToken
      }
    });

    const payload = result?.data || {};
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const totalCount = typeof payload.totalcount === 'number' ? payload.totalcount : (start + rows.length);

    allRows.push(...rows);
    start += SEARCH_PAGE_SIZE;

    if (rows.length === 0 || allRows.length >= totalCount) {
      break;
    }
    if (allRows.length >= maxResults) {
      truncated = true;
      break;
    }
  }

  return { rows: allRows, truncated };
};

// Busca tickets de una entidad GLPI modificados después de `dateModAfter` (o todos si es null),
// devolviendo solo los campos que necesita el importador (id, título, contenido, fecha de
// modificación y categoría). Pagina sola si hay más de una página de resultados.
const searchTickets = async (config, { entitiesId, dateModAfter = null }) => {
  return withGlpiSession(config, async (session) => {
    const fields = await fetchSearchOptionIds(session, 'Ticket', 'glpi_tickets', [
      'id', 'name', 'content', 'date_mod', 'itilcategories_id', 'entities_id'
    ]);

    const criteria = [
      { field: fields.get('entities_id'), searchtype: 'equals', value: entitiesId }
    ];
    if (dateModAfter) {
      criteria.push({ link: 'AND', field: fields.get('date_mod'), searchtype: 'morethan', value: toGlpiDateTime(dateModAfter) });
    }

    const forcedisplayNames = ['id', 'name', 'content', 'date_mod', 'itilcategories_id'];
    const { rows, truncated } = await runPaginatedSearch(session, {
      itemtype: 'Ticket',
      criteria,
      forcedisplayIds: forcedisplayNames.map((name) => fields.get(name)),
      sortId: fields.get('date_mod')
    });

    const tickets = rows.map((row) => ({
      id: row[String(fields.get('id'))],
      name: row[String(fields.get('name'))] || '',
      content: row[String(fields.get('content'))] || '',
      dateMod: row[String(fields.get('date_mod'))] ? new Date(row[String(fields.get('date_mod'))]) : null,
      itilCategoriesId: row[String(fields.get('itilcategories_id'))] ? Number(row[String(fields.get('itilcategories_id'))]) : null
    }));

    return { tickets, truncated };
  });
};

// Trae los seguimientos (ITILFollowup) de un ticket posteriores a `dateModAfter`, excluyendo
// los que la propia bitácora escribió (identificados por GLPI_SYNC_MARKER) para no reimportar
// como "novedad externa" algo que en realidad salió de acá. Pagina sola si hace falta.
const listNewFollowups = async (config, { ticketId, dateModAfter }) => {
  return withGlpiSession(config, async (session) => {
    const fields = await fetchSearchOptionIds(session, 'ITILFollowup', 'glpi_itilfollowups', [
      'id', 'content', 'date_mod', 'items_id'
    ]);

    const criteria = [
      { field: fields.get('items_id'), searchtype: 'equals', value: ticketId }
    ];
    if (dateModAfter) {
      criteria.push({ link: 'AND', field: fields.get('date_mod'), searchtype: 'morethan', value: toGlpiDateTime(dateModAfter) });
    }

    const forcedisplayNames = ['id', 'content', 'date_mod'];
    const { rows, truncated } = await runPaginatedSearch(session, {
      itemtype: 'ITILFollowup',
      criteria,
      forcedisplayIds: forcedisplayNames.map((name) => fields.get(name)),
      sortId: fields.get('date_mod')
    });

    const followups = rows
      .map((row) => ({
        id: row[String(fields.get('id'))],
        content: row[String(fields.get('content'))] || '',
        dateMod: row[String(fields.get('date_mod'))] ? new Date(row[String(fields.get('date_mod'))]) : null
      }))
      .filter((followup) => !followup.content.includes(GLPI_SYNC_MARKER));

    return { followups, truncated };
  });
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
  GLPI_SYNC_MARKER,
  addTicketFollowup,
  dispatchGlpiPayload,
  ensureGlpiConfig,
  fillTemplate,
  glpiRequest,
  listNewFollowups,
  sanitizeGlpiConfig,
  searchTickets,
  withDefaultPath,
  withGlpiSession
};
