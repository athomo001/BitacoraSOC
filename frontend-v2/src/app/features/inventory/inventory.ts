import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AssetEvent, AssetRequest, InventoryAsset, InventoryMeta, InventoryRow, InventoryService, IpKind } from '../../core/inventory/inventory.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { SseService } from '../../core/sse/sse.service';
import { AssetFormComponent } from './asset-form';
import { AssetCsvComponent } from './asset-csv';

import '../../core/i18n/packs/inventory';

type Panel = 'detail' | 'new' | 'edit' | 'csv' | 'requests';

const EVENT_ICON: Record<AssetEvent['kind'], string> = {
  created: 'add_circle', edited: 'edit', work: 'build', ticket: 'confirmation_number', import: 'upload_file', deactivated: 'block', reactivated: 'restart_alt',
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
  imports: [MatIconModule, DatePipe, RouterLink, AssetFormComponent, AssetCsvComponent],
  templateUrl: './inventory.html',
  styleUrl: './inventory.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventoryComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly api = inject(InventoryService);
  private readonly sse = inject(SseService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly meta = signal<InventoryMeta | null>(null);
  protected readonly rows = signal<InventoryRow[]>([]);
  protected readonly scope = signal<'mine' | 'all'>('mine');
  protected readonly kindFilter = signal<string | null>(null);
  protected readonly showInactive = signal(false);
  protected query = '';
  protected readonly selectedId = signal<string | null>(null);
  protected readonly asset = signal<InventoryAsset | null>(null);
  protected readonly panel = signal<Panel>('detail');
  protected readonly tab = signal<'history' | 'tickets'>('history');
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
  protected readonly visibleRows = computed(() => this.rows().filter((r) => !this.kindFilter() || r.kind === this.kindFilter()));
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
    await this.load();
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
      this.rows.set(await this.api.list({ scope: this.scope(), q: this.query, inactive: this.showInactive() }));
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
