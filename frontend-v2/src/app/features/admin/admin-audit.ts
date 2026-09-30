import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { AuditFilter, AuditLevel, AuditRecord, AuditService } from '../../core/audit/audit.service';
import { AUDIT_CATEGORIES, AuditRange, categoryOf, formatMetadata, rangeBounds } from '../../core/audit/audit-view';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { problemDetail } from '../../core/http-error';
import { ButtonComponent } from '../../shared/ui/button/button';

const PAGE_SIZES = [25, 50, 100] as const;
const RANGES: readonly AuditRange[] = ['today', '7d', '30d', 'custom'];
const SEARCH_DELAY_MS = 300;

/**
 * Auditoría (Administración → Sistema), artboard aprobado: búsqueda libre,
 * nivel, resultado, rango de fechas y categoría; tabla densa con el detalle
 * del evento al lado, paginación y "Exportar CSV" de exactamente lo filtrado.
 * Solo lectura para admin y auditor: nada se edita ni se borra.
 */
@Component({
  selector: 'app-admin-audit',
  standalone: true,
  imports: [DatePipe, MatIconModule, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-audit.html',
  styleUrl: './admin-audit.css',
})
export class AdminAuditComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(AuditService);
  private readonly prefs = inject(PreferencesService);

  protected readonly categories = AUDIT_CATEGORIES;
  protected readonly ranges = RANGES;
  protected readonly pageSizes = PAGE_SIZES;
  protected readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  protected readonly category = signal<string>('all');
  protected readonly level = signal<AuditLevel | ''>('');
  protected readonly result = signal<'ok' | 'fail' | ''>('');
  protected readonly range = signal<AuditRange>('7d');
  protected readonly customFrom = signal('');
  protected readonly customTo = signal('');
  protected readonly query = signal('');
  protected readonly page = signal(1);
  protected readonly pageSize = signal<number>(50);

  protected readonly records = signal<AuditRecord[]>([]);
  protected readonly total = signal(0);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly exported = signal(false);

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private requestSeq = 0;

  protected readonly filter = computed<AuditFilter>(() => {
    const category = AUDIT_CATEGORIES.find((c) => c.id === this.category());
    return {
      events: category?.prefixes,
      level: this.level() || undefined,
      result: this.result() || undefined,
      q: this.query(),
      ...rangeBounds(this.range(), new Date(), this.customFrom(), this.customTo()),
    };
  });

  /** Algún filtro distinto del estado inicial (el rango de 7 días es el punto de partida, no un filtro). */
  protected readonly filtered = computed(
    () => this.category() !== 'all' || !!this.level() || !!this.result() || !!this.query().trim() || this.range() !== '7d',
  );

  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  protected readonly rangeLabel = computed(() => {
    const total = this.total();
    if (!total) return this.i18n.t('audit.none');
    const from = (this.page() - 1) * this.pageSize() + 1;
    const to = Math.min(from + this.pageSize() - 1, total);
    return `${this.number(from)}–${this.number(to)} ${this.i18n.t('audit.of')} ${this.number(total)}`;
  });

  protected readonly exportLabel = computed(() => {
    if (this.exported()) return this.i18n.t('audit.exported');
    return this.filtered() ? this.i18n.tf('audit.exportCount', this.number(this.total())) : this.i18n.t('audit.export');
  });

  protected readonly selected = computed(() => this.records().find((r) => r.id === this.selectedId()) ?? null);

  constructor() {
    // Cualquier cambio de filtro, página o tamaño vuelve a pedir; una respuesta vieja se descarta.
    effect(() => {
      const filter = this.filter();
      const page = this.page();
      const pageSize = this.pageSize();
      untracked(() => void this.load(filter, page, pageSize));
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.searchTimer));
  }

  /** Cambiar un filtro siempre vuelve a la primera página. */
  protected setFilter<T>(target: { set(value: T): void }, value: T): void {
    target.set(value);
    this.page.set(1);
    this.exported.set(false);
  }

  protected onSearch(value: string): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.setFilter(this.query, value), SEARCH_DELAY_MS);
  }

  protected clear(): void {
    clearTimeout(this.searchTimer);
    this.category.set('all');
    this.level.set('');
    this.result.set('');
    this.range.set('7d');
    this.customFrom.set('');
    this.customTo.set('');
    this.query.set('');
    this.page.set(1);
    this.exported.set(false);
  }

  protected goPage(delta: number): void {
    this.page.set(Math.min(this.pages(), Math.max(1, this.page() + delta)));
  }

  protected async exportCsv(): Promise<void> {
    this.error.set(null);
    try {
      await this.api.exportCsv(this.filter());
      this.exported.set(true);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('audit.exportError')));
    }
  }

  protected categoryKey(event: string): MessageKey {
    return categoryOf(event).labelKey;
  }

  protected categoryTone(event: string): string {
    return 'tone-' + categoryOf(event).tone;
  }

  protected roleKey(role?: string): MessageKey | null {
    return role === 'admin' || role === 'user' || role === 'auditor' ? (`audit.role.${role}` as MessageKey) : null;
  }

  protected rangeKey(range: AuditRange): MessageKey {
    return `audit.range.${range}` as MessageKey;
  }

  protected levelKey(level: string): MessageKey {
    return `audit.level.${level}` as MessageKey;
  }

  /** 1.284 en español, 1,284 en inglés. */
  private number(value: number): string {
    return value.toLocaleString(this.prefs.language() === 'es' ? 'es-CL' : 'en-US');
  }

  protected metadata(record: AuditRecord): string {
    return formatMetadata(record.metadata);
  }

  private async load(filter: AuditFilter, page: number, pageSize: number): Promise<void> {
    const seq = ++this.requestSeq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.api.list(filter, page, pageSize);
      if (seq !== this.requestSeq) return;
      this.records.set(result.items);
      this.total.set(result.total);
      if (!result.items.some((r) => r.id === this.selectedId())) this.selectedId.set(result.items[0]?.id ?? null);
    } catch (error) {
      if (seq !== this.requestSeq) return;
      this.records.set([]);
      this.total.set(0);
      this.error.set(problemDetail(error, this.i18n.t('audit.loadError')));
    } finally {
      if (seq === this.requestSeq) this.loading.set(false);
    }
  }
}
