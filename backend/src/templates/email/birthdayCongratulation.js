/**
 * File Purpose: backend/src/templates/email/birthdayCongratulation.js
 * Responsibilities: Generate HTML email template for user birthday congratulations.
 */

/**
 * Genera el cuerpo de correo en formato HTML para felicitar a los usuarios en su cumpleaños.
 * @param {Object} data - Parámetros de datos del correo.
 * @param {string} data.logoHtml - Fragmento de código HTML representativo del logo del sistema.
 * @param {string} data.systemName - Nombre de marca de la aplicación.
 * @param {string} data.kawaiiImgUrl - URL absoluta o CID de la imagen Kawaii decorativa.
 * @param {string} data.userName - Nombre del usuario a felicitar.
 * @returns {string} HTML final de la plantilla de cumpleaños.
 */
function buildBirthdayEmail({ logoHtml, systemName, kawaiiImgUrl, userName }) {
  return `
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
}

module.exports = { buildBirthdayEmail };
