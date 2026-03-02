const { sendEmail } = require('./email');
const WorkShift = require('../models/WorkShift');
const Entry = require('../models/Entry');
const ShiftCheck = require('../models/ShiftCheck');
const { logger } = require('./logger');

/**
 * Genera y envía reporte de turno por correo
 * 
 * Contenido:
 *   - Checklist de entrada y salida (lado a lado)
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

  const keys = new Set([...entryMap.keys(), ...exitMap.keys()]);
  const rows = Array.from(keys)
    .map((key) => ({
      key,
      entry: entryMap.get(key) || null,
      exit: exitMap.get(key) || null
    }))
    .sort((a, b) => {
      const aTitle = a.entry?.serviceTitle || a.exit?.serviceTitle || '';
      const bTitle = b.entry?.serviceTitle || b.exit?.serviceTitle || '';
      return aTitle.localeCompare(bTitle, 'es');
    });

  return rows;
};

const renderStatusCell = (service) => {
  if (!service) {
    return '<span style="color:#000000 !important;font-size:12px;">No registrado</span>';
  }

  const isOk = service.status === 'verde';
  const label = isOk ? 'OK' : 'ERROR';
  const labelWithText = isOk ? 'OK (Verde)' : 'ERROR (Rojo)';
  const color = isOk ? '#1b5e20' : '#b71c1c';
  const observation = service.observation ? escapeHtml(service.observation) : '-';

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0;">
      <tr>
        <td bgcolor="${color}" style="background-color:${color};padding:4px 10px;border-radius:4px;border:1px solid ${color};">
          <span style="color:#ffffff !important;-webkit-text-fill-color:#ffffff !important;font-weight:700;font-size:12px;letter-spacing:0.3px;">${label}</span>
        </td>
      </tr>
    </table>
    <div style="margin-top:4px;color:#000000 !important;-webkit-text-fill-color:#000000 !important;font-size:11px;font-weight:600;">${labelWithText}</div>
    <div style="margin-top:4px;color:#000000 !important;-webkit-text-fill-color:#000000 !important;font-size:12px;">${observation}</div>
  `;
};

/**
 * Genera HTML del reporte de turno
 */
