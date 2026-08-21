/**
 * File Purpose: frontend/src/app/utils/markdown.util.ts
 * Responsibilities: Convertir contenido Markdown de una Entry en HTML seguro para renderizar.
 * QA Notes: El contenido proviene de analistas (no público), pero igual se sanitiza con DOMPurify
 *           antes de bindear vía [innerHTML] para evitar XSS.
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  breaks: true, // un solo salto de línea = <br>, igual que el texto plano que ya escriben los analistas
  gfm: true
});

// ATX heading sin espacio tras el "#" ("#Hola" en vez de "# Hola"): por decisión explícita del
// usuario, esto también se renderiza como título aunque no cumpla el estándar CommonMark. Solo
// aplica a inicio de línea (^), así que un #tag mencionado a mitad de texto no se toca; si el tag
// va solo en su propia línea (ej. #iniciodeturno en las plantillas de turno), sí sale como título.
const UNSPACED_HEADING_REGEX = /^(#{1,6})(?!#)(?!\s)(.+)$/gm;

function normalizeUnspacedHeadings(source: string): string {
  return source.replace(UNSPACED_HEADING_REGEX, '$1 $2');
}

export function renderMarkdown(raw: string | null | undefined): string {
  const source = String(raw || '');
  if (!source.trim()) {
    return '';
  }

  const html = marked.parse(normalizeUnspacedHeadings(source), { async: false }) as string;
  return DOMPurify.sanitize(html);
}
