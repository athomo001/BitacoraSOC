import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import {
  ForwardDestination, ForwardDestinationInput, ForwardFormat, ForwardLevel, ForwardTestResult, ForwardTransport, IntegrationsService,
} from '../../core/integrations/integrations.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/integrations';

/** Una cabecera del formulario: saved = guardada (su valor no vuelve). */
interface HeaderDraft {
  name: string;
  value: string;
  saved: boolean;
  replace: boolean;
}

interface Draft {
  name: string;
  enabled: boolean;
  transport: ForwardTransport;
  host: string;
  port: number;
  url: string;
  format: ForwardFormat;
  batch: boolean;
  sendAudit: boolean;
  auditLevel: ForwardLevel;
  sendEntries: boolean;
  sendEscalation: boolean;
  sendTickets: boolean;
  headers: HeaderDraft[];
  /** undefined = se mantiene; '' = se quita; texto = PEM nuevo. */
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
}

const TRANSPORTS: ForwardTransport[] = ['udp', 'tcp', 'tls', 'http'];
const FORMATS: ForwardFormat[] = ['json', 'rfc5424'];
const LEVELS: ForwardLevel[] = ['info', 'warn', 'error'];
const NEW = 'new';

function toDraft(d: ForwardDestination | null, name: string): Draft {
  if (!d) {
    return { name, enabled: true, transport: 'tls', host: '', port: 6514, url: '', format: 'json', batch: false, sendAudit: true,
      auditLevel: 'info', sendEntries: true, sendEscalation: true, sendTickets: true, headers: [] };
  }
  return {
    name: d.name, enabled: d.enabled, transport: d.transport, host: d.host ?? '', port: d.port ?? (d.transport === 'tls' ? 6514 : 514),
    url: d.url ?? '', format: d.format, batch: d.batch, sendAudit: d.sendAudit, auditLevel: d.auditLevel, sendEntries: d.sendEntries,
    sendEscalation: d.sendEscalation, sendTickets: d.sendTickets, headers: d.headers.map((h) => ({ name: h, value: '', saved: true, replace: false })),
  };
}

/** Un evento de ejemplo, como le llega al SIEM. */
export function sampleEvent(format: ForwardFormat): string {
  const ev = {
    v: 1, ts: '2026-10-21T14:03:11.402Z', source: 'bitacora', group: 'ticketera', event: 'ticket.sla_breached', level: 'warn',
    actor: { name: 'camila.rojas' }, client: { name: 'Casinos' }, object: { type: 'ticket', ref: 'TKT-2026-00039' },
    data: { sla: 'resolution', priority: 'p2_high', area: 'SOC', slaResolutionDue: '2026-10-21T14:00:00Z' }, node: 'bitacora-1',
  };
  if (format === 'rfc5424') return `<132>1 ${ev.ts} bitacora-1 bitacora - ticket.sla_breached - ${JSON.stringify(ev)}`;
  return JSON.stringify(ev, null, 2);
}

