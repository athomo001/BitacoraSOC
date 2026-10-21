import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { GlpiService, GlpiTicketRun, GlpiTicketsCatalog, GlpiTicketsConfig, GlpiTicketsEvery } from '../../core/glpi/glpi.service';
import { Organization, OrganizationsService } from '../../core/organizations/organizations.service';
import { TicketArea, TicketsService } from '../../core/tickets/tickets.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/admin';
import '../../core/i18n/packs/glpi';

interface TicketsDraft {
  enabled: boolean;
  every: GlpiTicketsEvery;
  sinceDays: number;
  entities: number[];
  clients: Record<string, string>;
  groupAreas: Record<string, string>;
}

const EVERY: GlpiTicketsEvery[] = ['5m', '15m', 'off'];

/** Mientras una corrida sigue en curso, cada cuánto se miran las corridas. */
const POLL_MS = 3000;

function toDraft(c: GlpiTicketsConfig): TicketsDraft {
  return {
    enabled: c.enabled, every: c.every, sinceDays: c.sinceDays, entities: [...c.entities].sort((a, b) => a - b),
    clients: { ...c.clients }, groupAreas: { ...c.groupAreas },
  };
}

/**
 * Administración → GLPI, «Tickets de GLPI» (10d.1, spec/18, diseño aprobado
 * 2026-10-20): encender, la primera carga y cada cuánto; las entidades que se
 * traen (con su cliente) y qué grupo técnico va a qué área; «Sincronizar
 * ahora» y las últimas corridas.
 */
