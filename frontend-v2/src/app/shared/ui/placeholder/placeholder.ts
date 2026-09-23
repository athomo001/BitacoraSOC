import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Contenido placeholder genérico para secciones cuya pantalla real llega en
 * una fase posterior (Fase 3: "Fuera de alcance: cualquier llamada HTTP real
 * a la API, lógica de negocio"). Un solo componente reusado por las 5
 * secciones, no 5 placeholders copy-pasteados.
 */
@Component({
  selector: 'app-placeholder',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="placeholder">
      <h1>{{ title() }}</h1>
      <p class="placeholder__note">
        Módulo en construcción — pantalla real en {{ builtInPhase() }} del roadmap
        (<code>spec/02-alcance-y-roadmap.md</code>).
      </p>
    </div>
  `,
  styles: `
    .placeholder {
      padding: 24px;
      color: var(--text-secondary);
      font-family: var(--font-ui);
    }
    .placeholder h1 {
      color: var(--text-primary);
      margin: 0 0 8px;
    }
    .placeholder__note code {
      font-family: var(--font-mono);
      background: var(--bg-surface-hover);
      padding: 0 4px;
      border-radius: var(--radius-sm);
    }
  `,
})
export class PlaceholderComponent {
  readonly title = input.required<string>();
  readonly builtInPhase = input.required<string>();
}
