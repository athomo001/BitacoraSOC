const nodemailer = require('nodemailer');
const { logger } = require('./logger');
const AppConfig = require('../models/AppConfig');
const SmtpConfig = require('../models/SmtpConfig');
const { decrypt } = require('./encryption');
const { auditSystem } = require('./audit');

/**
 * Servicio centralizado de envío de emails
 * Lee configuración SMTP desde BD (AppConfig.smtpConfig)
 */

let smtpConfigCache = null;
let cacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos
const MAIL_AUDIT_NOISE_WINDOW_MS = Math.max(60 * 1000, Number(process.env.MAIL_AUDIT_NOISE_WINDOW_MS) || (5 * 60 * 1000));
const MAIL_AUDIT_RELOG_EVERY = Math.max(2, Number(process.env.MAIL_AUDIT_RELOG_EVERY) || 10);
const mailFailureNoiseMap = new Map();

const maskEmail = (email = '') => {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  if (!local) return `***@${domain}`;
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
};

const normalizeRecipients = (to) => {
  if (Array.isArray(to)) {
    return to
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof to === 'string') {
    return to
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
};

const classifyMailFailure = (errorMessage = '', recipientsCount = 0) => {
  const normalized = String(errorMessage || '').toLowerCase();

  if (recipientsCount === 0 || normalized.includes('no recipients')) {
    return 'destinatarios vacios por filtro';
  }
  if (normalized.includes('smtp configuration missing')) {
    return 'config smtp incompleta';
  }
  if (normalized.includes('eauth') || normalized.includes('invalid login') || normalized.includes('authentication')) {
    return 'credenciales smtp invalidas';
  }
  if (normalized.includes('enotfound') || normalized.includes('getaddrinfo')) {
    return 'host smtp no resoluble';
  }
  if (normalized.includes('timeout') || normalized.includes('etimedout')) {
    return 'timeout smtp';
  }

  return 'error de envio smtp';
};

const normalizeAuditContext = (context = {}) => ({
  sourceModule: String(context.sourceModule || 'unknown').trim() || 'unknown',
  triggerType: String(context.triggerType || 'unspecified').trim() || 'unspecified',
  triggerContext: String(context.triggerContext || '').trim() || null,
  shiftId: context.shiftId || null,
  checklistId: context.checklistId || null,
  entryType: context.entryType || null,
  smtpConfigId: context.smtpConfigId || null,
  resolvedRecipientsCount: Number(context.resolvedRecipientsCount || 0),
  resolvedRecipientsPreview: Array.isArray(context.resolvedRecipientsPreview)
    ? context.resolvedRecipientsPreview.filter(Boolean)
    : [],
  extra: context.extra && typeof context.extra === 'object' ? context.extra : {}
});

const buildMailFailureNoiseState = (signature) => {
  const now = Date.now();

  if (mailFailureNoiseMap.size > 500) {
    for (const [key, value] of mailFailureNoiseMap.entries()) {
      if ((now - value.windowStart) > MAIL_AUDIT_NOISE_WINDOW_MS) {
        mailFailureNoiseMap.delete(key);
      }
    }
  }

  const current = mailFailureNoiseMap.get(signature);
  if (!current || (now - current.windowStart) > MAIL_AUDIT_NOISE_WINDOW_MS) {
    const next = {
      windowStart: now,
      countInWindow: 1,
      loggedInWindow: 1,
      lastSeenAt: now
    };
    mailFailureNoiseMap.set(signature, next);
    return {
      shouldAudit: true,
      countInWindow: next.countInWindow,
      loggedInWindow: next.loggedInWindow,
      suppressedInWindow: 0,
      windowMs: MAIL_AUDIT_NOISE_WINDOW_MS
    };
  }

  current.countInWindow += 1;
  current.lastSeenAt = now;

  const shouldAudit = current.countInWindow % MAIL_AUDIT_RELOG_EVERY === 0;
  if (shouldAudit) {
    current.loggedInWindow += 1;
  }

  return {
    shouldAudit,
    countInWindow: current.countInWindow,
    loggedInWindow: current.loggedInWindow,
    suppressedInWindow: current.countInWindow - current.loggedInWindow,
    windowMs: MAIL_AUDIT_NOISE_WINDOW_MS
  };
};

/**
 * Obtiene configuración SMTP desde BD (AppConfig.smtpConfig) o variables de entorno
 */
async function getSMTPConfig() {
  const now = Date.now();
  
  // Usar cache si está disponible
  if (smtpConfigCache && (now - cacheTime) < CACHE_DURATION) {
    logger.info('📧 SMTP config FROM CACHE');
    return smtpConfigCache;
  }

  try {
    logger.info('📧 Reading SMTP config FROM DATABASE (SmtpConfig)...');
    const smtpDoc = await SmtpConfig.findOne({ isActive: true }).lean();

    if (smtpDoc) {
      const config = {
        host: smtpDoc.host,
        port: smtpDoc.port,
        secure: smtpDoc.useTLS === true || smtpDoc.port === 465,
        user: smtpDoc.username,
        pass: decrypt(smtpDoc.password),
        smtpConfigId: smtpDoc._id?.toString?.() || String(smtpDoc._id || ''),
        smtpConfigSource: 'SmtpConfig',
        from: smtpDoc.senderName
          ? `"${smtpDoc.senderName}" <${smtpDoc.senderEmail}>`
          : smtpDoc.senderEmail || smtpDoc.username
      };

      smtpConfigCache = config;
      cacheTime = now;
      logger.info('📧 SMTP config LOADED FROM SmtpConfig', { host: config.host, port: config.port, user: config.user });
      return config;
    }

    logger.warn('📧 No SMTP config found in SmtpConfig (isActive: true)');
  } catch (error) {
    logger.error('📧 ERROR reading SMTP from SmtpConfig:', error.message, error.stack);
  }

  try {
    logger.info('📧 Reading SMTP config FROM DATABASE (AppConfig.smtpConfig) as fallback...');
    const appConfig = await AppConfig.findOne().select('smtpConfig').lean();

    if (appConfig && appConfig.smtpConfig) {
      const smtpConfig = appConfig.smtpConfig;
      logger.info('📧 SMTP config found in AppConfig', { user: smtpConfig.user });

      const config = {
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure === true,
        user: smtpConfig.user,
        pass: smtpConfig.pass,
        smtpConfigId: appConfig?._id?.toString?.() || null,
        smtpConfigSource: 'AppConfig',
        from: smtpConfig.from || smtpConfig.user
      };

      smtpConfigCache = config;
      cacheTime = now;
      logger.info('📧 SMTP config LOADED FROM AppConfig', { host: config.host, port: config.port, user: config.user });
      return config;
    }

    logger.warn('📧 No SMTP config found in AppConfig');
  } catch (error) {
    logger.error('📧 ERROR reading SMTP from AppConfig:', error.message, error.stack);
  }

  // Fallback a variables de entorno
  logger.info('📧 Trying ENV VARIABLES fallback...');
  const envConfig = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    smtpConfigId: null,
    smtpConfigSource: 'env',
    from: process.env.SMTP_FROM || ''
  };

  if (envConfig.user && envConfig.pass) {
    logger.info('📧 Using SMTP from ENV VARIABLES', { user: envConfig.user });
    smtpConfigCache = envConfig;
    cacheTime = now;
    return envConfig;
  }

  logger.error('❌ NO SMTP CONFIGURATION FOUND - neither DB nor ENV');
  return null;
}

