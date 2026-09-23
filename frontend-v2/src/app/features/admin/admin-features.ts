import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { SystemFeature, SystemFeaturesService } from '../../core/system-features/system-features.service';
import { problemDetail } from '../../core/http-error';

/**
 * Funcionalidades opcionales activables sin reiniciar (system_features).
 * Tabla plana con toggle de 1 clic por fila — no tarjetas por feature.
 */
@Component({
  selector: 'app-admin-features',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <h2 class="panel__title">Funcionalidades opcionales</h2>
      <p class="panel__hint">Se activan en caliente, sin reiniciar el servidor ni tocar variables de entorno.</p>
      @if (error()) {
        <p class="msg msg--error">{{ error() }}</p>
      }
      <table class="features">
        <thead>
          <tr><th>Código</th><th>Funcionalidad</th><th>Estado</th><th></th></tr>
        </thead>
        <tbody>
          @for (f of features(); track f.code) {
            <tr>
              <td class="mono">{{ f.code }}</td>
              <td>
                <span class="features__name">{{ f.name }}</span>
                @if (f.description) {
                  <span class="features__desc">{{ f.description }}</span>
                }
              </td>
              <td>
                <span class="state" [class.state--on]="f.isEnabled" [class.state--off]="!f.isEnabled">
                  {{ f.isEnabled ? 'ACTIVO' : 'INACTIVO' }}
                </span>
              </td>
              <td>
                <button type="button" class="features__toggle" [disabled]="busyCode() === f.code" (click)="toggle(f)">
                  {{ f.isEnabled ? 'Desactivar' : 'Activar' }}
                </button>
              </td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `
    .features {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .features th {
      text-align: left;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      padding: 6px 8px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .features td {
      height: var(--row-height);
      padding: 6px 8px;
      border-bottom: 1px solid var(--border-subtle);
      vertical-align: middle;
    }
    .features__name {
      display: block;
      color: var(--text-primary);
    }
    .features__desc {
      display: block;
      font-size: 12px;
      color: var(--text-secondary);
    }
    .features__toggle {
      min-height: 30px;
      padding: 0 12px;
      background: none;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font: inherit;
      cursor: pointer;
    }
    .features__toggle:hover {
      background: var(--bg-surface-hover);
    }
  `,
})
export class AdminFeaturesComponent implements OnInit {
  protected readonly features = signal<SystemFeature[]>([]);
  protected readonly busyCode = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  private readonly service = inject(SystemFeaturesService);

  async ngOnInit(): Promise<void> {
    try {
      this.features.set(await this.service.list());
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudieron cargar las funcionalidades.'));
    }
  }

  protected async toggle(feature: SystemFeature): Promise<void> {
    this.error.set(null);
    this.busyCode.set(feature.code);
    try {
      const updated = await this.service.setEnabled(feature.code, !feature.isEnabled);
      this.features.update((list) => list.map((f) => (f.code === updated.code ? updated : f)));
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo cambiar la funcionalidad.'));
    } finally {
      this.busyCode.set(null);
    }
  }
}
