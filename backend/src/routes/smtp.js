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
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { encrypt, decrypt } = require('../utils/encryption');
const { invalidateCache } = require('../utils/email');
const { audit } = require('../utils/audit');

const smtpTestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 3,
  message: 'Demasiados intentos de prueba SMTP. Intenta en 15 minutos.',
  standardHeaders: true,
  legacyHeaders: false
});

const smtpValidators = [
  body('provider').isIn(['office365', 'aws-ses', 'elastic-email', 'google-mail', 'google-workspace', 'mailgun', 'custom']),
  body('username').trim().notEmpty(),
  body('password').isLength({ min: 8 }).withMessage('Password SMTP debe tener al menos 8 caracteres'),
  body('host').trim().notEmpty(),
  body('port').isInt({ min: 1, max: 65535 }).toInt(),
  body('useTLS').isBoolean(),
  body('senderName').trim().notEmpty(),
  body('senderEmail').isEmail().normalizeEmail(),
  body('recipients').optional().isArray({ min: 1 }),
  body('recipients.*').optional().isEmail().normalizeEmail(),
  body('sendOnlyIfRed').isBoolean()
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
  body('recipients').optional().isArray({ min: 1 }),
  body('recipients.*').optional().isEmail().normalizeEmail(),
  body('sendOnlyIfRed').optional().isBoolean()
];

const ensureRequiredFields = (data, requireRecipients = true) => {
  const required = ['host', 'port', 'username', 'password', 'senderName', 'senderEmail'];
  for (const field of required) {
    if (!data[field]) return `Falta el campo requerido: ${field}`;
  }
  if (requireRecipients && (!Array.isArray(data.recipients) || data.recipients.length === 0)) {
    return 'Debe haber al menos un destinatario';
  }
  return null;
};

const verifyAndTest = async (config, sendMail = true) => {
  // Determinar si usar SSL seguro o STARTTLS
  // Puerto 465 = SSL directo (secure: true)
  // Puerto 587 = STARTTLS (secure: false, luego upgrade)
  // Puerto 25 = Sin encriptación (secure: false)
  const secure = config.port === 465;

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: secure,
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
    subject: 'Prueba de Configuracion SMTP - Bitacora SOC',
    text: 'Este es un correo de prueba. La configuracion SMTP funciona correctamente.',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Prueba Exitosa</h2>
        <p>Correo de prueba enviado desde la <strong>Bitacora SOC</strong>.</p>
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
    const config = await SmtpConfig.findOne();
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
      const data = req.body;

      // No requerir destinatarios para guardar
      const missing = ensureRequiredFields(data, false);
      if (missing) {
        return res.status(400).json({ message: missing });
      }

      // Verificar conexión sin enviar email (ya que puede no haber destinatarios)
      const hasRecipients = Array.isArray(data.recipients) && data.recipients.length > 0;
      await verifyAndTest({
        ...data,
        password: data.password
      }, hasRecipients);

      const encryptedPassword = encrypt(data.password);

      let config = await SmtpConfig.findOne();
      if (!config) {
        config = new SmtpConfig({
          ...data,
          password: encryptedPassword,
          lastTestDate: new Date(),
          lastTestSuccess: true
        });
      } else {
        Object.assign(config, {
          ...data,
          password: encryptedPassword,
          lastTestDate: new Date(),
          lastTestSuccess: true
        });
      }

      await config.save();
      invalidateCache();

      await audit(req, {
        event: 'admin.smtp.config.update',
        level: 'info',
        result: { success: true, reason: 'SMTP config saved' },
        metadata: {
          provider: data.provider,
          host: data.host,
          port: data.port,
          useTLS: data.useTLS,
          recipientsCount: Array.isArray(data.recipients) ? data.recipients.length : 0,
          sendOnlyIfRed: data.sendOnlyIfRed
        }
      });

      const configObj = config.toObject();
      delete configObj.password;

      return res.json({
        message: 'Configuracion SMTP guardada y probada exitosamente',
        config: configObj
      });
    } catch (error) {
      await audit(req, {
        event: 'admin.smtp.config.update',
        level: 'warn',
        result: { success: false, reason: error.message },
        metadata: {
          host: req.body?.host,
          port: req.body?.port,
          provider: req.body?.provider
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
    try {
      let configData = null;

      if (Object.keys(req.body || {}).length > 0) {
        // No requerir destinatarios para prueba de conexión
        const missing = ensureRequiredFields(req.body, false);
        if (missing) {
          return res.status(400).json({ message: missing });
        }
        configData = req.body;
      } else {
        const stored = await SmtpConfig.findOne();
        usingStoredConfig = true;
        if (!stored) {
          return res.status(404).json({ message: 'No hay configuracion SMTP' });
        }
        configData = {
          ...stored.toObject(),
          password: decrypt(stored.password)
        };
      }

      // Determinar si enviar email o solo verificar conexión
      const hasRecipients = Array.isArray(configData.recipients) && configData.recipients.length > 0;
      const sendMail = hasRecipients;

      const recipient = await verifyAndTest({
        ...configData,
        password: configData.password
      }, sendMail);

      if (usingStoredConfig) {
        const stored = await SmtpConfig.findOne();
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
          usingStoredConfig,
          host: configData.host,
          port: configData.port,
          recipient: recipient || null,
          recipientsCount: Array.isArray(configData.recipients) ? configData.recipients.length : 0
        }
      });

      return res.json({
        message,
        recipient: recipient || 'N/A (solo verificación de conexión)',
        connectionOnly: !sendMail
      });
    } catch (error) {
      await audit(req, {
        event: 'smtp.test.fail',
        level: 'warn',
        result: { success: false, reason: error.message },
        metadata: {
          usingStoredConfig,
          host: req.body?.host,
          port: req.body?.port
        }
      });

      console.error('Error al probar SMTP:', error);

      if (usingStoredConfig) {
        const stored = await SmtpConfig.findOne();
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
        <small style="color: #666;">Bitacora SOC - ${new Date().toLocaleString()}</small>
      </div>
    `;

    await transporter.sendMail({
      from: `"${config.senderName}" <${config.senderEmail}>`,
      to: config.recipients.join(', '),
      subject: `[Bitacora SOC] Checklist de ${check.type} - ${check.username}`,
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
        <small style="color: #666;">Bitácora SOC - ${new Date().toLocaleString()}</small>
      </div>
    `;

    await transporter.sendMail({
      from: `"${config.senderName}" <${config.senderEmail}>`,
      to: recipients.join(', '),
      subject: '[Bitácora SOC] Checklist pendiente',
      html: emailHtml
    });

    console.log('Correo de alerta de checklist enviado');
  } catch (error) {
    console.error('Error al enviar correo de alerta de checklist:', error);
  }
};

module.exports = router;
module.exports.sendChecklistEmail = sendChecklistEmail;
module.exports.sendChecklistAlertEmail = sendChecklistAlertEmail;