/** Reenvío de eventos (spec/19 §3): destinos a la izquierda, el elegido a la derecha. */
@Component({
  selector: 'app-integrations-forward',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './integrations-forward.html',
  styleUrl: './integrations-forward.css',
})
export class IntegrationsForwardComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(IntegrationsService);

  protected readonly transports = TRANSPORTS;
  protected readonly formats = FORMATS;
  protected readonly levels = LEVELS;
  protected readonly list = signal<ForwardDestination[]>([]);
  protected readonly selected = signal<string | null>(null);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly busy = signal<'save' | 'test' | 'delete' | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly test = signal<ForwardTestResult | null>(null);
  protected readonly confirmDelete = signal(false);

  protected readonly current = computed(() => this.list().find((d) => d.id === this.selected()) ?? null);
  protected readonly isNew = computed(() => this.selected() === NEW);
  protected readonly dirty = computed(() => {
    const d = this.draft();
    if (!d) return false;
    if (this.isNew()) return true;
    const c = this.current();
    return !c || JSON.stringify(d) !== JSON.stringify(toDraft(c, ''));
  });
  protected readonly sample = computed(() => sampleEvent(this.draft()?.format ?? 'json'));

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(select?: string): Promise<void> {
    try {
      const list = await this.api.destinations();
      this.list.set(list);
      const want = select ?? this.selected();
      const pick = list.some((d) => d.id === want) ? want : (list[0]?.id ?? null);
      if (pick !== this.selected() || select) this.select(pick);
      this.error.set(null);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ig.loadError')));
    }
  }

  protected select(id: string | null): void {
    this.selected.set(id);
    this.test.set(null);
    this.notice.set(null);
    this.confirmDelete.set(false);
    const d = this.list().find((x) => x.id === id) ?? null;
    this.draft.set(id === NEW ? toDraft(null, this.i18n.t('ig.fw.newName')) : d ? toDraft(d, '') : null);
  }

  protected startNew(): void {
    this.select(NEW);
  }

  protected patch(changes: Partial<Draft>): void {
    this.draft.update((d) => (d ? { ...d, ...changes } : d));
    this.notice.set(null);
    this.test.set(null);
  }

  protected setTransport(t: ForwardTransport): void {
    const d = this.draft();
    if (!d || d.transport === t) return;
    const port = t === 'tls' && d.port === 514 ? 6514 : t !== 'tls' && t !== 'http' && d.port === 6514 ? 514 : d.port;
    this.patch({ transport: t, port });
  }

  protected stateIcon(d: ForwardDestination): string {
    return { off: 'pause_circle', idle: 'schedule', ok: 'check_circle', failing: 'error' }[d.state];
  }

  protected stateTone(d: ForwardDestination): string {
    return { off: 'text-neutral', idle: 'text-neutral', ok: 'text-ok', failing: 'text-bad' }[d.state];
  }

  protected stateKey(d: ForwardDestination): MessageKey {
    return `ig.fw.st.${d.state}` as MessageKey;
  }

  protected where(d: ForwardDestination): string {
    if (d.transport === 'http') {
      try {
        return new URL(d.url ?? '').host;
      } catch {
        return d.url ?? '';
      }
    }
    return `${d.host}:${d.port}`;
  }

  protected key(prefix: string, v: string): MessageKey {
    return `${prefix}.${v}` as MessageKey;
  }

  // ===== Cabeceras =====

  protected addHeader(): void {
    this.patch({ headers: [...this.draft()!.headers, { name: '', value: '', saved: false, replace: true }] });
  }

  protected setHeader(i: number, changes: Partial<HeaderDraft>): void {
    this.patch({ headers: this.draft()!.headers.map((h, j) => (j === i ? { ...h, ...changes } : h)) });
  }

  protected removeHeader(i: number): void {
    this.patch({ headers: this.draft()!.headers.filter((_, j) => j !== i) });
  }

  // ===== Certificados =====

  protected async loadPem(field: 'caCert' | 'clientCert' | 'clientKey', input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.patch({ [field]: (await file.text()).trim() });
  }

  protected caState(): 'none' | 'loaded' | 'new' {
    const d = this.draft();
    if (d?.caCert !== undefined) return d.caCert ? 'new' : 'none';
    return this.current()?.hasCaCert ? 'loaded' : 'none';
  }

  protected mtlsState(): 'none' | 'loaded' | 'new' {
    const d = this.draft();
    if (d?.clientCert !== undefined || d?.clientKey !== undefined) return d.clientCert || d.clientKey ? 'new' : 'none';
    return this.current()?.hasClientCert ? 'loaded' : 'none';
  }

  protected clearMtls(): void {
    this.patch({ clientCert: '', clientKey: '' });
  }

  // ===== Guardar, probar, eliminar =====

  private input(d: Draft): ForwardDestinationInput {
    const out: ForwardDestinationInput = {
      name: d.name.trim(), enabled: d.enabled, transport: d.transport, host: d.host.trim(), port: +d.port, url: d.url.trim(), format: d.format,
      batch: d.batch, sendAudit: d.sendAudit, auditLevel: d.auditLevel, sendEntries: d.sendEntries, sendEscalation: d.sendEscalation,
      sendTickets: d.sendTickets, headers: d.headers.map((h) => ({ name: h.name.trim(), value: h.saved && !h.replace ? null : h.value })),
    };
    if (d.caCert !== undefined) out.caCert = d.caCert;
    if (d.clientCert !== undefined) out.clientCert = d.clientCert;
    if (d.clientKey !== undefined) out.clientKey = d.clientKey;
    return out;
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d || this.busy()) return;
    this.busy.set('save');
    this.error.set(null);
    try {
      const saved = this.isNew() ? await this.api.createDestination(this.input(d)) : await this.api.updateDestination(this.selected()!, this.input(d));
      await this.load(saved.id);
      this.notice.set(this.i18n.t('ig.fw.savedOk'));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ig.saveError')));
    } finally {
      this.busy.set(null);
    }
  }

  protected async runTest(): Promise<void> {
    const id = this.selected();
    if (!id || id === NEW || this.dirty() || this.busy()) return;
    this.busy.set('test');
    this.test.set(null);
    try {
      this.test.set(await this.api.testDestination(id));
    } catch (e) {
      this.test.set({ ok: false, transport: this.current()!.transport, error: problemDetail(e, this.i18n.t('ig.saveError')) });
    } finally {
      this.busy.set(null);
    }
  }

  protected testText(r: ForwardTestResult): string {
    if (!r.ok) return r.error ?? '';
    if (r.transport === 'http') return this.i18n.t('ig.fw.testOk.http');
    return this.i18n.t(r.transport === 'udp' ? 'ig.fw.testOk.udp' : 'ig.fw.testOk.stream');
  }

  protected async remove(): Promise<void> {
    const id = this.selected();
    if (!id || id === NEW || this.busy()) return;
    this.busy.set('delete');
    try {
      await this.api.deleteDestination(id);
      this.selected.set(null);
      await this.load();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ig.saveError')));
    } finally {
      this.busy.set(null);
      this.confirmDelete.set(false);
    }
  }

  protected discard(): void {
    if (this.isNew()) {
      this.select(this.list()[0]?.id ?? null);
      return;
    }
    this.select(this.selected());
  }
}
