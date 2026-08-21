/**
 * File Purpose: frontend/src/app/pipes/markdown.pipe.ts
 * Responsibilities: Exponer renderMarkdown() como pipe standalone para templates.
 * QA Notes: El HTML ya sale sanitizado por DOMPurify (ver markdown.util.ts); Angular igual
 *           aplica su propio sanitizador sobre [innerHTML] como segunda capa de defensa.
 */
import { Pipe, PipeTransform } from '@angular/core';
import { renderMarkdown } from '../utils/markdown.util';

@Pipe({
  name: 'markdown',
  standalone: true
})
export class MarkdownPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return renderMarkdown(value);
  }
}