@Component({
  selector: 'app-admin-glpi-tickets',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-glpi-tickets.html',
  styleUrl: './admin-glpi-tickets.css',
})
export class AdminGlpiTicketsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GlpiService);
  private readonly organizations = inject(OrganizationsService);
  private readonly tickets = inject(TicketsService);
  private readonly destroyRef = inject(DestroyRef);
  /** Se guardó un cliente de una entidad: la sección de equipos usa el mismo mapeo. */
  readonly clientsSaved = output<void>();

  protected readonly saved = signal<GlpiTicketsConfig | null>(null);
  protected readonly draft = signal<TicketsDraft | null>(null);
  protected readonly catalog = signal<GlpiTicketsCatalog | null>(null);
  protected readonly orgs = signal<Organization[]>([]);
  protected readonly areas = signal<TicketArea[]>([]);
  protected readonly runs = signal<GlpiTicketRun[]>([]);
  protected readonly busy = signal<'save' | 'catalog' | 'sync' | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly everyOptions = EVERY;
  private pollTimer?: ReturnType<typeof setTimeout>;

  protected readonly dirty = computed(() => {
    const s = this.saved();
    const d = this.draft();
    return !!s && !!d && JSON.stringify(d) !== JSON.stringify(toDraft(s));
  });

  protected readonly problem = computed<string | null>(() => {
    const d = this.draft();
    if (!d) return null;
    if (!(d.sinceDays >= 1 && d.sinceDays <= 365)) return this.i18n.t('glpi.tk.problem.days');
    return null;
  });

  protected readonly running = computed(() => this.runs().some((r) => r.running));
  protected readonly last = computed(() => this.runs().find((r) => !r.running) ?? null);
  protected readonly resolving = computed(() => this.areas().filter((a) => a.resolves));

  /** Entidades: las de GLPI o, sin traerlas, las marcadas y las que tienen cliente. */
  protected readonly entityRows = computed(() => {
    const fromGlpi = this.catalog()?.entities;
    if (fromGlpi) return fromGlpi.map((e) => ({ id: e.id, name: e.name }));
    const d = this.draft();
    const ids = new Set([...(d?.entities ?? []), ...Object.keys(d?.clients ?? {}).map(Number)]);
    return [...ids].sort((a, b) => a - b).map((id) => ({ id, name: this.i18n.tf('glpi.entityId', String(id)) }));
  });

  /** Grupos: los de GLPI o, sin traerlos, los que tienen área. */
  protected readonly groupRows = computed(() => {
    const fromGlpi = this.catalog()?.groups;
    if (fromGlpi) return fromGlpi;
    return Object.keys(this.draft()?.groupAreas ?? {}).map((id) => ({ id: Number(id), name: this.i18n.tf('glpi.tk.groupId', id), openCount: 0 }));
  });

  /** Entidades marcadas sin cliente propio ni de una madre: sus tickets se saltan. */
  protected readonly withoutClient = computed(() => {
    const d = this.draft();
    const cat = this.catalog();
    if (!d || !cat) return [];
    const parent = new Map(cat.entities.map((e) => [e.id, e.parentId]));
    const hasClient = (id: number): boolean => {
      for (let i = 0, cur = id; i < 64 && cur >= 0; i++) {
        if (d.clients[String(cur)]) return true;
        const p = parent.get(cur);
        if (p === undefined || p === cur) return false;
        cur = p;
      }
      return false;
    };
    return cat.entities.filter((e) => d.entities.includes(e.id) && !hasClient(e.id)).map((e) => e.name);
  });

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.pollTimer));
  }

  async ngOnInit(): Promise<void> {
    try {
      const [config, runs, orgs, scope] = await Promise.all([
        this.api.ticketsConfig(), this.api.ticketRuns(), this.organizations.list({ clients: true }), this.tickets.scope(),
      ]);
      this.applySaved(config);
      this.runs.set(runs);
      this.orgs.set(orgs);
      this.areas.set(scope.areas);
      this.watchRuns();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('glpi.loadError')));
    }
  }

  private applySaved(config: GlpiTicketsConfig): void {
    this.saved.set(config);
    this.draft.set(toDraft(config));
  }

  /** La sección de equipos guardó el mapeo entidad → cliente: se toma sin perder lo que se está editando. */
  async refreshClients(): Promise<void> {
    try {
      const config = await this.api.ticketsConfig();
      const old = this.saved()?.clients ?? {};
      const mine = Object.entries(this.draft()?.clients ?? {}).filter(([id, v]) => old[id] !== v);
      this.saved.update((s) => (s ? { ...s, clients: config.clients } : s));
      this.draft.update((d) => (d ? { ...d, clients: { ...config.clients, ...Object.fromEntries(mine) } } : d));
    } catch {
      // Se ve al recargar la página.
    }
  }

  protected patch(changes: Partial<TicketsDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...changes } : d));
    this.notice.set(null);
  }

  protected isMarked(id: number): boolean {
    return this.draft()?.entities.includes(id) ?? false;
  }

  protected toggleEntity(id: number): void {
    const list = this.draft()!.entities;
    this.patch({ entities: (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]).sort((a, b) => a - b) });
  }

  protected setClient(id: number, value: string): void {
    const clients = { ...this.draft()!.clients };
    if (value) clients[String(id)] = value;
    else delete clients[String(id)];
    this.patch({ clients });
  }

  protected setGroupArea(id: number, value: string): void {
    const groupAreas = { ...this.draft()!.groupAreas };
    if (value) groupAreas[String(id)] = value;
    else delete groupAreas[String(id)];
    this.patch({ groupAreas });
  }

  protected discard(): void {
    const s = this.saved();
    if (s) this.draft.set(toDraft(s));
    this.error.set(null);
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    const s = this.saved();
    if (!d || !s || this.problem() || this.busy()) return;
    this.busy.set('save');
    this.error.set(null);
    // Solo los clientes que cambiaron (lo quitado va como null): el mismo
    // mapeo lo edita la sección de equipos y no se pisa lo que guardó ella.
    const clients: Record<string, string | null> = {};
    for (const id of new Set([...Object.keys(s.clients), ...Object.keys(d.clients)])) {
      if (s.clients[id] !== d.clients[id]) clients[id] = d.clients[id] ?? null;
    }
    try {
      this.applySaved(await this.api.saveTicketsConfig({ ...d, clients }));
      this.notice.set(this.i18n.t('admin.saved'));
      if (Object.keys(clients).length) this.clientsSaved.emit();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('glpi.saveError')));
    } finally {
      this.busy.set(null);
    }
  }

  protected async loadCatalog(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('catalog');
    this.error.set(null);
    try {
      this.catalog.set(await this.api.ticketsCatalog());
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('glpi.catalogError')));
    } finally {
      this.busy.set(null);
    }
  }

  protected async sync(): Promise<void> {
    if (this.dirty() || this.busy() || this.running()) return;
    this.busy.set('sync');
    this.error.set(null);
    try {
      await this.api.syncTickets();
      this.runs.set(await this.api.ticketRuns());
      this.watchRuns();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('glpi.tk.syncError')));
    } finally {
      this.busy.set(null);
    }
  }

  /** Mientras haya una corrida en curso, se vuelve a mirar cada 3 s. */
  private watchRuns(): void {
    clearTimeout(this.pollTimer);
    if (!this.running()) return;
    this.pollTimer = setTimeout(async () => {
      try {
        this.runs.set(await this.api.ticketRuns());
        if (!this.running()) this.applySaved(await this.api.ticketsConfig());
      } catch {
        // Se vuelve a intentar en la próxima vuelta.
      }
      this.watchRuns();
    }, POLL_MS);
  }

  protected everyLabel(e: GlpiTicketsEvery): MessageKey {
    return `glpi.tk.every.${e}` as MessageKey;
  }

  protected result(run: GlpiTicketRun): string {
    if (run.running) return this.i18n.t('glpi.tk.running');
    return this.i18n.t(run.ok ? 'glpi.run.ok' : 'glpi.run.fail');
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
