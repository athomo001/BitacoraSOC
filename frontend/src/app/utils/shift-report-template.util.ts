/**
 * File Purpose: frontend/src/app/utils/shift-report-template.util.ts
 * Responsibilities: Armar el texto de la Entry de Inicio/Cierre de Turno a partir de 3 cajones
 *                    de texto libre, aplicando el parser de líneas de tickets/incidentes.
 * QA Notes: Nunca se descarta una línea del usuario: si no matchea ningún formato reconocido
 *           se agrega tal cual como viñeta. No hay llamadas a backend acá, es texto puro.
 */

export type ShiftReportMode = 'inicio' | 'cierre';

export interface ShiftMetricField {
  key: string;
  label: string;
}

export interface ShiftReportInput {
  mode: ShiftReportMode;
  metrics: Array<{ label: string; value: string }>;
  ticketsText: string;
  notesText: string;
}

/**
 * Campo numérico fijo del cajón de métricas (chico, 1 solo campo por modo). Entero de máx.
 * 3 dígitos, sin separadores de miles — se valida en el input del diálogo
 * (ver shift-report-dialog.component.ts).
 */
export const SHIFT_METRIC_FIELDS: Record<ShiftReportMode, ShiftMetricField[]> = {
  inicio: [
    { key: 'ticketsTotales', label: 'Tickets totales CDC' }
  ],
  cierre: [
    { key: 'incidentesGestionados', label: 'Incidentes gestionados (SOC)' }
  ]
};

interface ParsedTicketLine {
  raw: string;
  matched: boolean;
  ticket?: string;
  cliente?: string;
  severidad?: string;
  descripcion?: string;
}

const TAG_BY_MODE: Record<ShiftReportMode, string> = {
  inicio: '#iniciodeturno',
  cierre: '#cierredeturno'
};

/**
 * Detecta un dump crudo tipo export de CDC: número de ticket (a veces con espacio interno,
 * ej "5 245") seguido de tab o 2+ espacios y la descripción. Sin comas, una línea = un ticket.
 */
const RAW_DUMP_REGEX = /^(\d[\d\s]{0,7}\d|\d)\s*(?:\t| {2,})\s*(.+)$/;

// Campos separados por coma O punto y coma: en la práctica el dump que pegan los analistas
// mezcla ambos (ej: "5 193;netics,[QA][2022-180] Nueva plataforma QA").
const FIELD_SPLIT_REGEX = /[,;]/;

function isTicketLine(trimmedLine: string): boolean {
  if (!trimmedLine) {
    return false;
  }
  if (trimmedLine.startsWith('//')) {
    return true;
  }
  return RAW_DUMP_REGEX.test(trimmedLine);
}

function parseTicketLine(trimmed: string): ParsedTicketLine {
  // 1) Delimitador especial "//" con campos separados por coma o punto y coma:
  //    // ticket, cliente, descripcion   ó   // ticket, cliente, severidad, descripcion
  if (trimmed.startsWith('//')) {
    const parts = trimmed
      .slice(2)
      .split(FIELD_SPLIT_REGEX)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    if (parts.length === 0) {
      return { raw: trimmed, matched: false };
    }
    if (parts.length === 1) {
      return { raw: trimmed, matched: true, descripcion: parts[0] };
    }

    const ticket = parts[0];
    const descripcion = parts[parts.length - 1];
    const middle = parts.slice(1, -1); // [cliente] o [cliente, severidad]
    return {
      raw: trimmed,
      matched: true,
      ticket,
      cliente: middle[0],
      severidad: middle[1],
      descripcion
    };
  }

  // 2) Dump crudo pegado directo desde CDC/GLPI (sin comas): "5 245<TAB>[QA] Descripcion..."
  const rawMatch = trimmed.match(RAW_DUMP_REGEX);
  if (rawMatch) {
    return {
      raw: trimmed,
      matched: true,
      ticket: rawMatch[1].replace(/\s+/g, ''),
      descripcion: rawMatch[2].trim()
    };
  }

  // 3) No reconocido: se pasa tal cual como viñeta simple, no se pierde información.
  return { raw: trimmed, matched: false };
}

function formatTicketFields(parsed: ParsedTicketLine): string {
  const fields = [parsed.ticket, parsed.cliente, parsed.severidad, parsed.descripcion]
    .filter((field): field is string => !!field && field.length > 0);
  return fields.length > 0 ? fields.join(' | ') : parsed.raw;
}

