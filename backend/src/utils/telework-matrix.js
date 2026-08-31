/**
 * File Purpose: backend/src/utils/telework-matrix.js
 * Responsibilities: Reconstruir en el backend la grilla semanal "Personal en Teletrabajo y Apoyo"
 *   (Lun-Vie, una fila por analista interno, estado de mayor prioridad por día) y renderizarla como
 *   una página HTML autónoma para el enlace público de solo lectura (pantalla/TV, sin sesión).
 * QA Notes: La lógica de resolución por día (prioridades, solape de fechas, exclusión de roles
 *   guest/auditor, orden hasSpecial-primero) debe mantenerse alineada con `computeMatrixRows` de
 *   frontend/src/app/pages/escalation/escalation-simple/escalation-simple.component.ts.
 */

// Estados posibles de una celda día/persona y su presentación (sin fuentes externas: emoji + color).
const STATUS_META = {
  'medical-leave': { label: 'Licencia Médica', color: '#dc2626', marker: '🩹' },
  vacation: { label: 'Vacaciones', color: '#dc2626', marker: '🌴' },
  'medical-appointment': { label: 'Trámite Médico', color: '#0e7490', marker: '🏥' },
  training: { label: 'Capacitación', color: '#b45309', marker: '🎓' },
  telework: { label: 'Teletrabajo', color: '#059669', marker: '🏠' },
  office: { label: 'En Oficina', color: '#64748b', marker: '' }
};

// Prioridad para resolver el (poco frecuente) caso de dos asignaciones relevantes el mismo día.
const DAY_PRIORITY = { VACATION: 1, MEDICAL_LEAVE: 1, MEDICAL_APPOINTMENT: 2, OL: 3, TELEWORK: 4 };
const RELEVANT_ROLE_CODES = Object.keys(DAY_PRIORITY);

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const capitalizeFirst = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

const mapRoleToStatus = (roleCode) => {
  switch (roleCode) {
    case 'MEDICAL_LEAVE': return 'medical-leave';
    case 'VACATION': return 'vacation';
    case 'MEDICAL_APPOINTMENT': return 'medical-appointment';
    case 'OL': return 'training';
    case 'TELEWORK': return 'telework';
    default: return 'office';
  }
};

/** Lunes 00:00 de la semana que contiene `reference`. */
const resolveWeekStart = (reference) => {
  const now = new Date(reference);
  const dayOfWeek = now.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + diff);
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
};

/** 5 columnas Lun-Vie a partir del lunes dado. */
const buildWeekdayColumns = (weekStart) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    d.setHours(0, 0, 0, 0);
    return {
      date: d,
      dayShort: capitalizeFirst(d.toLocaleDateString('es-CL', { weekday: 'short' })).replace(/\./g, ''),
      dateShort: d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' }),
      isToday: d.getTime() === today.getTime()
    };
  });
};

/**
 * Resuelve, por cada usuario interno y cada columna/día, el estado de mayor prioridad activo ese día.
 * @param {Array} assignments - ShiftAssignment (con userId poblado o como ObjectId).
 * @param {Array} users - usuarios internos (fullName, role, cargoLabel).
 * @param {Array} columns - salida de buildWeekdayColumns.
 */
