/**
 * File Purpose: backend/src/utils/escalationScheduleEmailTemplate.js
 * Responsibilities: Generate MJML-based HTML email for escalation schedule notifications.
 */

const mjml = require('mjml');

function e(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(fecha) {
  if (!fecha) return '-';
  try {
    const d = new Date(fecha);
    if (isNaN(d.getTime())) return String(fecha);
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return String(fecha); }
}

function formatTime(fecha) {
  if (!fecha) return '-';
  try {
    const d = new Date(fecha);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

const PALETTE = {
  pageBg: '#173831',
  headerBg: '#155F50',
  cardBg: '#F8FAE1',
  cardAccent: '#EEF3C8',
  softLine: '#D7DEC0',
  headerText: '#F8FAE1',
  bodyText: '#173831',
  mutedText: '#5B695D',
  white: '#FFFFFF',
  accent: '#4CAF50'
};

/**
 * Genera el HTML del correo de turnos de escalación
 * @param {Object} data - Datos del turno
 * @param {Array} data.schedule - Lista de turnos [{ analystName, startDate, endDate, cargoLabel, isCurrent }]
 * @param {string} data.periodLabel - Texto del periodo (ej: "Semana del 07 al 13 de Mayo")
 * @param {string} data.logoCid - CID del logo para adjuntar
 * @param {string} data.brandName - Nombre de la marca (Bitácora SOC)
 */
async function buildEscalationScheduleEmail({ schedule = [], periodLabel = '', logoCid = null, brandName = 'Bitácora SOC' }) {
  
  const scheduleRows = schedule.map((s, i) => {
    const isLast = i === schedule.length - 1;
    const border = isLast ? 'none' : `1px solid ${PALETTE.softLine}`;
    const badge = s.isCurrent 
      ? `<span style="background-color:${PALETTE.accent}; color:${PALETTE.white}; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:700;">EN TURNO</span>`
      : `<span style="background-color:${PALETTE.mutedText}; color:${PALETTE.white}; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:700;">PRÓXIMO</span>`;

    return `
      <tr>
        <td style="padding:12px 8px; border-bottom:${border}; color:${PALETTE.bodyText}; font-weight:700;">${e(s.analystName)}</td>
        <td style="padding:12px 8px; border-bottom:${border}; color:${PALETTE.bodyText}; font-size:13px;">
          ${formatDate(s.startDate)} ${formatTime(s.startDate)}
        </td>
        <td style="padding:12px 8px; border-bottom:${border}; color:${PALETTE.bodyText}; font-size:13px;">
          ${formatDate(s.endDate)} ${formatTime(s.endDate)}
        </td>
        <td style="padding:12px 8px; border-bottom:${border}; color:${PALETTE.mutedText}; font-size:12px;">${e(s.cargoLabel || '-')}</td>
        <td style="padding:12px 8px; border-bottom:${border}; text-align:right;">${badge}</td>
      </tr>
    `;
  }).join('');

  const template = `
<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="'Segoe UI', Roboto, Helvetica, Arial, sans-serif" />
      <mj-section padding="0px" />
    </mj-attributes>
    <mj-style inline="inline">
      .schedule-table {
        width: 100%;
        border-collapse: collapse;
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#FFFFFF" width="800px">
    <mj-wrapper background-color="${PALETTE.pageBg}" padding="20px 0">
      
      <!-- Cabecera -->
      <mj-section padding="24px" background-color="${PALETTE.headerBg}" border-radius="12px 12px 0 0">
        <mj-column width="100%">
          <mj-table padding="0 0 15px 0">
            <tr>
              <td style="width:50%; vertical-align:middle;">
                ${logoCid 
                  ? `<img src="${logoCid}" width="150" alt="${e(brandName)}" />`
                  : `<span style="font-size:24px; font-weight:700; color:${PALETTE.headerText};">${e(brandName)}</span>`
                }
              </td>
              <td style="width:50%; text-align:right; vertical-align:middle;">
                <span style="font-size:12px; font-weight:700; color:${PALETTE.headerText}; letter-spacing:1px;">CALENDARIO DE ESCALACIÓN</span>
              </td>
            </tr>
          </mj-table>
          <mj-text align="center" color="${PALETTE.headerText}" font-size="28px" font-weight="700" padding="10px 0">
            Turnos de Escalación SOC
          </mj-text>
          <mj-text align="center" color="${PALETTE.cardAccent}" font-size="16px" font-weight="400" padding="0">
            ${e(periodLabel)}
          </mj-text>
        </mj-column>
      </mj-section>

      <!-- Tabla de Turnos -->
      <mj-section background-color="${PALETTE.cardBg}" padding="30px 24px" border-radius="0 0 12px 12px">
        <mj-column width="100%">
          <mj-text font-size="18px" font-weight="700" color="${PALETTE.bodyText}" padding="0 0 20px 0">
            Asignación de Turnos
          </mj-text>
          <mj-table css-class="schedule-table">
            <tr style="border-bottom: 2px solid ${PALETTE.softLine};">
              <th style="text-align:left; padding:10px 8px; color:${PALETTE.mutedText}; font-size:12px;">ANALISTA</th>
              <th style="text-align:left; padding:10px 8px; color:${PALETTE.mutedText}; font-size:12px;">INICIO</th>
              <th style="text-align:left; padding:10px 8px; color:${PALETTE.mutedText}; font-size:12px;">FIN</th>
              <th style="text-align:left; padding:10px 8px; color:${PALETTE.mutedText}; font-size:12px;">CARGO</th>
              <th style="text-align:right; padding:10px 8px; color:${PALETTE.mutedText}; font-size:12px;">ESTADO</th>
            </tr>
            ${scheduleRows}
          </mj-table>
          
          <mj-spacer height="30px" />
          
          <mj-divider border-width="1px" border-style="dashed" border-color="${PALETTE.softLine}" />
          
          <mj-spacer height="20px" />
          
          <mj-text font-size="13px" line-height="20px" color="${PALETTE.mutedText}" align="center">
            Este es un correo automático generado por el sistema Bitácora SOC.<br/>
            Por favor, asegúrese de que su disponibilidad coincida con los turnos asignados.
          </mj-text>
        </mj-column>
      </mj-section>

    </mj-wrapper>

    <!-- Footer -->
    <mj-section padding="20px 0">
      <mj-column>
        <mj-text align="center" color="#999999" font-size="11px">
          &copy; ${new Date().getFullYear()} ${e(brandName)} &middot; Todos los derechos reservados
        </mj-text>
      </mj-column>
    </mj-section>

  </mj-body>
</mjml>
  `;

  const result = await mjml(template, { validationLevel: 'soft' });
  
  // Validar que se generó HTML correctamente
  const html = result?.html || '';
  if (!html || html.trim().length === 0) {
    console.error('[escalationScheduleEmailTemplate] MJML compilation produced empty HTML', {
      hasResult: !!result,
      hasHtml: !!result?.html,
      htmlLength: result?.html?.length || 0,
      errors: result?.errors || [],
      template: template.substring(0, 200) // primeros 200 caracteres para debugging
    });
  }
  
  return { html, errors: result?.errors || [] };
}

module.exports = { buildEscalationScheduleEmail };
