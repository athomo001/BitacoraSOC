/**
 * File Purpose: backend/src/templates/email/incidentReport.js
 * Responsibilities: Define template generation logic for Incident Reports using MJML.
 */

const fs = require('fs');
const path = require('path');
const mjml = require('mjml');

/**
 * Escapa caracteres HTML especiales para mitigar vulnerabilidades XSS.
 * @param {any} v - Valor a escapar.
 * @returns {string} Cadena de texto sanitizada.
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

const CRITICIDAD_COLORS = {
  critica: '#C0392B', alta: '#E85D04', media: '#E67E22',
  baja: '#27AE60', informativa: '#2980B9',
};

// Paletas predefinidas para el correo de incidentes.
// Define el aspecto visual y contraste según el tipo seleccionado.
const PALETTES = {
  'cdc-verde': {
    pageBg: '#173831', headerBg: '#155F50',
    cardBg: '#F8FAE1', cardAccent: '#EEF3C8',
    evidenceLabelBg: '#9BCB93', softLine: '#D7DEC0',
    headerText: '#F8FAE1', bodyText: '#173831',
    mutedText: '#5B695D', infoDanger: '#C3382B', white: '#FFFFFF',
  },
  'noche-azul': {
    pageBg: '#0D1B2A', headerBg: '#1B3A5C',
    cardBg: '#EFF4FB', cardAccent: '#D6E4F5',
    evidenceLabelBg: '#7EB2E0', softLine: '#BDD2EC',
    headerText: '#EFF4FB', bodyText: '#0D1B2A',
    mutedText: '#4A6580', infoDanger: '#C3382B', white: '#FFFFFF',
  },
  'slate-pro': {
    pageBg: '#1C2333', headerBg: '#2E3D56',
    cardBg: '#F5F6FA', cardAccent: '#E2E6F0',
    evidenceLabelBg: '#8DA5C4', softLine: '#CBD3E2',
    headerText: '#F5F6FA', bodyText: '#1C2333',
    mutedText: '#5A6A82', infoDanger: '#C3382B', white: '#FFFFFF',
  },
  'carbon': {
    pageBg: '#1A1A1A', headerBg: '#2D2D2D',
    cardBg: '#F7F7F7', cardAccent: '#EBEBEB',
    evidenceLabelBg: '#AAAAAA', softLine: '#D5D5D5',
    headerText: '#F7F7F7', bodyText: '#1A1A1A',
    mutedText: '#666666', infoDanger: '#C3382B', white: '#FFFFFF',
  },
  'indigo': {
    pageBg: '#1A1240', headerBg: '#2D2080',
    cardBg: '#F4F3FF', cardAccent: '#E2DFF8',
    evidenceLabelBg: '#9B93E0', softLine: '#CCC9EF',
    headerText: '#F4F3FF', bodyText: '#1A1240',
    mutedText: '#5C5590', infoDanger: '#C3382B', white: '#FFFFFF',
  },
  'bosque': {
    pageBg: '#1B2A1E', headerBg: '#2D4A33',
    cardBg: '#F2F8F3', cardAccent: '#D8EDD9',
    evidenceLabelBg: '#7DBD85', softLine: '#B9D9BC',
    headerText: '#F2F8F3', bodyText: '#1B2A1E',
    mutedText: '#4A6550', infoDanger: '#C3382B', white: '#FFFFFF',
  },
};

/**
 * Resuelve la paleta de colores según la clave.
 * @param {string} paletteKey - Clave de la paleta.
 * @returns {Object} Paleta de colores seleccionada.
 */
function resolvePalette(paletteKey) {
  return PALETTES[paletteKey] || PALETTES['cdc-verde'];
}

/**
 * Lee la tipografía de node_modules y la codifica en Base64 para incrustarla inline en el correo.
 * @param {string} fileName - Nombre del archivo de fuente.
 * @returns {string} Codificación Base64 de la fuente o vacío.
 */
