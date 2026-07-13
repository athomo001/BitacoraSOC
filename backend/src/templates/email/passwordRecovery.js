/**
 * File Purpose: backend/src/templates/email/passwordRecovery.js
 * Responsibilities: Generate HTML and plain text template for password recovery emails.
 */

/**
 * Genera el contenido HTML y texto plano para el correo de recuperación de contraseña.
 * @param {Object} data - Datos para rellenar la plantilla.
 * @param {string} data.resetUrl - URL única de restablecimiento de contraseña.
 * @param {string} data.systemName - Nombre del sistema.
 * @param {string} data.teamName - Nombre del equipo o firma del remitente.
 * @returns {{html: string, text: string}} Objeto con las versiones de texto e HTML.
 */
function buildPasswordRecoveryEmail({ resetUrl, systemName, teamName }) {
  // Versión en texto plano para clientes de correo sin soporte HTML
  const text = `Hola,\n\nHemos recibido una solicitud para resetear tu contraseña en ${systemName}.\n\nHaz click en el siguiente enlace para crear una nueva contraseña:\n${resetUrl}\n\nEste enlace expirará en 5 minutos.\n\nSi no solicitaste este cambio, ignora este email.\n\nSaludos,\n${teamName}`;

  // Versión en formato HTML enriquecido
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1976d2;">Recuperación de Contraseña</h2>
      <p>Hola,</p>
      <p>Hemos recibido una solicitud para resetear tu contraseña en ${systemName}.</p>
      <p>Haz click en el siguiente botón para crear una nueva contraseña:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetUrl}" style="background-color: #1976d2; color: white; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block;">
          Resetear Contraseña
        </a>
      </div>
      <p><small>O copia y pega este enlace en tu navegador:<br>${resetUrl}</small></p>
      <p style="color: #f44336;"><strong>⏰ Este enlace expirará en 5 minutos.</strong></p>
      <p>Si no solicitaste este cambio, ignora este email.</p>
      <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
      <p style="color: #666; font-size: 12px;">Saludos,<br>${teamName}</p>
    </div>
  `;

  return { html, text };
}

module.exports = { buildPasswordRecoveryEmail };
