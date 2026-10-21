import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import {
  GlpiAction, GlpiAutoMode, GlpiCatalog, GlpiConfig, GlpiEntityRule, GlpiPlan, GlpiPlanRow, GlpiRun, GlpiService, GlpiTest,
} from '../../core/glpi/glpi.service';
import { InventoryMeta, InventoryService } from '../../core/inventory/inventory.service';
import { Organization, OrganizationsService } from '../../core/organizations/organizations.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { AdminGlpiWriteComponent } from './admin-glpi-write';
import { AdminGlpiTicketsComponent } from './admin-glpi-tickets';

import '../../core/i18n/packs/admin';
import '../../core/i18n/packs/glpi';

interface GlpiDraft {
  url: string;
  appToken: string;
  userToken: string;
  verifyTls: boolean;
  timeoutSeconds: number;
  importComputers: boolean;
  importNetwork: boolean;
  areaId: string | null;
  computerTypes: Record<string, string>;
  entities: Record<string, GlpiEntityRule>;
  autoMode: GlpiAutoMode;
}

type Health = 'none' | 'untested' | 'ok' | 'failed';

/** Orden de los grupos de la revisión. */
const ACTIONS: GlpiAction[] = ['create', 'update', 'reactivate', 'deactivate', 'skip', 'error', 'unchanged'];
const ACTION_ICON: Record<GlpiAction, string> = {
  create: 'add_circle', update: 'sync', reactivate: 'restart_alt', deactivate: 'block', skip: 'redo', error: 'error_outline', unchanged: 'check',
};
const AUTO_MODES: GlpiAutoMode[] = ['off', 'night', '6h'];

function toDraft(c: GlpiConfig): GlpiDraft {
  return {
    url: c.url, appToken: '', userToken: '', verifyTls: c.verifyTls, timeoutSeconds: c.timeoutSeconds,
    importComputers: c.importComputers, importNetwork: c.importNetwork, areaId: c.areaId,
    computerTypes: { ...c.computerTypes }, entities: { ...c.entities }, autoMode: c.autoMode,
  };
}

/**
 * Administración → GLPI (spec/16 §5.1, 9.6, diseño aprobado 2026-10-15):
 * conexión con la API clásica de GLPI, qué se trae y cómo se reparte, la
 * importación automática, y «Revisar ahora» → «Importar». Solo aparece con
 * «Sincronización con GLPI» prendida en Funcionalidades.
 */
