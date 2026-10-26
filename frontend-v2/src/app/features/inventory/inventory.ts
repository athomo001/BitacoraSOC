import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AssetEvent, AssetGroup, AssetRequest, InventoryAsset, InventoryMeta, InventoryRow, InventoryService, IpKind } from '../../core/inventory/inventory.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { SseService } from '../../core/sse/sse.service';
import { SystemFeaturesService } from '../../core/system-features/system-features.service';
import { SetupService } from '../../core/setup/setup.service';
import { PermissionsService } from '../../core/auth/permissions.service';
import { AssetFormComponent } from './asset-form';
import { AssetCsvComponent } from './asset-csv';
import { AssetGroupsComponent } from './asset-groups';
import { coordsLabel } from './location-fields';

import { ComplementSlot, ComplementsService } from '../../core/complements/complements.service';
import { ComplementFrameComponent } from '../../shared/complement-frame/complement-frame';
import '../../core/i18n/packs/inventory';

type Panel = 'detail' | 'new' | 'edit' | 'csv' | 'requests' | 'groups';

/** Campos que trae GLPI (9.6): en un equipo importado, cada importación los actualiza. */
const GLPI_ATTRIBUTES = new Set(['os', 'os_version', 'cpu', 'ram_gb', 'disk', 'equipment']);

const EVENT_ICON: Record<AssetEvent['kind'], string> = {
  created: 'add_circle', edited: 'edit', work: 'build', ticket: 'confirmation_number', import: 'upload_file', glpi: 'cloud_download', deactivated: 'block', reactivated: 'restart_alt',
};

/**
 * Inventario (spec/16 §4.2, 9.2, diseño aprobado 2026-10-14): los equipos de
 * las áreas del usuario (dueña o responsable), su ficha con los campos de su
 * tipo, varias IP y responsables, y el historial de cada trabajo. Dar de baja
 * o borrar: admin o jefatura del área dueña; los demás lo piden.
 */
