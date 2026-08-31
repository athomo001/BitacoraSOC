/**
 * File Purpose: backend/src/utils/shift-report.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const { sendEmail } = require('./email');
const mjml2html = require('mjml');
const WorkShift = require('../models/WorkShift');
const Entry = require('../models/Entry');
const ShiftCheck = require('../models/ShiftCheck');
const { getBrandingSnapshot, getAppTitleForText } = require('./branding');
const { logger } = require('./logger');
const { auditSystem } = require('./audit');
const { dispatchGlpiPayload } = require('./glpi-dispatch');

/**
 * Genera y envía reporte de turno por correo
 * 
 * Contenido:
 *   - Checklist de entrada y salida: comparativo ítem-a-ítem si ambas usan la misma
 *     plantilla; dos listas compactas lado a lado si son plantillas distintas.
 *   - Entradas de bitácora del turno
 * 
 * Variables en asunto:
 *   [fecha] → 2026-02-03
 *   [turno] → Turno Mañana
 *   [hora]  → 18:00
 */

/**
 * Reemplaza variables en plantilla de asunto
 */
function replaceSubjectVariables(template, { date, shiftName, time }) {
  return template
    .replace(/\[fecha\]/gi, date)
    .replace(/\[turno\]/gi, shiftName)
    .replace(/\[hora\]/gi, time);
}

