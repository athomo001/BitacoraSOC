/**
 * File Purpose: backend/src/templates/email/escalationSchedule.js
 * Responsibilities: Generate MJML-based HTML email for escalation schedule notifications.
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

/**
 * Formatea un objeto fecha o string a formato de fecha dd-mm-aaaa.
 * @param {Date|string} fecha - Fecha a formatear.
 * @returns {string} Fecha formateada o guion si no es válida.
 */
function formatDate(fecha) {
  if (!fecha) return '-';
  try {
    const d = new Date(fecha);
    if (isNaN(d.getTime())) return String(fecha);
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return String(fecha); }
}

/**
 * Formatea un objeto fecha o string a formato de hora de 24 horas hh:mm.
 * @param {Date|string} fecha - Fecha a formatear.
 * @returns {string} Hora formateada o cadena vacía si no es válida.
 */
function formatTime(fecha) {
  if (!fecha) return '-';
  try {
    const d = new Date(fecha);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return ''; }
}

/**
 * Obtiene el nombre del día de la semana en español con la primera letra en mayúscula.
 * @param {Date|string} fecha - Objeto Date o cadena representativa de la fecha.
 * @returns {string} Nombre del día (ej. 'Lunes') o cadena vacía si no es válida.
 */
function getDayOfWeek(fecha) {
  if (!fecha) return '';
  try {
    const d = new Date(fecha);
    if (isNaN(d.getTime())) return '';
    const dayName = d.toLocaleDateString('es-CL', { weekday: 'long' });
    return dayName.charAt(0).toUpperCase() + dayName.slice(1);
  } catch { return ''; }
}

// Paleta de colores para el estilo visual del correo
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
 * Genera el HTML compilado a partir de MJML para el correo de turnos de escalamiento.
 * @param {Object} data - Datos para completar la plantilla del correo.
 * @param {Array} data.schedule - Listado de asignaciones de turnos.
 * @param {string} data.periodLabel - Etiqueta representativa de las fechas del período.
 * @param {string|null} data.logoCid - CID del logo para adjuntar en línea.
 * @param {string} data.brandName - Nombre de marca de la aplicación.
 * @param {string} data.title - Título principal de la cabecera.
 * @param {string} data.categoriesLabel - Categorías de turnos visualizadas.
 * @returns {Promise<{html: string, errors: Array}>} Resultado HTML y advertencias de compilación.
 */
