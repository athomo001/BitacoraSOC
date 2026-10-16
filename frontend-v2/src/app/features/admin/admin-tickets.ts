import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { AffectsRule, SlaPair, TicketSettings, TicketsService } from '../../core/tickets/tickets.service';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { AdminTicketSeriesComponent } from './admin-ticket-series';

import '../../core/i18n/packs/admin';
import '../../core/i18n/packs/tickets';

type SlaKey = keyof TicketSettings['sla'];

/** Una fila de la tabla de SLA: incidentes por prioridad y requerimientos. */
const SLA_ROWS: readonly { key: SlaKey; labelKey: MessageKey }[] = [
  { key: 'p1', labelKey: 'tkAdmin.sla.p1' },
  { key: 'p2', labelKey: 'tkAdmin.sla.p2' },
  { key: 'p3', labelKey: 'tkAdmin.sla.p3' },
  { key: 'p4', labelKey: 'tkAdmin.sla.p4' },
  { key: 'request', labelKey: 'tkAdmin.sla.request' },
];

/** Eventos de cada grupo, en el orden del panel (spec/15 §4.2 y §4.3). */
const TEAM_EVENTS = [
  'team.created', 'team.assigned', 'team.resolver_added', 'team.sla_response_breached', 'team.sla_resolution_warning',
  'team.sla_resolution_breached', 'team.reopened', 'team.pending_vendor', 'team.resolved', 'team.merged', 'team.client_changed',
] as const;
const CLIENT_EVENTS = [
  'client.opened', 'client.comment', 'client.pending_vendor', 'client.resumed', 'client.resolved', 'client.reopened', 'client.closed',
] as const;

const BATCH_OPTIONS = [0, 5, 15, 30, 60] as const;
const AFFECTS: readonly { value: AffectsRule; labelKey: MessageKey }[] = [
  { value: 'p1p2', labelKey: 'tkAdmin.affects.p1p2' },
  { value: 'incidents', labelKey: 'tkAdmin.affects.incidents' },
  { value: 'none', labelKey: 'tkAdmin.affects.none' },
];

/** Horas con hasta dos decimales, para mostrar minutos como "1", "0,5", "72". */
function hours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Administración → Ticketera (pedido del dueño 2026-10-13: "todo lo de
 * tickets en una sección para configurarlo a gusto"): plazos de SLA por
 * prioridad, el umbral "en riesgo", la firma ante el cliente y los avisos
 * por correo de spec/15 (canvas "Ticketera: avisos por correo").
 */
@Component({
  selector: 'app-admin-tickets',
  standalone: true,
  imports: [FormsModule, MatIconModule, AdminTicketSeriesComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-tickets.html',
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .tk__tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-left: auto; }
    .tk__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
    .tk__sla { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .tk__sla th, .tk__sla td { padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); text-align: left; }
    .tk__sla th { color: var(--text-muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .tk__sla input { width: 96px; }
    .tk__events { display: flex; flex-direction: column; }
    .tk__event { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-subtle); }
    .tk__event:last-child { border-bottom: none; }
    .tk__event .switch { grid-row: span 2; }
    .tk__event-label { font-size: 12.5px; font-weight: 600; }
    .tk__event-who { color: var(--text-muted); font-size: 11.5px; }
    .tk__chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .tk__chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 8px; border: 1px solid var(--border-subtle); border-radius: 999px; background: var(--bg-app); font-size: 12px; }
    .tk__chip button { display: inline-grid; place-items: center; width: 18px; height: 18px; padding: 0; border: none; border-radius: 50%; background: transparent; color: var(--text-muted); cursor: pointer; }
    .tk__chip button:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
    .tk__add { display: flex; gap: 6px; }
    .tk__add input { flex: 1; min-width: 0; }
    .tk__stack { display: flex; flex-direction: column; gap: 12px; }
    .tk__seg { display: flex; flex-wrap: wrap; gap: 4px; }
    .tk__off { opacity: 0.55; }
    @media (width <= 1100px) { .tk__grid { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class AdminTicketsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(TicketsService);

  protected readonly slaRows = SLA_ROWS;
  protected readonly teamEvents = TEAM_EVENTS;
  protected readonly clientEvents = CLIENT_EVENTS;
  protected readonly batchOptions = BATCH_OPTIONS;
  protected readonly affectsOptions = AFFECTS;
  protected readonly hours = hours;

  protected readonly tab = signal<'general' | 'mail' | 'numbering'>('general');
  private readonly saved = signal<TicketSettings | null>(null);
  protected readonly draft = signal<TicketSettings | null>(null);
  protected readonly newBackup = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.saved()));

  async ngOnInit(): Promise<void> {
    try {
      this.apply(await this.api.settings());
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('tkAdmin.loadError')));
    }
  }

  protected eventLabel(event: string): string {
    return this.i18n.t(`tkmail.ev.${event}` as MessageKey);
  }

  protected eventWho(event: string): string {
    return this.i18n.t(`tkAdmin.who.${event}` as MessageKey);
  }

  protected batchLabel(minutes: number): string {
    return minutes === 0 ? this.i18n.t('tkAdmin.batch.none') : this.i18n.tf('tkAdmin.batch.minutes', minutes);
  }

  private update(change: (d: TicketSettings) => TicketSettings): void {
    const d = this.draft();
    if (!d) return;
    this.draft.set(change(d));
    this.notice.set(null);
    this.error.set(null);
  }

  protected patch(p: Partial<TicketSettings>): void {
    this.update((d) => ({ ...d, ...p }));
  }

  protected patchMail(p: Partial<TicketSettings['mail']>): void {
    this.update((d) => ({ ...d, mail: { ...d.mail, ...p } }));
  }

  /** Las horas de la pantalla se guardan en minutos (mínimo 1). */
  protected setSla(key: SlaKey, field: keyof SlaPair, value: number | string): void {
    const minutes = Math.max(1, Math.round(Number(value) * 60) || 0);
    this.update((d) => ({ ...d, sla: { ...d.sla, [key]: { ...d.sla[key], [field]: minutes } } }));
  }

  protected isOn(event: string): boolean {
    return this.draft()?.mail.events.includes(event) ?? false;
  }

  protected toggleEvent(event: string): void {
    const events = this.draft()?.mail.events ?? [];
    this.patchMail({ events: events.includes(event) ? events.filter((e) => e !== event) : [...events, event] });
  }

  protected addBackup(): void {
    const email = this.newBackup().trim();
    const list = this.draft()?.mail.backupEmails ?? [];
    if (!email || list.some((e) => e.toLowerCase() === email.toLowerCase())) {
      this.newBackup.set('');
      return;
    }
    this.patchMail({ backupEmails: [...list, email] });
    this.newBackup.set('');
  }

  protected removeBackup(email: string): void {
    this.patchMail({ backupEmails: (this.draft()?.mail.backupEmails ?? []).filter((e) => e !== email) });
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d) return;
    await this.run(async () => {
      this.apply(await this.api.saveSettings(d));
      return this.i18n.t('admin.saved');
    });
  }

  protected async sendTest(): Promise<void> {
    await this.run(async () => this.i18n.tf('tkAdmin.testSent', await this.api.sendMailTest()));
  }

  private async run(action: () => Promise<string>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      this.notice.set(await action());
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('tkAdmin.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  private apply(s: TicketSettings): void {
    this.saved.set(s);
    this.draft.set(structuredClone(s));
  }
}
