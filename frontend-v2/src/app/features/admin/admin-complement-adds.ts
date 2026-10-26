import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Complement, ComplementItem, ComplementManifest, ComplementSettings, ComplementsService, SettingField } from '../../core/complements/complements.service';
import { ComplementsAdminService } from '../../core/complements/complements-admin.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/complement-features';

/** Lo aprobado que vale hoy: si pide «de la casa», solo si el complemento lo es. */
export function isEffective(c: Complement, it: ComplementItem): boolean {
  return c.approved.includes(it.key) && (!it.house || c.isHouse);
}

/** Lo que espera revisión: lo declarado sin aprobar que podría aprobarse. */
export function pendingOf(c: Complement): number {
  return c.items.filter((it) => !c.approved.includes(it.key) && (!it.house || c.isHouse)).length;
}

/** «{0} y {1}» con los valores en orden. */
export function fill(text: string, ...values: (string | number)[]): string {
  return values.reduce<string>((t, v, i) => t.replace(`{${i}}`, String(v)), text);
}

interface Row {
  key: string;
  what: string;
  detail: string;
  state: 'ok' | 'pending' | 'house';
}

const SCREEN: ComplementItem['kind'][] = ['page', 'panel', 'action', 'topbar', 'settings'];
const BACK: ComplementItem['kind'][] = ['event', 'schedule'];

/**
 * Administración → Complementos → «Qué agrega» y «Configuración» (10i,
 * diseño aprobado el 2026-10-26): cada cosa que declara complement.json se
 * aprueba o se quita por separado; la barra superior y las páginas en
 * Administración piden «de la casa». La configuración se arma con los
 * campos que declara el complemento; los secretos no vuelven a la pantalla.
 */
@Component({
  selector: 'app-admin-complement-adds',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-complement-adds.html',
  styleUrl: './admin-complement-adds.css',
})
export class AdminComplementAddsComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ComplementsAdminService);
  private readonly slots = inject(ComplementsService);

  readonly complement = input.required<Complement>();
  readonly mode = input<'adds' | 'settings'>('adds');
  readonly updated = output<Complement>();

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly manifest = computed<ComplementManifest | null>(() => this.complement().manifest ?? null);
  protected readonly service = computed(() => this.complement().sourceType === 'manual');
  protected readonly pending = computed(() => pendingOf(this.complement()));
  protected readonly screenRows = computed(() => this.rows(SCREEN));
  protected readonly backRows = computed(() => this.rows(BACK));
  protected readonly dataRows = computed(() => this.rows(['data']));

  // Configuración
  protected readonly settings = signal<ComplementSettings | null>(null);
  protected readonly values = signal<Record<string, unknown>>({});
  protected readonly secrets = signal<Record<string, string>>({});
  protected readonly editingSecret = signal<string | null>(null);

  constructor() {
    effect(() => {
      const slug = this.complement().slug;
      if (this.mode() === 'settings') untracked(() => void this.loadSettings(slug));
    });
  }

  protected fill = fill;

  private rows(kinds: ComplementItem['kind'][]): Row[] {
    const c = this.complement();
    return c.items
      .filter((it) => kinds.includes(it.kind))
      .map((it) => ({
        key: it.key,
        ...this.describe(it),
        state: it.house && !c.isHouse ? 'house' : c.approved.includes(it.key) ? 'ok' : 'pending',
      }));
  }

  /** Qué es y dónde aparece, en lenguaje claro. */
  private describe(it: ComplementItem): { what: string; detail: string } {
    const m = this.manifest() ?? {};
    const t = (k: string) => this.i18n.t(k as MessageKey);
    const id = it.key.slice(it.key.indexOf(':') + 1);
    switch (it.kind) {
      case 'page': {
        const p = m.pages?.find((x) => x.id === id);
        return { what: fill(t('cf.what.page'), t(`cf.module.${p?.module}`)), detail: p?.title ?? id };
      }
      case 'panel': {
        const p = m.panels?.find((x) => x.id === id);
        return { what: fill(t('cf.what.panel'), t(`cf.target.${p?.target}`)), detail: p?.title ?? id };
      }
      case 'action': {
        const a = m.actions?.find((x) => x.id === id);
        return { what: fill(t('cf.what.action'), a?.title ?? id), detail: t(`cf.on.${a?.target}`) };
      }
      case 'topbar':
        return { what: t('cf.what.topbar'), detail: t('cf.what.topbarDetail') };
      case 'settings':
        return { what: t('cf.what.settings'), detail: fill(t('cf.what.settingsDetail'), m.settings?.length ?? 0) };
      case 'event':
        return { what: fill(t('cf.what.event'), t(`cf.event.${id}`)), detail: t('cf.what.eventDetail') };
      case 'schedule': {
        const s = m.schedules?.find((x) => x.name === id);
        const when = s?.every
          ? fill(t('cf.what.every'), s.every.replace(/([mhd])$/, ' $1'))
          : fill(t('cf.what.at'), s?.days?.length ? s.days.map((d) => t(`cf.day.${d}`)).join(', ') : t('cf.what.everyDay'), s?.at ?? '');
        return { what: when, detail: s?.title || id };
      }
      case 'data':
        return { what: t(`cf.data.${id}`), detail: t(id.endsWith(':read') ? 'cf.data.read' : 'cf.data.write') };
    }
  }

  protected async toggle(key: string): Promise<void> {
    const c = this.complement();
    const approved = c.approved.includes(key) ? c.approved.filter((k) => k !== key) : [...c.approved, key];
    await this.save(() => this.api.setApprovals(c.slug, approved, c.isHouse));
  }

  protected async toggleHouse(): Promise<void> {
    const c = this.complement();
    await this.save(() => this.api.setApprovals(c.slug, c.approved, !c.isHouse));
  }

  protected async reread(): Promise<void> {
    const c = this.complement();
    await this.save(() => this.api.refreshManifest(c.slug));
  }

  private async save(action: () => Promise<Complement>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      const saved = await action();
      this.updated.emit({ ...saved, entriesCount: this.complement().entriesCount });
      void this.slots.refresh();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('acomp.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  // ===== Configuración =====

  private async loadSettings(slug: string): Promise<void> {
    this.notice.set(null);
    this.editingSecret.set(null);
    this.secrets.set({});
    try {
      const s = await this.api.getSettings(slug);
      this.settings.set(s);
      this.values.set({ ...s.values });
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('acomp.loadError')));
    }
  }

  protected value(f: SettingField): unknown {
    return this.values()[f.key] ?? '';
  }

  protected setValue(key: string, v: unknown): void {
    this.values.update((x) => ({ ...x, [key]: v }));
  }

  protected setSecret(key: string, v: string): void {
    this.secrets.update((x) => ({ ...x, [key]: v }));
  }

  protected async saveSettings(clear: string[] = []): Promise<void> {
    const c = this.complement();
    this.error.set(null);
    this.notice.set(null);
    this.busy.set(true);
    try {
      const s = await this.api.putSettings(c.slug, { values: this.values(), secrets: this.secrets(), clear });
      this.settings.set(s);
      this.values.set({ ...s.values });
      this.secrets.set({});
      this.editingSecret.set(null);
      this.notice.set(this.i18n.t('cf.set.savedOk'));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('acomp.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