async function buildEscalationScheduleEmail({ schedule = [], periodLabel = '', logoCid = null, brandName = 'Bitácora CDC', title = 'Turnos de Escalamiento SOC', categoriesLabel = '' }) {
  
  const scheduleRows = schedule.map((s, i) => {
    const isLast = i === schedule.length - 1;
    const border = isLast ? 'none' : `1px solid ${PALETTE.softLine}`;
    const getBadgeInfo = (roleCode) => {
      switch (roleCode) {
        case 'N2':
          return { label: 'OPERADOR N2', bg: '#155F50' };
        case 'TI':
          return { label: 'ESPECIALISTA TI', bg: '#155F50' };
        case 'N1_NO_HABIL':
          return { label: 'GUARDIA N1', bg: '#155F50' };
        case 'TELEWORK':
          return { label: 'TELETRABAJO', bg: '#1E88E5' };
        case 'OL':
          return { label: 'CHARLA/CAPACITACIÓN', bg: '#795548' };
        case 'VACATION':
          return { label: 'VACACIONES', bg: '#F57C00' };
        case 'MEDICAL_LEAVE':
          return { label: 'LICENCIA MÉDICA', bg: '#D32F2F' };
        case 'MEDICAL_APPOINTMENT':
          return { label: 'TRÁMITE MÉDICO', bg: '#8E24AA' };
        default:
          return { label: String(roleCode || 'TURNO').toUpperCase(), bg: '#5B695D' };
      }
    };

    const badgeInfo = getBadgeInfo(s.roleCode);
    const badge = `<span style="display:inline-block; white-space:nowrap; background-color:${badgeInfo.bg}; color:${PALETTE.white}; padding:4px 8px; border-radius:4px; font-size:11px; line-height:1; font-weight:700;">${e(badgeInfo.label)}</span>`;

    return `
      <tr>
        <td style="padding:12px 8px; border-bottom:${border}; color:${PALETTE.bodyText}; font-weight:700; line-height:1.35;">${e(s.analystName)}</td>
        <td style="padding:12px 8px; border-bottom:${border}; color:${PALETTE.bodyText}; font-size:13px;">
          <!-- Día de la semana en formato destacado de inicio -->
          <span style="font-weight:bold; font-size:15px; display:inline-block; margin-bottom:2px;">${getDayOfWeek(s.startDate)}</span><br/>
          <span style="white-space:nowrap;">${formatDate(s.startDate)}</span><br/>
          <span style="white-space:nowrap;">${formatTime(s.startDate)}</span>
        </td>
        <td style="padding:12px 8px; border-bottom:${border}; color:${PALETTE.bodyText}; font-size:13px;">
          <!-- Día de la semana en formato destacado de término -->
          <span style="font-weight:bold; font-size:15px; display:inline-block; margin-bottom:2px;">${getDayOfWeek(s.endDate)}</span><br/>
          <span style="white-space:nowrap;">${formatDate(s.endDate)}</span><br/>
          <span style="white-space:nowrap;">${formatTime(s.endDate)}</span>
        </td>
        <td style="padding:12px 8px; border-bottom:${border}; color:${PALETTE.mutedText}; font-size:12px; white-space:nowrap;">${e(s.cargoLabel || '-')}</td>
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
  <mj-body background-color="#FFFFFF" width="700px">
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
                <span style="font-size:11px; font-weight:700; color:${PALETTE.headerText}; letter-spacing:1px;">${e((categoriesLabel || 'CALENDARIO').toUpperCase())}</span>
              </td>
            </tr>
          </mj-table>
          <mj-text align="center" color="${PALETTE.headerText}" font-size="28px" font-weight="700" padding="10px 0">
            ${e(title)}
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
              <th style="text-align:left; padding:10px 8px; color:${PALETTE.mutedText}; font-size:12px; white-space:nowrap; width:28%;">ANALISTA</th>
              <th style="text-align:left; padding:10px 8px; color:${PALETTE.mutedText}; font-size:12px; white-space:nowrap; width:22%;">INICIO</th>
              <th style="text-align:left; padding:10px 8px; color:${PALETTE.mutedText}; font-size:12px; white-space:nowrap; width:22%;">FIN</th>
              <th style="text-align:left; padding:10px 8px; color:${PALETTE.mutedText}; font-size:12px; white-space:nowrap; width:10%;">CARGO</th>
              <th style="text-align:right; padding:10px 8px; color:${PALETTE.mutedText}; font-size:12px; white-space:nowrap; width:18%;">ESTADO</th>
            </tr>
            ${scheduleRows}
          </mj-table>
          
          <mj-spacer height="30px" />
          
          <mj-divider border-width="1px" border-style="dashed" border-color="${PALETTE.softLine}" />
          
          <mj-spacer height="20px" />
          
          <mj-text font-size="12px" line-height="18px" color="${PALETTE.mutedText}" align="center" font-style="italic">
            Nota: Este correo de aviso es exclusivamente para <b>control interno</b> del área. Los turnos asignados son preliminares y pueden ser modificados en el transcurso de la semana según las necesidades del servicio.
          </mj-text>
          <mj-spacer height="10px" />
          <mj-text font-size="13px" line-height="20px" color="${PALETTE.mutedText}" align="center">
            Este es un correo automático generado por el sistema ${e(brandName)}.
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
  const html = result?.html || '';
  if (!html || html.trim().length === 0) {
    console.error('[escalationScheduleEmailTemplate] MJML compilation produced empty HTML', {
      hasResult: !!result,
      hasHtml: !!result?.html,
      htmlLength: result?.html?.length || 0,
      errors: result?.errors || [],
      template: template.substring(0, 200)
    });
  }
  
  return { html, errors: result?.errors || [] };
}

module.exports = { buildEscalationScheduleEmail };
