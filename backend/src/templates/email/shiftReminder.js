/**
 * File Purpose: backend/src/templates/email/shiftReminder.js
 * Responsibilities: Generate HTML and formatting utilities for shift reminder emails.
 */

const { getAppTitleForText } = require('../../utils/branding');

/**
 * Escapa caracteres HTML especiales para evitar XSS.
 * @param {string} value - Texto a escapar.
 * @returns {string} Texto escapado.
 */
function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formatea el texto de recordatorio para que sea compatible con HTML en el correo.
 * @param {string} reminderText - Texto original del recordatorio.
 * @returns {string} Código HTML de las líneas del recordatorio.
 */
function formatReminderTextForEmail(reminderText = '') {
  const normalized = String(reminderText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  return lines.map((line) => {
    const trimmed = line.trim();

    if (!trimmed) {
      return '<div style="height:12px;line-height:12px;">&nbsp;</div>';
    }

    const bulletMatch = trimmed.match(/^(\*|-|•)\s+(.*)$/);
    if (bulletMatch) {
      return `<div style="margin:0 0 6px 0;color:#111111;font-size:15px;line-height:1.6;">&bull; ${escapeHtml(bulletMatch[2])}</div>`;
    }

    return `<div style="margin:0 0 10px 0;color:#111111;font-size:15px;line-height:1.6;">${escapeHtml(line).replace(/  /g, ' &nbsp;')}</div>`;
  }).join('');
}

/**
 * Genera la plantilla de correo de recordatorio en HTML.
 * @param {Object} data - Datos para completar el correo.
 * @param {string} data.appTitle - Título de la aplicación.
 * @param {string} data.reminderText - Mensaje de recordatorio.
 * @returns {string} HTML completo para el cuerpo del correo.
 */
function buildReminderHtml({ appTitle, reminderText }) {
  const safeTitle = escapeHtml(getAppTitleForText(appTitle));
  const formattedBody = formatReminderTextForEmail(reminderText);

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table cellpadding="0" cellspacing="0" width="560" style="border-collapse:collapse;margin:24px auto;background:#ffffff;border:1px solid #ddd;border-radius:4px;">
    <tr>
      <td style="background:#1565c0;padding:20px 24px;">
        <p style="margin:0;font-size:13px;color:#bbdefb;">${safeTitle}</p>
        <h2 style="margin:4px 0 0 0;color:#ffffff;font-size:20px;">Recordatorio de Turno</h2>
      </td>
    </tr>
    <tr>
      <td style="padding:32px 24px;">
        <div style="margin:0;color:#111111;">${formattedBody}</div>
        <p style="margin:24px 0 0 0;font-size:12px;color:#888888;line-height:1.5;">
          Este es un recordatorio automático generado por ${safeTitle}. No responder a este correo.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = {
  buildReminderHtml,
  formatReminderTextForEmail
};
