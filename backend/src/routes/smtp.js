/**
 * File Purpose: backend/src/routes/smtp.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Rutas de Configuracion SMTP (estilo Passbolt)
 *
 * Reglas:
 *  - GET    /api/smtp       -> obtiene config sin password
 *  - POST   /api/smtp       -> guarda config solo si la prueba es exitosa
 *  - POST   /api/smtp/test  -> prueba conexion/envio (usa body o config guardada)
 *
 * Seguridad:
 *  - Password cifrada (AES) en Mongo, nunca se expone
 *  - Rate limit en pruebas para evitar abuso de relay
 */
const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const SmtpConfig = require('../models/SmtpConfig');
const AppConfig = require('../models/AppConfig');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { getBrandingSnapshot, formatBrandedSubject, getAppTitleForText } = require('../utils/branding');
const { encrypt, decrypt } = require('../utils/encryption');
const { invalidateCache, resolveTransportSecurityOptions } = require('../utils/email');
const logger = require('../utils/logger');
const { auditSystem } = require('../utils/audit');
const { audit } = require('../utils/audit');

const smtpTestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 15,
  message: 'Demasiados intentos de prueba SMTP. Intenta en 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false,
  // El proyecto usa trust proxy en producción; evitamos validación bloqueante
  // de express-rate-limit para este limiter manteniendo el límite activo.
  validate: {
    trustProxy: false
  }
});

const smtpValidators = [
  body('provider').isIn(['office365', 'aws-ses', 'elastic-email', 'google-mail', 'google-workspace', 'mailgun', 'custom']),
  body('username').trim().notEmpty(),
  body('password').optional().isLength({ min: 8 }).withMessage('Password SMTP debe tener al menos 8 caracteres'),
  body('host').trim().notEmpty(),
  body('port').isInt({ min: 1, max: 65535 }).toInt(),
  body('useTLS').isBoolean(),
  body('senderName').trim().notEmpty(),
  body('senderEmail').isEmail().normalizeEmail(),
  body('recipients').optional().isArray(),
  body('recipients.*').optional().isEmail().normalizeEmail(),
  body('sendOnlyIfRed').isBoolean(),
  body('isActive').optional().isBoolean()
];

const testValidators = [
  body('provider').optional().isIn(['office365', 'aws-ses', 'elastic-email', 'google-mail', 'google-workspace', 'mailgun', 'custom']),
  body('username').optional().trim().notEmpty(),
  body('password').optional().isLength({ min: 8 }),
  body('host').optional().trim().notEmpty(),
  body('port').optional().isInt({ min: 1, max: 65535 }).toInt(),
  body('useTLS').optional().isBoolean(),
  body('senderName').optional().trim().notEmpty(),
  body('senderEmail').optional().isEmail().normalizeEmail(),
  body('recipients').optional().isArray(),
  body('recipients.*').optional().isEmail().normalizeEmail(),
  body('sendOnlyIfRed').optional().isBoolean(),
  body('isActive').optional().isBoolean(),
  body('retryAttempt').optional().isBoolean(),
  body('retryCount').optional().isInt({ min: 1, max: 20 }).toInt()
];

const ensureRequiredFields = (data, requireRecipients = true, requirePassword = true) => {
  const required = ['host', 'port', 'username', 'senderName', 'senderEmail'];
  if (requirePassword) {
    required.push('password');
  }
  for (const field of required) {
    if (!data[field]) return `Falta el campo requerido: ${field}`;
  }
  if (requireRecipients && (!Array.isArray(data.recipients) || data.recipients.length === 0)) {
    return 'Debe haber al menos un destinatario';
  }
  return null;
};

const safeDecrypt = (value, { allowPlainFallback = false } = {}) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const dec = String(decrypt(raw) || '').trim();
  if (dec) return dec;
  return allowPlainFallback ? raw : '';
};

const maskEmail = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  const atIndex = raw.indexOf('@');
  if (!raw || atIndex <= 1) return raw || '';
  return `${raw.slice(0, 2)}***${raw.slice(atIndex)}`;
};

