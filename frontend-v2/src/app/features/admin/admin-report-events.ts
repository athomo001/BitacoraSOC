import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ReportEvent, ReportsService } from '../../core/reports/reports.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/admin';

type EventForm = Omit<ReportEvent, 'id'>;

const PAGE_SIZE = 50;

/**
 * Eventos del informe de incidente (catalogEvents del legacy, ~1.900): al
 * escribir "Nombre del evento" en Reportes se sugieren de aquí y "Motivo"
 * toma su texto por defecto. Mismo patrón que los tipos de operación, con
 * búsqueda y páginas porque son muchos.
 */
@Component({
  selector: 'app-admin-report-events',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="adm-card">
      <div class="adm-card__head">
        <h3 class="adm-card__title"><mat-icon>bolt</mat-icon>{{ i18n.t('rev.title') }} <span class="mono adm-secondary">{{ total() }}</span></h3>
        <label class="rev__search adm-push">
          <mat-icon>search</mat-icon>
          <input type="search" name="revSearch" [placeholder]="i18n.t('rev.search')" [attr.aria-label]="i18n.t('rev.search')" [ngModel]="query()" (ngModelChange)="onSearch($event)" />
        </label>
        <button type="button" class="adm-btn" (click)="edit(null)"><mat-icon>add</mat-icon>{{ i18n.t('rev.new') }}</button>
      </div>
      <p class="adm-card__note">{{ i18n.t('rev.hint') }}</p>
      @if (error(); as e) { <p class="adm-error rev__msg" role="alert">{{ e }}</p> }
      <div class="adm-table-wrap">
        <table class="adm-table rev__table">
          <thead><tr><th>{{ i18n.t('rev.name') }}</th><th>{{ i18n.t('rev.parent') }}</th><th>{{ i18n.t('rev.motivo') }}</th><th>{{ i18n.t('ca.active') }}</th></tr></thead>
          <tbody>
            @if (form(); as f) {
              <tr>
                <td><input class="adm-input" name="revName" [attr.aria-label]="i18n.t('rev.name')" [ngModel]="f.name" (ngModelChange)="form.set({ ...f, name: $event })" /></td>
                <td><input class="adm-input" name="revParent" [attr.aria-label]="i18n.t('rev.parent')" [ngModel]="f.parent" (ngModelChange)="form.set({ ...f, parent: $event })" /></td>
                <td><textarea class="adm-input" name="revMotivo" rows="3" [attr.aria-label]="i18n.t('rev.motivo')" [ngModel]="f.motivoDefault" (ngModelChange)="form.set({ ...f, motivoDefault: $event })"></textarea></td>
                <td>
                  <span class="rev__actions">
                    <button type="button" class="adm-btn adm-btn--primary" [disabled]="saving() || !f.name.trim()" (click)="save()">{{ i18n.t('ca.save') }}</button>
                    <button type="button" class="adm-btn" (click)="form.set(null)">{{ i18n.t('adminChecklist.cancel') }}</button>
                    @if (editingId()) {
                      <button type="button" class="adm-icon-btn adm-icon-btn--danger" [attr.aria-label]="i18n.t('ca.delete')" [title]="i18n.t('ca.delete')" (click)="remove()"><mat-icon>delete</mat-icon></button>
                    }
                  </span>
                </td>
              </tr>
            }
            @for (e of events(); track e.id) {
              @if (editingId() !== e.id) {
                <tr class="adm-row-click" tabindex="0" [class.rev__muted]="!e.enabled" (click)="edit(e)" (keydown.enter)="edit(e)">
                  <td class="adm-strong">{{ e.name }}</td>
                  <td class="adm-secondary">{{ e.parent || '—' }}</td>
                  <td class="rev__motivo">{{ e.motivoDefault || '—' }}</td>
                  <td (click)="$event.stopPropagation()">
                    <label class="switch">
                      <input class="switch__input" type="checkbox" role="switch" [checked]="e.enabled" [attr.aria-label]="e.name" (change)="toggle(e)" />
                      <span class="switch__track" aria-hidden="true"></span>
                    </label>
                  </td>
                </tr>
              }
            } @empty {
              <tr><td colspan="4" class="adm-empty">{{ i18n.t(query() ? 'rev.noMatch' : 'rev.empty') }}</td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (pages() > 1) {
        <footer class="adm-foot">
          <span class="adm-muted mono">{{ page() }} / {{ pages() }}</span>
          <button type="button" class="adm-btn adm-push" [disabled]="page() <= 1" (click)="go(page() - 1)"><mat-icon>chevron_left</mat-icon>{{ i18n.t('rev.prev') }}</button>
          <button type="button" class="adm-btn" [disabled]="page() >= pages()" (click)="go(page() + 1)">{{ i18n.t('rev.next') }}<mat-icon>chevron_right</mat-icon></button>
        </footer>
      }
    </section>
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .rev__search { display: flex; align-items: center; gap: 6px; padding: 0 9px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); color: var(--text-muted); }
    .rev__search:focus-within { border-color: var(--accent); }
    .rev__search input { min-width: 200px; min-height: 28px; border: none; outline: none; background: transparent; color: var(--text-primary); font: inherit; font-size: 12px; }
    .rev__msg { padding: 0 14px; }
    .adm-table-wrap { max-height: 520px; overflow-y: auto; }
    .rev__table td { vertical-align: top; }
    .rev__motivo { max-width: 420px; color: var(--text-secondary); white-space: pre-line; }
    .rev__muted td { opacity: 0.55; }
    .rev__actions { display: flex; flex-wrap: wrap; gap: 6px; }
  `,
})
export class AdminReportEventsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly reports = inject(ReportsService);

  protected readonly events = signal<ReportEvent[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly query = signal('');
  protected readonly form = signal<EventForm | null>(null);
  protected readonly editingId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  protected onSearch(q: string): void {
    this.query.set(q);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page.set(1);
      void this.load();
    }, 250);
  }

  protected async go(page: number): Promise<void> {
    this.page.set(page);
    await this.load();
  }

  protected edit(e: ReportEvent | null): void {
    this.error.set(null);
    this.editingId.set(e?.id ?? null);
    this.form.set(e ? { name: e.name, parent: e.parent, description: e.description, motivoDefault: e.motivoDefault, enabled: e.enabled } : { name: '', parent: '', description: '', motivoDefault: '', enabled: true });
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    await this.run(async () => {
      await this.reports.saveEvent(f, this.editingId() ?? undefined);
      this.form.set(null);
      this.editingId.set(null);
    });
  }

  protected async toggle(e: ReportEvent): Promise<void> {
    await this.run(() => this.reports.saveEvent({ name: e.name, parent: e.parent, description: e.description, motivoDefault: e.motivoDefault, enabled: !e.enabled }, e.id).then(() => undefined));
  }

  protected async remove(): Promise<void> {
    const id = this.editingId();
    if (!id) return;
    await this.run(async () => {
      await this.reports.deleteEvent(id);
      this.form.set(null);
      this.editingId.set(null);
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await action();
      await this.load();
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('rev.saveError')));
    } finally {
      this.saving.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      const { events, total } = await this.reports.listEvents(this.query().trim(), this.page());
      this.events.set(events);
      this.total.set(total);
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('rev.loadError')));
    }
  }
}
