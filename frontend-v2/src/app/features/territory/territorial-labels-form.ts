import { ChangeDetectionStrategy, Component, OnInit, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../../shared/ui/button/button';
import { TerritoryService } from '../../core/territory/territory.service';
import { TERRITORIAL_KINDS, TerritorialKind, TerritorialLabels } from '../../core/territory/territory.models';
import { problemDetail } from '../../core/http-error';

/** Pista del nivel técnico para el admin — no es una etiqueta de UI de negocio. */
const KIND_HINT: Record<TerritorialKind, string> = {
  country: 'Nivel 1 (ej. País)',
  region: 'Nivel 2 (ej. Región, Departamento, Estado, Provincia)',
  zone: 'Nivel 3 (ej. Comuna, Ciudad, Localidad)',
  site: 'Nivel 4 (ej. Sitio, Nodo, Instalación)',
};

/**
 * Renombra los 4 niveles de la jerarquía para el país real de la
 * instalación (HU-TERR-1). Solo presentación: no migra nada.
 */
@Component({
  selector: 'app-territorial-labels-form',
  standalone: true,
  imports: [FormsModule, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="field-grid">
      @for (kind of kinds; track kind) {
        <label class="field">
          <span>{{ hints[kind] }}</span>
          <input type="text" maxlength="40" [attr.name]="kind" [ngModel]="draft()[kind]"
            (ngModelChange)="setDraft(kind, $event)" />
        </label>
      }
    </div>
    <div class="actions">
      <app-button variant="primary" icon="save" [disabled]="saving()" (pressed)="save()">
        {{ saving() ? 'Guardando…' : 'Guardar etiquetas' }}
      </app-button>
    </div>
    @if (error()) {
      <p class="msg msg--error">{{ error() }}</p>
    }
    @if (savedOk()) {
      <p class="msg msg--ok">Etiquetas guardadas — se aplican de inmediato, sin migrar datos.</p>
    }
  `,
})
export class TerritorialLabelsFormComponent implements OnInit {
  readonly saved = output<TerritorialLabels>();

  protected readonly kinds = TERRITORIAL_KINDS;
  protected readonly hints = KIND_HINT;
  // Signal y no objeto plano: en zoneless+OnPush, reasignar un objeto tras
  // un await no redibuja la vista.
  protected readonly draft = signal<TerritorialLabels>({ country: '', region: '', zone: '', site: '' });

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly savedOk = signal(false);

  private readonly territory = inject(TerritoryService);

  async ngOnInit(): Promise<void> {
    this.draft.set({ ...this.territory.labels() });
    try {
      this.draft.set({ ...(await this.territory.loadLabels()) });
    } catch {
      // Se queda con los defaults; el guardado mostrará el error real si lo hay.
    }
  }

  protected setDraft(kind: TerritorialKind, value: string): void {
    this.draft.update((current) => ({ ...current, [kind]: value }));
  }

  protected async save(): Promise<void> {
    this.error.set(null);
    this.savedOk.set(false);
    this.saving.set(true);
    try {
      const labels = await this.territory.saveLabels(this.draft());
      this.draft.set({ ...labels });
      this.savedOk.set(true);
      this.saved.emit(labels);
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudieron guardar las etiquetas.'));
    } finally {
      this.saving.set(false);
    }
  }
}