function readFontBase64(fileName) {
  try {
    // Al moverse a backend/src/templates/email/, debemos resolver la ruta hacia node_modules subiendo 3 niveles.
    const filePath = path.resolve(__dirname, '..', '..', '..', 'node_modules', '@fontsource', 'inter', 'files', fileName);
    return fs.readFileSync(filePath).toString('base64');
  } catch {
    return '';
  }
}

/**
 * Genera el CSS de la fuente embebida para un peso específico.
 * @param {number} weight - Peso de la tipografía.
 * @returns {string} Código CSS @font-face o vacío.
 */
function buildEmbeddedInterFont(weight) {
  const woff2 = readFontBase64(`inter-latin-ext-${weight}-normal.woff2`) || readFontBase64(`inter-latin-${weight}-normal.woff2`);
  const woff = readFontBase64(`inter-latin-ext-${weight}-normal.woff`) || readFontBase64(`inter-latin-${weight}-normal.woff`);

  if (!woff2 && !woff) return '';

  const sources = [];
  if (woff2) sources.push(`url(data:font/woff2;base64,${woff2}) format('woff2')`);
  if (woff) sources.push(`url(data:font/woff;base64,${woff}) format('woff')`);

  return `
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: ${weight};
      font-display: swap;
      src: ${sources.join(', ')};
    }
  `;
}

const EMBEDDED_INTER_CSS = [buildEmbeddedInterFont(400), buildEmbeddedInterFont(700)]
  .filter(Boolean)
  .join('\n');

/**
 * Compila y construye el correo MJML para reportes de incidentes a HTML.
 * @param {Object} data - Parámetros de generación del correo.
 * @returns {Promise<{html: string, errors: Array}>} HTML final y warnings.
 */