const computeRows = (assignments, users, columns) => {
  const userGroups = new Map();

  (Array.isArray(users) ? users : []).forEach((u) => {
    if (!u || u.role === 'guest' || u.role === 'auditor') return;
    const key = String(u._id);
    userGroups.set(key, {
      key,
      name: u.fullName || u.name || 'Sin asignar',
      role: u.cargoLabel || 'Analista',
      assignments: []
    });
  });

  (Array.isArray(assignments) ? assignments : []).forEach((asg) => {
    if (!asg) return;
    const userIdStr = asg.userId && asg.userId._id
      ? String(asg.userId._id)
      : (asg.userId ? String(asg.userId) : null);
    if (!userIdStr || !userGroups.has(userIdStr)) return;

    const group = userGroups.get(userIdStr);
    if (!group.assignments.some((a) => String(a._id) === String(asg._id))) {
      group.assignments.push(asg);
    }
  });

  const rows = [];
  userGroups.forEach((group) => {
    const relevantAsgs = group.assignments.filter(
      (a) => RELEVANT_ROLE_CODES.includes(a.roleCode) && a.isPaused !== true
    );

    let hasSpecial = false;
    const days = columns.map((col) => {
      const dayStart = new Date(col.date);
      const dayEnd = new Date(col.date);
      dayEnd.setHours(23, 59, 59, 999);

      const activeToday = relevantAsgs.filter((a) => {
        const start = new Date(a.weekStartDate);
        const end = new Date(a.weekEndDate);
        return start <= dayEnd && end >= dayStart;
      });

      if (activeToday.length === 0) {
        return { status: 'office', ...STATUS_META.office };
      }

      activeToday.sort((a, b) => (DAY_PRIORITY[a.roleCode] ?? 9) - (DAY_PRIORITY[b.roleCode] ?? 9));
      hasSpecial = true;
      const status = mapRoleToStatus(activeToday[0].roleCode);
      return { status, ...STATUS_META[status] };
    });

    rows.push({ key: group.key, name: group.name, role: group.role, hasSpecial, days });
  });

  rows.sort((a, b) => {
    if (a.hasSpecial !== b.hasSpecial) return a.hasSpecial ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return rows;
};

/**
 * Construye la matriz completa de la semana en curso.
 * @param {Object} params
 * @param {Array} params.assignments
 * @param {Array} params.users
 * @param {Date|string|number} [params.now]
 */
const buildTeleworkWeeklyMatrix = ({ assignments, users, now = new Date() } = {}) => {
  const weekStart = resolveWeekStart(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 4);
  weekEnd.setHours(23, 59, 59, 999);

  const columns = buildWeekdayColumns(weekStart);
  const rows = computeRows(assignments, users, columns);

  const fmt = (d) => `${d.getDate()} de ${MONTHS_ES[d.getMonth()]}`;
  const weekRangeText = `Semana del Lunes ${fmt(weekStart)} al Viernes ${fmt(weekEnd)} de ${weekStart.getFullYear()}`;

  return { columns, rows, weekStart, weekEnd, weekRangeText };
};

/** Condiciones de solape para traer las asignaciones que tocan la semana [weekStart, weekEnd]. */
const buildWeekOverlapFilter = (weekStart, weekEnd) => ({
  $or: [
    { weekStartDate: { $gte: weekStart, $lte: weekEnd } },
    { weekEndDate: { $gte: weekStart, $lte: weekEnd } },
    { weekStartDate: { $lte: weekStart }, weekEndDate: { $gte: weekEnd } }
  ]
});

const LEGEND_ORDER = ['telework', 'training', 'vacation', 'medical-leave', 'medical-appointment'];

/**
 * Renderiza la página HTML autónoma (sin JS, sin fuentes externas) para el enlace público.
 * @param {Object} params
 * @param {Object} params.matrix - salida de buildTeleworkWeeklyMatrix.
 * @param {string} [params.appTitle]
 * @param {Date} [params.generatedAt]
 * @param {number} [params.refreshSeconds]
 */
const renderTeleworkWeeklyPage = ({ matrix, appTitle = 'Bitácora SOC', generatedAt = new Date(), refreshSeconds = 600 } = {}) => {
  const { columns, rows, weekRangeText } = matrix;
  const safeTitle = escapeHtml(appTitle);
  const updatedLabel = new Date(generatedAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

  const headCells = columns
    .map((col) => `<th class="${col.isToday ? 'is-today' : ''}"><span class="d-name">${escapeHtml(col.dayShort)}</span><span class="d-date">${escapeHtml(col.dateShort)}</span></th>`)
    .join('');

  const bodyRows = rows.length > 0
    ? rows.map((row) => {
      const cells = row.days.map((day) => {
        if (day.status === 'office') {
          return '<td class="cell-office"></td>';
        }
        return `<td class="cell-special" style="--c:${day.color}">`
          + `<span class="marker">${day.marker}</span>`
          + `<span class="label">${escapeHtml(day.label)}</span>`
          + '</td>';
      }).join('');
      const roleHtml = row.role ? `<span class="r-role">${escapeHtml(row.role)}</span>` : '';
      return `<tr class="${row.hasSpecial ? 'has-special' : ''}"><td class="cell-name"><span class="r-name">${escapeHtml(row.name)}</span>${roleHtml}</td>${cells}</tr>`;
    }).join('')
    : `<tr><td class="empty" colspan="${1 + columns.length}">Sin personal fuera de la oficina esta semana</td></tr>`;

  const legendHtml = LEGEND_ORDER
    .map((status) => {
      const meta = STATUS_META[status];
      return `<span class="leg-item"><span class="leg-dot" style="background:${meta.color}"></span>${meta.marker} ${escapeHtml(meta.label)}</span>`;
    })
    .join('');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${Number(refreshSeconds) || 600}">
<meta name="robots" content="noindex, nofollow">
<title>${safeTitle} · Personal en Teletrabajo y Apoyo</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px clamp(16px, 4vw, 56px);
    font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: #f1f5f9; color: #0f172a;
  }
  .wrap { max-width: 1600px; margin: 0 auto; }
  header { margin-bottom: 20px; }
  h1 { margin: 0; font-size: clamp(24px, 3vw, 40px); letter-spacing: -0.02em; }
  .subtitle { margin: 6px 0 0; font-size: clamp(15px, 1.6vw, 22px); font-weight: 600; color: #475569; }
  .bar { height: 4px; margin-top: 14px; border-radius: 3px; background: linear-gradient(90deg, #6366f1, #a855f7); }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; background: #fff; border: 1px solid #cbd5e1; }
  th, td { border: 1px solid #cbd5e1; padding: 14px 10px; text-align: center; vertical-align: middle; }
  thead th { background: #f8fafc; font-size: clamp(13px, 1.4vw, 18px); }
  thead th.is-today { background: #eef2ff; box-shadow: inset 0 -3px 0 #6366f1; }
  th:first-child, td.cell-name { width: 24%; text-align: left; }
  .d-name { display: block; font-weight: 800; }
  .d-date { display: block; font-size: 0.8em; font-weight: 500; color: #64748b; }
  .r-name { display: block; font-weight: 700; font-size: clamp(14px, 1.5vw, 20px); }
  .r-role { display: block; font-size: clamp(11px, 1vw, 14px); color: #64748b; margin-top: 2px; }
  tr.has-special { background: #fffdf5; }
  td.cell-special {
    background: #f8fafc; /* respaldo si el navegador no soporta color-mix */
    background: color-mix(in srgb, var(--c) 12%, #fff);
    border-bottom: 3px solid var(--c);
  }
  td.cell-special .marker { font-size: clamp(20px, 2.4vw, 34px); display: block; line-height: 1.1; }
  td.cell-special .label {
    display: block; margin-top: 4px; font-size: clamp(10px, 1vw, 13px);
    font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; color: var(--c);
  }
  td.cell-office { background: #fff; }
  td.empty { padding: 40px; font-style: italic; color: #64748b; font-size: clamp(15px, 1.6vw, 20px); }
  .legend { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 16px; font-size: clamp(12px, 1.2vw, 16px); color: #334155; }
  .leg-item { display: inline-flex; align-items: center; gap: 6px; }
  .leg-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
  footer { margin-top: 18px; font-size: clamp(11px, 1.1vw, 14px); color: #64748b; }
  footer .updated { font-weight: 700; color: #334155; }
  .disclaimer { margin-top: 8px; font-style: italic; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>🏡 Personal en Teletrabajo y Apoyo</h1>
      <p class="subtitle">${escapeHtml(weekRangeText)}</p>
      <div class="bar"></div>
    </header>

    <table>
      <thead><tr><th>Nombre</th>${headCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>

    <div class="legend">${legendHtml}</div>

    <footer>
      <span class="updated">Actualizado ${escapeHtml(updatedLabel)}</span> · la pantalla se actualiza sola cada ${Math.round((Number(refreshSeconds) || 600) / 60)} min.
      <div class="disclaimer">Programación de control interno, de carácter representativo y sujeta a cambios operativos del SOC durante la semana.</div>
    </footer>
  </div>
</body>
</html>`;
};

/** Página mínima para token inválido / enlace desactivado (no revela si el token existe). */
const renderUnavailablePage = (appTitle = 'Bitácora SOC') => {
  const safeTitle = escapeHtml(appTitle);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${safeTitle}</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f1f5f9; color: #334155; }
  .box { text-align: center; padding: 40px; }
  h1 { font-size: 22px; margin: 0 0 8px; color: #0f172a; }
  p { margin: 0; font-size: 15px; }
</style>
</head>
<body>
  <div class="box">
    <h1>Este enlace no está disponible</h1>
    <p>Solicita un enlace vigente al administrador del SOC.</p>
  </div>
</body>
</html>`;
};

module.exports = {
  STATUS_META,
  DAY_PRIORITY,
  RELEVANT_ROLE_CODES,
  mapRoleToStatus,
  resolveWeekStart,
  buildWeekdayColumns,
  computeRows,
  buildTeleworkWeeklyMatrix,
  buildWeekOverlapFilter,
  renderTeleworkWeeklyPage,
  renderUnavailablePage
};
