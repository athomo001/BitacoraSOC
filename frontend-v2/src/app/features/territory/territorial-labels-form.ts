import { ChangeDetectionStrategy, Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { TerritoryService } from '../../core/territory/territory.service';
import { TERRITORIAL_KINDS, TerritorialKind, TerritorialLabels } from '../../core/territory/territory.models';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

/**
 * Renombra los 4 niveles de la jerarquía para el país real de la
 * instalación (HU-TERR-1). Solo presentación: no migra nada. Lo usan el
 * setup inicial y Administración → Territorio.
 */
@Component({
  selector: 'app-territorial-labels-form',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-row">
      @for (kind of kinds; track kind) {
        <label class="adm-field">
          <span class="adm-label">{{ i18n.t(levelKey(kind)) }}</span>
          <input class="adm-input" type="text" maxlength="40" [attr.name]="kind" [ngModel]="draft()[kind]" (ngModelChange)="setDraft(kind, $event)" />
          <span class="adm-hint">{{ i18n.t(exampleKey(kind)) }}</span>
        </label>
      }
    </div>
    <div class="tl__foot">
      <span class="tl__status">
        @if (savedOk()) {
          <span class="pill tone-ok"><mat-icon>task_alt</mat-icon>{{ i18n.t('territory.labelsSaved') }}</span>
        } @else if (error(); as e) {
          <span class="adm-error" role="alert">{{ e }}</span>
        } @else {
          <span class="adm-muted">{{ i18n.t(dirty() ? 'admin.unsaved' : 'admin.noChanges') }}</span>
        }
      </span>
      <button type="button" class="adm-btn adm-btn--primary" [disabled]="saving() || !dirty()" (click)="save()"><mat-icon>save</mat-icon>{{ i18n.t('admin.save') }}</button>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 12px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .tl__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .tl__status { flex: 1 1 160px; }
  `,
})
export class TerritorialLabelsFormComponent implements OnInit {
  readonly saved = output<TerritorialLabels>();

  protected readonly i18n = inject(I18nService);
  private readonly territory = inject(TerritoryService);

  protected readonly kinds = TERRITORIAL_KINDS;
  // Signal y no objeto plano: en zoneless+OnPush, reasignar un objeto tras
  // un await no redibuja la vista.
  protected readonly draft = signal<TerritorialLabels>({ country: '', region: '', zone: '', site: '' });
  private readonly stored = signal<TerritorialLabels>({ country: '', region: '', zone: '', site: '' });

  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly savedOk = signal(false);

  protected readonly dirty = computed(() => TERRITORIAL_KINDS.some((k) => this.draft()[k] !== this.stored()[k]));

  async ngOnInit(): Promise<void> {
    this.apply(this.territory.labels());
    try {
      this.apply(await this.territory.loadLabels());
    } catch {
      // Se queda con los defaults; el guardado mostrará el error real si lo hay.
    }
  }

  protected levelKey(kind: TerritorialKind): MessageKey {
    return `territory.level.${kind}` as MessageKey;
  }

  protected exampleKey(kind: TerritorialKind): MessageKey {
    return `territory.example.${kind}` as MessageKey;
  }

  protected setDraft(kind: TerritorialKind, value: string): void {
    this.draft.update((current) => ({ ...current, [kind]: value }));
    this.savedOk.set(false);
  }

  protected async save(): Promise<void> {
    this.error.set(null);
    this.savedOk.set(false);
    this.saving.set(true);
    try {
      const labels = await this.territory.saveLabels(this.draft());
      this.apply(labels);
      this.savedOk.set(true);
      this.saved.emit(labels);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('territory.labelsError')));
    } finally {
      this.saving.set(false);
    }
  }

  private apply(labels: TerritorialLabels): void {
    this.stored.set({ ...labels });
    this.draft.set({ ...labels });
  }
}
