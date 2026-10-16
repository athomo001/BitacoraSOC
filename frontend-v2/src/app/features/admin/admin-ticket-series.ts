import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { TicketSeries, TicketSeriesForm, TicketSeriesService, TicketSeriesState, YearFormat, formatTicketNumber } from '../../core/tickets/ticket-series.service';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';

import '../../core/i18n/packs/admin';

const YEARS: { value: YearFormat; labelKey: MessageKey }[] = [
  { value: 'yyyy', labelKey: 'tkSeries.year.yyyy' },
  { value: 'yy', labelKey: 'tkSeries.year.yy' },
  { value: 'none', labelKey: 'tkSeries.year.none' },
];

/**
 * Administración → Ticketera → Numeración (pedido del dueño 2026-10-16):
 * cómo se ve el número de los tickets (prefijo, año, dígitos), una general y
 * otras para las áreas que quieran la suya (varias pueden compartirla).
 * Numera el área que pide el ticket; el correlativo nunca vuelve a 1.
 */
@Component({
  selector: 'app-admin-ticket-series',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ts__grid">
      <section class="adm-card">
        <div class="adm-card__head">
          <h3 class="adm-card__title"><mat-icon>tag</mat-icon>{{ i18n.t('tkSeries.title') }}</h3>
          <button type="button" class="adm-btn adm-push" [disabled]="busy()" (click)="edit(null)"><mat-icon>add</mat-icon>{{ i18n.t('tkSeries.new') }}</button>
        </div>
        <p class="adm-card__note">{{ i18n.t('tkSeries.hint') }}</p>
        <div class="adm-table-wrap">
          <table class="adm-table">
            <thead><tr><th>{{ i18n.t('tkSeries.name') }}</th><th>{{ i18n.t('tkSeries.next') }}</th><th>{{ i18n.t('tkSeries.usedBy') }}</th></tr></thead>
            <tbody>
              @for (s of state().series; track s.id) {
                <tr class="adm-row-click" tabindex="0" [class.adm-row--active]="editingId() === s.id" (click)="edit(s)" (keydown.enter)="edit(s)">
                  <td><strong>{{ s.name }}</strong>@if (s.isDefault) { <span class="pill tone-info ts__general">{{ i18n.t('tkSeries.general') }}</span> }</td>
                  <td class="mono">{{ s.preview }}</td>
                  <td class="adm-small adm-secondary">{{ usedBy(s) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (form(); as f) {
          <div class="adm-card__body ts__form">
            <span class="adm-label">{{ i18n.t(editingId() ? 'tkSeries.edit' : 'tkSeries.new') }}</span>
            <div class="adm-row">
              <label class="adm-field"><span class="adm-label">{{ i18n.t('tkSeries.name') }}</span>
                <input class="adm-input" name="tsName" maxlength="60" [ngModel]="f.name" (ngModelChange)="patch({ name: $event })" /></label>
              <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('tkSeries.prefix') }}</span>
                <input class="adm-input mono" name="tsPrefix" maxlength="10" [ngModel]="f.prefix" (ngModelChange)="patch({ prefix: cleanPrefix($event) })" /></label>
            </div>
            <div class="adm-field">
              <span class="adm-label">{{ i18n.t('tkSeries.year') }}</span>
              <span class="ts__seg" role="group" [attr.aria-label]="i18n.t('tkSeries.year')">
                @for (y of years; track y.value) {
                  <button type="button" class="seg" [attr.aria-pressed]="f.yearFormat === y.value" (click)="patch({ yearFormat: y.value })">{{ i18n.t(y.labelKey) }}</button>
                }
              </span>
            </div>
            <div class="adm-row">
              <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('tkSeries.digits') }}</span>
                <input class="adm-input mono" type="number" name="tsDigits" min="3" max="10" [ngModel]="f.digits" (ngModelChange)="patch({ digits: +$event })" /></label>
              <label class="adm-field adm-field--narrow"><span class="adm-label">{{ i18n.t('tkSeries.nextNumber') }}</span>
                <input class="adm-input mono" type="number" name="tsNext" [min]="minNext()" [ngModel]="f.nextNumber" (ngModelChange)="patch({ nextNumber: +$event })" /></label>
            </div>
            @if (editingId()) { <span class="adm-hint">{{ i18n.t('tkSeries.nextHint') }}</span> }
            @if (!original()?.isDefault) {
              <label class="ts__check"><input type="checkbox" name="tsDefault" [ngModel]="f.isDefault" (ngModelChange)="patch({ isDefault: $event })" />{{ i18n.t('tkSeries.makeGeneral') }}</label>
            }
            <p class="ts__preview">{{ i18n.t('tkSeries.preview') }} <strong class="mono">{{ preview() }}</strong></p>
            <div class="ts__actions">
              @if (editingId() && !original()?.isDefault) {
                <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy()" (click)="remove()">{{ i18n.t(confirmDelete() ? 'tkSeries.deleteSure' : 'tkSeries.delete') }}</button>
              }
              <button type="button" class="adm-btn adm-push" (click)="form.set(null)">{{ i18n.t('adminChecklist.cancel') }}</button>
              <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy() || !valid()" (click)="save()"><mat-icon>save</mat-icon>{{ i18n.t('admin.save') }}</button>
            </div>
          </div>
        }
      </section>

      <section class="adm-card">
        <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>account_tree</mat-icon>{{ i18n.t('tkSeries.areas') }}</h3></div>
        <p class="adm-card__note">{{ i18n.t('tkSeries.areasHint') }}</p>
        <div class="adm-table-wrap">
          <table class="adm-table">
            <thead><tr><th>{{ i18n.t('tkSeries.area') }}</th><th>{{ i18n.t('tkSeries.numbering') }}</th></tr></thead>
            <tbody>
              @for (a of state().areas; track a.id) {
                <tr [class.ts__off]="!a.active">
                  <td>{{ a.name }}</td>
                  <td>
                    <select class="adm-input" [name]="'tsArea' + a.code" [attr.aria-label]="i18n.t('tkSeries.numbering') + ' ' + a.name" [disabled]="busy()" (change)="assign(a.id, $any($event.target).value)">
                      @for (s of state().series; track s.id) {
                        <option [value]="s.isDefault ? '' : s.id" [selected]="s.isDefault ? !a.seriesId : a.seriesId === s.id">{{ s.name }} · {{ s.preview }}</option>
                      }
                    </select>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
    @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }
    @if (notice(); as n) { <span class="pill tone-ok ts__notice"><mat-icon>task_alt</mat-icon>{{ n }}</span> }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 12px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ts__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
    .ts__general { margin-left: 6px; }
    .ts__form { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--border-subtle); }
    .ts__seg { display: flex; flex-wrap: wrap; gap: 4px; }
    .ts__preview { margin: 0; color: var(--text-secondary); }
    .ts__actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .ts__off td { opacity: 0.55; }
    .ts__check { display: flex; align-items: center; gap: 6px; font-size: 13px; }
    .ts__notice { align-self: flex-start; }
    @media (max-width: 960px) { .ts__grid { grid-template-columns: 1fr; } }
  `,
})
export class AdminTicketSeriesComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(TicketSeriesService);

  protected readonly years = YEARS;
  protected readonly state = signal<TicketSeriesState>({ series: [], areas: [] });
  protected readonly form = signal<TicketSeriesForm | null>(null);
  protected readonly editingId = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly confirmDelete = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly original = computed(() => this.state().series.find((s) => s.id === this.editingId()) ?? null);
  protected readonly minNext = computed(() => this.original()?.nextNumber ?? 1);
  protected readonly preview = computed(() => {
    const f = this.form();
    return f ? formatTicketNumber(f.prefix || '?', f.yearFormat, Math.min(10, Math.max(3, f.digits || 3)), Math.max(1, f.nextNumber || 1)) : '';
  });
  protected readonly valid = computed(() => {
    const f = this.form();
    return !!f && !!f.name.trim() && /^[A-Z0-9]{1,10}$/.test(f.prefix) && f.digits >= 3 && f.digits <= 10 && f.nextNumber >= this.minNext();
  });

  async ngOnInit(): Promise<void> {
    await this.run(async () => this.state.set(await this.api.list()));
  }

  protected usedBy(s: TicketSeries): string {
    const names = this.state()
      .areas.filter((a) => (s.isDefault ? !a.seriesId : a.seriesId === s.id))
      .map((a) => a.name);
    return names.length ? names.join(', ') : this.i18n.t('tkSeries.noAreas');
  }

  protected cleanPrefix(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  protected edit(s: TicketSeries | null): void {
    this.confirmDelete.set(false);
    this.notice.set(null);
    this.editingId.set(s?.id ?? null);
    this.form.set(
      s
        ? { name: s.name, prefix: s.prefix, yearFormat: s.yearFormat, digits: s.digits, nextNumber: s.nextNumber, isDefault: s.isDefault }
        : { name: '', prefix: '', yearFormat: 'yyyy', digits: 5, nextNumber: 1, isDefault: false },
    );
  }

  protected patch(p: Partial<TicketSeriesForm>): void {
    const f = this.form();
    if (f) this.form.set({ ...f, ...p });
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f || !this.valid()) return;
    await this.run(async () => {
      this.state.set(await this.api.save(f, this.editingId() ?? undefined));
      this.form.set(null);
      this.editingId.set(null);
      this.notice.set(this.i18n.t('admin.saved'));
    });
  }

  protected async remove(): Promise<void> {
    const id = this.editingId();
    if (!id) return;
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      return;
    }
    await this.run(async () => {
      this.state.set(await this.api.remove(id));
      this.form.set(null);
      this.editingId.set(null);
      this.notice.set(this.i18n.t('tkSeries.deleted'));
    });
  }

  protected async assign(areaId: string, seriesId: string): Promise<void> {
    await this.run(async () => {
      this.state.set(await this.api.assign(areaId, seriesId || null));
      this.notice.set(this.i18n.t('admin.saved'));
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('tkSeries.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
