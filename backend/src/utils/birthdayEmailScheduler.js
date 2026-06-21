/**
 * File Purpose: backend/src/utils/birthdayEmailScheduler.js
 * Responsibilities: Programar y ejecutar el envío automático de correos de cumpleaños a los usuarios.
 * QA Notes: Mantener auditoría completa y control estricto de ejecuciones diarias.
 */

const fs = require('fs').promises;
const path = require('path');
const AppConfig = require('../models/AppConfig');
const User = require('../models/User');
const { logger } = require('./logger');
const { auditSystem } = require('./audit');
const { sendEmail } = require('./email');
const { getBrandingSnapshot, getAppTitleForText } = require('./branding');

let birthdayIntervalId = null;

/**
 * Resuelve una URL absoluta a partir de una ruta relativa, utilizando el dominio y puerto configurados del backend.
 */
const getAbsoluteUrl = (pathStr) => {
  if (!pathStr) return '';
  if (pathStr.startsWith('http://') || pathStr.startsWith('https://')) {
    return pathStr;
  }
  const host = process.env.HOST_DOMAIN === '0.0.0.0' ? 'localhost' : (process.env.HOST_DOMAIN || 'localhost');
  const port = process.env.BACKEND_PORT || 3000;
  return `http://${host}:${port}${pathStr.startsWith('/') ? '' : '/'}${pathStr}`;
};

/**
 * Compara si dos fechas corresponden al mismo día (año, mes y día)
 */
const isSameDay = (dateA, dateB) => {
  if (!dateA || !dateB) return false;
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
};

/**
 * Ejecuta el proceso de verificación y envío de correos de cumpleaños
 */
