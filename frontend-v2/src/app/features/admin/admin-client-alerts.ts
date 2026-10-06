import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { AlertContext, AlertWindow, ClientAlertForm, ClientAlertRule, OperationType, ReportsService } from '../../core/reports/reports.service';
import { Organization, OrganizationsService } from '../../core/organizations/organizations.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

type Mode = AlertWindow['mode'];

export const ALERT_MODES: readonly Mode[] = [
  'always',
  'outside_business_hours',
  'between_hours',
  'after_hour',
  'before_hour',
  'weekend_only',
  'weekdays_only',
];

/** 1 = lunes … 0 = domingo (como Date.getDay). */
const WEEK: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

export const newWindow = (): AlertWindow => ({ mode: 'always', startTime: '09:00', endTime: '18:00', daysOfWeek: [], holidayOnly: false });

const emptyRule = (): ClientAlertForm => ({
  organizationId: '',
  name: '',
  enabled: true,
  contexts: ['report', 'copy-report'],
  timezone: 'America/Santiago',
  priority: 100,
  validFrom: null,
  validTo: null,
  holidayDates: [],
  windows: [newWindow()],
  channels: [],
  message: '',
  requiresAck: true,
});

/** Para <input type="datetime-local">: ISO → "2026-10-05T09:00" en hora local, y de vuelta. */
export function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Administración → Avisos por cliente (canvas v20 aprobado; clientAlertController
 * y special_alert del legacy): lo que el analista debe leer antes de enviar o
 * copiar un reporte a ese cliente, con cuándo se muestra y si pide "Leí el
 * aviso". Abajo, los tipos de operación del informe de incidente con su texto
 * por defecto de "Información adicional" (catalogOperationTypes del legacy).
 */