/**
 * Crea transporter de nodemailer con configuración actual
 */
async function createTransporter(configOverride = null) {
  const config = configOverride || await getSMTPConfig();

  if (!config || !config.user || !config.pass) {
    throw new Error('SMTP configuration missing: user and pass required');
  }

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure === true,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });
}

/**
 * Envía un email
 * @param {Object} options - Opciones del email
 * @param {string|string[]} options.to - Destinatario(s)
 * @param {string} options.subject - Asunto
 * @param {string} [options.text] - Contenido en texto plano
 * @param {string} [options.html] - Contenido en HTML
 * @param {string} [options.from] - Remitente (opcional, usa config por defecto)
 * @param {Array<Object>} [options.attachments] - Adjuntos nodemailer (p. ej. { filename, content, cid } para img inline)
 */
async function sendEmail({ to, subject, text, html, from, attachments, auditContext = {} }) {
  const recipients = normalizeRecipients(to);
  const resolvedRecipientsPreview = recipients.map(maskEmail).slice(0, 5);
  const context = normalizeAuditContext({
    ...auditContext,
    resolvedRecipientsCount: recipients.length,
    resolvedRecipientsPreview
  });

  try {
    logger.info('📧 [sendEmail] Starting email send process...', { to, subject });

    if (recipients.length === 0) {
      throw new Error('No recipients resolved for email send');
    }
    
    const config = await getSMTPConfig();
    
    if (!config || !config.user || !config.pass) {
      logger.error('❌ [sendEmail] SMTP config is missing!', { user: config?.user, pass: !!config?.pass });
      throw new Error('SMTP configuration missing: Please configure email settings in Settings > Configuración SMTP');
    }

    logger.info('📧 [sendEmail] SMTP config loaded, creating transporter...');
    const transporter = await createTransporter(config);
    
    const mailOptions = {
      from: from || config.from || config.user,
      to: recipients.join(', '),
      subject,
      text,
      html
    };

    if (Array.isArray(attachments) && attachments.length > 0) {
      mailOptions.attachments = attachments;
    }

    logger.info('📧 [sendEmail] Sending mail...', {
      from: mailOptions.from,
      to: mailOptions.to,
      subject,
      hasHTML: !!html,
      htmlLength: html?.length || 0,
      hasText: !!text,
      attachmentCount: Array.isArray(attachments) ? attachments.length : 0
    });

    const info = await transporter.sendMail(mailOptions);

    auditSystem({
      event: 'mail.send.success',
      level: 'info',
      result: { success: true, reason: 'Email sent successfully' },
      metadata: {
        sourceModule: context.sourceModule,
        triggerType: context.triggerType,
        triggerContext: context.triggerContext,
        shiftId: context.shiftId,
        checklistId: context.checklistId,
        entryType: context.entryType,
        smtpConfigId: context.smtpConfigId || config.smtpConfigId || null,
        smtpConfigSource: config.smtpConfigSource || null,
        resolvedRecipientsCount: recipients.length,
        resolvedRecipientsPreview,
        toMasked: recipients.map(maskEmail),
        recipientsCount: recipients.length,
        subject,
        template: html ? 'html' : 'text',
        messageId: info.messageId,
        ...context.extra
      }
    }).catch((err) => logger.error({ err }, 'Audit mail.send.success failed'));
    
    logger.info('✅ [sendEmail] EMAIL SENT SUCCESSFULLY!', {
      messageId: info.messageId,
      recipients: mailOptions.to,
      subject,
      response: info.response
    });

    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    logger.error('❌ [sendEmail] EMAIL SEND FAILED!', {
      error: error.message,
      stack: error.stack,
      to,
      subject
    });

    const config = await getSMTPConfig().catch(() => null);
    const failureCategory = classifyMailFailure(error.message, recipients.length);
    const failureReason = `${failureCategory}: ${error.message}`;
    const noiseSignature = [
      context.sourceModule,
      context.triggerType,
      failureCategory,
      String(subject || '').slice(0, 120),
      recipients.length
    ].join('|');
    const noiseState = buildMailFailureNoiseState(noiseSignature);

    if (noiseState.shouldAudit) {
      auditSystem({
        event: 'mail.send.fail',
        level: 'warn',
        result: { success: false, reason: failureReason },
        metadata: {
          sourceModule: context.sourceModule,
          triggerType: context.triggerType,
          triggerContext: context.triggerContext,
          shiftId: context.shiftId,
          checklistId: context.checklistId,
          entryType: context.entryType,
          smtpConfigId: context.smtpConfigId || config?.smtpConfigId || null,
          smtpConfigSource: config?.smtpConfigSource || null,
          resolvedRecipientsCount: recipients.length,
          resolvedRecipientsPreview,
          toMasked: recipients.map(maskEmail),
          recipientsCount: recipients.length,
          subject,
          template: html ? 'html' : 'text',
          error: error.message,
          failureCategory,
          noiseControl: {
            dedupApplied: noiseState.suppressedInWindow > 0,
            windowMs: noiseState.windowMs,
            countInWindow: noiseState.countInWindow,
            loggedInWindow: noiseState.loggedInWindow,
            suppressedInWindow: noiseState.suppressedInWindow,
            relogEvery: MAIL_AUDIT_RELOG_EVERY
          },
          ...context.extra
        }
      }).catch((err) => logger.error({ err }, 'Audit mail.send.fail failed'));
    }

    throw error;
  }
}

/**
 * Verifica si la configuración SMTP está disponible
 */
async function isConfigured() {
  try {
    const config = await getSMTPConfig();
    return !!(config && config.user && config.pass && config.host);
  } catch (error) {
    return false;
  }
}

/**
 * Invalida el cache de configuración (llamar después de actualizar SMTP)
 */
function invalidateCache() {
  smtpConfigCache = null;
  cacheTime = 0;
}

module.exports = {
  sendEmail,
  createTransporter,
  isConfigured,
  invalidateCache,
  getSMTPConfig
};