const escapeHtml = (value) => {
  if (!value && value !== 0) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const formatTime = (date) => {
  if (!date) return 'No completado';
  try {
    return new Date(date).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    return 'No completado';
  }
};

const formatDate = (date) => {
  if (!date) return '';
  try {
    return new Date(date).toLocaleDateString('es-CL', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch (error) {
    return '';
  }
};

const formatEntryContent = (value) => {
  const text = value || '';
  return escapeHtml(text).replace(/\n/g, '<br>');
};

const buildServiceRows = (checklistEntry, checklistExit) => {
  const entryMap = new Map();
  (checklistEntry?.services || []).forEach((service) => {
    const key = service.serviceId?.toString() || service.serviceTitle;
    entryMap.set(key, service);
  });
  const exitMap = new Map();
  (checklistExit?.services || []).forEach((service) => {
    const key = service.serviceId?.toString() || service.serviceTitle;
    exitMap.set(key, service);
  });

  const orderedKeys = [];
  const seen = new Set();
  [...entryMap.keys(), ...exitMap.keys()].forEach((key) => {
    if (!seen.has(key)) {
      seen.add(key);
      orderedKeys.push(key);
    }
  });

  const rows = orderedKeys.map((key) => ({
    key,
    serviceId: (entryMap.get(key)?.serviceId || exitMap.get(key)?.serviceId || '').toString(),
    entry: entryMap.get(key) || null,
    exit: exitMap.get(key) || null
  }));

  return rows;
};

const buildParentServiceIdSet = (checklistEntry, checklistExit) => {
  const parentIds = new Set();
  [...(checklistEntry?.services || []), ...(checklistExit?.services || [])].forEach((service) => {
    if (service?.parentServiceId) {
      parentIds.add(service.parentServiceId.toString());
    }
  });
  return parentIds;
};

const renderStatusCell = (service) => {
  if (!service) {
    return '<span style="color:#000000 !important;font-size:11px;line-height:1.25;">No registrado</span>';
  }

  const isOk = service.status === 'verde';
  const label = isOk ? 'OK' : 'ERROR';
  const labelWithText = isOk ? 'OK (Verde)' : 'ERROR (Rojo)';
  const color = isOk ? '#1b5e20' : '#b71c1c';
  const observation = service.observation ? escapeHtml(service.observation) : '-';

  return `
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;line-height:1.2;">
      <span style="display:inline-block;background-color:${color};padding:2px 8px;border-radius:4px;border:1px solid ${color};color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;font-weight:700;font-size:11px;letter-spacing:0.2px;">${label}</span>
      <span style="color:#000000 !important;-webkit-text-fill-color:#000000 !important;font-size:11px;font-weight:600;">${labelWithText}</span>
    </div>
    <div style="margin-top:2px;color:#000000 !important;-webkit-text-fill-color:#000000 !important;font-size:11px;line-height:1.25;"><strong>Obs:</strong> ${observation}</div>
  `;
};

const normalizeName = (value) => {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
};

const normalizeEntryType = (value) => normalizeName(value).replace(/\s+/g, '');

const toCanonicalEntryType = (value) => {
  const normalized = normalizeEntryType(value);
  if (['operativa', 'operativas'].includes(normalized)) {
    return 'operativa';
  }
  if (['ofensa', 'ofensas'].includes(normalized)) {
    return 'ofensa';
  }
  if (['incidente', 'incidentes'].includes(normalized)) {
    return 'incidente';
  }
  return null;
};

const isSameChecklistContext = (checklistEntry, checklistExit) => {
  if (!checklistEntry || !checklistExit) {
    return false;
  }

  const entryChecklistId = checklistEntry.checklistId ? checklistEntry.checklistId.toString() : '';
  const exitChecklistId = checklistExit.checklistId ? checklistExit.checklistId.toString() : '';
  if (entryChecklistId && exitChecklistId) {
    return entryChecklistId === exitChecklistId;
  }

  const entryChecklistName = normalizeName(checklistEntry.checklistName);
  const exitChecklistName = normalizeName(checklistExit.checklistName);
  if (entryChecklistName && exitChecklistName) {
    return entryChecklistName === exitChecklistName;
  }

  return false;
};

const resolveShiftWindow = (shift, shiftDate) => {
  const [startHour, startMinute] = shift.startTime.split(':').map(Number);
  const [endHour, endMinute] = shift.endTime.split(':').map(Number);

  const shiftStart = new Date(shiftDate);
  shiftStart.setHours(startHour, startMinute, 0, 0);

  const shiftEnd = new Date(shiftDate);
  shiftEnd.setHours(endHour, endMinute, 0, 0);

  const crossesMidnight = endHour < startHour || (endHour === startHour && endMinute < startMinute);
  if (crossesMidnight) {
    if (shiftDate < shiftEnd) {
      shiftStart.setDate(shiftStart.getDate() - 1);
    } else {
      shiftEnd.setDate(shiftEnd.getDate() + 1);
    }
  }

  return { shiftStart, shiftEnd };
};

const clampDateToRange = (date, minDate, maxDate) => {
  if (date <= minDate) {
    return new Date(minDate);
  }
  if (date >= maxDate) {
    return new Date(maxDate);
  }
  return new Date(date);
};

async function loadShiftReportData(shift, shiftDate, options = {}) {
  const { previewAt = null } = options;
  const { shiftStart, shiftEnd } = resolveShiftWindow(shift, shiftDate);

  const cutoffSource = previewAt ? new Date(previewAt) : shiftEnd;
  const reportCutoff = clampDateToRange(cutoffSource, shiftStart, shiftEnd);

  const checklistExit = await ShiftCheck.findOne({
    type: 'cierre',
    createdAt: { $gte: shiftStart, $lte: reportCutoff }
  }).sort({ createdAt: -1 });

  const entryRangeEnd = checklistExit?.createdAt || reportCutoff;
  const checklistEntry = await ShiftCheck.findOne({
    type: 'inicio',
    createdAt: { $gte: shiftStart, $lte: entryRangeEnd }
  }).sort({ createdAt: -1 });

  const periodStart = checklistEntry?.createdAt || shiftStart;
  const periodEnd = checklistExit?.createdAt || reportCutoff;

  const entries = await Entry.find({
    createdAt: { $gte: periodStart, $lte: periodEnd }
  }).sort({ createdAt: 1 });

  return {
    shiftStart,
    shiftEnd,
    reportCutoff,
    checklistEntry,
    checklistExit,
    periodStart,
    periodEnd,
    entries
  };
}

const buildStatusPill = (label, color) => {
  return `<span style="display:inline-block;background:${color};color:#ffffff;font-size:11px;font-weight:700;line-height:1;padding:6px 10px;border-radius:999px;letter-spacing:0.2px;">${label}</span>`;
};

/**
 * Normaliza y limpia una cadena de texto para comparaciones difusas de correlación (remueve diacríticos y convierte a minúsculas).
 */
const normalizeNameForCorrelation = (value) => {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
};

/**
 * Extrae palabras clave significativas de un título para la correlación en el backend.
 */
const getSearchKeywordsForCorrelation = (title) => {
  const cleanTitle = String(title || '')
    .replace(/\(.*?\)/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const words = cleanTitle.split(/\s+/).map(w => w.trim()).filter(w => w.length > 2);
  const stopWords = new Set([
    'todos', 'los', 'conectar', 'actualizar', 'revision', 'general', 'salud', 
    'delitos', 'turno', 'anterior', 'del', 'con', 'para', 'una', 'uno', 'las', 
    'por', 'sus', 'componentes', 'alerta', 'alertas', 'plataforma', 'graves', 'criticos'
  ]);

  return words.filter(w => !stopWords.has(w));
};

/**
 * Correlaciona dinámicamente incidentes de servicios sin comentarios, asociándolos a las observaciones
 * de otros servicios en el mismo checklist si se menciona alguna palabra clave significativa de los mismos.
 */
const correlateBackendServices = (checklist) => {
  if (!checklist || !Array.isArray(checklist.services)) return;

  const servicesWithObservation = checklist.services.filter(s => s.status === 'rojo' && s.observation);

  checklist.services.forEach(service => {
    if (service.status === 'rojo' && !service.observation) {
      let matchedSource = null;

      // 1. Relación Jerárquica Directa: Intentar correlacionar por pertenencia directa de árbol.
      const currentServiceIdStr = service.serviceId ? service.serviceId.toString() : '';

      // Caso A: El servicio actual es padre de otros servicios.
      // Buscamos si algún hijo directo está en rojo con observación.
      if (currentServiceIdStr) {
        matchedSource = servicesWithObservation.find(other => 
          other.parentServiceId && other.parentServiceId.toString() === currentServiceIdStr
        );
      }

      // Caso B: El servicio actual es hijo de otro servicio.
      // Buscamos si el padre directo está en rojo con observación, o si algún hermano directo la tiene.
      if (!matchedSource && service.parentServiceId) {
        const parentIdStr = service.parentServiceId.toString();

        // Probar con el padre
        matchedSource = servicesWithObservation.find(other => 
          other.serviceId && other.serviceId.toString() === parentIdStr
        );

        // Probar con hermanos directos (hijos del mismo padre)
        if (!matchedSource) {
          matchedSource = servicesWithObservation.find(other => 
            other.parentServiceId && other.parentServiceId.toString() === parentIdStr &&
            other.serviceId?.toString() !== service.serviceId?.toString()
          );
        }
      }

      // 2. Correlación Heurística por palabras clave si no se halló enlace por jerarquía.
      if (!matchedSource) {
        let keywords = getSearchKeywordsForCorrelation(service.serviceTitle);
        
        // Heredar palabras clave del servicio padre
        if (service.parentServiceId) {
          const parent = checklist.services.find(s => s.serviceId?.toString() === service.parentServiceId.toString());
          if (parent) {
            const parentKeywords = getSearchKeywordsForCorrelation(parent.serviceTitle);
            keywords = [...new Set([...keywords, ...parentKeywords])];
          }
        }

        if (keywords.length > 0) {
          matchedSource = servicesWithObservation.find(other => {
            if (other.serviceTitle === service.serviceTitle) return false;
            
            const obsNormalized = normalizeNameForCorrelation(other.observation || '');
            return keywords.some(keyword => obsNormalized.includes(keyword));
          });
        }
      }

      if (matchedSource) {
        service.correlatedFrom = {
          serviceTitle: matchedSource.serviceTitle,
          observation: matchedSource.observation
        };
      }
    }
  });
};

const renderServiceStatusBlock = ({ service, entryService = null, isExit = false, allowRepaired = false }) => {
  if (!service) {
    return `
      <div style="font-size:12px;color:#90a4ae;line-height:1.3;">—</div>
    `;
  }

  const isError = service.status === 'rojo';
  const isRepaired = Boolean(
    isExit
    && allowRepaired
    && service.status === 'verde'
    && entryService
    && entryService.status === 'rojo'
  );

  let pill = '';
  if (isRepaired) {
    pill = buildStatusPill('REPARADO', '#f57f17');
  } else if (isError) {
    pill = buildStatusPill('ERROR', '#c62828');
  } else {
    pill = buildStatusPill('OK', '#2e7d32');
  }

  const observation = String(service.observation || '').trim();
  const repairedHint = isRepaired
    ? '<div style="margin-top:6px;font-size:11px;color:#8d6e63;line-height:1.25;">Fue ERROR en entrada</div>'
    : '';
  const observationHtml = observation
    ? `<div style="margin-top:6px;font-size:12px;color:#37474f;line-height:1.35;"><strong>Obs:</strong> ${escapeHtml(observation)}</div>`
    : '';

  // Inyección de bloque HTML responsivo para el correo en caso de existir correlación
  const correlationHtml = (!observation && service.correlatedFrom)
    ? `
      <div style="margin-top:6px;padding:6px 8px;background-color:#fffdf6;border-radius:4px;border:1px dashed #ffd54f;font-size:11px;line-height:1.3;color:#263238;">
        <strong style="color:#ef6c00;">Causa relacionada (${escapeHtml(service.correlatedFrom.serviceTitle)}):</strong>
        <div style="font-style:italic;margin-top:2px;">"${escapeHtml(service.correlatedFrom.observation)}"</div>
      </div>
    `
    : '';

  return `
    <div>${pill}</div>
    ${repairedHint}
    ${observationHtml}
    ${correlationHtml}
  `;
};

/**
 * Renderiza un checklist completo (entrada o salida) como lista compacta de una línea por ítem.
 * Se usa cuando las plantillas de entrada y salida son distintas: en vez de fusionar fila a fila
 * (dejando celdas "—" desperdiciadas y un correo muy largo), se muestran ambos checklists lado a lado.
 */
const renderCompactChecklistColumn = ({ checklist, parentServiceIds, columnTitle, timeLabel }) => {
  const services = (checklist?.services || []).filter((service) => {
    const id = (service.serviceId || '').toString();
    return !id || !parentServiceIds.has(id);
  });

  const rowsHtml = services.length > 0
    ? services.map((service) => {
      const isChild = Boolean(service.parentServiceId);
      const isError = service.status === 'rojo';
      const pill = buildStatusPill(isError ? 'ERROR' : 'OK', isError ? '#c62828' : '#2e7d32');
      const title = escapeHtml(service.serviceTitle || 'Servicio');
      const indicator = isChild ? '<span style="color:#90a4ae;font-weight:700;margin-right:4px;">└─</span>' : '';
      const indentStyle = isChild ? 'padding-left:16px;' : '';
      const observation = String(service.observation || '').trim();
      let detailHtml = '';
      if (observation) {
        detailHtml = `<div style="margin:3px 0 0 0;font-size:11px;color:#546e7a;line-height:1.3;"><strong>Obs:</strong> ${escapeHtml(observation)}</div>`;
      } else if (service.correlatedFrom) {
        detailHtml = `<div style="margin:3px 0 0 0;font-size:11px;color:#8d6e63;line-height:1.3;">↳ ${escapeHtml(service.correlatedFrom.serviceTitle)}: "${escapeHtml(service.correlatedFrom.observation)}"</div>`;
      }
      return `
        <tr>
          <td style="padding:7px 0;border-top:1px solid #eef2f5;${indentStyle}">
            <div style="font-size:12px;color:#263238;line-height:1.5;">${pill}<span style="margin-left:6px;font-weight:600;">${indicator}${title}</span></div>
            ${detailHtml}
          </td>
        </tr>
      `;
    }).join('')
    : '<tr><td style="padding:7px 0;font-size:12px;color:#90a4ae;">Sin registros</td></tr>';

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ea;border-radius:8px;background:#ffffff;overflow:hidden;">
      <tr>
        <td style="background:#f7f9fb;padding:11px 13px;font-size:13px;font-weight:700;color:#263238;">${escapeHtml(columnTitle)} <span style="color:#78909c;font-weight:600;">(${escapeHtml(timeLabel)})</span></td>
      </tr>
      <tr>
        <td style="padding:2px 13px 9px 13px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>
        </td>
      </tr>
    </table>
  `;
};

const renderSummaryCard = (label, value, styles) => {
  return `
    <td style="display:table-cell !important;width:33.3333% !important;vertical-align:top;padding:0 5px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${styles.bg};border:1px solid ${styles.border};border-radius:8px;">
        <tr>
          <td style="padding:16px 10px 14px 10px;text-align:center;">
            <p style="margin:0 0 6px 0;font-size:30px;font-weight:700;color:${styles.valueColor};line-height:1;">${value}</p>
            <p style="margin:0;font-size:12px;font-weight:600;color:${styles.labelColor};letter-spacing:0.4px;">${label}</p>
          </td>
        </tr>
      </table>
    </td>
  `;
};

/**
 * Genera HTML del reporte de turno
 */
async function generateReportHTML({ shift, checklistEntry, checklistExit, entries, periodStart, periodEnd, appTitle = '', faviconUrl = '' }) {
  const brandedAppTitle = String(appTitle || '').trim();
  const brandedAppTitleHtml = escapeHtml(brandedAppTitle);
  const favicon = String(faviconUrl || '').trim();
  const hasFavicon = favicon.length > 0;
  const dateLabel = formatDate(periodEnd || new Date());
  const periodLabel = periodStart && periodEnd
    ? `${formatDate(periodStart)} ${formatTime(periodStart)} - ${formatDate(periodEnd)} ${formatTime(periodEnd)}`
    : '';
  const includeChecklist = shift.emailReportConfig?.includeChecklist;

  // Correlacionar incidentes de manera inteligente antes de generar las filas del checklist
  if (includeChecklist) {
    correlateBackendServices(checklistEntry);
    correlateBackendServices(checklistExit);
  }

  const includeEntries = shift.emailReportConfig?.includeEntries;
  const serviceRows = includeChecklist ? buildServiceRows(checklistEntry, checklistExit) : [];
  const parentServiceIds = includeChecklist ? buildParentServiceIdSet(checklistEntry, checklistExit) : new Set();
  const leafServiceRows = serviceRows.filter((row) => !parentServiceIds.has(row.serviceId));
  const canCompareForRepair = isSameChecklistContext(checklistEntry, checklistExit);
  const entryTime = formatTime(checklistEntry?.createdAt || checklistEntry?.checkDate);
  const exitTime = formatTime(checklistExit?.createdAt || checklistExit?.checkDate);

  let totalOk = 0;
  let totalError = 0;
  leafServiceRows.forEach((row) => {
    const hasError = row.entry?.status === 'rojo' || row.exit?.status === 'rojo';
    const hasOk = row.entry?.status === 'verde' || row.exit?.status === 'verde';
    if (hasError) {
      totalError += 1;
    } else if (hasOk) {
      totalOk += 1;
    }
  });
  const totalEntries = Array.isArray(entries) ? entries.length : 0;
  const entryTypeCounts = { operativa: 0, ofensa: 0, incidente: 0 };
  (entries || []).forEach((entry) => {
    const canonicalType = toCanonicalEntryType(entry?.entryType);
    if (canonicalType === 'operativa') {
      entryTypeCounts.operativa += 1;
    } else if (canonicalType === 'ofensa') {
      entryTypeCounts.ofensa += 1;
    } else if (canonicalType === 'incidente') {
      entryTypeCounts.incidente += 1;
    }
  });

  const summarySection = `
    <mj-section padding="14px 32px 10px 32px">
      <mj-column>
        <mj-text font-size="18px" font-weight="700" color="#263238" padding="0 0 12px 0">Resumen Checklist</mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0 26px 18px 26px">
      <mj-column>
        <mj-text padding="0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;border-collapse:separate;border-spacing:0;">
            <tr>
              ${renderSummaryCard('OK', totalOk, { bg: '#e8f5e9', border: '#c8e6c9', valueColor: '#1b5e20', labelColor: '#2e7d32' })}
              ${renderSummaryCard('NO OK', totalError, { bg: '#ffebee', border: '#ffcdd2', valueColor: '#b71c1c', labelColor: '#c62828' })}
              ${renderSummaryCard('Entradas', totalEntries, { bg: '#e3f2fd', border: '#bbdefb', valueColor: '#0d47a1', labelColor: '#1565c0' })}
            </tr>
          </table>
        </mj-text>
      </mj-column>
    </mj-section>
  `;

  const comparisonCards = leafServiceRows.map((row) => {
      const title = escapeHtml(row.entry?.serviceTitle || row.exit?.serviceTitle || 'Servicio');
      const entryBlock = renderServiceStatusBlock({ service: row.entry });
      const exitBlock = renderServiceStatusBlock({
        service: row.exit,
        entryService: row.entry,
        isExit: true,
        allowRepaired: canCompareForRepair
      });

      const isChild = Boolean(row.entry?.parentServiceId || row.exit?.parentServiceId);
      const sectionPadding = isChild ? '0 24px 10px 54px' : '0 24px 10px 24px';
      const indicator = isChild ? '<span style="color:#78909c;margin-right:6px;font-weight:700;">└─</span>' : '';
      const backgroundHeader = isChild ? '#fafbfc' : '#f7f9fb';

      return `
        <mj-section padding="${sectionPadding}">
          <mj-column>
            <mj-text padding="0">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ea;border-radius:8px;background:#ffffff;overflow:hidden;">
                <tr>
                  <td style="background:${backgroundHeader};padding:12px 14px;font-size:14px;font-weight:700;color:#263238;">${indicator}${title}</td>
                </tr>
                <tr>
                  <td style="padding:10px 14px 12px 14px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:50%;vertical-align:top;padding-right:8px;">
                          <div style="font-size:12px;color:#546e7a;font-weight:600;margin-bottom:6px;">Entrada (${escapeHtml(entryTime)})</div>
                          ${entryBlock}
                        </td>
                        <td style="width:50%;vertical-align:top;padding-left:8px;">
                          <div style="font-size:12px;color:#546e7a;font-weight:600;margin-bottom:6px;">Salida (${escapeHtml(exitTime)})</div>
                          ${exitBlock}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </mj-text>
          </mj-column>
        </mj-section>
      `;
    }).join('');

  const splitChecklistColumns = `
      <mj-section padding="0 24px 14px 24px">
        <mj-column width="50%" vertical-align="top" padding="0 6px 0 0">
          <mj-text padding="0">${renderCompactChecklistColumn({ checklist: checklistEntry, parentServiceIds, columnTitle: 'Entrada', timeLabel: checklistEntry ? entryTime : '—' })}</mj-text>
        </mj-column>
        <mj-column width="50%" vertical-align="top" padding="0 0 0 6px">
          <mj-text padding="0">${renderCompactChecklistColumn({ checklist: checklistExit, parentServiceIds, columnTitle: 'Salida', timeLabel: checklistExit ? exitTime : '—' })}</mj-text>
        </mj-column>
      </mj-section>
    `;

  const noChecklistDataSection = `
      <mj-section padding="0 32px 14px 32px">
        <mj-column>
          <mj-text font-size="13px" color="#78909c" padding="0">No se registraron datos de checklist para este turno.</mj-text>
        </mj-column>
      </mj-section>
    `;

  let checklistCards;
  if (!includeChecklist || leafServiceRows.length === 0) {
    checklistCards = noChecklistDataSection;
  } else if (canCompareForRepair) {
    // Misma plantilla en entrada y salida → comparación ítem-a-ítem (permite marcar REPARADO).
    checklistCards = comparisonCards;
  } else {
    // Plantillas distintas → dos listas compactas lado a lado (correo más corto, vista rápida).
    checklistCards = splitChecklistColumns;
  }

  const checklistSection = includeChecklist
    ? `
      <mj-section padding="8px 24px 8px 24px">
        <mj-column>
          <mj-text font-size="18px" font-weight="700" color="#263238" padding="0 0 10px 0">Checklist</mj-text>
        </mj-column>
      </mj-section>
      ${checklistCards}
    `
    : '';

  const entryTypeSummarySection = includeEntries
    ? `
      <mj-section padding="4px 32px 8px 32px">
        <mj-column>
          <mj-text font-size="16px" font-weight="700" color="#263238" padding="0 0 4px 0">Entradas por tipo</mj-text>
          <mj-text font-size="12px" color="#607d8b" padding="0 0 10px 0">Resumen rápido de entradas registradas en el periodo.</mj-text>
        </mj-column>
      </mj-section>
      <mj-section padding="0 26px 18px 26px">
        <mj-column>
          <mj-text padding="0">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;border-collapse:separate;border-spacing:0;">
              <tr>
                ${renderSummaryCard('Operativa', entryTypeCounts.operativa, { bg: '#e8f5e9', border: '#c8e6c9', valueColor: '#1b5e20', labelColor: '#2e7d32' })}
                ${renderSummaryCard('Ofensa', entryTypeCounts.ofensa, { bg: '#fff8e1', border: '#ffecb3', valueColor: '#ef6c00', labelColor: '#f57c00' })}
                ${renderSummaryCard('Incidente', entryTypeCounts.incidente, { bg: '#ffebee', border: '#ffcdd2', valueColor: '#b71c1c', labelColor: '#c62828' })}
              </tr>
            </table>
          </mj-text>
        </mj-column>
      </mj-section>
    `
    : '';

  const entriesSection = includeEntries
    ? `
      <mj-section padding="10px 24px 8px 24px">
        <mj-column>
          <mj-text font-size="18px" font-weight="700" color="#263238" padding="0 0 10px 0">Bitácora</mj-text>
        </mj-column>
      </mj-section>
      ${totalEntries > 0
    ? entries.map((entry) => {
      const time = entry.entryTime || formatTime(entry.createdAt);
      const date = entry.entryDate ? formatDate(entry.entryDate) : formatDate(entry.createdAt);
      const typeLabel = entry.entryType ? entry.entryType.toUpperCase() : 'ENTRADA';
      const header = `${escapeHtml(time)}${date ? ` • ${escapeHtml(date)}` : ''}`;
      const subtitle = `Tipo: ${escapeHtml(typeLabel)}${entry.clientName ? ` • Cliente: ${escapeHtml(entry.clientName)}` : ''}`;
      const content = formatEntryContent(entry.content || '');
      return `
              <mj-section padding="0 24px 10px 24px">
                <mj-column>
                  <mj-text padding="0">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ea;border-radius:8px;background:#ffffff;overflow:hidden;">
                      <tr>
                        <td style="padding:10px 14px 6px 14px;font-size:13px;font-weight:700;color:#263238;">${header}</td>
                      </tr>
                      <tr>
                        <td style="padding:0 14px 8px 14px;font-size:12px;color:#607d8b;">${subtitle}</td>
                      </tr>
                      <tr>
                        <td style="padding:0 14px 12px 14px;font-size:13px;line-height:1.45;color:#263238;">${content}</td>
                      </tr>
                    </table>
                  </mj-text>
                </mj-column>
              </mj-section>
            `;
    }).join('')
    : `
            <mj-section padding="0 24px 12px 24px">
              <mj-column>
                <mj-text font-size="13px" color="#78909c" padding="0">No se registraron entradas durante este turno.</mj-text>
              </mj-column>
            </mj-section>
          `}
    `
    : '';

  const mjmlTemplate = `
<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Segoe UI, Arial, sans-serif" />
      <mj-text color="#263238" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#eef2f5" width="960px">
    <mj-section padding="16px 24px 0 24px">
      <mj-column background-color="#edf4fb" border="1px solid #d7e3ef" border-bottom="0" border-radius="10px 10px 0 0" padding="20px 18px 14px 18px">
        <mj-table padding="0">
          <tr>
            ${hasFavicon ? `<td style="width:44px;vertical-align:middle;padding-right:8px;"><img src="${escapeHtml(favicon)}" width="36" height="36" style="display:block;width:36px;height:36px;border:0;outline:none;text-decoration:none;" alt="Logo"></td>` : ''}
            <td style="vertical-align:middle;"><div style="font-size:24px;font-weight:700;line-height:1.2;color:#1f2d3a;">Reporte de Turno${brandedAppTitle ? ` - ${brandedAppTitleHtml}` : ''}</div></td>
          </tr>
        </mj-table>
        <mj-text font-size="13px" color="#355066" padding="8px 0 0 0">${escapeHtml(shift.name)} • ${escapeHtml(shift.startTime)}-${escapeHtml(shift.endTime)} • ${escapeHtml(dateLabel)}</mj-text>
        ${periodLabel ? `<mj-text font-size="12px" color="#4f6b81" padding="6px 0 0 0">Periodo: ${escapeHtml(periodLabel)}</mj-text>` : ''}
      </mj-column>
    </mj-section>
    ${summarySection}
    ${entryTypeSummarySection}
    ${checklistSection}
    ${entriesSection}
    <mj-section padding="8px 24px 20px 24px">
      <mj-column background-color="#ffffff" border="1px solid #dde3e8" border-top="0" border-radius="0 0 10px 10px" padding="0 18px 10px 18px">
        <mj-divider border-width="1px" border-color="#e1e7eb" padding="0 0 10px 0" />
        <mj-text font-size="12px" color="#78909c" align="center" padding="0">Este correo fue generado automáticamente por ${escapeHtml(getAppTitleForText(brandedAppTitle))}</mj-text>
        <mj-text font-size="12px" color="#90a4ae" align="center" padding="4px 0 0 0">No responder a este mensaje</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>
`;

  const compilation = await mjml2html(mjmlTemplate, {
    validationLevel: 'strict',
    minify: false,
    keepComments: false
  });

  if (Array.isArray(compilation.errors) && compilation.errors.length > 0) {
    const message = compilation.errors.map((item) => item.formattedMessage || item.message).join(' | ');
    throw new Error(`MJML compilation failed: ${message}`);
  }

  return compilation.html;
}

function generateReportText({ shift, checklistEntry, checklistExit, entries, periodStart, periodEnd, appTitle = '' }) {
  const brandedAppTitle = String(appTitle || '').trim();
  const lines = [];
  const dateLabel = formatDate(periodEnd || new Date());
  const periodLabel = periodStart && periodEnd
    ? `${formatDate(periodStart)} ${formatTime(periodStart)} - ${formatDate(periodEnd)} ${formatTime(periodEnd)}`
    : '';

  lines.push(`Reporte de Turno${brandedAppTitle ? ` - ${brandedAppTitle}` : ''}`);
  lines.push(`${shift.name} (${shift.startTime} - ${shift.endTime}) • ${dateLabel}`);
  if (periodLabel) lines.push(`Periodo: ${periodLabel}`);
  lines.push('');

  if (shift.emailReportConfig.includeChecklist && (checklistEntry || checklistExit)) {
    // Correlacionar antes de renderizar texto
    correlateBackendServices(checklistEntry);
    correlateBackendServices(checklistExit);

    const entryTime = formatTime(checklistEntry?.createdAt || checklistEntry?.checkDate);
    const exitTime = formatTime(checklistExit?.createdAt || checklistExit?.checkDate);
    const serviceRows = buildServiceRows(checklistEntry, checklistExit);
    const sameChecklistContext = isSameChecklistContext(checklistEntry, checklistExit);

    const getStatusText = (srv) => {
      if (!srv) return 'No registrado';
      let statusStr = srv.status.toUpperCase();
      if (srv.observation) {
        statusStr += ` - Obs: ${srv.observation}`;
      } else if (srv.correlatedFrom) {
        statusStr += ` - Causa Relacionada (${srv.correlatedFrom.serviceTitle}): "${srv.correlatedFrom.observation}"`;
      }
      return statusStr;
    };

    if (sameChecklistContext) {
      lines.push('Checklist de Entrada y Salida');
      lines.push(`Entrada: ${entryTime} | Salida: ${exitTime}`);
      serviceRows.forEach((row) => {
        const title = row.entry?.serviceTitle || row.exit?.serviceTitle || 'Servicio';
        const entryStatus = getStatusText(row.entry);
        const exitStatus = getStatusText(row.exit);
        const isChild = Boolean(row.entry?.parentServiceId || row.exit?.parentServiceId);
        const prefix = isChild ? '  └─ ' : '- ';
        lines.push(`${prefix}${title}: Entrada=${entryStatus} | Salida=${exitStatus}`);
      });
      lines.push('');
    } else {
      const pushChecklistList = (checklist, label, timeLabel) => {
        lines.push(`${label} (${timeLabel})`);
        const services = checklist?.services || [];
        if (services.length === 0) {
          lines.push('- Sin registros');
        } else {
          services.forEach((srv) => {
            const prefix = srv.parentServiceId ? '  └─ ' : '- ';
            lines.push(`${prefix}${srv.serviceTitle || 'Servicio'}: ${getStatusText(srv)}`);
          });
        }
        lines.push('');
      };
      pushChecklistList(checklistEntry, 'Checklist de Entrada', checklistEntry ? entryTime : '—');
      pushChecklistList(checklistExit, 'Checklist de Salida', checklistExit ? exitTime : '—');
    }
  }

  if (shift.emailReportConfig.includeEntries) {
    lines.push('Entradas de Bitacora');
    if (entries && entries.length > 0) {
      entries.forEach((entry) => {
        const time = entry.entryTime || formatTime(entry.createdAt);
        const date = entry.entryDate ? formatDate(entry.entryDate) : formatDate(entry.createdAt);
        const typeLabel = entry.entryType ? entry.entryType.toUpperCase() : 'ENTRADA';
        const clientLabel = entry.clientName ? ` | Cliente: ${entry.clientName}` : '';
        lines.push(`* ${time}${date ? ` • ${date}` : ''} | ${typeLabel}${clientLabel}`);
        if (entry.content) {
          lines.push(entry.content);
        }
        lines.push('');
      });
    } else {
      lines.push('No se registraron entradas durante este turno');
      lines.push('');
    }
  }

  lines.push(`Este correo fue generado automaticamente por ${getAppTitleForText(brandedAppTitle)}`);
  lines.push('No responder a este mensaje');

  return lines.join('\n');
}

/**
 * Envía reporte de turno por correo
 * @param {string} shiftId - ID del turno
 * @param {Date} shiftDate - Fecha del turno (para buscar datos)
 * @param {Object} options - Opciones de envío
 * @param {boolean} options.ignoreShiftEnabled - Ignora emailReportConfig.enabled del turno
 */
async function sendShiftReport(shiftId, shiftDate = new Date(), options = {}) {
  const isManualTrigger = options.ignoreShiftEnabled === true;
  const triggerSource = isManualTrigger ? 'closure-checklist' : 'scheduler';

  const registerShiftReportAudit = async ({ event, success, reason, level, metadata = {} }) => {
    await auditSystem({
      event,
      level: level || (success ? 'info' : 'warn'),
      result: {
        success,
        reason
      },
      metadata: {
        shiftId,
        triggerSource,
        ...metadata
      }
    });
  };

  try {
    logger.info('📊 [sendShiftReport] STARTING shift report process...', { shiftId, shiftDate });

    // 1. Obtener turno
    const shift = await WorkShift.findById(shiftId);
    if (!shift) {
      throw new Error(`Shift ${shiftId} not found`);
    }

    logger.info('📊 [sendShiftReport] Shift found', { name: shift.name, id: shift._id });

    // Validar configuración de trigger
    const ignoreShiftEnabled = options.ignoreShiftEnabled === true;
    if (!ignoreShiftEnabled && !shift.emailReportConfig?.enabled) {
      logger.info(`📊 [sendShiftReport] Email reports DISABLED for shift ${shift.name}`);
      await registerShiftReportAudit({
        event: 'smtp.shift-report.skipped',
        success: true,
        reason: 'Email reports disabled for this shift',
        metadata: {
          shiftName: shift.name,
          enabled: false
        }
      });
      return { success: true, message: 'Email reports disabled for this shift' };
    }

    logger.info('📊 [sendShiftReport] Email reports ENABLED', {
      enabled: true,
      ignoreShiftEnabled
    });

    const emailRecipients = Array.isArray(shift.emailReportConfig?.recipients)
      ? shift.emailReportConfig.recipients.filter(Boolean)
      : [];

    logger.info('📊 [sendShiftReport] Email recipients resolved', {
      count: emailRecipients.length,
      recipients: emailRecipients
    });

    const appConfig = await getBrandingSnapshot();
    const appTitle = appConfig.appTitle;
    const faviconUrl = appConfig.faviconUrl;

    const {
      shiftStart,
      checklistEntry,
      checklistExit,
      periodStart,
      periodEnd,
      entries
    } = await loadShiftReportData(shift, shiftDate, {
      previewAt: isManualTrigger ? shiftDate : null
    });

    // B14: Guardas anti-vacío y validación de checklist de cierre
    if (!isManualTrigger) {
      const hasContentToSend = (checklistEntry || checklistExit || (entries && entries.length > 0));
      if (!hasContentToSend) {
        logger.warn('📊 [sendShiftReport] Aborted: Report is completely empty', { shiftId: shift._id });
        await registerShiftReportAudit({
          event: 'smtp.shift-report.skipped',
          success: false,
          reason: 'Empty report aborted',
          metadata: {
            shiftName: shift.name
          }
        });
        return { success: false, message: 'Empty report aborted' };
      }

      // Se eliminó la validación que difería el envío del reporte por la ausencia del checklist de cierre.
      // Ahora el reporte de turno se despacha de manera directa al finalizar el turno, garantizando el envío
      // oportuno sin bloquear la operación de los analistas por tareas pendientes.

      // B14: Anti duplicados comprobando lastReportSentAt dentro del periodo de turno
      if (shift.lastReportSentAt) {
        const lastSentDate = new Date(shift.lastReportSentAt);
        // Si el último reporte se envió DENTRO del segmento de este turno o DESPUÉS de su inicio
        // significa que ya fue despachado para la "sesión" de este turno.
        // Damos un margen de 15 minutos antes de `shiftStart` para evitar problemas de cron clock.
        const effectiveShiftStart = new Date(shiftStart.getTime() - 15 * 60000);
        if (lastSentDate >= effectiveShiftStart) {
          logger.warn('📊 [sendShiftReport] Aborted: Report already sent for this shift period', { shiftId: shift._id, lastSentDate, shiftStart });
          await registerShiftReportAudit({
            event: 'smtp.shift-report.skipped',
            success: false,
            reason: 'Report already sent for this shift period',
            metadata: {
              shiftName: shift.name,
              lastSentDate,
              shiftStart
            }
          });
          return { success: false, message: 'Report already sent for this shift period' };
        }
      }
    }

    // 5. Generar asunto del correo
    const date = (periodEnd || shiftDate).toLocaleDateString('es-CL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const time = shift.endTime;
    const subject = replaceSubjectVariables(shift.emailReportConfig.subjectTemplate, {
      date,
      shiftName: shift.name,
      time
    });

    // 6. Generar HTML
    const html = await generateReportHTML({
      shift,
      checklistEntry,
      checklistExit,
      entries,
      periodStart,
      periodEnd,
      appTitle,
      faviconUrl
    });
    const text = generateReportText({
      shift,
      checklistEntry,
      checklistExit,
      entries,
      periodStart,
      periodEnd,
      appTitle
    });

    const deliveredChannels = [];
    let lastDeliveryError = null;

    if (emailRecipients.length > 0) {
      logger.info('📊 [sendShiftReport] About to send email...', {
        recipients: emailRecipients,
        subject,
        htmlSize: html.length
      });

      try {
        await sendEmail({
          to: emailRecipients,
          subject,
          html,
          text,
          auditContext: {
            sourceModule: 'shift-report',
            triggerType: triggerSource,
            triggerContext: 'sendShiftReport',
            shiftId: shift._id?.toString(),
            extra: {
              shiftName: shift.name,
              entriesCount: entries.length,
              periodStart,
              periodEnd
            }
          }
        });
        deliveredChannels.push('email');
      } catch (error) {
        lastDeliveryError = error;
        logger.error({ err: error, shiftId }, 'Error sending shift report email');
      }
    }

    const glpiDispatchResult = await dispatchGlpiPayload({
      expectedDispatchMode: 'daily-summary',
      title: subject,
      subject,
      text,
      html,
      sourceEvent: 'shift-report.daily-summary',
      context: {
        shiftId: shift._id.toString(),
        shiftName: shift.name,
        entriesCount: entries.length,
        periodStart,
        periodEnd
      }
    });

    if (glpiDispatchResult.success) {
      deliveredChannels.push('glpi');
    } else if (!['disabled', 'dispatch-mode-mismatch'].includes(glpiDispatchResult.skippedReason || '')) {
      lastDeliveryError = lastDeliveryError || glpiDispatchResult.error || new Error(glpiDispatchResult.message || 'GLPI dispatch failed');
    }

    if (!deliveredChannels.length) {
      const reason = emailRecipients.length > 0
        ? (lastDeliveryError?.message || 'No se logró entregar el reporte por ningún canal')
        : 'No hay destinatarios configurados y GLPI resumen diario no está disponible';

      await registerShiftReportAudit({
        event: 'smtp.shift-report.skipped',
        success: false,
        reason,
        metadata: {
          shiftName: shift.name,
          recipientsCount: emailRecipients.length,
          glpiSkippedReason: glpiDispatchResult.skippedReason || null
        }
      });

      return { success: false, message: reason };
    }

    shift.lastReportSentAt = new Date();
    await shift.save({ validateModifiedOnly: true });

    logger.info('✅ [sendShiftReport] SHIFT REPORT SENT SUCCESSFULLY!', {
      shiftId,
      channels: deliveredChannels,
      recipients: emailRecipients
    });

    logger.info(`Shift report sent for ${shift.name}`, {
      shiftId: shift._id,
      recipients: emailRecipients,
      channels: deliveredChannels,
      date: shiftDate
    });

    await registerShiftReportAudit({
      event: 'smtp.shift-report.sent',
      success: true,
      reason: 'Report sent successfully',
      metadata: {
        shiftName: shift.name,
        recipientsCount: emailRecipients.length,
        includeChecklist: shift.emailReportConfig.includeChecklist,
        includeEntries: shift.emailReportConfig.includeEntries,
        entriesCount: entries.length,
        periodStart,
        periodEnd,
        channels: deliveredChannels
      }
    });

    return {
      success: true,
      deferredByClosure: false,
      message: 'Report sent successfully',
      recipients: emailRecipients.length,
      includeChecklist: shift.emailReportConfig.includeChecklist,
      includeEntries: shift.emailReportConfig.includeEntries,
      entriesCount: entries.length,
      channels: deliveredChannels
    };

  } catch (error) {
    await registerShiftReportAudit({
      event: 'smtp.shift-report.error',
      success: false,
      reason: error.message,
      level: 'error'
    });

    logger.error('❌ [sendShiftReport] ERROR!', {
      error: error.message,
      stack: error.stack,
      shiftId
    });
    throw error;
  }
}

/**
 * Envía una vista previa PoC del reporte de turno usando datos reales del turno
 * para la fecha/hora de referencia, sin contabilizarlo como envío productivo.
 */
async function sendShiftReportPoc(shiftId, options = {}) {
  const referenceDate = options.date ? new Date(options.date) : new Date();

  const registerPocAudit = async ({ event, success, reason, level, metadata = {} }) => {
    await auditSystem({
      event,
      level: level || (success ? 'info' : 'warn'),
      result: { success, reason },
      metadata: {
        shiftId,
        isPoc: true,
        ...metadata
      }
    });
  };

  try {
    const shift = await WorkShift.findById(shiftId);
    if (!shift) {
      throw new Error(`Shift ${shiftId} not found`);
    }

    const recipients = Array.isArray(shift.emailReportConfig?.recipients)
      ? shift.emailReportConfig.recipients.filter(Boolean)
      : [];

    if (recipients.length === 0) {
      await registerPocAudit({
        event: 'smtp.shift-report.poc.skipped',
        success: false,
        reason: 'No recipients configured',
        metadata: {
          shiftName: shift.name,
          recipientsCount: 0
        }
      });

      return { success: false, isPoc: true, message: 'No recipients configured' };
    }

    const appConfig = await getBrandingSnapshot();
    const appTitle = appConfig.appTitle;
    const faviconUrl = appConfig.faviconUrl;

    const dateLabel = referenceDate.toLocaleDateString('es-CL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    const subjectTemplate = shift.emailReportConfig?.subjectTemplate || 'Reporte SOC [fecha] [turno]';
    const baseSubject = replaceSubjectVariables(subjectTemplate, {
      date: dateLabel,
      shiftName: shift.name,
      time: shift.endTime
    });

    const {
      checklistEntry,
      checklistExit,
      periodStart,
      periodEnd,
      entries,
      shiftStart,
      shiftEnd,
      reportCutoff
    } = await loadShiftReportData(shift, referenceDate, {
      previewAt: referenceDate
    });

    const shiftForPoc = {
      ...shift.toObject(),
      emailReportConfig: {
        ...(shift.emailReportConfig || {}),
        includeChecklist: shift.emailReportConfig?.includeChecklist !== false,
        includeEntries: shift.emailReportConfig?.includeEntries !== false
      }
    };

    const htmlBody = await generateReportHTML({
      shift: shiftForPoc,
      checklistEntry,
      checklistExit,
      entries,
      periodStart,
      periodEnd,
      appTitle,
      faviconUrl
    });

    const html = `
      <div style="font-family:Segoe UI,Arial,sans-serif;background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:10px 12px;margin:0 0 12px 0;color:#8d6e63;font-size:12px;">
        PRUEBA POC: Vista previa del correo de fin de turno con datos reales acumulados dentro del rango ${formatDate(shiftStart)} ${formatTime(shiftStart)} - ${formatDate(reportCutoff)} ${formatTime(reportCutoff)}. No registra envío productivo ni marca el turno como reportado.
      </div>
      ${htmlBody}
    `;

    const text = [
      `PRUEBA POC: Vista previa del correo de fin de turno con datos reales acumulados dentro del rango ${formatDate(shiftStart)} ${formatTime(shiftStart)} - ${formatDate(reportCutoff)} ${formatTime(reportCutoff)}. No registra envío productivo ni marca el turno como reportado.`,
      '',
      generateReportText({
        shift: shiftForPoc,
        checklistEntry,
        checklistExit,
        entries,
        periodStart,
        periodEnd,
        appTitle
      })
    ].join('\n');

    const subject = `[POC] ${baseSubject}`;

    await sendEmail({
      to: recipients,
      subject,
      html,
      text,
      auditContext: {
        sourceModule: 'shift-report',
        triggerType: 'poc',
        triggerContext: 'sendShiftReportPoc',
        shiftId: shift._id?.toString(),
        extra: {
          shiftName: shift.name,
          date: referenceDate,
          entriesCount: entries.length
        }
      }
    });

    await registerPocAudit({
      event: 'smtp.shift-report.poc.sent',
      success: true,
      reason: 'POC report sent successfully',
      metadata: {
        shiftName: shift.name,
        recipientsCount: recipients.length,
        includeChecklist: shiftForPoc.emailReportConfig.includeChecklist,
        includeEntries: shiftForPoc.emailReportConfig.includeEntries,
        entriesCount: entries.length,
        hasChecklistEntry: !!checklistEntry,
        hasChecklistExit: !!checklistExit,
        shiftStart,
        shiftEnd,
        reportCutoff,
        periodStart,
        periodEnd,
        date: referenceDate
      }
    });

    return {
      success: true,
      isPoc: true,
      message: 'Vista previa del reporte de turno enviada correctamente',
      recipients: recipients.length,
      entriesCount: entries.length,
      hasChecklistEntry: !!checklistEntry,
      hasChecklistExit: !!checklistExit
    };
  } catch (error) {
    await registerPocAudit({
      event: 'smtp.shift-report.poc.error',
      success: false,
      reason: error.message,
      level: 'error'
    });

    throw error;
  }
}

module.exports = {
  sendShiftReport,
  sendShiftReportPoc,
  generateReportHTML,
  generateReportText,
  replaceSubjectVariables
};