/**
 * Una línea suelta que sigue a un ticket (ej: "└ Situación actual: xxx" o texto plano) se
 * adjunta como anotación de ESE ticket en vez de convertirse en una viñeta nueva y separada.
 * Si ya viene con "└", se respeta tal cual (solo se normaliza la indentación); si no, se le
 * agrega la etiqueta por defecto del modo (Estado / Situación actual).
 */
function formatAnnotationLine(trimmedLine: string, defaultLabel: string): string {
  const labeledMatch = trimmedLine.match(/^└\s*(.+)$/);
  if (labeledMatch) {
    return `  └ ${labeledMatch[1].trim()}`;
  }
  return `  └ ${defaultLabel}: ${trimmedLine}`;
}

function formatTicketBlock(text: string, mode: ShiftReportMode): string[] {
  const lines = (text || '').split('\n');
  const defaultLabel = mode === 'inicio' ? 'Estado' : 'Situación actual';
  const blocks: string[] = [];
  let currentBlockLines: string[] | null = null;

  const flushCurrentBlock = (): void => {
    if (currentBlockLines) {
      blocks.push(currentBlockLines.join('\n'));
    }
    currentBlockLines = null;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    if (isTicketLine(trimmed)) {
      flushCurrentBlock();
      const parsed = parseTicketLine(trimmed);
      const bullet = parsed.matched ? `* ${formatTicketFields(parsed)}` : `* ${parsed.raw}`;
      currentBlockLines = [bullet];
      continue;
    }

    // Línea suelta: se adjunta al ticket anterior. Si no hay ticket anterior, queda como
    // viñeta propia (no se pierde texto).
    if (currentBlockLines) {
      currentBlockLines.push(formatAnnotationLine(trimmed, defaultLabel));
    } else {
      blocks.push(`* ${trimmed}`);
    }
  }

  flushCurrentBlock();
  return blocks;
}

// Texto libre tal cual lo escribe el usuario (sin forzar "* " al inicio de cada línea):
// así una línea con "# Título" sigue siendo un título real al renderizar Markdown, en vez de
// quedar atrapada dentro de una viñeta como texto plano.
function toFreeTextLines(text: string): string[] {
  return (text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function toMetricsBulletLines(metrics: Array<{ label: string; value: string }>): string[] {
  return (metrics || [])
    .filter((metric) => String(metric.value ?? '').trim().length > 0)
    .map((metric) => `* ${metric.label}: ${String(metric.value).trim()}`);
}

// Título de sección como H2 de Markdown (## Título) para que se vea formateado al ver el evento.
function sectionHeading(title: string): string {
  return `## ${title}`;
}

export function buildShiftReportContent(input: ShiftReportInput): string {
  const tag = TAG_BY_MODE[input.mode];
  const metricsLines = toMetricsBulletLines(input.metrics);
  const ticketBlocks = formatTicketBlock(input.ticketsText, input.mode);
  const notesLines = toFreeTextLines(input.notesText);

  const sections = input.mode === 'inicio'
    ? [
        metricsLines.length ? metricsLines.join('\n') : '* Tickets totales CDC: ',
        [
          sectionHeading('INCIDENTES ACTIVOS O INCIDENTES EN GUARDIA PASIVA.'),
          ticketBlocks.length ? ticketBlocks.join('\n') : '(Sin incidentes activos)'
        ].join('\n'),
        [
          sectionHeading('NOVEDADES / ALERTAS EN OBSERVACION'),
          notesLines.length ? notesLines.join('\n') : '(Sin novedades)'
        ].join('\n')
      ]
    : [
        [
          sectionHeading('RESUMEN DE GESTIÓN DEL TURNO'),
          metricsLines.length ? metricsLines.join('\n') : '* Incidentes gestionados (SOC): '
        ].join('\n'),
        [
          sectionHeading('TICKETS ACTIVOS O DEL DIA'),
          ticketBlocks.length ? ticketBlocks.join('\n') : '(Sin tickets activos)'
        ].join('\n'),
        [
          sectionHeading('OBSERVACIONES GENERALES'),
          notesLines.length ? notesLines.join('\n') : '(Sin observaciones)'
        ].join('\n')
      ];

  return [tag, ...sections].join('\n\n');
}