const runBirthdayEmails = async () => {
  try {
    const config = await AppConfig.findOne();
    if (!config) return;

    // Verificar si la funcionalidad está activa
    if (!config.birthdayEmailsEnabled) {
      return;
    }

    const now = new Date();

    // Validar si ya se envió hoy
    if (config.lastBirthdayEmailsDate && isSameDay(config.lastBirthdayEmailsDate, now)) {
      return;
    }

    // Validar si ya pasó la hora configurada (formato HH:mm)
    const [configHour, configMin] = (config.birthdayEmailsTime || '09:00').split(':').map(Number);
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();

    if (currentHour < configHour || (currentHour === configHour && currentMin < configMin)) {
      return;
    }

    // Obtener branding para el correo
    const { appTitle } = await getBrandingSnapshot();
    const systemName = getAppTitleForText(appTitle, 'el sistema');

    // Buscar usuarios activos con cumpleaños ingresado
    const activeUsers = await User.find({
      isActive: true,
      birthday: { $ne: null }
    }).select('email fullName username birthday');

    const currentMonth = now.getMonth(); // 0-11
    const currentDate = now.getDate(); // 1-31

    // Filtrar usuarios que cumplen años hoy
    const birthdayUsers = activeUsers.filter(user => {
      if (!user.birthday) return false;
      const bdate = new Date(user.birthday);
      // Usamos UTC para evitar desfases debido a la zona horaria del almacenamiento
      return bdate.getUTCMonth() === currentMonth && bdate.getUTCDate() === currentDate;
    });

    if (birthdayUsers.length === 0) {
      // Registrar que ya se validó hoy y no hubo cumpleañeros
      config.lastBirthdayEmailsDate = now;
      await config.save();
      logger.info({ event: 'birthday.scheduler.checked', count: 0 }, 'Verificación de cumpleaños completada: sin cumpleañeros hoy.');
      return;
    }

    logger.info({ event: 'birthday.scheduler.sending', count: birthdayUsers.length }, `Enviando felicitaciones de cumpleaños a ${birthdayUsers.length} usuarios.`);

    // Enviar correos
    for (const user of birthdayUsers) {
      if (!user.email) continue;

      const userName = user.fullName || user.username;
      
      // Consultar el logo y la configuración del branding
      const appConfig = await AppConfig.findOne().select('logoUrl logoType').lean();
      const logoUrl = appConfig?.logoUrl;
      const logoType = appConfig?.logoType;
      
      const attachments = [];

      // Incrustar imagen kawaii de felicitación como adjunto inline (CID) para evitar bloqueos del cliente de correo
      try {
        const kawaiiPath = path.resolve(path.join(__dirname, '../assets/branding/birthday_kawaii.png'));
        const kawaiiBuf = await fs.readFile(kawaiiPath);
        if (kawaiiBuf && kawaiiBuf.length) {
          attachments.push({
            filename: 'birthday_kawaii.png',
            content: kawaiiBuf,
            cid: 'birthday-kawaii@bitacora',
            contentType: 'image/png',
            contentDisposition: 'inline'
          });
        }
      } catch (err) {
        logger.error({ err }, 'Error al leer imagen kawaii de cumpleaños para adjunto inline de correo');
      }

      let logoHtml = '';
      let logoCid = null;

      if (logoUrl) {
        let resolvedLogoUrl = logoUrl;
        // Si el logo fue subido por el usuario, resolver su ruta absoluta de uploads
        if (logoType === 'upload' && !logoUrl.startsWith('/') && !logoUrl.startsWith('http')) {
          resolvedLogoUrl = `/uploads/${logoUrl}`;
        }

        // Si es una ruta local del servidor, cargar el archivo e incrustarlo mediante CID
        if (resolvedLogoUrl.startsWith('/uploads/')) {
          try {
            const logoPath = path.resolve(path.join(__dirname, '../..', resolvedLogoUrl.split('?')[0]));
            const logoBuf = await fs.readFile(logoPath);
            if (logoBuf && logoBuf.length) {
              const ext = path.extname(logoPath).toLowerCase().replace('.', '') || 'png';
              const ct = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
              const cidStr = 'logo-email@bitacora';
              
              attachments.push({
                filename: `logo-email.${ext}`,
                content: logoBuf,
                cid: cidStr,
                contentType: ct,
                contentDisposition: 'inline'
              });
              logoCid = `cid:${cidStr}`;
            }
          } catch (err) {
            logger.error({ err }, 'Error al leer logotipo para adjunto inline de correo de cumpleaños');
          }
        }

        // Generar la etiqueta img correspondiente usando CID o fallback de URL absoluta
        if (logoCid) {
          logoHtml = `<img src="${logoCid}" alt="Logo" style="max-height: 48px; width: auto; display: inline-block; margin-bottom: 5px;" height="48">`;
        } else if (resolvedLogoUrl.startsWith('http://') || resolvedLogoUrl.startsWith('https://')) {
          logoHtml = `<img src="${resolvedLogoUrl}" alt="Logo" style="max-height: 48px; width: auto; display: inline-block; margin-bottom: 5px;" height="48">`;
        } else {
          logoHtml = `<img src="${getAbsoluteUrl(resolvedLogoUrl)}" alt="Logo" style="max-height: 48px; width: auto; display: inline-block; margin-bottom: 5px;" height="48">`;
        }
      } else {
        // Fallback en caso de que no haya un logo configurado
        logoHtml = `<div style="display: inline-block; background-color: #155f50; color: #ffffff; width: 44px; height: 44px; line-height: 44px; border-radius: 12px; font-size: 22px; font-weight: bold; text-align: center; margin-bottom: 5px;">🎂</div>`;
      }

      // Utilizar la imagen adjunta por CID si se cargó correctamente; de lo contrario usar fallback de URL absoluta
      const hasKawaiiAttachment = attachments.some(a => a.cid === 'birthday-kawaii@bitacora');
      const kawaiiImgUrl = hasKawaiiAttachment ? 'cid:birthday-kawaii@bitacora' : getAbsoluteUrl('/uploads/birthday_kawaii.png');

      const emailHtml = `
        <div style="font-family: 'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f1faf4; padding: 40px 20px; text-align: center; margin: 0; min-height: 100%;">
          <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 30px rgba(21, 95, 80, 0.08); border: 1px solid #e2f3e7; text-align: left;">
            
            <!-- Encabezado con Logo y Título -->
            <div style="padding: 30px 30px 10px 30px; text-align: center;">
              ${logoHtml}
              <h2 style="margin: 10px 0 0 0; font-size: 16px; font-weight: 600; color: #155f50; text-transform: uppercase; letter-spacing: 2px;">
                ${systemName}
              </h2>
            </div>

            <!-- Imagen Kawaii Central -->
            <div style="padding: 10px 30px; text-align: center;">
              <img src="${kawaiiImgUrl}" alt="¡Feliz Cumpleaños!" style="max-width: 100%; height: auto; border-radius: 16px; display: block; margin: 0 auto;" width="380">
            </div>

            <!-- Título y Nombre Destacado -->
            <div style="padding: 20px 30px 10px 30px; text-align: center;">
              <h1 style="margin: 0; font-size: 32px; font-weight: 900; color: #173831; letter-spacing: -0.5px;">HAPPY BIRTHDAY</h1>
              <div style="display: inline-block; margin-top: 10px; background-color: #ff7675; color: #ffffff; padding: 10px 24px; border-radius: 12px; font-size: 24px; font-weight: 800; text-transform: uppercase; box-shadow: 0 4px 10px rgba(255, 118, 117, 0.3);">
                ${userName}
              </div>
            </div>

            <!-- Mensaje del Equipo -->
            <div style="padding: 10px 40px 30px 40px; text-align: center; color: #4b655f; font-size: 15px; line-height: 1.6;">
              <p style="margin: 0;">
                ¡En nombre de todo el equipo de <strong>${systemName}</strong>, te enviamos nuestras más sinceras felicitaciones en tu cumpleaños!
              </p>
              <p style="margin: 15px 0 0 0;">
                Agradecemos profundamente tu compromiso diario y tu excelente labor. Esperamos que tengas un día lleno de alegrías, rodeado de tus seres queridos. ¡Que se cumplan todos tus deseos!
              </p>
            </div>

            <!-- Pie de página -->
            <div style="background-color: #fafdfb; padding: 20px; border-top: 1px solid #eaf6ee; font-size: 12px; color: #8eaba4; text-align: center;">
              <span>Este es un correo automático enviado por el SOC de ${systemName}.</span>
            </div>
          </div>
        </div>
      `;

      try {
        await sendEmail({
          to: user.email,
          subject: `¡Feliz Cumpleaños ${user.fullName || user.username}! 🎂`,
          html: emailHtml,
          attachments: attachments.length ? attachments : undefined,
          auditContext: {
            sourceModule: 'birthday-scheduler',
            triggerType: 'scheduled',
            triggerContext: 'birthday-congratulations'
          }
        });

        await auditSystem({
          event: 'birthday.email.sent',
          level: 'info',
          result: { success: true },
          metadata: {
            recipientId: user._id,
            recipientUsername: user.username,
            recipientEmail: user.email
          }
        });
      } catch (err) {
        logger.error({ err, userId: user._id }, 'Error al enviar correo de cumpleaños a usuario');
      }
    }

    // Registrar fecha de ejecución exitosa
    config.lastBirthdayEmailsDate = now;
    await config.save();

  } catch (error) {
    logger.error({ err: error }, 'Error fatal en la ejecución del planificador de cumpleaños');
  }
};

/**
 * Inicializa el planificador de cumpleaños
 */
const startBirthdayEmailScheduler = () => {
  // Ejecutar cada 2 minutos para agilizar la detección y pruebas en tiempo real
  const intervalMs = 2 * 60 * 1000;
  
  logger.info({ event: 'birthday.scheduler.start', intervalMs }, 'Planificador de correos de cumpleaños iniciado.');
  
  // Ejecución inicial inmediata
  runBirthdayEmails();

  birthdayIntervalId = setInterval(() => {
    runBirthdayEmails();
  }, intervalMs);
};

/**
 * Detiene el planificador de cumpleaños
 */
const stopBirthdayEmailScheduler = () => {
  if (birthdayIntervalId) {
    clearInterval(birthdayIntervalId);
    birthdayIntervalId = null;
    logger.info({ event: 'birthday.scheduler.stop' }, 'Planificador de correos de cumpleaños detenido.');
  }
};

module.exports = {
  startBirthdayEmailScheduler,
  stopBirthdayEmailScheduler,
  runBirthdayEmails
};