function generateReportHTML({ shift, checklistEntry, checklistExit, entries, periodStart, periodEnd }) {
  const dateLabel = formatDate(periodEnd || new Date());
  const periodLabel = periodStart && periodEnd
    ? `${formatDate(periodStart)} ${formatTime(periodStart)} - ${formatDate(periodEnd)} ${formatTime(periodEnd)}`
    : '';

  const baseFont = "font-family:'Segoe UI', Arial, sans-serif;";
  const hardBlack = 'color:#000000 !important;-webkit-text-fill-color:#000000 !important;mso-color-alt:#000000;mso-style-textfill-fill-color:#000000;';
  const baseColor = hardBlack;
  const tableBorder = 'border:1px solid #e0e0e0;';
  const cellPadding = 'padding:10px 12px;';

  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <!--[if mso]>
  <style>
    body, table, td, p, span, div, a, h1, h2, h3, h4, h5, h6, li { color:#000000 !important; }
  </style>
  <![endif]-->
</head>
<body style="${baseFont}line-height:1.6;${baseColor}background-color:#f5f5f5;margin:0;padding:0;" bgcolor="#f5f5f5">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f5f5" style="background-color:#f5f5f5;">
    <tr>
      <td align="center" style="padding:16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:1100px;">
          <tr>
            <td style="background-color:#ffffff;border-radius:8px;padding:28px;box-shadow:0 2px 4px rgba(0,0,0,0.1);${baseColor}" bgcolor="#ffffff">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#ffffff;color:#000000;padding:20px;border-bottom:2px solid #e0e0e0;border-radius:8px 8px 0 0;${hardBlack}" bgcolor="#ffffff">
                    <h1 style="margin:0;font-size:24px;${hardBlack}">🛡️ Reporte de Turno - Bitácora SOC</h1>
                    <div style="margin:5px 0 0 0;font-size:14px;${hardBlack}">
                      ${escapeHtml(shift.name)} (${shift.startTime} - ${shift.endTime}) • ${dateLabel}
                    </div>
                    ${periodLabel ? `<div style="margin:10px 0 0 0;font-size:13px;${hardBlack}">Periodo: ${periodLabel}</div>` : ''}
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:20px;${baseColor}">
                    <font color="#000000">
`;

  // Sección de Checklist
  if (shift.emailReportConfig.includeChecklist && (checklistEntry || checklistExit)) {
    const entryTime = formatTime(checklistEntry?.createdAt || checklistEntry?.checkDate);
    const exitTime = formatTime(checklistExit?.createdAt || checklistExit?.checkDate);
    const serviceRows = buildServiceRows(checklistEntry, checklistExit);

    html += `
    <div style="margin:30px 0;">
      <div style="font-size:18px;font-weight:700;${hardBlack}margin-bottom:15px;padding-bottom:8px;border-bottom:2px solid #e0e0e0;">📋 Checklist de Entrada y Salida</div>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:15px;${baseColor}background-color:#ffffff !important;" cellpadding="0" cellspacing="0" bgcolor="#ffffff">
        <thead>
          <tr>
            <th style="width:40%;background-color:#f8f9fa !important;${cellPadding}${tableBorder}${hardBlack}text-align:left;" bgcolor="#f8f9fa">Servicio</th>
            <th style="width:30%;background-color:#f8f9fa !important;${cellPadding}${tableBorder}${hardBlack}text-align:left;" bgcolor="#f8f9fa">Entrada (${entryTime})</th>
            <th style="width:30%;background-color:#f8f9fa !important;${cellPadding}${tableBorder}${hardBlack}text-align:left;" bgcolor="#f8f9fa">Salida (${exitTime})</th>
          </tr>
        </thead>
        <tbody>
`;

    serviceRows.forEach((row) => {
      const title = escapeHtml(row.entry?.serviceTitle || row.exit?.serviceTitle || 'Servicio');
      html += `
        <tr>
          <td style="${cellPadding}${tableBorder}${hardBlack}vertical-align:top;background-color:#ffffff !important;" bgcolor="#ffffff"><strong style="${hardBlack}">${title}</strong></td>
          <td style="${cellPadding}${tableBorder}${hardBlack}vertical-align:top;background-color:#ffffff !important;" bgcolor="#ffffff">${renderStatusCell(row.entry)}</td>
          <td style="${cellPadding}${tableBorder}${hardBlack}vertical-align:top;background-color:#ffffff !important;" bgcolor="#ffffff">${renderStatusCell(row.exit)}</td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    </div>
`;
  }

  // Sección de Entradas
  if (shift.emailReportConfig.includeEntries) {
    html += `
    <div style="margin:30px 0;">
      <div style="font-size:18px;font-weight:700;${hardBlack}margin-bottom:15px;padding-bottom:8px;border-bottom:2px solid #e0e0e0;">📝 Entradas de Bitácora</div>
`;

    if (entries && entries.length > 0) {
      html += '<ul style="list-style:none;padding:0;margin:0;">';
      entries.forEach(entry => {
        const time = entry.entryTime
          ? entry.entryTime
          : new Date(entry.createdAt).toLocaleTimeString('es-CL', {
            hour: '2-digit',
            minute: '2-digit'
          });
        const date = entry.entryDate ? formatDate(entry.entryDate) : formatDate(entry.createdAt);
        const typeLabel = entry.entryType ? entry.entryType.toUpperCase() : 'ENTRADA';
        html += `
        <li style="background-color:#ffffff !important;border:1px solid #e0e0e0;border-left:4px solid #667eea;padding:15px;margin:10px 0;border-radius:4px;${hardBlack}" bgcolor="#ffffff">
          <div style="font-weight:700;${hardBlack}margin-bottom:5px;">${escapeHtml(time)}${date ? ` • ${escapeHtml(date)}` : ''}</div>
          <div style="${hardBlack}font-size:12px;margin-bottom:6px;">Tipo: ${escapeHtml(typeLabel)}${entry.clientName ? ` • Cliente: ${escapeHtml(entry.clientName)}` : ''}</div>
          <div style="${hardBlack}font-size:14px;white-space:pre-wrap;word-break:break-word;">${formatEntryContent(entry.content || '')}</div>
        </li>
`;
      });
      html += '</ul>';
    } else {
      html += '<div style="text-align:center;padding:30px;color:#999 !important;font-style:italic;">No se registraron entradas durante este turno</div>';
    }

    html += '</div>';
  }

  html += `
    <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e0e0e0;text-align:center;${hardBlack}font-size:12px;">
      Este correo fue generado automáticamente por Bitácora SOC<br>
      No responder a este mensaje
    </div>
                    </font>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  return html;
}

function generateReportText({ shift, checklistEntry, checklistExit, entries, periodStart, periodEnd }) {
  const lines = [];
  const dateLabel = formatDate(periodEnd || new Date());
  const periodLabel = periodStart && periodEnd
    ? `${formatDate(periodStart)} ${formatTime(periodStart)} - ${formatDate(periodEnd)} ${formatTime(periodEnd)}`
    : '';

  lines.push('Reporte de Turno - Bitacora SOC');
  lines.push(`${shift.name} (${shift.startTime} - ${shift.endTime}) • ${dateLabel}`);
  if (periodLabel) lines.push(`Periodo: ${periodLabel}`);
  lines.push('');

  if (shift.emailReportConfig.includeChecklist && (checklistEntry || checklistExit)) {
    const entryTime = formatTime(checklistEntry?.createdAt || checklistEntry?.checkDate);
    const exitTime = formatTime(checklistExit?.createdAt || checklistExit?.checkDate);
    const serviceRows = buildServiceRows(checklistEntry, checklistExit);

    lines.push('Checklist de Entrada y Salida');
    lines.push(`Entrada: ${entryTime} | Salida: ${exitTime}`);
    serviceRows.forEach((row) => {
      const title = row.entry?.serviceTitle || row.exit?.serviceTitle || 'Servicio';
      const entryStatus = row.entry ? `${row.entry.status.toUpperCase()}${row.entry.observation ? ` - ${row.entry.observation}` : ''}` : 'No registrado';
      const exitStatus = row.exit ? `${row.exit.status.toUpperCase()}${row.exit.observation ? ` - ${row.exit.observation}` : ''}` : 'No registrado';
      lines.push(`- ${title}: Entrada=${entryStatus} | Salida=${exitStatus}`);
    });
    lines.push('');
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

  lines.push('Este correo fue generado automaticamente por Bitacora SOC');
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
      return { success: true, message: 'Email reports disabled for this shift' };
    }

    logger.info('📊 [sendShiftReport] Email reports ENABLED', {
      enabled: true,
      ignoreShiftEnabled
    });

    if (!shift.emailReportConfig.recipients || shift.emailReportConfig.recipients.length === 0) {
      logger.warn(`📊 [sendShiftReport] No recipients configured for shift ${shift.name}`);
      return { success: false, message: 'No recipients configured' };
    }

    logger.info('📊 [sendShiftReport] Recipients found', { count: shift.emailReportConfig.recipients.length, recipients: shift.emailReportConfig.recipients });

    // 2. Calcular rango horario del turno
    const [startHour, startMinute] = shift.startTime.split(':').map(Number);
    const [endHour, endMinute] = shift.endTime.split(':').map(Number);

    const shiftStart = new Date(shiftDate);
    shiftStart.setHours(startHour, startMinute, 0, 0);

    let shiftEnd = new Date(shiftDate);
    shiftEnd.setHours(endHour, endMinute, 0, 0);

    const crossesMidnight = endHour < startHour || (endHour === startHour && endMinute < startMinute);
    if (crossesMidnight) {
      // Si es madrugada (antes del fin del turno), el turno empezó el día anterior
      if (shiftDate < shiftEnd) {
        shiftStart.setDate(shiftStart.getDate() - 1);
      } else {
        shiftEnd.setDate(shiftEnd.getDate() + 1);
      }
    }

    // 3. Buscar checklists de entrada y salida dentro del rango real del turno
    const checklistExit = await ShiftCheck.findOne({
      type: 'cierre',
      createdAt: { $gte: shiftStart, $lte: shiftEnd }
    }).sort({ createdAt: -1 });

    const entryRangeEnd = checklistExit?.createdAt || shiftEnd;
    const checklistEntry = await ShiftCheck.findOne({
      type: 'inicio',
      createdAt: { $gte: shiftStart, $lte: entryRangeEnd }
    }).sort({ createdAt: -1 });

    // 4. Buscar entradas entre inicio y cierre de checklist (fallback al rango del turno)
    const periodStart = checklistEntry?.createdAt || shiftStart;
    const periodEnd = checklistExit?.createdAt || shiftEnd;

    const entries = await Entry.find({
      createdAt: { $gte: periodStart, $lte: periodEnd }
    }).sort({ createdAt: 1 });

    // B14: Guardas anti-vacío y validación de checklist de cierre
    const isManualTrigger = options.ignoreShiftEnabled === true;
    if (!isManualTrigger) {
      if (!checklistExit) {
        logger.warn('📊 [sendShiftReport] Aborted: No closure checklist found for shift', { shiftId: shift._id });
        return { success: false, message: 'No closure checklist found' };
      }

      if (!checklistExit && entries.length === 0) {
        logger.warn('📊 [sendShiftReport] Aborted: Report is completely empty', { shiftId: shift._id });
        return { success: false, message: 'Empty report aborted' };
      }

      // B14: Anti duplicados comprobando lastReportSentAt dentro del periodo de turno
      if (shift.lastReportSentAt) {
        const lastSentDate = new Date(shift.lastReportSentAt);
        // Si el último reporte se envió DENTRO del segmento de este turno o DESPUÉS de su inicio
        // significa que ya fue despachado para la "sesión" de este turno.
        // Damos un margen de 15 minutos antes de `shiftStart` para evitar problemas de cron clock.
        const effectiveShiftStart = new Date(shiftStart.getTime() - 15 * 60000);
        if (lastSentDate >= effectiveShiftStart) {
          logger.warn('📊 [sendShiftReport] Aborted: Report already sent for this shift period', { shiftId: shift._id, lastSentDate, shiftStart });
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
    const html = generateReportHTML({
      shift,
      checklistEntry,
      checklistExit,
      entries,
      periodStart,
      periodEnd
    });
    const text = generateReportText({
      shift,
      checklistEntry,
      checklistExit,
      entries,
      periodStart,
      periodEnd
    });

    // 7. Enviar correo
    logger.info('📊 [sendShiftReport] About to send email...', {
      recipients: shift.emailReportConfig.recipients,
      subject,
      htmlSize: html.length
    });

    await sendEmail({
      to: shift.emailReportConfig.recipients,
      subject,
      html,
      text
    });

    // Registrar envío para evitar duplicados
    shift.lastReportSentAt = new Date();
    await shift.save({ validateModifiedOnly: true });

    logger.info('✅ [sendShiftReport] SHIFT REPORT SENT SUCCESSFULLY!', { shiftId, recipients: shift.emailReportConfig.recipients });

    logger.info(`Shift report sent for ${shift.name}`, {
      shiftId: shift._id,
      recipients: shift.emailReportConfig.recipients,
      date: shiftDate
    });

    return {
      success: true,
      message: 'Report sent successfully',
      recipients: shift.emailReportConfig.recipients.length,
      includeChecklist: shift.emailReportConfig.includeChecklist,
      includeEntries: shift.emailReportConfig.includeEntries,
      entriesCount: entries.length
    };

  } catch (error) {
    logger.error('❌ [sendShiftReport] ERROR!', {
      error: error.message,
      stack: error.stack,
      shiftId
    });
    throw error;
  }
}

module.exports = {
  sendShiftReport,
  generateReportHTML,
  replaceSubjectVariables
};