@Component({
  selector: 'app-admin-client-alerts',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ca__grid { display: grid; grid-template-columns: minmax(0, 1fr) 440px; gap: 14px; align-items: start; }
    .ca__body { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px 16px; font-size: 12px; }
    .ca__two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .ca__seg { display: flex; flex-wrap: wrap; gap: 4px; }
    .ca__seg .adm-btn { padding: 3px 8px; font-size: 11px; }
    .ca__on, .ca__on:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
    .ca__window { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); }
    .ca__window-head { display: flex; align-items: center; gap: 8px; }
    .ca__times { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .ca__times .adm-input { width: 110px; }
    .ca__muted-row { opacity: 0.55; }
    .ca__msg { min-height: 110px; }
    .ca__foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border-subtle); }
    .ca__push { margin-left: auto; }
    .ca__types td { vertical-align: top; }
    .ca__type-info { max-width: 520px; color: var(--text-secondary); white-space: pre-wrap; }
    @media (width <= 1100px) { .ca__grid { grid-template-columns: minmax(0, 1fr); } }
  `,
  template: `
    <header class="adm-head">
      <div>
        <h2 class="adm-title">{{ i18n.t('admin.nav.clientAlerts') }}</h2>
        <p class="adm-muted">{{ i18n.t('ca.subtitle') }}</p>
      </div>
    </header>

    @if (error(); as message) {
      <p class="adm-error" role="alert">{{ message }}</p>
    }

    <div class="ca__grid">
      <section class="adm-card">
        <div class="adm-card__head">
          <h3 class="adm-card__title"><mat-icon>campaign</mat-icon>{{ i18n.t('ca.rules') }} <span class="mono adm-muted">{{ rules().length }}</span></h3>
          <button type="button" class="adm-btn adm-btn--primary adm-push" (click)="startNew()"><mat-icon>add</mat-icon>{{ i18n.t('ca.new') }}</button>
        </div>
        <div class="adm-table-wrap">
          <table class="adm-table">
            <thead>
              <tr><th>{{ i18n.t('rpt.col.client') }}</th><th>{{ i18n.t('ca.name') }}</th><th>{{ i18n.t('ca.when') }}</th><th>{{ i18n.t('ca.ack') }}</th><th>{{ i18n.t('ca.active') }}</th></tr>
            </thead>
            <tbody>
              @for (r of rules(); track r.id) {
                <tr class="adm-row-click" tabindex="0" [class.adm-row--active]="editingId() === r.id" [class.ca__muted-row]="!r.enabled" (click)="edit(r)" (keydown.enter)="edit(r)">
                  <td class="adm-strong">{{ r.organizationName }}</td>
                  <td>{{ r.name || '—' }}</td>
                  <td class="adm-small adm-secondary">{{ whenLabel(r) }}</td>
                  <td>{{ i18n.t(r.requiresAck ? 'ca.yes' : 'ca.no') }}</td>
                  <td (click)="$event.stopPropagation()">
                    <label class="switch">
                      <input class="switch__input" type="checkbox" role="switch" [checked]="r.enabled" [attr.aria-label]="i18n.t('ca.active')" (change)="toggle(r)" />
                      <span class="switch__track" aria-hidden="true"></span>
                    </label>
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="5" class="adm-empty">{{ i18n.t('ca.empty') }}</td></tr>
              }
            </tbody>
          </table>
        </div>
        <p class="adm-card__note">{{ i18n.t('ca.note') }}</p>
      </section>

      @if (form(); as f) {
        <section class="adm-card">
          <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>edit</mat-icon>{{ editingId() ? (f.name || i18n.t('ca.untitled')) : i18n.t('ca.new') }}</h3></div>
          <div class="ca__body">
            <div class="ca__two">
              <label class="adm-field">
                <span class="adm-label">{{ i18n.t('rpt.col.client') }}</span>
                <select class="adm-input" name="org" [ngModel]="f.organizationId" (ngModelChange)="patch({ organizationId: $event })">
                  <option value="">{{ i18n.t('rpt.f.chooseClient') }}</option>
                  @for (o of organizations(); track o.id) { <option [value]="o.id">{{ o.name }}</option> }
                </select>
              </label>
              <label class="adm-field">
                <span class="adm-label">{{ i18n.t('ca.name') }}</span>
                <input class="adm-input" name="name" [ngModel]="f.name" (ngModelChange)="patch({ name: $event })" />
              </label>
            </div>

            <div class="adm-field">
              <span class="adm-label">{{ i18n.t('ca.when') }}</span>
              @for (w of f.windows; track $index; let i = $index) {
                <div class="ca__window">
                  <div class="ca__seg" role="group">
                    @for (m of modes; track m) {
                      <button type="button" class="adm-btn" [class.ca__on]="w.mode === m" [attr.aria-pressed]="w.mode === m" (click)="patchWindow(i, { mode: m })">{{ i18n.t(modeKey(m)) }}</button>
                    }
                  </div>
                  @if (w.mode === 'outside_business_hours' || w.mode === 'between_hours' || w.mode === 'after_hour' || w.mode === 'before_hour') {
                    <span class="ca__times">
                      @if (w.mode !== 'before_hour') {
                        <label class="ca__times">{{ i18n.t(w.mode === 'after_hour' ? 'ca.from' : 'ca.start') }}
                          <input class="adm-input mono" type="time" [name]="'start' + i" [ngModel]="w.startTime" (ngModelChange)="patchWindow(i, { startTime: $event })" /></label>
                      }
                      @if (w.mode !== 'after_hour') {
                        <label class="ca__times">{{ i18n.t(w.mode === 'before_hour' ? 'ca.until' : 'ca.end') }}
                          <input class="adm-input mono" type="time" [name]="'end' + i" [ngModel]="w.endTime" (ngModelChange)="patchWindow(i, { endTime: $event })" /></label>
                      }
                    </span>
                  }
                  <span class="adm-hint">{{ i18n.t(modeHintKey(w.mode)) }}</span>
                  <div class="ca__window-head">
                    <span class="ca__seg" role="group" [attr.aria-label]="i18n.t('ca.days')">
                      @for (d of week; track d) {
                        <button type="button" class="adm-btn" [class.ca__on]="w.daysOfWeek.includes(d)" [attr.aria-pressed]="w.daysOfWeek.includes(d)" (click)="toggleDay(i, d)">{{ i18n.t(dayKey(d)) }}</button>
                      }
                    </span>
                    <label class="adm-small"><input type="checkbox" [name]="'hol' + i" [ngModel]="w.holidayOnly" (ngModelChange)="patchWindow(i, { holidayOnly: $event })" /> {{ i18n.t('ca.holidayOnly') }}</label>
                    @if (f.windows.length > 1) {
                      <button type="button" class="adm-icon-btn adm-icon-btn--danger ca__push" [attr.aria-label]="i18n.t('ca.removeWindow')" [title]="i18n.t('ca.removeWindow')" (click)="removeWindow(i)"><mat-icon>close</mat-icon></button>
                    }
                  </div>
                </div>
              }
              <span class="adm-hint">{{ i18n.t('ca.daysHint') }}</span>
              <button type="button" class="adm-btn" (click)="addWindow()"><mat-icon>add</mat-icon>{{ i18n.t('ca.addWindow') }}</button>
            </div>

            <label class="adm-field">
              <span class="adm-label">{{ i18n.t('ca.message') }}</span>
              <textarea class="adm-input ca__msg" name="msg" [ngModel]="f.message" (ngModelChange)="patch({ message: $event })"></textarea>
            </label>

            <div class="adm-field">
              <span class="adm-label">{{ i18n.t('ca.contexts') }}</span>
              <span class="ca__seg">
                <button type="button" class="adm-btn" [class.ca__on]="f.contexts.includes('report')" (click)="toggleContext('report')"><mat-icon>send</mat-icon>{{ i18n.t('ca.ctx.report') }}</button>
                <button type="button" class="adm-btn" [class.ca__on]="f.contexts.includes('copy-report')" (click)="toggleContext('copy-report')"><mat-icon>content_copy</mat-icon>{{ i18n.t('ca.ctx.copy') }}</button>
              </span>
            </div>

            <div class="ca__two">
              <label class="adm-field">
                <span class="adm-label">{{ i18n.t('ca.validFrom') }}</span>
                <input class="adm-input mono" type="datetime-local" name="from" [ngModel]="toLocal(f.validFrom)" (ngModelChange)="patch({ validFrom: fromLocal($event) })" />
              </label>
              <label class="adm-field">
                <span class="adm-label">{{ i18n.t('ca.validTo') }}</span>
                <input class="adm-input mono" type="datetime-local" name="to" [ngModel]="toLocal(f.validTo)" (ngModelChange)="patch({ validTo: fromLocal($event) })" />
              </label>
            </div>
            <label class="adm-field">
              <span class="adm-label">{{ i18n.t('ca.holidays') }}</span>
              <input class="adm-input mono" name="holidays" placeholder="2026-12-25, 2027-01-01" [ngModel]="f.holidayDates.join(', ')" (ngModelChange)="patch({ holidayDates: splitDates($event) })" />
            </label>

            <label class="switch">
              <input class="switch__input" type="checkbox" role="switch" name="ack" [ngModel]="f.requiresAck" (ngModelChange)="patch({ requiresAck: $event })" />
              <span class="switch__track" aria-hidden="true"></span>
              {{ i18n.t('ca.requiresAck') }}
            </label>
          </div>
          <footer class="ca__foot">
            @if (editingId()) {
              @if (confirmDelete()) {
                <button type="button" class="adm-btn adm-btn--danger" (click)="remove()"><mat-icon>delete</mat-icon>{{ i18n.t('rpt.confirmDelete') }}</button>
              } @else {
                <button type="button" class="adm-icon-btn adm-icon-btn--danger" [attr.aria-label]="i18n.t('ca.delete')" [title]="i18n.t('ca.delete')" (click)="confirmDelete.set(true)"><mat-icon>delete</mat-icon></button>
              }
            }
            <span class="ca__push"></span>
            <button type="button" class="adm-btn" (click)="cancel()">{{ i18n.t('adminChecklist.cancel') }}</button>
            <button type="button" class="adm-btn adm-btn--primary" [disabled]="saving()" (click)="save()"><mat-icon>save</mat-icon>{{ i18n.t('ca.save') }}</button>
          </footer>
        </section>
      }
    </div>

    <section class="adm-card">
      <div class="adm-card__head">
        <h3 class="adm-card__title"><mat-icon>category</mat-icon>{{ i18n.t('ca.types') }}</h3>
        <button type="button" class="adm-btn adm-push" (click)="editType(null)"><mat-icon>add</mat-icon>{{ i18n.t('ca.newType') }}</button>
      </div>
      <p class="adm-card__note">{{ i18n.t('ca.typesHint') }}</p>
      <div class="adm-table-wrap">
        <table class="adm-table ca__types">
          <thead><tr><th>{{ i18n.t('ca.name') }}</th><th>{{ i18n.t('rpt.f.additional') }}</th><th>{{ i18n.t('ca.active') }}</th></tr></thead>
          <tbody>
            @if (typeForm(); as t) {
              <tr>
                <td><input class="adm-input" name="tname" [attr.aria-label]="i18n.t('ca.name')" [ngModel]="t.name" (ngModelChange)="typeForm.set({ ...t, name: $event })" /></td>
                <td><textarea class="adm-input" name="tinfo" rows="3" [attr.aria-label]="i18n.t('rpt.f.additional')" [ngModel]="t.infoDefault" (ngModelChange)="typeForm.set({ ...t, infoDefault: $event })"></textarea></td>
                <td>
                  <span class="ca__seg">
                    <button type="button" class="adm-btn adm-btn--primary" [disabled]="saving()" (click)="saveType()">{{ i18n.t('ca.save') }}</button>
                    <button type="button" class="adm-btn" (click)="typeForm.set(null)">{{ i18n.t('adminChecklist.cancel') }}</button>
                    @if (typeId()) {
                      <button type="button" class="adm-icon-btn adm-icon-btn--danger" [attr.aria-label]="i18n.t('ca.delete')" [title]="i18n.t('ca.delete')" (click)="deleteType()"><mat-icon>delete</mat-icon></button>
                    }
                  </span>
                </td>
              </tr>
            }
            @for (t of types(); track t.id) {
              @if (typeId() !== t.id) {
                <tr class="adm-row-click" tabindex="0" [class.ca__muted-row]="!t.enabled" (click)="editType(t)" (keydown.enter)="editType(t)">
                  <td class="adm-strong">{{ t.name }}</td>
                  <td class="ca__type-info">{{ t.infoDefault || '—' }}</td>
                  <td (click)="$event.stopPropagation()">
                    <label class="switch">
                      <input class="switch__input" type="checkbox" role="switch" [checked]="t.enabled" [attr.aria-label]="i18n.t('ca.active')" (change)="toggleType(t)" />
                      <span class="switch__track" aria-hidden="true"></span>
                    </label>
                  </td>
                </tr>
              }
            } @empty {
              <tr><td colspan="3" class="adm-empty">{{ i18n.t('ca.typesEmpty') }}</td></tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
})
export class AdminClientAlertsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly reports = inject(ReportsService);
  private readonly organizationsApi = inject(OrganizationsService);

  protected readonly modes = ALERT_MODES;
  protected readonly week = WEEK;
  protected readonly toLocal = toLocalInput;
  protected readonly fromLocal = fromLocalInput;

  protected readonly rules = signal<ClientAlertRule[]>([]);
  protected readonly organizations = signal<Organization[]>([]);
  protected readonly form = signal<ClientAlertForm | null>(null);
  protected readonly editingId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly confirmDelete = signal(false);
  protected readonly error = signal('');

  protected readonly types = signal<OperationType[]>([]);
  protected readonly typeForm = signal<Omit<OperationType, 'id'> | null>(null);
  protected readonly typeId = signal<string | null>(null);

  private readonly orgNames = computed(() => new Map(this.organizations().map((o) => [o.id, o.name])));

  async ngOnInit(): Promise<void> {
    const [rules, orgs, types] = await Promise.allSettled([
      this.reports.listAlerts(),
      this.organizationsApi.list({ clients: true }),
      this.reports.operationTypes(),
    ]);
    if (rules.status === 'fulfilled') this.rules.set(rules.value);
    else this.error.set(problemDetail(rules.reason, this.i18n.t('ca.loadFailed')));
    if (orgs.status === 'fulfilled') this.organizations.set(orgs.value);
    if (types.status === 'fulfilled') this.types.set(types.value);
  }

  protected modeKey(m: Mode): MessageKey {
    return `ca.mode.${m}`;
  }

  protected modeHintKey(m: Mode): MessageKey {
    return `ca.modeHint.${m}`;
  }

  protected dayKey(d: number): MessageKey {
    return `ca.day.${d}` as MessageKey;
  }

  protected whenLabel(r: ClientAlertRule): string {
    return r.windows.map((w) => this.i18n.t(this.modeKey(w.mode))).join(' · ') || this.i18n.t('ca.mode.always');
  }

  protected splitDates(value: string): string[] {
    return value.split(/[\s,;]+/).map((d) => d.trim()).filter(Boolean);
  }

  protected startNew(): void {
    this.editingId.set(null);
    this.confirmDelete.set(false);
    this.form.set(emptyRule());
  }

  protected edit(r: ClientAlertRule): void {
    const { id, organizationName: _org, acked: _acked, ...rest } = r;
    this.editingId.set(id);
    this.confirmDelete.set(false);
    this.form.set({ ...rest, windows: r.windows.length ? r.windows.map((w) => ({ ...w, daysOfWeek: [...(w.daysOfWeek ?? [])] })) : [newWindow()] });
  }

  protected cancel(): void {
    this.form.set(null);
    this.editingId.set(null);
  }

  protected patch(p: Partial<ClientAlertForm>): void {
    this.form.update((f) => (f ? { ...f, ...p } : f));
  }

  protected patchWindow(i: number, p: Partial<AlertWindow>): void {
    this.form.update((f) => (f ? { ...f, windows: f.windows.map((w, j) => (j === i ? { ...w, ...p } : w)) } : f));
  }

  protected toggleDay(i: number, d: number): void {
    const w = this.form()?.windows[i];
    if (!w) return;
    this.patchWindow(i, { daysOfWeek: w.daysOfWeek.includes(d) ? w.daysOfWeek.filter((x) => x !== d) : [...w.daysOfWeek, d].sort() });
  }

  protected addWindow(): void {
    this.form.update((f) => (f ? { ...f, windows: [...f.windows, newWindow()] } : f));
  }

  protected removeWindow(i: number): void {
    this.form.update((f) => (f ? { ...f, windows: f.windows.filter((_, j) => j !== i) } : f));
  }

  protected toggleContext(c: AlertContext): void {
    const f = this.form();
    if (!f) return;
    const contexts = f.contexts.includes(c) ? f.contexts.filter((x) => x !== c) : [...f.contexts, c];
    this.patch({ contexts: contexts.length ? contexts : f.contexts });
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    this.saving.set(true);
    this.error.set('');
    try {
      const id = this.editingId();
      const saved = id ? await this.reports.updateAlert(id, f) : await this.reports.createAlert(f);
      const named = { ...saved, organizationName: saved.organizationName ?? this.orgNames().get(saved.organizationId) };
      this.rules.update((l) => (id ? l.map((r) => (r.id === id ? named : r)) : [...l, named]));
      this.cancel();
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('ca.saveFailed')));
    } finally {
      this.saving.set(false);
    }
  }

  protected async toggle(r: ClientAlertRule): Promise<void> {
    const { id, organizationName, acked: _acked, ...rest } = r;
    try {
      const saved = await this.reports.updateAlert(id, { ...rest, enabled: !r.enabled });
      this.rules.update((l) => l.map((x) => (x.id === id ? { ...saved, organizationName: saved.organizationName ?? organizationName } : x)));
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('ca.saveFailed')));
    }
  }

  protected async remove(): Promise<void> {
    const id = this.editingId();
    if (!id) return;
    try {
      await this.reports.deleteAlert(id);
      this.rules.update((l) => l.filter((r) => r.id !== id));
      this.cancel();
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('ca.saveFailed')));
    }
  }

  // ─── Tipos de operación ───────────────────────────────────────────────

  protected editType(t: OperationType | null): void {
    this.typeId.set(t?.id ?? null);
    this.typeForm.set(t ? { name: t.name, infoDefault: t.infoDefault, enabled: t.enabled } : { name: '', infoDefault: '', enabled: true });
  }

  protected async saveType(): Promise<void> {
    const t = this.typeForm();
    if (!t) return;
    this.saving.set(true);
    this.error.set('');
    try {
      const id = this.typeId();
      const saved = await this.reports.saveOperationType(t, id ?? undefined);
      this.types.update((l) => (id ? l.map((x) => (x.id === id ? saved : x)) : [...l, saved]).sort((a, b) => a.name.localeCompare(b.name)));
      this.typeForm.set(null);
      this.typeId.set(null);
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('ca.saveFailed')));
    } finally {
      this.saving.set(false);
    }
  }

  protected async toggleType(t: OperationType): Promise<void> {
    try {
      const saved = await this.reports.saveOperationType({ name: t.name, infoDefault: t.infoDefault, enabled: !t.enabled }, t.id);
      this.types.update((l) => l.map((x) => (x.id === t.id ? saved : x)));
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('ca.saveFailed')));
    }
  }

  protected async deleteType(): Promise<void> {
    const id = this.typeId();
    if (!id) return;
    try {
      await this.reports.deleteOperationType(id);
      this.types.update((l) => l.filter((x) => x.id !== id));
      this.typeForm.set(null);
      this.typeId.set(null);
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('ca.saveFailed')));
    }
  }
}