@Component({
  selector: 'app-inventory',
  standalone: true,
  imports: [MatIconModule, DatePipe, RouterLink, AssetFormComponent, AssetCsvComponent, AssetGroupsComponent, ComplementFrameComponent],
  templateUrl: './inventory.html',
  styleUrl: './inventory.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventoryComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly api = inject(InventoryService);
  private readonly sse = inject(SseService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly features = inject(SystemFeaturesService);
  /** «De GLPI» solo existe con la importación desde GLPI prendida. */
  protected readonly glpiOn = computed(() => this.features.isEnabled('glpi_sync'));
  private readonly setup = inject(SetupService);
  private readonly perms = inject(PermissionsService);
  private readonly route = inject(ActivatedRoute);
  /** «Ver en el mapa»: el Mapa es del módulo NOC y del perfil Operativo. */
  protected readonly mapOn = computed(() => this.setup.status()?.nocEnabled !== false && this.perms.operational());
  protected readonly coordsLabel = coordsLabel;
  /** «Ver sus equipos» desde Grupos: la lista muestra solo ese grupo. */
  protected readonly groupFilter = signal<{ id: string; name: string } | null>(null);
  /** Cliente: '' todos, 'internal' los sin cliente, o el id del cliente. */
  protected readonly clientFilter = signal('');
  protected readonly clientsInList = computed(() => {
    const byId = new Map<string, string>();
    for (const r of this.rows()) if (r.clientId) byId.set(r.clientId, r.clientName ?? '');
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });

  protected readonly meta = signal<InventoryMeta | null>(null);
  protected readonly rows = signal<InventoryRow[]>([]);
  protected readonly scope = signal<'mine' | 'all'>('mine');
  protected readonly kindFilter = signal<string | null>(null);
  protected readonly showInactive = signal(false);
  protected readonly glpiOnly = signal(false);
  protected query = '';
  protected readonly selectedId = signal<string | null>(null);
  protected readonly asset = signal<InventoryAsset | null>(null);
  protected readonly panel = signal<Panel>('detail');
  protected readonly tab = signal<'history' | 'tickets' | `c:${string}`>('history');
  private readonly complements = inject(ComplementsService);
  /** Pestañas que suman los complementos aprobados (10i). */
  protected readonly panels = computed(() => this.complements.slots().panels.filter((p) => p.target === 'asset'));
  protected readonly currentPanel = computed(() => this.panels().find((p) => this.panelTab(p) === this.tab()) ?? null);

  protected panelTab(p: ComplementSlot): `c:${string}` {
    return `c:${p.slug}|${p.key}`;
  }

  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly loaded = signal(false);
  /** Registrar trabajo / pedir baja / confirmar borrado: formularios cortos en la ficha. */
  protected readonly working = signal(false);
  protected readonly workText = signal('');
  protected readonly workDate = signal('');
  protected readonly asking = signal<'deactivate' | 'delete' | null>(null);
  protected readonly askReason = signal('');
  protected readonly confirmDelete = signal(false);
  protected readonly requests = signal<AssetRequest[]>([]);
  protected readonly decisionNote = signal('');

  protected readonly kindOf = computed(() => new Map((this.meta()?.kinds ?? []).map((k) => [k.code, k])));
  protected readonly kindsInList = computed(() => {
    const codes = new Set(this.rows().map((r) => r.kind));
    return (this.meta()?.kinds ?? []).filter((k) => codes.has(k.code) || this.kindFilter() === k.code);
  });
  protected readonly visibleRows = computed(() => {
    const c = this.clientFilter();
    return this.rows().filter((r) => (!this.kindFilter() || r.kind === this.kindFilter())
      && (!c || (c === 'internal' ? !r.clientId : r.clientId === c)));
  });
  protected readonly fields = computed(() => {
    const a = this.asset();
    return (a && this.kindOf().get(a.kind)?.fields.filter((f) => a.attributes[f.key])) ?? [];
  });
  protected readonly extraList = computed(() => Object.entries(this.asset()?.extra ?? {}));
  protected readonly eventIcon = EVENT_ICON;

  async ngOnInit(): Promise<void> {
    try {
      this.meta.set(await this.api.meta());
      this.api.pending.set(this.meta()!.pendingRequests);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('inv.loadError')));
    }
    // Desde el Mapa («Abrir en el Inventario»): esa ficha.
    const linked = this.route.snapshot.queryParamMap.get('id');
    if (linked) this.selectedId.set(linked);
    await this.load();
    if (linked && this.asset()?.id !== linked) await this.select(linked);
    const stop = this.sse.connect((type) => {
      if (type === 'inventory.request') {
        void this.api.refreshPending();
        if (this.panel() === 'requests') void this.openRequests();
      }
    });
    this.destroyRef.onDestroy(stop);
  }

  protected async load(): Promise<void> {
    try {
      this.rows.set(await this.api.list({ scope: this.scope(), q: this.query, inactive: this.showInactive(), glpi: this.glpiOnly(), group: this.groupFilter()?.id }));
      this.error.set(null);
      const sel = this.selectedId();
      if (!sel || !this.rows().some((r) => r.id === sel)) {
        const first = this.visibleRows()[0];
        if (first && this.panel() === 'detail') await this.select(first.id);
        else if (!first) this.asset.set(null);
      }
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('inv.loadError')));
    } finally {
      this.loaded.set(true);
    }
  }

  protected setScope(scope: 'mine' | 'all'): void {
    this.scope.set(scope);
    void this.load();
  }

  protected setKind(code: string): void {
    this.kindFilter.set(this.kindFilter() === code ? null : code);
  }

  protected toggleGlpi(): void {
    this.glpiOnly.update((v) => !v);
    void this.load();
  }

  /** El dato lo trae GLPI: se marca con la nube en la ficha. */
  protected fromGlpi(field: string): boolean {
    return !!this.asset()?.glpi && GLPI_ATTRIBUTES.has(field);
  }

  protected filterGroup(g: AssetGroup | null): void {
    this.groupFilter.set(g ? { id: g.id, name: g.name } : null);
    if (g) this.panel.set('detail');
    void this.load();
  }

  /** Un grupo cambió de lugar: la lista y la ficha abierta lo reflejan. */
  protected async groupsChanged(): Promise<void> {
    await this.load();
    const id = this.selectedId();
    if (id) this.asset.set(await this.api.get(id).catch(() => this.asset()));
  }

  protected toggleInactive(): void {
    this.showInactive.update((v) => !v);
    void this.load();
  }

  protected search(value: string): void {
    this.query = value;
    void this.load();
  }

  protected async select(id: string): Promise<void> {
    this.selectedId.set(id);
    this.panel.set('detail');
    this.resetForms();
    try {
      this.asset.set(await this.api.get(id));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('inv.loadError')));
    }
  }

  private resetForms(): void {
    this.working.set(false);
    this.asking.set(null);
    this.confirmDelete.set(false);
    this.workText.set('');
    this.askReason.set('');
  }

  protected kindName(code: string): string {
    return this.kindOf().get(code)?.name ?? code;
  }

  protected kindIcon(code: string): string {
    return this.kindOf().get(code)?.icon ?? 'category';
  }

  /** «Ubuntu Server 24.04» en la lista. */
  protected system(r: InventoryRow): string {
    return [r.attributes['os'], r.attributes['os_version']].filter(Boolean).join(' ') || r.model || '';
  }

  protected ipLabel(k: IpKind): MessageKey {
    return `inv.ip.${k}` as MessageKey;
  }

  protected eventLabel(k: AssetEvent['kind']): MessageKey {
    return `inv.ev.${k}` as MessageKey;
  }

  protected actionLabel(a: 'deactivate' | 'delete'): string {
    return this.i18n.t(`inv.action.${a}` as MessageKey);
  }

  protected openNew(): void {
    this.panel.set('new');
  }

  protected async onSaved(a: InventoryAsset): Promise<void> {
    this.asset.set(a);
    this.selectedId.set(a.id);
    this.panel.set('detail');
    await this.load();
  }

  protected async addWork(): Promise<void> {
    const a = this.asset();
    if (!a || !this.workText().trim()) return;
    await this.run(async () => {
      const date = this.workDate() ? new Date(this.workDate() + 'T12:00:00').toISOString() : undefined;
      this.asset.set(await this.api.addWork(a.id, this.workText().trim(), date));
      this.resetForms();
    });
  }

  protected async setActive(active: boolean): Promise<void> {
    const a = this.asset();
    if (!a) return;
    await this.run(async () => {
      this.asset.set(await this.api.setActive(a.id, active));
      await this.load();
    });
  }

  protected async remove(): Promise<void> {
    const a = this.asset();
    if (!a) return;
    await this.run(async () => {
      await this.api.remove(a.id);
      this.asset.set(null);
      this.selectedId.set(null);
      await this.load();
    });
  }

  protected async sendRequest(): Promise<void> {
    const a = this.asset();
    const action = this.asking();
    if (!a || !action || !this.askReason().trim()) return;
    await this.run(async () => {
      this.asset.set(await this.api.request(a.id, action, this.askReason().trim()));
      this.resetForms();
    });
  }

  protected async openRequests(): Promise<void> {
    this.panel.set('requests');
    try {
      this.requests.set(await this.api.requests());
      this.api.pending.set(this.requests().length);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('inv.loadError')));
    }
  }

  protected async decide(r: AssetRequest, approve: boolean): Promise<void> {
    await this.run(async () => {
      await this.api.decide(r.id, approve, this.decisionNote().trim());
      this.decisionNote.set('');
      await this.openRequests();
      await this.load();
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('inv.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
