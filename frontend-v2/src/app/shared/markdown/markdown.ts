import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * Un único componente de Markdown para todo cajón de texto de la app
 * (spec/06-frontend-arquitectura-y-ui.md sección 7.4, spec/10-armonizacion.md
 * punto 5): bitácora, notas, comentarios de ticket, observaciones de
 * checklist — todos pasan por acá, nunca un <textarea> plano ni una
 * implementación de render/sanitización propia por pantalla.
 *
 * marked (GFM: listas `- [ ]`/`- [x]` como checkboxes reales) + DOMPurify
 * (sanitización real — nunca `[innerHTML]` directo sobre HTML no confiable).
 */
@Component({
  selector: 'app-markdown',
  standalone: true,
  template: `<div class="app-markdown" [innerHTML]="safeHtml()"></div>`,
  styleUrl: './markdown.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownComponent {
  readonly content = input<string>('');

  private readonly sanitizer = inject(DomSanitizer);

  protected readonly safeHtml = computed(() => {
    const rawHtml = marked.parse(this.content(), { async: false, gfm: true, breaks: true });
    // DOMPurify hace la sanitización real; bypassSecurityTrustHtml de acá no
    // es un atajo para saltársela — es decirle a Angular "esto ya está
    // limpio, no lo re-sanitices" (el sanitizador nativo de Angular a veces
    // destruye markup válido de marked, como los `<input type="checkbox"
    // disabled>` de las listas de tareas GFM).
    const cleanHtml = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
    return this.sanitizer.bypassSecurityTrustHtml(cleanHtml);
  });
}