@Component({
  selector: 'app-admin-glpi',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule, AdminGlpiTicketsComponent, AdminGlpiWriteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-glpi.html',
  styleUrl: './admin-glpi.css',
})
export class AdminGlpiComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GlpiService);
  private readonly inventory = inject(InventoryService);
  private readonly organizations = inject(OrganizationsService);
  /** Tickets de GLPI (spec/18): comparte con esta sección el mapeo entidad → cliente. */
  private readonly ticketsSection = viewChild(AdminGlpiTicketsComponent);

  protected readonly saved = signal<GlpiConfig | null>(null);
  protected readonly draft = signal<GlpiDraft | null>(null);
  protected readonly meta = signal<InventoryMeta | null>(null);
  protected readonly orgs = signal<Organization[]>([]);
  protected readonly catalog = signal<GlpiCatalog | null>(null);
  protected readonly plan = signal<GlpiPlan | null>(null);
  protected readonly group = signal<GlpiAction>('create');
  protected readonly result = signal<GlpiRun | null>(null);
  protected readonly runs = signal<GlpiRun[]>([]);
  protected readonly linked = signal<Set<string>>(new Set());
  protected readonly busy = signal<'save' | 'test' | 'catalog' | 'review' | 'import' | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly actions = ACTIONS;
  protected readonly actionIcon = ACTION_ICON;
  protected readonly autoModes = AUTO_MODES;

  protected readonly dirty = computed(() => {
    const s = this.saved();
    const d = this.draft();
    return !!s && !!d && (JSON.stringify(d) !== JSON.stringify(toDraft(s)));
  });

  protected readonly problem = computed<string | null>(() => {
    const d = this.draft();
    if (!d) return null;
    if (!d.url.trim()) return this.i18n.t('glpi.problem.url');
    if (!d.userToken.trim() && !this.saved()?.hasUserToken) return this.i18n.t('glpi.problem.token');
    if (!(d.timeoutSeconds >= 2 && d.timeoutSeconds <= 60)) return this.i18n.t('glpi.problem.timeout');
    if (!d.importComputers && !d.importNetwork) return this.i18n.t('glpi.problem.what');
    return null;
  });

  protected readonly health = computed<Health>(() => {
    const s = this.saved();
    if (!s?.url || !s.hasUserToken) return 'none';
    if (!s.lastTest) return 'untested';
    return s.lastTest.ok ? 'ok' : 'failed';
  });

  /** Tipos de computador: los que tienen regla más los que trajo GLPI. */
  protected readonly typeRows = computed(() => {
    const names = new Set([...Object.keys(this.draft()?.computerTypes ?? {}), ...(this.catalog()?.computerTypes ?? [])]);
    return [...names].sort((a, b) => a.localeCompare(b));
  });

  /** Entidades: las que trajo GLPI o, sin traerlas, las que tienen regla. */
  protected readonly entityRows = computed(() => {
    const fromGlpi = this.catalog()?.entities;
    if (fromGlpi) return fromGlpi.map((e) => ({ id: String(e.id), name: e.name }));
    return Object.keys(this.draft()?.entities ?? {}).map((id) => ({ id, name: this.i18n.tf('glpi.entityId', id) }));
  });

  protected readonly kinds = computed(() => (this.meta()?.kinds ?? []).filter((k) => k.active));
  protected readonly kindName = computed(() => new Map((this.meta()?.kinds ?? []).map((k) => [k.code, k.name])));
  protected readonly groupRows = computed(() => (this.plan()?.rows ?? []).filter((r) => r.action === this.group()));
  protected readonly applicable = computed(() => {
    const c = this.plan()?.counts;
    return !!c && c.create + c.update + c.reactivate + c.deactivate > 0;
  });

  async ngOnInit(): Promise<void> {
    try {
      const [config, meta, orgs, runs] = await Promise.all([this.api.config(), this.inventory.meta(), this.organizations.list({ clients: true }), this.api.runs()]);
      this.applySaved(config);
      this.meta.set(meta);
      this.orgs.set(orgs);
      this.runs.set(runs);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('glpi.loadError')));
    }
  }

  private applySaved(config: GlpiConfig): void {
    this.saved.set(config);
    this.draft.set(toDraft(config));
  }

  protected patch(changes: Partial<GlpiDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...changes } : d));
    this.notice.set(null);
  }

  protected setType(name: string, kind: string): void {
    const types = { ...this.draft()!.computerTypes };
    if (kind === 'computer') delete types[name];
    else types[name] = kind;
    this.patch({ computerTypes: types });
  }

  protected entityValue(id: string): string {
    const rule = this.draft()?.entities[id];
    if (rule?.skip) return 'skip';
    return rule?.organizationId ?? '';
  }

  protected setEntity(id: string, value: string): void {
    const entities = { ...this.draft()!.entities };
    if (!value) delete entities[id];
    else entities[id] = value === 'skip' ? { organizationId: null, skip: true } : { organizationId: value, skip: false };
    this.patch({ entities });
  }

  /** «Tickets de GLPI» guardó clientes de entidades: se toman sin perder lo que se está editando aquí. */
  protected async refreshEntities(): Promise<void> {
    try {
      const config = await this.api.config();
      const old = this.saved()?.entities ?? {};
      const mine = Object.entries(this.draft()?.entities ?? {}).filter(([id, rule]) => JSON.stringify(old[id]) !== JSON.stringify(rule));
      this.saved.update((s) => (s ? { ...s, entities: config.entities } : s));
      this.draft.update((d) => (d ? { ...d, entities: { ...config.entities, ...Object.fromEntries(mine) } } : d));
    } catch {
      // Se ve al recargar la página.
    }
  }

  protected discard(): void {
    const s = this.saved();
    if (s) this.draft.set(toDraft(s));
    this.error.set(null);
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d || this.problem() || this.busy()) return;
    this.busy.set('save');
    this.error.set(null);
    try {
      this.applySaved(await this.api.saveConfig({ ...d, url: d.url.trim(), appToken: d.appToken.trim() || undefined, userToken: d.userToken.trim() || undefined }));
      this.notice.set(this.i18n.t('admin.saved'));
      void this.ticketsSection()?.refreshClients();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('glpi.saveError')));
    } finally {
      this.busy.set(null);
    }
  }

  protected async test(): Promise<void> {
    if (this.dirty() || this.busy()) return;
    this.busy.set('test');
    this.error.set(null);
    try {
      const last: GlpiTest = await this.api.test();
      this.saved.update((s) => (s ? { ...s, lastTest: last } : s));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('glpi.testError')));
    } finally {
      this.busy.set(null);
    }
  }

  protected async loadCatalog(): Promise<void> {
    if (this.dirty() || this.busy()) return;
    this.busy.set('catalog');
    this.error.set(null);
    try {
      this.catalog.set(await this.api.catalog());
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('glpi.catalogError')));
    } finally {
      this.busy.set(null);
    }
  }

  protected async review(): Promise<void> {
    if (this.dirty() || this.busy()) return;
    this.busy.set('review');
    this.error.set(null);
    this.result.set(null);
    this.linked.set(new Set());
    try {
      const plan = await this.api.preview();
      this.plan.set(plan);
      this.group.set(ACTIONS.find((a) => plan.counts[a] > 0) ?? 'unchanged');
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('glpi.previewError')));
    } finally {
      this.busy.set(null);
    }
  }

  protected async runImport(): Promise<void> {
    if (this.dirty() || this.busy() || !this.plan()) return;
    this.busy.set('import');
    this.error.set(null);
    try {
      this.result.set(await this.api.import());
      this.plan.set(null);
      const [runs, config] = await Promise.all([this.api.runs(), this.api.config()]);
      this.runs.set(runs);
      this.saved.update((s) => (s ? { ...s, nextAutoAt: config.nextAutoAt } : s));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('glpi.importError')));
    } finally {
      this.busy.set(null);
    }
  }

  protected async link(row: GlpiPlanRow): Promise<void> {
    if (!row.linkAssetId || this.busy()) return;
    try {
      await this.api.link(row.linkAssetId, row.itemtype, row.glpiId);
      this.linked.update((set) => new Set([...set, `${row.itemtype}:${row.glpiId}`]));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('glpi.linkError')));
    }
  }

  protected isLinked(row: GlpiPlanRow): boolean {
    return this.linked().has(`${row.itemtype}:${row.glpiId}`);
  }

  protected actionLabel(a: GlpiAction): MessageKey {
    return `glpi.c.${a}` as MessageKey;
  }

  protected autoLabel(m: GlpiAutoMode): MessageKey {
    return `glpi.auto.${m}` as MessageKey;
  }

  /** «4 nuevos · 3 actualizados · 1 dado de baja»: solo lo que no es cero. */
  protected summary(run: GlpiRun): string {
    const parts: [number, MessageKey][] = [
      [run.created, 'glpi.s.created'], [run.updated, 'glpi.s.updated'], [run.reactivated, 'glpi.s.reactivated'],
      [run.deactivated, 'glpi.s.deactivated'], [run.skipped, 'glpi.s.skipped'], [run.heldBack, 'glpi.s.heldBack'],
    ];
    const text = parts.filter(([n]) => n > 0).map(([n, key]) => `${n} ${this.i18n.t(key)}`).join(' · ');
    return text || `${run.unchanged} ${this.i18n.t('glpi.s.unchanged')}`;
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
