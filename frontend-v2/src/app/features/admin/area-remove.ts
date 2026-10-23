import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Area, AreaUsage, AreasService } from '../../core/areas/areas.service';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';

import '../../core/i18n/packs/departments';

const USAGE_KEYS: { key: keyof AreaUsage; label: MessageKey }[] = [
  { key: 'people', label: 'ar.rm.people' },
  { key: 'tickets', label: 'ar.rm.tickets' },
  { key: 'assets', label: 'ar.rm.assets' },
  { key: 'teams', label: 'ar.rm.teams' },
  { key: 'policies', label: 'ar.rm.policies' },
  { key: 'tasks', label: 'ar.rm.tasks' },
  { key: 'goals', label: 'ar.rm.goals' },
  { key: 'windows', label: 'ar.rm.windows' },
  { key: 'other', label: 'ar.rm.other' },
];

/**
 * Ficha del área → Borrar o unir (pedido del dueño 2026-10-22): un área sin
 * gente ni datos se borra; una con gente o datos se une a otra (todo pasa al
 * destino) y queda vacía, lista para borrarla. SOC y NOC no aparecen aquí.
 */
@Component({
  selector: 'app-area-remove',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="adm-card">
      <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>call_merge</mat-icon>{{ i18n.t('ar.rm.title') }}</h3></div>
      @if (usage(); as u) {
        <div class="rm__body">
          @if (u.empty) {
            <p class="rm__sec">{{ i18n.tf('ar.rm.emptyText', area().name) }}</p>
            @if (confirming()) {
              <div class="rm__confirm" role="alert">
                <span>{{ i18n.tf('ar.rm.confirmDelete', area().name) }}</span>
                <button type="button" class="adm-btn" (click)="confirming.set(false)">{{ i18n.t('dep.cancel') }}</button>
                <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy()" (click)="remove()">{{ i18n.t('ar.rm.delete') }}</button>
              </div>
            } @else {
              <div><button type="button" class="adm-btn adm-btn--danger" (click)="confirming.set(true)"><mat-icon>delete</mat-icon>{{ i18n.t('ar.rm.delete') }}</button></div>
            }
          } @else {
            <p class="rm__sec">{{ i18n.t('ar.rm.hasData') }}</p>
            <ul class="rm__list">@for (line of lines(); track line) { <li>{{ line }}</li> }</ul>
            <label class="adm-field rm__field"><span class="adm-label">{{ i18n.t('ar.rm.into') }}</span>
              <select class="adm-input" name="mergeInto" [value]="into()" (change)="into.set($any($event.target).value); confirming.set(false)">
                <option value="">{{ i18n.t('ar.rm.pickInto') }}</option>
                @for (a of targets(); track a.code) { <option [value]="a.code">{{ a.name }}</option> }
              </select>
            </label>
            @if (confirming() && targetName()) {
              <div class="rm__confirm" role="alert">
                <span>{{ i18n.t('ar.rm.confirmMerge').replace('{a}', area().name).replace('{b}', targetName()) }}</span>
                <button type="button" class="adm-btn" (click)="confirming.set(false)">{{ i18n.t('dep.cancel') }}</button>
                <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy()" (click)="merge()">{{ i18n.tf('ar.rm.merge', targetName()) }}</button>
              </div>
            } @else {
              <div><button type="button" class="adm-btn" [disabled]="!into()" (click)="confirming.set(true)"><mat-icon>call_merge</mat-icon>{{ i18n.tf('ar.rm.merge', targetName() || '…') }}</button></div>
            }
          }
          @if (done(); as d) { <p class="rm__ok" role="status"><mat-icon>check_circle</mat-icon>{{ d }}</p> }
          @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }
        </div>
      }
    </section>
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .rm__body { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; }
    .rm__sec { margin: 0; color: var(--text-secondary); line-height: 1.5; }
    .rm__list { margin: 0; padding-left: 18px; color: var(--text-secondary); }
    .rm__field { max-width: 320px; }
    .rm__confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; border-radius: var(--radius-md); background: var(--status-critical-bg); }
    .rm__confirm span { flex: 1; min-width: 200px; }
    .rm__ok { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--status-ok); }
  `,
})
export class AreaRemoveComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(AreasService);

  readonly area = input.required<Area>();
  readonly areas = input<Area[]>([]);
  /** Se unió: recargar las áreas (la gente cambió). */
  readonly merged = output<void>();
  /** Se borró el área. */
  readonly deleted = output<void>();

  protected readonly usage = signal<AreaUsage | null>(null);
  protected readonly into = signal('');
  protected readonly confirming = signal(false);
  protected readonly busy = signal(false);
  protected readonly done = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly targets = computed(() => this.areas().filter((a) => a.active && a.code !== this.area().code));
  protected readonly targetName = computed(() => this.areas().find((a) => a.code === this.into())?.name ?? '');
  protected readonly lines = computed(() => {
    const u = this.usage();
    if (!u) return [];
    return USAGE_KEYS.filter((k) => (u[k.key] as number) > 0).map((k) => this.i18n.tf(k.label, u[k.key] as number));
  });

  constructor() {
    effect(() => {
      const code = this.area().code;
      untracked(() => {
        this.into.set('');
        this.confirming.set(false);
        this.done.set(null);
        void this.load(code);
      });
    });
  }

  private async load(code: string): Promise<void> {
    try {
      this.usage.set(await this.api.areaUsage(code));
      this.error.set(null);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('areas.error')));
    }
  }

  protected async merge(): Promise<void> {
    const target = this.targetName();
    await this.run(async () => {
      const res = await this.api.mergeArea(this.area().code, this.into());
      this.usage.set(res.usage);
      this.done.set(this.i18n.t('ar.rm.mergedText').replace('{a}', String(res.moved)).replace('{b}', target));
      this.into.set('');
      this.merged.emit();
    });
  }

  protected async remove(): Promise<void> {
    await this.run(async () => {
      await this.api.deleteArea(this.area().code);
      this.deleted.emit();
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      this.confirming.set(false);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('areas.error')));
    } finally {
      this.busy.set(false);
    }
  }
}