async function buildIncidentEmail({ reportData: rd = {}, images = [], logoCid = null, autor = 'Analista SOC', brandName = 'Bitácora SOC', paletteKey = 'cdc-verde' }) {
  const P = resolvePalette(paletteKey);
  const critStr = String(rd.criticidad || 'media').toLowerCase();
  const critColor = CRITICIDAD_COLORS[critStr] || '#E67E22';
  const fechaStr = formatDate(rd.fecha);
  const usableImages = images.filter((img, idx) => {
    const src = img && (img._isSrcOverride ? img._previewSrc : `cid:evidence-${idx + 1}@bitacora-incident`);
    return Boolean(src);
  });

  const fieldDefs = [
    { label: 'Ofensa',                  value: rd.ofensa },
    { label: 'Tipo de operación',       value: rd.tipoOperacion },
    { label: 'Nombre de Ofensa/Evento', value: rd.nombreEvento },
    rd.motivoEvento    && { label: 'Motivo',              value: rd.motivoEvento },
    rd.criticidad      && { label: 'MRSC (Criticidad)',   value: rd.criticidad },
    rd.origenConexion  && { label: 'Origen de conexión', value: rd.origenConexion },
    rd.destino         && { label: 'Destino',             value: rd.destino },
    rd.logSource       && { label: 'Fuente / Log Source', value: rd.logSource },
    rd.reputacionOrigen && { label: 'Reputación de origen', value: rd.reputacionOrigen },
  ].filter(Boolean);

  const fieldRows = fieldDefs.map((f, i) => {
    const last = i === fieldDefs.length - 1;
    const bdr  = last ? 'none' : `1px solid ${P.softLine}`;
    return `<tr>
  <td style="padding:12px 18px 12px 0;border-bottom:${bdr};width:42%;vertical-align:top;color:${P.bodyText};font-weight:700;">${e(f.label)}</td>
  <td style="padding:12px 0;border-bottom:${bdr};vertical-align:top;text-align:left;color:${P.bodyText};">${e(f.value)}</td>
</tr>`;
  }).join('\n');

  const obsHtml = rd.observaciones
    ? `<mj-text css-class="inter-panel" font-size="14px" color="${P.bodyText}" padding="0px" line-height="24px"><span style="font-weight:700;">Observaciones</span><br/>${e(rd.observaciones).replace(/\n/g, '<br/>')}</mj-text>`
    : '';
  const recomHtml = rd.recomendacion && String(rd.recomendacion).trim()
    ? `<mj-spacer height="16px"></mj-spacer><mj-text css-class="inter-panel" font-size="14px" color="${P.bodyText}" padding="0px" line-height="24px"><span style="font-weight:700;">Recomendación</span><br/>${e(rd.recomendacion).replace(/\n/g, '<br/>')}</mj-text>`
    : '';

  const hasEvidence = (rd.evidenciaTexto && String(rd.evidenciaTexto).trim()) || images.length > 0;
  let evidenceContent = '';
  if (rd.evidenciaTexto && String(rd.evidenciaTexto).trim()) {
    evidenceContent += `<mj-text css-class="inter-panel" font-size="14px" color="${P.bodyText}" line-height="24px" padding="0px">${e(rd.evidenciaTexto).replace(/\n/g, '<br/>')}</mj-text>`;
    if (usableImages.length > 0) evidenceContent += `\n        <mj-spacer height="14px"></mj-spacer>`;
  }
  usableImages.forEach((img, idx) => {
    const src = img._isSrcOverride ? img._previewSrc : `cid:evidence-${idx + 1}@bitacora-incident`;
    const alt = e(img.name || `evidencia-${idx + 1}`);
    evidenceContent += `\n        <mj-image src="${src}" padding="0px" border="1px solid ${P.softLine}" alt="${alt}" />`;
    if (idx < usableImages.length - 1) evidenceContent += `\n        <mj-spacer height="12px"></mj-spacer>`;
  });

  const evidenceSection = hasEvidence ? `
    <mj-section background-color="transparent" padding="0">
      <mj-column padding="0">
        <mj-spacer height="16px"></mj-spacer>
      </mj-column>
    </mj-section>
    <mj-section background-color="transparent" padding="0">
      <mj-column background-color="${P.cardBg}" border-radius="10px" padding="12px 24px 18px 24px">
        <mj-text css-class="inter-panel" font-size="15px" color="${P.bodyText}" font-weight="700" padding="0 0 10px 0">
          <span style="display:inline-block;background:${P.evidenceLabelBg};padding:10px 14px;">Evidencia</span>
        </mj-text>
        ${evidenceContent}
      </mj-column>
    </mj-section>` : '';

  const infoSection = rd.informacionAdicional && String(rd.informacionAdicional).trim()
    ? `
    <mj-section background-color="transparent" padding="0">
      <mj-column padding="0">
        <mj-spacer height="16px"></mj-spacer>
      </mj-column>
    </mj-section>
    <mj-section background-color="transparent" padding="0px 0px 28px 0px">
      <mj-column background-color="${P.infoDanger}" border-radius="10px" padding="16px 18px 16px 18px">
        <mj-text css-class="inter-panel" font-size="16px" color="${P.white}" font-weight="700" padding="0 0 8px 0">Información adicional</mj-text>
        <mj-text css-class="inter-panel" font-size="14px" color="${P.white}" line-height="24px" padding="0">${e(rd.informacionAdicional).replace(/\n/g, '<br/>')}</mj-text>
      </mj-column>
    </mj-section>` : '';

  const template = `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Arial,Helvetica,sans-serif" />
      <mj-section padding="0px" />
    </mj-attributes>
    <mj-style inline="inline">
      ${EMBEDDED_INTER_CSS}
      .inter-title, .inter-title * {
        font-family: 'Inter', 'Segoe UI', Arial, Helvetica, sans-serif !important;
      }
      .inter-panel, .inter-panel * {
        font-family: 'Inter', 'Segoe UI', Arial, Helvetica, sans-serif !important;
      }
      p {
        margin: 0 !important;
      }
    </mj-style>
  </mj-head>
  <mj-body background-color="#FFFFFF" width="900px">
    <mj-wrapper background-color="${P.pageBg}" padding="16px 0">
    
    <mj-section padding="10px 24px 20px 24px" background-color="${P.headerBg}" border-radius="16px 16px 16px 16px">
      <mj-column width="100%">
        <mj-table padding="0 0 10px 0">
          <tr>
            <td style="width:60%; vertical-align:middle;">
              ${logoCid 
                ? `<img src="${logoCid}" width="160" alt="${e(brandName)}" style="display:block;" />`
                : `<span style="font-family:'Inter', Arial; font-size:26px; font-weight:700; color:${P.headerText};">${e(brandName)}</span>`
              }
            </td>
            <td style="width:40%; text-align:right; vertical-align:middle;">
              <span style="font-family:'Inter', Arial; font-size:11px; font-weight:700; color:${P.headerText}; letter-spacing:0.05em;">CRITICIDAD:</span>
              <span style="display:inline-block; background-color:${critColor}; color:${P.white}; padding:5px 12px; border-radius:6px; font-size:12px; font-weight:700; margin-left:6px;">
                ${e(String(rd.criticidad || 'MEDIA').toUpperCase())}
              </span>
            </td>
          </tr>
        </mj-table>

        <mj-text css-class="inter-title" align="center" color="${P.headerText}" font-size="28px" font-weight="700" padding="5px 0 15px 0" line-height="32px">
          Reporte de Detección
        </mj-text>

        <mj-text css-class="inter-title" font-size="18px" color="${P.headerText}" font-weight="700" padding="0 0 2px 0" line-height="22px">
          ${e(rd.nombreEvento || '-')}
        </mj-text>
        <mj-text css-class="inter-panel" font-size="13px" color="${P.cardAccent}" padding="0" line-height="18px">
          Ticket: <span style="font-weight:700; color:${P.white};">${e(rd.codigoTicket || '-')}</span> &nbsp;·&nbsp; 
          Ofensa: <span style="font-weight:700; color:${P.white};">${e(rd.ofensa || '-')}</span> &nbsp;·&nbsp; 
          ${fechaStr}
        </mj-text>
      </mj-column>
    </mj-section>

    <mj-section background-color="transparent" padding="0">
      <mj-column padding="0">
        <mj-spacer height="16px"></mj-spacer>
      </mj-column>
    </mj-section>

    <mj-section background-color="${P.cardBg}" padding="0px" border-radius="10px 10px 0 0">
      <mj-column padding="24px 32px 0 32px">
        <mj-text css-class="inter-panel" font-size="18px" color="${P.bodyText}" font-weight="700" padding="0px">Información del Evento</mj-text>
      </mj-column>
    </mj-section>

    <mj-section padding="0px" background-color="${P.cardBg}">
      <mj-column padding="12px 32px 0 32px">
        <mj-table css-class="inter-panel" font-size="14px" color="${P.bodyText}">${fieldRows}</mj-table>
      </mj-column>
    </mj-section>
    
    <mj-section padding="18px 0 24px 0" background-color="${P.cardBg}">
      <mj-column padding="0 32px">
        ${obsHtml}
        ${recomHtml}
      </mj-column>
    </mj-section>

    <mj-section background-color="${P.cardBg}" padding="0">
      <mj-column padding="0 32px">
        <mj-spacer height="2px"></mj-spacer>
      </mj-column>
    </mj-section>

    ${evidenceSection}

    ${infoSection}
    </mj-wrapper>

    <mj-section padding="24px 0px">
      <mj-column>
        <mj-text align="center" color="#888888" font-size="12px">
          Generado por&nbsp;<span style="color:${P.headerBg};font-weight:700;">${e(autor)}</span>&nbsp;·&nbsp;${e(brandName)}
        </mj-text>
      </mj-column>
    </mj-section>

  </mj-body>
</mjml>`;

  const result = await mjml(template, { validationLevel: 'soft' });
  return { html: result?.html || '', errors: result?.errors || [] };
}

/**
 * Versión para previsualización (navegador) utilizando data URIs en vez de CIDs de adjunto MIME.
 */
async function buildIncidentEmailPreview(opts) {
  const { images = [], ...rest } = opts;
  const previewImages = images.map((img) => ({
    ...img,
    _isSrcOverride: true
  }));
  return buildIncidentEmail({ ...rest, images: previewImages });
}

module.exports = { buildIncidentEmail, buildIncidentEmailPreview, PALETTES };
