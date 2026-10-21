import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ApiKey, ApiKeyCreated, ApiKeyRequest, IntegrationsMeta, IntegrationsService } from '../../core/integrations/integrations.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/integrations';

interface KeyDraft {
  name: string;
  description: string;
  scopes: string[];
  someClients: boolean;
  clientIds: string[];
  areaId: string;
  expiresInDays: number;
}

const EXPIRES = [90, 365, 0];
const DAY = 24 * 3600 * 1000;

function emptyDraft(): KeyDraft {
  return { name: '', description: '', scopes: ['entries:write'], someClients: false, clientIds: [], areaId: '', expiresInDays: 365 };
}

/** Llaves de la API de integraciones (spec/19 §4): la lista, crear (se muestra una vez), revocar y sus llamadas. */
@Component({
  selector: 'app-integrations-keys',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './integrations-keys.html',
  styleUrl: './integrations-keys.css',
})
export class IntegrationsKeysComponent implements OnInit {
  readonly meta = input.required<IntegrationsMeta>();

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(IntegrationsService);

  protected readonly expires = EXPIRES;
  protected readonly keys = signal<ApiKey[]>([]);
  protected readonly selected = signal<string | null>(null);
  protected readonly requests = signal<ApiKeyRequest[]>([]);
  protected readonly draft = signal<KeyDraft | null>(null);
  protected readonly created = signal<ApiKeyCreated | null>(null);
  protected readonly copied = signal(false);
  protected readonly confirmRevoke = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly current = computed(() => this.keys().find((k) => k.id === this.selected()) ?? null);
  protected readonly needsArea = computed(() => this.draft()?.scopes.includes('tickets:write') ?? false);
  protected readonly problem = computed<string | null>(() => {
    const d = this.draft();
    if (!d) return null;
    if (!d.name.trim()) return this.i18n.t('ig.k.problem.name');
    if (!d.scopes.length) return this.i18n.t('ig.k.problem.scopes');
    if (d.someClients && !d.clientIds.length) return this.i18n.t('ig.k.problem.clients');
    if (d.scopes.includes('tickets:write') && !d.areaId) return this.i18n.t('ig.k.problem.area');
    return null;
  });
  protected readonly curl = computed(() => {
    const c = this.created();
    if (!c) return '';
    const base = typeof location === 'undefined' ? 'https://bitacora' : location.origin;
    return [
      `curl -X POST ${base}/api/v1/entries \\`,
      `  -H "X-API-Key: ${c.secret}" \\`,
      '  -H "Idempotency-Key: alerta-1" \\',
      '  -H "Content-Type: application/json" \\',
      `  -d '{"content":"Prueba desde ${c.key.name}","entryType":"operativa","tags":["api"]}'`,
    ].join('\n');
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(select?: string): Promise<void> {
    try {
      const keys = await this.api.keys();
      this.keys.set(keys);
      const want = select ?? this.selected() ?? keys[0]?.id ?? null;
      if (want) await this.select(want);
      this.error.set(null);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ig.loadError')));
    }
  }

  protected async select(id: string): Promise<void> {
    this.selected.set(id);
    this.draft.set(null);
    this.created.set(null);
    this.confirmRevoke.set(false);
    this.requests.set([]);
    try {
      const list = await this.api.keyRequests(id);
      if (this.selected() === id) this.requests.set(list);
    } catch {
      // El registro es secundario: la llave se ve igual.
    }
  }

  protected startNew(): void {
    this.draft.set(emptyDraft());
    this.created.set(null);
    this.confirmRevoke.set(false);
  }

  protected patch(changes: Partial<KeyDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...changes } : d));
  }

  protected toggle(list: 'scopes' | 'clientIds', value: string): void {
    const cur = this.draft()![list];
    this.patch({ [list]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] });
  }

  protected scopeKey(s: string): MessageKey {
    return `ig.k.sc.${s}` as MessageKey;
  }

  protected expKey(days: number): MessageKey {
    return `ig.k.exp.${days}` as MessageKey;
  }

  protected clientNames(k: ApiKey): string {
    if (!k.clientIds?.length) return this.i18n.t('ig.k.allClients');
    const names = new Map(this.meta().clients.map((c) => [c.id, c.name]));
    return k.clientIds.map((id) => names.get(id) ?? '—').join(', ');
  }

  protected daysLeft(k: ApiKey): number | null {
    if (k.state !== 'active' || !k.expiresAt) return null;
    return Math.max(0, Math.ceil((new Date(k.expiresAt).getTime() - Date.now()) / DAY));
  }

  protected two(key: MessageKey, v: string, w: string): string {
    return this.i18n.tf(key, v).replace('{w}', w);
  }

  protected async create(): Promise<void> {
    const d = this.draft();
    if (!d || this.problem() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const out = await this.api.createKey({
        name: d.name.trim(), description: d.description.trim(), scopes: d.scopes, clientIds: d.someClients ? d.clientIds : [],
        areaId: d.scopes.includes('tickets:write') ? d.areaId : null, expiresInDays: d.expiresInDays,
      });
      this.keys.set(await this.api.keys());
      this.selected.set(out.key.id);
      this.requests.set([]);
      this.draft.set(null);
      this.copied.set(false);
      this.created.set(out);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ig.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy(field: HTMLElement): Promise<void> {
    const secret = this.created()?.secret;
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      this.copied.set(true);
    } catch {
      // Sin portapapeles: se deja seleccionada para copiarla a mano.
      const range = document.createRange();
      range.selectNodeContents(field);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }
  }

  protected done(): void {
    const id = this.created()?.key.id;
    this.created.set(null);
    if (id) void this.select(id);
  }

  protected async revoke(): Promise<void> {
    const k = this.current();
    if (!k || this.busy()) return;
    this.busy.set(true);
    try {
      await this.api.revokeKey(k.id);
      await this.load(k.id);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ig.saveError')));
    } finally {
      this.busy.set(false);
      this.confirmRevoke.set(false);
    }
  }
}
