const CONTACT_TYPE_VALUES = ['escalation', 'preventive'];

function normalizeContactType(value) {
  return String(value || '').trim().toLowerCase() === 'preventive' ? 'preventive' : 'escalation';
}

function parseBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'si', 'sí', 'activo', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'inactivo', 'off'].includes(normalized)) return false;
  return fallback;
}

function isValidEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function splitCsvLine(line) {
  const output = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      output.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  output.push(current);
  return output.map((entry) => String(entry || '').trim());
}

function sanitizeString(value, maxLength = 300) {
  const normalized = String(value ?? '').replace(/\r/g, '').trim();
  return normalized.slice(0, maxLength);
}

function parseContactsCsv(csvText, options = {}) {
  const defaultType = normalizeContactType(options.defaultType || 'preventive');
  const text = String(csvText || '').replace(/^\uFEFF/, '').trim();
  if (!text) {
    return { validRows: [], errors: [{ row: 0, message: 'CSV vacío' }] };
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { validRows: [], errors: [{ row: 0, message: 'CSV sin filas' }] };
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.toLowerCase());
  const validRows = [];
  const errors = [];

  const resolve = (row, aliases) => {
    const key = aliases.find((alias) => headers.includes(alias));
    if (!key) return '';
    return row[headers.indexOf(key)] || '';
  };

  for (let index = 1; index < lines.length; index += 1) {
    const values = splitCsvLine(lines[index]);
    const rowNumber = index + 1;

    const contactType = normalizeContactType(resolve(values, ['contacttype', 'type', 'tipo']) || defaultType);
    const entry = {
      name: sanitizeString(resolve(values, ['name', 'nombre']), 120),
      email: sanitizeString(resolve(values, ['email', 'correo', 'mail']), 180).toLowerCase(),
      organization: sanitizeString(resolve(values, ['organization', 'empresa', 'company']), 160),
      phone: sanitizeString(resolve(values, ['phone', 'telefono', 'teléfono']), 80),
      notes: sanitizeString(resolve(values, ['notes', 'nota', 'notas']), 500),
      favorite: parseBooleanLike(resolve(values, ['favorite', 'favorito']), false),
      doNotSend: parseBooleanLike(resolve(values, ['donotsend', 'noenviar', 'no_enviar']), false),
      active: parseBooleanLike(resolve(values, ['active', 'activo']), true),
      role: sanitizeString(resolve(values, ['role', 'rol']), 40) || (contactType === 'preventive' ? 'PREVENTIVO' : 'PARA'),
      serviceId: sanitizeString(resolve(values, ['serviceid', 'servicioid']), 60) || null,
      contactType
    };

    const rowErrors = [];
    if (!entry.name) rowErrors.push('nombre requerido');
    if (!entry.email) rowErrors.push('correo requerido');
    if (entry.email && !isValidEmail(entry.email)) rowErrors.push('correo inválido');
    if (contactType === 'preventive' && !entry.organization) rowErrors.push('empresa requerida');

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, message: rowErrors.join(', '), raw: lines[index] });
      continue;
    }

    validRows.push(entry);
  }

  return { validRows, errors };
}

function escapeCsvValue(value) {
  const normalized = String(value ?? '');
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function formatContactsCsv(contacts = []) {
  const header = [
    'name',
    'email',
    'organization',
    'phone',
    'contactType',
    'active',
    'favorite',
    'doNotSend',
    'notes'
  ];

  const rows = (contacts || []).map((contact) => ([
    contact.name,
    contact.email,
    contact.organization,
    contact.phone,
    normalizeContactType(contact.contactType),
    Boolean(contact.active),
    Boolean(contact.favorite),
    Boolean(contact.doNotSend),
    contact.notes || ''
  ].map(escapeCsvValue).join(',')));

  return [header.join(','), ...rows].join('\n');
}

function analyzeRecipientEmails(input = []) {
  const rawEntries = [];
  const collect = (value) => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    String(value || '')
      .split(/[;,\n]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => rawEntries.push(item));
  };

  collect(input);

  const seen = new Set();
  const valid = [];
  const duplicates = [];
  const invalid = [];

  rawEntries.forEach((entry) => {
    const email = String(entry || '').trim().toLowerCase();
    if (!isValidEmail(email)) {
      invalid.push(entry);
      return;
    }
    if (seen.has(email)) {
      duplicates.push(email);
      return;
    }
    seen.add(email);
    valid.push(email);
  });

  return {
    valid,
    duplicates,
    invalid,
    totalSubmitted: rawEntries.length
  };
}

module.exports = {
  CONTACT_TYPE_VALUES,
  normalizeContactType,
  parseBooleanLike,
  isValidEmail,
  parseContactsCsv,
  formatContactsCsv,
  analyzeRecipientEmails
};
