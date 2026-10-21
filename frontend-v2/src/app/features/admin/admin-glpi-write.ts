import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { GlpiOutboxItem, GlpiService, GlpiWriteConfig, GlpiWriteTest } from '../../core/glpi/glpi.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/admin';
import '../../core/i18n/packs/glpi';

interface WriteDraft {
  enabled: boolean;
  /** undefined = se mantiene el guardado; texto = uno nuevo. */
  token?: string;
  defaultType: 1 | 2;
  clientEntities: Record<string, number>;
  areaGroups: Record<string, number>;
}

function toDraft(c: GlpiWriteConfig): WriteDraft {
  const clientEntities: Record<string, number> = {};
  const areaGroups: Record<string, number> = {};
  c.clients.forEach((x) => x.entityId !== null && x.entities.length > 1 && (clientEntities[x.clientId] = x.entityId));
  c.areas.forEach((x) => x.groupId !== null && x.groups.length > 1 && (areaGroups[x.areaId] = x.groupId));
  return { enabled: c.enabled, defaultType: c.defaultType, clientEntities, areaGroups };
}

/**
 * Administración → GLPI → Escribir en GLPI (10d.2, spec/18 §4.6, diseño
 * aprobado): interruptor, User-Token de escritura aparte con «Probar» (sin
 * crear nada), tipo por defecto, a qué entidad y grupo va lo que se crea
 * cuando hay más de uno, y la cola de envíos con «Reintentar».
 */
@Component({
  selector: 'app-admin-glpi-write',
  standalone: true,
  imports: [DatePipe, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-glpi-write.html',
  styleUrl: './admin-glpi-write.css',
})
export class AdminGlpiWriteComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(GlpiService);

  protected readonly saved = signal<GlpiWriteConfig | null>(null);
  protected readonly draft = signal<WriteDraft | null>(null);
  protected readonly queue = signal<GlpiOutboxItem[]>([]);
  protected readonly test = signal<GlpiWriteTest | null>(null);
  protected readonly replacing = signal(false);
  protected readonly busy = signal<'save' | 'test' | 'retry' | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly dirty = computed(() => {
    const s = this.saved();
    const d = this.draft();
    return !!s && !!d && JSON.stringify(d) !== JSON.stringify(toDraft(s));
  });
  protected readonly problem = computed(() => {
    const d = this.draft();
    const s = this.saved();
    if (d?.enabled && !s?.hasToken && !d.token?.trim()) return this.i18n.t('gw.adm.needToken');
    return null;
  });
  protected readonly failed = computed(() => this.queue().some((q) => q.state === 'failed'));

  async ngOnInit(): Promise<void> {
    try {
      const [config, queue] = await Promise.all([this.api.writeConfig(), this.api.writeQueue()]);
      this.apply(config);
      this.queue.set(queue);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('glpi.loadError')));
    }
  }

  private apply(c: GlpiWriteConfig): void {
    this.saved.set(c);
    this.draft.set(toDraft(c));
    this.replacing.set(false);
  }

  protected patch(changes: Partial<WriteDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...changes } : d));
    this.notice.set(null);
  }

  protected setEntity(clientId: string, value: string): void {
    const clientEntities = { ...this.draft()!.clientEntities };
    if (value) clientEntities[clientId] = Number(value);
    else delete clientEntities[clientId];
    this.patch({ clientEntities });
  }

  protected setGroup(areaId: string, value: string): void {
    const areaGroups = { ...this.draft()!.areaGroups };
    if (value) areaGroups[areaId] = Number(value);
    else delete areaGroups[areaId];
    this.patch({ areaGroups });
  }

  protected tokenInput(e: Event): void {
    this.patch({ token: (e.target as HTMLInputElement).value });
  }

  protected keepToken(): void {
    this.replacing.set(false);
    const d = { ...this.draft()! };
    delete d.token;
    this.draft.set(d);
  }

  protected discard(): void {
    const s = this.saved();
    if (s) this.apply(s);
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d || this.problem() || this.busy()) return;
    this.busy.set('save');
    this.error.set(null);
    try {
      this.apply(await this.api.saveWriteConfig({ enabled: d.enabled, token: d.token === undefined ? null : d.token.trim(), defaultType: d.defaultType,
        clientEntities: d.clientEntities, areaGroups: d.areaGroups }));
      this.notice.set(this.i18n.t('gw.adm.saved'));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('gw.adm.saveError')));
    } finally {
      this.busy.set(null);
    }
  }

  protected async runTest(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('test');
    this.test.set(null);
    try {
      this.test.set(await this.api.testWrite());
    } catch (e) {
      this.test.set({ ok: false, problem: { error: problemDetail(e, this.i18n.t('glpi.loadError')), cause: '', next: '', raw: '' } });
    } finally {
      this.busy.set(null);
    }
  }

  protected testText(t: GlpiWriteTest): string {
    if (!t.ok) return [t.problem?.error, t.problem?.next].filter(Boolean).join(' ');
    return this.i18n.tf('gw.adm.testOk', t.user ?? '').replace('{w}', t.profile ?? '—');
  }

  protected async retry(id?: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set('retry');
    try {
      await this.api.retryWrite(id);
      this.queue.set(await this.api.writeQueue());
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('gw.adm.saveError')));
    } finally {
      this.busy.set(null);
    }
  }

  protected kindLabel(q: GlpiOutboxItem): string {
    return this.i18n.tf(`gw.adm.kind.${q.kind}` as MessageKey, q.glpiTicketId) + (q.ticketNumber ? ` (${q.ticketNumber})` : '');
  }

  protected stateLabel(q: GlpiOutboxItem): string {
    if (q.state === 'queued') return this.i18n.tf('gw.adm.st.queued', q.attempts + 1);
    return this.i18n.t(`gw.adm.st.${q.state}` as MessageKey);
  }
}