const normalizeRecipients = (input) => {
  if (Array.isArray(input)) {
    return input
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
  if (typeof input === 'string') {
    return input
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const classifySmtpTestFailure = (message = '') => {
  const text = String(message || '').toLowerCase();

  if (text.includes('5.7.139') || text.includes('did not meet the criteria') || text.includes('conditional access')) {
    return 'smtp_auth_policy';
  }
  if (text.includes('535') || text.includes('eauth') || text.includes('invalid login') || text.includes('authentication')) {
    return 'smtp_auth';
  }
  if (text.includes('etimedout') || text.includes('timeout')) {
    return 'smtp_timeout';
  }
  if (text.includes('enotfound') || text.includes('eai_again') || text.includes('getaddrinfo')) {
    return 'smtp_host';
  }
  if (text.includes('ssl') || text.includes('tls') || text.includes('certificate') || text.includes('wrong version number')) {
    return 'smtp_tls';
  }
  if (text.includes('too many') || text.includes('rate limit') || text.includes('throttle')) {
    return 'smtp_throttled';
  }
  return 'smtp_unknown';
};

const findStoredSmtpConfig = async ({ activeOnly = false } = {}) => {
  const query = activeOnly
    ? { $or: [{ isActive: true }, { isActive: { $exists: false } }] }
    : {};

  return SmtpConfig.findOne(query).sort({ updatedAt: -1, createdAt: -1 });
};

const resolveLegacyPasswordFromAppConfig = async () => {
  const appConfig = await AppConfig.findOne().select('smtpConfig').lean();
  const legacy = appConfig?.smtpConfig || null;
  if (!legacy) return '';
  return safeDecrypt(legacy.pass || legacy.password || '', { allowPlainFallback: true });
};

const verifyAndTest = async (config, sendMail = true) => {
  const { appTitle } = await getBrandingSnapshot();
  const systemName = getAppTitleForText(appTitle, 'el sistema');

  const transportSecurity = resolveTransportSecurityOptions({
    port: config.port,
    useTLS: config.useTLS
  });

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: transportSecurity.port,
    secure: transportSecurity.secure,
    requireTLS: transportSecurity.requireTLS,
    auth: {
      user: config.username,
      pass: config.password
    }
  });

  // Verificar conexión SMTP
  await transporter.verify();

  // Si no se solicita enviar email, retornar aquí
  if (!sendMail) {
    return null;
  }

  // Para enviar email de prueba, necesitamos destinatarios
  const testRecipient = (config.recipients && config.recipients[0]) || config.senderEmail;
  if (!testRecipient) throw new Error('No hay destinatarios configurados ni email remitente');

  await transporter.sendMail({
    from: `"${config.senderName}" <${config.senderEmail}>`,
    to: testRecipient,
    subject: appTitle ? `Prueba de Configuracion SMTP - ${appTitle}` : 'Prueba de Configuracion SMTP',
    text: 'Este es un correo de prueba. La configuracion SMTP funciona correctamente.',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Prueba Exitosa</h2>
        <p>Correo de prueba enviado desde <strong>${systemName}</strong>.</p>
        <p>La configuracion SMTP esta funcionando correctamente.</p>
        <hr>
        <small>Fecha: ${new Date().toISOString()}</small>
      </div>
    `
  });

  return testRecipient;
};

// GET /api/smtp - Obtener configuracion SMTP (admin)
router.get('/', authenticate, authorize('admin'), async (_req, res) => {
  try {
    const config = await findStoredSmtpConfig();
    if (!config) return res.json(null);

    const configObj = config.toObject();
    delete configObj.password;
    return res.json(configObj);
  } catch (error) {
    console.error('Error al obtener config SMTP:', error);
    return res.status(500).json({ message: 'Error al obtener configuracion' });
  }
});

// POST /api/smtp - Guardar config solo si la prueba es exitosa
router.post('/',
  authenticate,
  authorize('admin'),
  smtpValidators,
  validate,
  async (req, res) => {
    try {
      const data = { ...req.body };
      let config = await findStoredSmtpConfig();
      const isActive = data.isActive !== false;
      const previousIsActive = config ? (config.isActive !== false) : null;

      await audit(req, {
        event: 'smtp.config.save.attempt',
        level: 'info',
        result: { success: true, reason: 'SMTP save requested' },
        metadata: {
          provider: data.provider,
          host: data.host,
          port: data.port,
          requestedIsActive: isActive,
          previousIsActive,
          hasPasswordInput: Boolean(String(data.password || '').trim())
        }
      });

      const audit400 = async (message, metadata = {}) => {
        await audit(req, {
          event: 'smtp.config.save.rejected',
          level: 'warn',
          result: { success: false, reason: message },
          metadata: {
            provider: data.provider,
            host: data.host,
            port: data.port,
            isActive,
            previousIsActive,
            hasPasswordInput: Boolean(String(data.password || '').trim()),
            ...metadata
          }
        });
      };

      if (!data.password) {
        if (!isActive && config?.password) {
          // Para desactivar SMTP no exigimos descifrar/reingresar la contraseña.
          // Conservamos la contraseña cifrada existente para permitir reactivación futura.
          data.password = '';
        } else if (config?.password) {
          data.password = safeDecrypt(config.password, { allowPlainFallback: false });
          if (!data.password) {
            await audit400('No se pudo reutilizar la contraseña SMTP guardada. Ingresa la contraseña nuevamente y guarda.', {
              source: 'stored-config',
              hadStoredPassword: true
            });
            return res.status(400).json({
              message: 'No se pudo reutilizar la contraseña SMTP guardada. Ingresa la contraseña nuevamente y guarda.'
            });
          }
        } else {
          const legacyPassword = await resolveLegacyPasswordFromAppConfig();
          if (!legacyPassword && isActive) {
            await audit400('Falta el campo requerido: password', {
              source: 'request',
              hadStoredPassword: false
            });
            return res.status(400).json({ message: 'Falta el campo requerido: password' });
          }
          data.password = legacyPassword;
        }
      }

      // No requerir destinatarios para guardar. Password solo obligatorio si SMTP activo.
      const missing = ensureRequiredFields(data, false, isActive);
      if (missing) {
        await audit400(missing, { source: 'required-fields' });
        return res.status(400).json({ message: missing });
      }

      // Verificar conexión sin enviar email (ya que puede no haber destinatarios)
      const hasRecipients = Array.isArray(data.recipients) && data.recipients.length > 0;
      if (isActive) {
        await verifyAndTest({
          ...data,
          password: data.password
        }, hasRecipients);
      }

      const encryptedPassword = data.password
        ? encrypt(data.password)
        : (config?.password || '');

      if (!config) {
        config = new SmtpConfig({
          ...data,
          password: encryptedPassword,
          lastTestDate: new Date(),
          lastTestSuccess: isActive
        });
      } else {
        Object.assign(config, {
          ...data,
          password: encryptedPassword,
          lastTestDate: new Date(),
          lastTestSuccess: isActive ? true : config.lastTestSuccess
        });
      }

      await config.save();
      invalidateCache();

      await audit(req, {
        event: 'smtp.config.save.success',
        level: 'info',
        result: { success: true, reason: isActive ? 'SMTP config saved' : 'SMTP sending disabled' },
        metadata: {
          provider: data.provider,
          host: data.host,
          port: data.port,
          useTLS: data.useTLS,
          recipientsCount: Array.isArray(data.recipients) ? data.recipients.length : 0,
          sendOnlyIfRed: data.sendOnlyIfRed,
          isActive: data.isActive !== false,
          previousIsActive,
          hasPasswordInput: Boolean(String(req.body?.password || '').trim())
        }
      });

      const configObj = config.toObject();
      delete configObj.password;

      return res.json({
        message: isActive ? 'Configuracion SMTP guardada y probada exitosamente' : 'Configuracion SMTP desactivada',
        config: configObj
      });
    } catch (error) {
      await audit(req, {
        event: 'smtp.config.save.error',
        level: 'warn',
        result: { success: false, reason: error.message },
        metadata: {
          host: req.body?.host,
          port: req.body?.port,
          provider: req.body?.provider,
          requestedIsActive: req.body?.isActive !== false,
          hasPasswordInput: Boolean(String(req.body?.password || '').trim())
        }
      });

      console.error('Error al guardar config SMTP:', error);
      return res.status(500).json({ message: 'Error al guardar configuracion SMTP', error: error.message });
    }
  }
);

// POST /api/smtp/test - Probar configuracion (usa body o config guardada)
router.post('/test',
  authenticate,
  authorize('admin'),
  smtpTestLimiter,
  testValidators,
  validate,
  async (req, res) => {
    let usingStoredConfig = false;
    let usingStoredPassword = false;
    let configData = null;
    const retryAttempt = req.body?.retryAttempt === true || req.body?.retryAttempt === 'true';
    const retryCountParsed = Number.parseInt(String(req.body?.retryCount ?? ''), 10);
    const retryCount = Number.isFinite(retryCountParsed) && retryCountParsed > 0 ? retryCountParsed : null;
    try {
      if (Object.keys(req.body || {}).length > 0) {
        const bodyData = { ...req.body };
        const stored = await findStoredSmtpConfig();

        if (!bodyData.password) {
          if (stored?.password) {
            bodyData.password = safeDecrypt(stored.password, { allowPlainFallback: false });
            usingStoredPassword = true;
            if (!bodyData.password) {
              return res.status(400).json({
                message: 'No se pudo reutilizar la contraseña SMTP guardada. Ingresa la contraseña nuevamente y vuelve a probar.'
              });
            }
          } else {
            const legacyPassword = await resolveLegacyPasswordFromAppConfig();
            if (!legacyPassword) {
              return res.status(400).json({ message: 'Falta el campo requerido: password' });
            }
            bodyData.password = legacyPassword;
            usingStoredPassword = true;
          }
        }

        // No requerir destinatarios para prueba de conexión
        const missing = ensureRequiredFields(bodyData, false);
        if (missing) {
          return res.status(400).json({ message: missing });
        }
        configData = bodyData;
      } else {
        const stored = await findStoredSmtpConfig();
        usingStoredConfig = true;
        if (!stored) {
          return res.status(404).json({ message: 'No hay configuracion SMTP' });
        }
        configData = {
          ...stored.toObject(),
          password: safeDecrypt(stored.password, { allowPlainFallback: false })
        };
        if (!configData.password) {
          return res.status(400).json({
            message: 'No se pudo descifrar la contraseña SMTP guardada. Ingresa la contraseña nuevamente en configuración SMTP.'
          });
        }
      }

      // Determinar si enviar email o solo verificar conexión
      const hasRecipients = Array.isArray(configData.recipients) && configData.recipients.length > 0;
      const sendMail = hasRecipients;

      const recipient = await verifyAndTest({
        ...configData,
        password: configData.password
      }, sendMail);

      if (usingStoredConfig) {
        const stored = await findStoredSmtpConfig();
        if (stored) {
          stored.lastTestDate = new Date();
          stored.lastTestSuccess = true;
          await stored.save();
          invalidateCache();
        }
      }

      const message = sendMail
        ? 'Correo de prueba enviado exitosamente'
        : 'Conexión SMTP verificada exitosamente (sin envío de email)';

      await audit(req, {
        event: sendMail ? 'smtp.test.send.success' : 'smtp.test.connection.success',
        level: 'info',
        result: { success: true, reason: message },
        metadata: {
          category: 'smtp_test',
          sourceModule: 'smtp-settings',
          triggerType: 'manual',
          triggerContext: 'smtp-test',
          usingStoredConfig,
          usingStoredPassword,
          retryAttempt,
          retryCount,
          host: configData.host,
          port: configData.port,
          recipient: recipient || null,
          recipientsCount: normalizeRecipients(configData.recipients).length,
          toMasked: normalizeRecipients(configData.recipients).map(maskEmail)
        }
      });

      return res.json({
        message,
        recipient: recipient || 'N/A (solo verificación de conexión)',
        connectionOnly: !sendMail
      });
    } catch (error) {
      const resolvedRecipients = normalizeRecipients(configData?.recipients ?? req.body?.recipients);
      const failureCategory = classifySmtpTestFailure(error.message);

      await audit(req, {
        event: 'smtp.test.fail',
        level: 'warn',
        result: { success: false, reason: error.message },
        metadata: {
          category: 'smtp_test',
          sourceModule: 'smtp-settings',
          triggerType: 'manual',
          triggerContext: 'smtp-test',
          usingStoredConfig,
          usingStoredPassword,
          retryAttempt,
          retryCount,
          host: configData?.host || req.body?.host,
          port: configData?.port || req.body?.port,
          recipientsCount: resolvedRecipients.length,
          resolvedRecipientsCount: resolvedRecipients.length,
          toMasked: resolvedRecipients.map(maskEmail),
          resolvedRecipientsPreview: resolvedRecipients.map(maskEmail),
          failureCategory,
          smtpErrorCode: error.code || null,
          smtpErrorCommand: error.command || null
        }
      });

      console.error('Error al probar SMTP:', error);

      if (usingStoredConfig) {
        const stored = await findStoredSmtpConfig();
        if (stored) {
          stored.lastTestDate = new Date();
          stored.lastTestSuccess = false;
          await stored.save();
          invalidateCache();
        }
      }

      return res.status(500).json({
        message: 'Error al enviar correo de prueba',
        error: error.message
      });
    }
  }
);

// Helper exportado para correos de checklist
const sendChecklistEmail = async (check, services) => {
  try {
    const config = await SmtpConfig.findOne({ isActive: true });
    const { appTitle } = await getBrandingSnapshot();
    const systemName = getAppTitleForText(appTitle, 'el sistema');
    if (!config) {
      console.log('No hay configuracion SMTP activa');
      return;
    }

    if (config.sendOnlyIfRed && !check.hasRedServices) {
      console.log('No se envia correo: no hay servicios en rojo');
      return;
    }

    const decryptedPassword = decrypt(config.password);

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.useTLS,
      auth: {
        user: config.username,
        pass: decryptedPassword
      }
    });

    const servicesHtml = check.services.map(s => {
      const statusColor = s.status === 'verde' ? '#4CAF50' : '#F44336';
      const statusIcon = s.status === 'verde' ? 'OK' : 'ERROR';
      return `
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd;">
            <strong>${s.serviceTitle}</strong>
          </td>
          <td style="padding: 10px; border: 1px solid #ddd; text-align: center; background-color: ${statusColor}; color: white;">
            ${statusIcon} ${s.status.toUpperCase()}
          </td>
          <td style="padding: 10px; border: 1px solid #ddd;">
            ${s.observation || '-'}
          </td>
        </tr>
      `;
    }).join('');

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <h2 style="color: #333;">Checklist de Turno - ${check.type.toUpperCase()}</h2>
        <p><strong>Analista:</strong> ${check.username}</p>
        <p><strong>Fecha:</strong> ${new Date(check.checkDate).toLocaleString()}</p>
        <p><strong>Estado general:</strong> ${check.hasRedServices ? 'Con problemas' : 'OK'}</p>
        
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <thead>
            <tr style="background-color: #f4f4f4;">
              <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Servicio</th>
              <th style="padding: 10px; border: 1px solid #ddd; text-align: center;">Estado</th>
              <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Observacion</th>
            </tr>
          </thead>
          <tbody>
            ${servicesHtml}
          </tbody>
        </table>
        
        <hr style="margin-top: 30px;">
        <small style="color: #666;">${systemName} - ${new Date().toLocaleString()}</small>
      </div>
    `;

    await transporter.sendMail({
      from: `"${config.senderName}" <${config.senderEmail}>`,
      to: config.recipients.join(', '),
      subject: formatBrandedSubject(appTitle, `Checklist de ${check.type} - ${check.username}`),
      html: emailHtml
    });

    console.log('Correo de checklist enviado exitosamente');
  } catch (error) {
    console.error('Error al enviar correo de checklist:', error);
  }
};

// Helper exportado para alertas de checklist no realizado
const sendChecklistAlertEmail = async ({ recipients, alertTime, dateLabel }) => {
  try {
    if (!recipients || recipients.length === 0) {
      return;
    }

    const config = await SmtpConfig.findOne({ isActive: true });
    const { appTitle } = await getBrandingSnapshot();
    const systemName = getAppTitleForText(appTitle, 'el sistema');
    if (!config) {
      console.log('No hay configuracion SMTP activa');
      return;
    }

    const decryptedPassword = decrypt(config.password);

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.useTLS,
      auth: {
        user: config.username,
        pass: decryptedPassword
      }
    });

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <h2 style="color: #d32f2f;">⚠️ Checklist no realizado</h2>
        <p>No se registró el checklist antes de las <strong>${alertTime}</strong> (${dateLabel}).</p>
        <p>Por favor revisar y completar el checklist correspondiente.</p>
        <hr style="margin-top: 20px;">
        <small style="color: #666;">${systemName} - ${new Date().toLocaleString()}</small>
      </div>
    `;

    await transporter.sendMail({
      from: `"${config.senderName}" <${config.senderEmail}>`,
      to: recipients.join(', '),
      subject: formatBrandedSubject(appTitle, 'Checklist pendiente'),
      html: emailHtml
    });

    console.log('Correo de alerta de checklist enviado');
  } catch (error) {
    console.error('Error al enviar correo de alerta de checklist:', error);
  }
};

const sendEscalationInternalReminderEmail = async ({
  recipients,
  cargoLabels,
  dateLabel,
  targetWeekStartLabel,
  targetWeekEndLabel,
  daysAhead
}) => {
  try {
    if (!recipients || recipients.length === 0) {
      return;
    }

    const config = await SmtpConfig.findOne({ isActive: true });
    const { appTitle } = await getBrandingSnapshot();
    const systemName = getAppTitleForText(appTitle, 'el sistema');
    if (!config) {
      console.log('No hay configuracion SMTP activa');
      return;
    }

    const decryptedPassword = decrypt(config.password);
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.useTLS,
      auth: {
        user: config.username,
        pass: decryptedPassword
      }
    });

    const cargosText = Array.isArray(cargoLabels) && cargoLabels.length > 0
      ? cargoLabels.join(', ')
      : 'N2';

    const targetWeekText = targetWeekStartLabel && targetWeekEndLabel
      ? `${targetWeekStartLabel} al ${targetWeekEndLabel}`
      : 'semana futura';

    const leadText = Number.isFinite(Number(daysAhead))
      ? `${Number(daysAhead)} día(s)`
      : 'los próximos días';

    const subject = formatBrandedSubject(appTitle, 'Recordatorio de escalación interna');

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
        <h2 style="color: #1565c0;">🔔 Recordatorio de escalación interna</h2>
        <p>Se detectó una semana futura sin escalación interna cargada en la ventana de anticipación (<strong>${leadText}</strong>).</p>
        <p><strong>Semana objetivo:</strong> ${targetWeekText}</p>
        <p>Fecha de evaluación: <strong>${dateLabel}</strong>.</p>
        <p><strong>Cargos objetivo:</strong> ${cargosText}</p>
        <hr style="margin-top: 20px;">
        <small style="color: #666;">${systemName} - ${new Date().toLocaleString()}</small>
      </div>
    `;

    logger.info('[sendEscalationInternalReminderEmail] Enviando correo...', {
      recipients: recipients.map(r => ({ email: r.substring(0, 3) + '***' })),
      recipientCount: recipients.length,
      cargoLabels,
      subject,
      targetWeek: `${targetWeekStartLabel} al ${targetWeekEndLabel}`,
      daysAhead,
      host: config.host,
      port: config.port,
      sender: config.senderEmail
    });

    const info = await transporter.sendMail({
      from: `"${config.senderName}" <${config.senderEmail}>`,
      to: recipients.join(', '),
      subject,
      html: emailHtml
    });

    logger.info('✅ [sendEscalationInternalReminderEmail] CORREO ENVIADO EXITOSAMENTE', {
      messageId: info.messageId,
      recipients: recipients.length,
      cargoLabels,
      subject,
      response: info.response
    });

    auditSystem({
      event: 'escalation.email.sent',
      level: 'info',
      result: { success: true, reason: 'Email sent successfully' },
      metadata: {
        sourceModule: 'smtp-scheduler',
        triggerType: 'scheduled',
        triggerContext: 'escalation-reminder',
        cargoLabels,
        recipientsCount: recipients.length,
        recipientsMasked: recipients.map((r) => r.substring(0, 3) + '***'),
        subject,
        messageId: info.messageId,
        smtpResponse: info.response,
        host: config.host,
        port: config.port
      }
    }).catch((err) => logger.error({ err }, 'Audit escalation.email.sent failed'));
  } catch (error) {
    logger.error('❌ [sendEscalationInternalReminderEmail] ERROR AL ENVIAR CORREO', {
      error: error.message,
      errorCode: error.code,
      errorCommand: error.command,
      recipients: recipients.map((r) => r.substring(0, 3) + '***'),
      recipientCount: recipients.length,
      cargoLabels,
      subject,
      stack: error.stack
    });

    auditSystem({
      event: 'escalation.email.failed',
      level: 'error',
      result: { success: false, reason: error.message },
      metadata: {
        sourceModule: 'smtp-scheduler',
        triggerType: 'scheduled',
        triggerContext: 'escalation-reminder',
        cargoLabels,
        recipientsCount: recipients.length,
        recipientsMasked: recipients.map((r) => r.substring(0, 3) + '***'),
        subject,
        error: error.message,
        errorCode: error.code,
        errorCommand: error.command,
        host: config.host,
        port: config.port,
        diagnosticHint: 'Revisa credenciales SMTP, conexión de red, o logs del backend para más detalles'
      }
    }).catch((err) => logger.error({ err }, 'Audit escalation.email.failed failed'));

    throw error;
  }
};

module.exports = router;
module.exports.sendChecklistEmail = sendChecklistEmail;
module.exports.sendChecklistAlertEmail = sendChecklistAlertEmail;
module.exports.sendEscalationInternalReminderEmail = sendEscalationInternalReminderEmail;
