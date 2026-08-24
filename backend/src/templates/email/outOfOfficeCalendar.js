/**
 * File Purpose: backend/src/templates/email/outOfOfficeCalendar.js
 * Responsibilities: Generate MJML-based HTML email for the out-of-office weekly calendar (Mon-Fri grid) notification.
 */

const mjml = require('mjml');

/**
 * Escapa caracteres HTML especiales para evitar vulnerabilidades XSS.
 * @param {any} v - Valor a escapar.
 * @returns {string} Cadena de texto escapada de forma segura.
 */
function e(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Paleta de colores compartida con el correo de lista (escalationSchedule.js) para mantener la misma familia visual
const PALETTE = {
  pageBg: '#173831',
  headerBg: '#155F50',
  cardBg: '#F8FAE1',
  cardAccent: '#EEF3C8',
  softLine: '#D7DEC0',
  headerText: '#F8FAE1',
  bodyText: '#173831',
  mutedText: '#5B695D',
  white: '#FFFFFF'
};

// Metadatos por estado (emoji + color), replicando la paleta usada en la impresión de escalaciones
// (escalation-simple.component.ts) pero con emoji en vez de la fuente Material Icons, que no carga de forma
// confiable en clientes de correo (particularmente Outlook de escritorio).
const STATUS_META = {
  telework: { emoji: '🏠', label: 'Teletrabajo', color: '#047857' },
  training: { emoji: '🎓', label: 'Charla/Capacitación', color: '#b45309' },
  vacation: { emoji: '🏖️', label: 'Vacaciones', color: '#b91c1c' },
  'medical-leave': { emoji: '🤒', label: 'Licencia Médica', color: '#b91c1c' },
  'medical-appointment': { emoji: '🏥', label: 'Trámite Médico', color: '#0e7490' }
};

const LEGEND_ORDER = ['telework', 'training', 'vacation', 'medical-leave', 'medical-appointment'];

/**
 * Genera el HTML compilado a partir de MJML para el correo de calendario semanal de personal fuera de oficina.
 * @param {Object} data - Datos para completar la plantilla del correo.
 * @param {Array} data.columns - Columnas de días [{ dayShort, dateShort }] (Lunes a Viernes).
 * @param {Array} data.rows - Filas de personal [{ name, cargoLabel, days: [{ status }] }].
 * @param {string} data.periodLabel - Etiqueta representativa de las fechas del período.
 * @param {string|null} data.logoCid - CID del logo para adjuntar en línea.
 * @param {string} data.brandName - Nombre de marca de la aplicación.
 * @param {string} data.title - Título principal de la cabecera.
 * @returns {Promise<{html: string, errors: Array}>} Resultado HTML y advertencias de compilación.
 */
async function buildOutOfOfficeCalendarEmail({ columns = [], rows = [], periodLabel = '', logoCid = null, brandName = 'Bitácora CDC', title = 'Personal Fuera de la Oficina y Apoyo' }) {

  const headerCells = columns.map((col) => `
    <th style="text-align:center; padding:10px 6px; color:${PALETTE.mutedText}; font-size:12px; white-space:nowrap; border-bottom: 2px solid ${PALETTE.softLine}; border-left: 1px solid ${PALETTE.softLine};">
      ${e(col.dayShort)}<br/><span style="font-weight:400; font-size:10.5px;">${e(col.dateShort)}</span>
    </th>
  `).join('');

  const bodyRows = rows.length > 0
    ? rows.map((row, i) => {
        const isLast = i === rows.length - 1;
        const border = isLast ? 'none' : `1px solid ${PALETTE.softLine}`;

        const dayCells = (row.days || []).map((day) => {
          const meta = STATUS_META[day.status];
          const content = meta
            ? `<span style="font-size:22px; line-height:1;">${meta.emoji}</span><br/><span style="display:inline-block; margin-top:3px; font-size:9.5px; font-weight:700; text-transform:uppercase; color:${meta.color};">${e(meta.label)}</span>`
            : '';
          return `<td style="padding:10px 4px; border-bottom:${border}; border-left: 1px solid ${PALETTE.softLine}; text-align:center; vertical-align:middle;">${content}</td>`;
        }).join('');

        const cargoHtml = row.cargoLabel
          ? `<br/><span style="font-size:11px; font-weight:400; color:${PALETTE.mutedText};">${e(row.cargoLabel)}</span>`
          : '';

        return `
          <tr>
            <td style="padding:12px 8px; border-bottom:${border}; color:${PALETTE.bodyText}; font-size:14px; font-weight:700; line-height:1.35; white-space:nowrap;">${e(row.name)}${cargoHtml}</td>
            ${dayCells}
          </tr>
        `;
      }).join('')
    : `<tr><td colspan="${1 + columns.length}" style="padding:20px; text-align:center; font-style:italic; color:${PALETTE.mutedText}; font-size:13px;">Sin personal registrado para la semana seleccionada</td></tr>`;

  const legendHtml = LEGEND_ORDER.map((status) => {
    const meta = STATUS_META[status];
    return `<span style="display:inline-block; margin:0 14px 8px 0; font-size:12px; color:${PALETTE.mutedText}; white-space:nowrap;"><span style="font-size:15px;">${meta.emoji}</span> ${e(meta.label)}</span>`;
  }).join('');

  const template = `
<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="'Segoe UI', Roboto, Helvetica, Arial, sans-serif" />
      <mj-section padding="0px" />
    </mj-attributes>
    <mj-style inline="inline">
      .calendar-table {
        width: 100%;
        border-collapse: collapse;
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#FFFFFF" width="880px">
    <mj-wrapper background-color="${PALETTE.pageBg}" padding="20px 0">

      <!-- Cabecera -->
      <mj-section padding="24px" background-color="${PALETTE.headerBg}" border-radius="12px 12px 0 0">
        <mj-column width="100%">
          <mj-table padding="0 0 15px 0">
            <tr>
              <td style="width:50%; vertical-align:middle;">
                ${logoCid
                  ? `<img src="${logoCid}" width="180" alt="${e(brandName)}" />`
                  : `<span style="font-size:28px; font-weight:700; color:${PALETTE.headerText};">${e(brandName)}</span>`
                }
              </td>
              <td style="width:50%; text-align:right; vertical-align:middle;">
                <span style="font-size:13px; font-weight:700; color:${PALETTE.headerText}; letter-spacing:1px;">CALENDARIO SEMANAL</span>
              </td>
            </tr>
          </mj-table>
          <mj-text align="center" color="${PALETTE.headerText}" font-size="30px" font-weight="700" padding="10px 0">
            ${e(title)}
          </mj-text>
          <mj-text align="center" color="${PALETTE.cardAccent}" font-size="18px" font-weight="400" padding="0">
            ${e(periodLabel)}
          </mj-text>
        </mj-column>
      </mj-section>

      <!-- Tabla Calendario -->
      <mj-section background-color="${PALETTE.cardBg}" padding="30px 24px" border-radius="0 0 12px 12px">
        <mj-column width="100%">
          <mj-table css-class="calendar-table">
            <tr>
              <th style="text-align:left; padding:10px 8px; color:${PALETTE.mutedText}; font-size:12px; white-space:nowrap; border-bottom: 2px solid ${PALETTE.softLine};">NOMBRE</th>
              ${headerCells}
            </tr>
            ${bodyRows}
          </mj-table>

          <mj-spacer height="20px" />

          <mj-divider border-width="1px" border-style="dashed" border-color="${PALETTE.softLine}" />

          <mj-spacer height="16px" />

          <mj-text align="center" padding="0 0 10px 0">
            ${legendHtml}
          </mj-text>

          <mj-text font-size="13px" line-height="19px" color="${PALETTE.mutedText}" align="center" font-style="italic">
            Nota de control interno: La presente programación es de carácter representativo y está sujeta a cambios y adaptaciones operativas según las necesidades críticas del servicio SOC durante la semana en curso.
          </mj-text>
          <mj-spacer height="10px" />
          <mj-text font-size="15px" line-height="22px" color="${PALETTE.mutedText}" align="center">
            Este es un correo automático generado por el sistema ${e(brandName)}.
          </mj-text>
        </mj-column>
      </mj-section>

    </mj-wrapper>

    <!-- Footer -->
    <mj-section padding="20px 0">
      <mj-column>
        <mj-text align="center" color="#999999" font-size="13px">
          &copy; ${new Date().getFullYear()} ${e(brandName)} &middot; Todos los derechos reservados
        </mj-text>
      </mj-column>
    </mj-section>

  </mj-body>
</mjml>
  `;

  const result = await mjml(template, { validationLevel: 'soft' });
  const html = result?.html || '';
  if (!html || html.trim().length === 0) {
    console.error('[outOfOfficeCalendarEmailTemplate] MJML compilation produced empty HTML', {
      hasResult: !!result,
      hasHtml: !!result?.html,
      htmlLength: result?.html?.length || 0,
      errors: result?.errors || [],
      template: template.substring(0, 200)
    });
  }

  return { html, errors: result?.errors || [] };
}

module.exports = { buildOutOfOfficeCalendarEmail };
