/**
 * Texto de la entrada de Inicio/Cierre de turno, portado de
 * shift-report-template.util.ts del legacy (comentario del dueño #6). Tres
 * cajones de texto libre → una entrada en Markdown con #iniciodeturno o
 * #cierredeturno. Nunca se descarta una línea: lo que no calza con un formato
 * de ticket queda como viñeta.
 */

export type ShiftReportMode = 'inicio' | 'cierre';

export interface ShiftReportInput {
  mode: ShiftReportMode;
  metricLabel: string;
  metricValue: string;
  ticketsText: string;
  notesText: string;
  /** Solo inicio: pendientes que dejó el turno anterior, marcados o no. */
  carried?: { text: string; done: boolean }[];
  /** Solo cierre: pendientes para el turno siguiente (- [ ] …). */
  pendingText?: string;
  headings: ShiftReportHeadings;
}

/** Títulos de sección (vienen de i18n para respetar ES/EN). */
export interface ShiftReportHeadings {
  tickets: string;
  notes: string;
  summary?: string;
  carried?: string;
  pending?: string;
  noTickets: string;
  noNotes: string;
}

export const SHIFT_REPORT_TAG: Record<ShiftReportMode, string> = { inicio: 'iniciodeturno', cierre: 'cierredeturno' };

/**
 * Dump crudo pegado del CDC: número de ticket (a veces con un espacio, "5 245")
 * seguido de tab o 2+ espacios y la descripción.
 */
const RAW_DUMP = /^(\d[\d\s]{0,7}\d|\d)\s*(?:\t| {2,})\s*(.+)$/;
/** Los analistas mezclan coma y punto y coma ("5 193;netics,[QA] …"). */
const FIELD_SPLIT = /[,;]/;

interface ParsedTicket {
  raw: string;
  matched: boolean;
  fields: string[];
}

function isTicketLine(line: string): boolean {
  return line.startsWith('//') || RAW_DUMP.test(line);
}

function parseTicketLine(line: string): ParsedTicket {
  if (line.startsWith('//')) {
    const parts = line.slice(2).split(FIELD_SPLIT).map((p) => p.trim()).filter((p) => p.length > 0);
    return parts.length ? { raw: line, matched: true, fields: parts } : { raw: line, matched: false, fields: [] };
  }
  const raw = RAW_DUMP.exec(line);
  if (raw) return { raw: line, matched: true, fields: [raw[1].replace(/\s+/g, ''), raw[2].trim()] };
  return { raw: line, matched: false, fields: [] };
}

/** Una línea suelta bajo un ticket es su comentario ("└ Estado: …"). */
function annotation(line: string, label: string): string {
  const labeled = /^└\s*(.+)$/.exec(line);
  return labeled ? `  └ ${labeled[1].trim()}` : `  └ ${label}: ${line}`;
}

export function formatTickets(text: string, mode: ShiftReportMode): string[] {
  const label = mode === 'inicio' ? 'Estado' : 'Situación actual';
  const blocks: string[] = [];
  let current: string[] | null = null;
  const flush = () => {
    if (current) blocks.push(current.join('\n'));
    current = null;
  };
  for (const rawLine of (text || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (isTicketLine(line)) {
      flush();
      const parsed = parseTicketLine(line);
      current = [`* ${parsed.matched ? parsed.fields.join(' | ') : parsed.raw}`];
      continue;
    }
    if (current) current.push(annotation(line, label));
    else blocks.push(`* ${line}`);
  }
  flush();
  return blocks;
}

function freeLines(text: string): string[] {
  return (text || '').split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

/** Solo dígitos, máximo 3 (0-999), como el legacy. */
export function sanitizeMetric(value: string): string {
  return (value || '').replace(/\D/g, '').slice(0, 3);
}

export function buildShiftReport(input: ShiftReportInput): string {
  const h = input.headings;
  const metric = `* ${input.metricLabel}: ${sanitizeMetric(input.metricValue)}`;
  const tickets = formatTickets(input.ticketsText, input.mode);
  const notes = freeLines(input.notesText);
  const section = (title: string, body: string) => `## ${title}\n${body}`;
  const sections: string[] = [`#${SHIFT_REPORT_TAG[input.mode]}`];
  if (input.mode === 'inicio') {
    sections.push(metric);
    if (input.carried?.length && h.carried) {
      sections.push(section(h.carried, input.carried.map((c) => `- [${c.done ? 'x' : ' '}] ${c.text}`).join('\n')));
    }
    sections.push(section(h.tickets, tickets.length ? tickets.join('\n') : h.noTickets));
    sections.push(section(h.notes, notes.length ? notes.join('\n') : h.noNotes));
  } else {
    sections.push(section(h.summary ?? '', metric));
    sections.push(section(h.tickets, tickets.length ? tickets.join('\n') : h.noTickets));
    sections.push(section(h.notes, notes.length ? notes.join('\n') : h.noNotes));
    const pending = freeLines(input.pendingText ?? '');
    if (pending.length && h.pending) sections.push(section(h.pending, pending.join('\n')));
  }
  return sections.join('\n\n');
}

/** "- [ ] algo" / "- algo" / "algo" → los pendientes que deja el cierre anterior. */
export function parsePending(text: string | null | undefined): { text: string; done: boolean }[] {
  return freeLines(text ?? '').map((line) => {
    const m = /^[-*]?\s*\[( |x|X)\]\s*(.+)$/.exec(line);
    if (m) return { text: m[2].trim(), done: m[1].toLowerCase() === 'x' };
    return { text: line.replace(/^[-*]\s*/, ''), done: false };
  });
}
