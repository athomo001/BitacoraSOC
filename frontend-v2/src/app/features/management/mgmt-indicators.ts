import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { Dialog } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { Indicators, IndicatorRow, ManagementService, MgmtClient, MgmtMeta, MgmtPeriod } from '../../core/management/management.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { problemDetail } from '../../core/http-error';
import { PERIODS, durationText, monthLong, monthShort, pct } from './mgmt-format';
import { ExportDialogComponent, ExportDialogData } from './export-dialog';

/** Series del gráfico: orden fijo, validadas para claro y oscuro (styles/tokens.css). */
const SLOTS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];
const MAX_SERIES = SLOTS.length;
const H = 250;
const M = { l: 44, t: 16, b: 28 };

interface Series { id: string; name: string; color: string; vals: number[]; }

/**
 * Gestión → Indicadores (spec/16 §4.4.8): por cliente o por área y por
 * período, la tendencia del SLA (6 meses, con la línea de objetivo y el
 * período marcado), la carga por área y la tabla. El gráfico compara hasta 5
 * a la vez (parte con los de SLA más bajo); cada uno conserva su color
 * mientras esté marcado. La tabla es la vista accesible de los mismos datos.
 */
@Component({
  selector: 'app-mgmt-indicators',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mgmt-indicators.html',
  styleUrl: './mgmt-indicators.css',
})
export class MgmtIndicatorsComponent {
  readonly meta = input.required<MgmtMeta>();
  readonly clients = input.required<MgmtClient[]>();
  readonly metaChange = output<MgmtMeta>();

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ManagementService);
  private readonly prefs = inject(PreferencesService);
  private readonly dialog = inject(Dialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly chartBox = viewChild<ElementRef<HTMLElement>>('chart');

  protected readonly periods = PERIODS;
  protected readonly pct = pct;
  protected readonly by = signal<'client' | 'area'>('client');
  protected readonly period = signal<MgmtPeriod>('month');
  protected readonly data = signal<Indicators | null>(null);
  protected readonly error = signal<string | null>(null);
  /** Lo que se compara en el gráfico: id → color (slot fijo mientras esté marcado). */
  protected readonly chosen = signal<Map<string, number>>(new Map());
  protected readonly hover = signal<number | null>(null);
  protected readonly focus = signal<string | null>(null);
  protected readonly width = signal(640);
  protected readonly target = signal('');

  protected readonly series = computed<Series[]>(() => {
    const d = this.data();
    if (!d) return [];
    const out: Series[] = [];
    for (const [id, slot] of this.chosen()) {
      const r = d.rows.find((x) => x.id === id);
      if (r) out.push({ id, name: r.name, color: SLOTS[slot], vals: r.trend });
    }
    return out;
  });

  /** Índices de los meses del período elegido (se sombrean en el gráfico). */
  protected readonly selectedMonths = computed(() => {
    const d = this.data();
    if (!d) return [];
    const n = d.months.length;
    switch (this.period()) {
      case 'prev': return [n - 2];
      case '90': return [n - 3, n - 2, n - 1];
      default: return [n - 1];
    }
  });

  /** Escala del eje: del objetivo menos 15 (o el peor valor) a 100. */
  protected readonly yLo = computed(() => {
    const vals = this.series().flatMap((s) => s.vals.filter((v) => v >= 0));
    const target = this.data()?.slaTarget ?? 95;
    const lo = Math.min(target - 15, ...vals);
    return Math.max(0, Math.floor(lo / 5) * 5);
  });

  protected readonly ticks = computed(() => {
    const lo = this.yLo();
    const step = (100 - lo) / 4 >= 10 ? 10 * Math.ceil((100 - lo) / 40) : 5;
    const out: number[] = [];
    for (let v = lo; v <= 100; v += step) out.push(v);
    return out;
  });

  /** Etiquetas directas al final de cada línea (solo con hasta 4 series). */
  protected readonly direct = computed(() => this.series().length <= 4);
  protected readonly right = computed(() => (this.direct() ? 112 : 14));

  protected readonly below = computed(() => {
    const d = this.data();
    return (d?.rows ?? []).filter((r) => r.slaPct >= 0 && r.slaPct < r.slaTarget);
  });

  protected readonly loadMax = computed(() => Math.max(1, ...(this.data()?.load ?? []).map((l) => l.tickets)));
  protected readonly loadTotal = computed(() => (this.data()?.load ?? []).reduce((n, l) => n + l.tickets, 0));

  constructor() {
    effect(() => {
      this.by();
      this.period();
      untracked(() => void this.load());
    });
    effect(() => this.target.set(String(this.meta().slaTarget)));
    // El gráfico aparece cuando llegan los datos: ahí se empieza a medir su ancho.
    effect(() => {
      const el = this.chartBox()?.nativeElement;
      this.ro?.disconnect();
      if (!el || typeof ResizeObserver === 'undefined') return;
      this.ro = new ResizeObserver(() => this.width.set(Math.max(320, Math.round(el.clientWidth - 16))));
      this.ro.observe(el);
    });
    this.destroyRef.onDestroy(() => this.ro?.disconnect());
  }

  private ro?: ResizeObserver;

  private async load(): Promise<void> {
    try {
      const d = await this.api.indicators(this.by(), this.period());
      const keep = new Map([...this.chosen()].filter(([id]) => d.rows.some((r) => r.id === id)));
      if (!keep.size) {
        // Parte con los de SLA más bajo del período (los que tienen datos).
        const worst = [...d.rows].filter((r) => r.trend.some((v) => v >= 0)).sort((a, b) => this.slaOrder(a) - this.slaOrder(b)).slice(0, MAX_SERIES);
        worst.forEach((r, i) => keep.set(r.id, i));
      }
      this.chosen.set(keep);
      this.data.set(d);
      this.error.set(null);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.loadError')));
    }
  }

  private slaOrder(r: IndicatorRow): number {
    return r.slaPct < 0 ? 1000 : r.slaPct;
  }

  // ===== Geometría =====

  protected x(i: number): number {
    const n = this.data()?.months.length ?? 6;
    const iw = this.width() - M.l - this.right();
    return M.l + (iw * i) / Math.max(1, n - 1);
  }

  protected y(v: number): number {
    const lo = this.yLo();
    const ih = H - M.t - M.b;
    return M.t + (ih * (100 - Math.max(lo, Math.min(100, v)))) / (100 - lo);
  }

  protected half(): number {
    const n = this.data()?.months.length ?? 6;
    return (this.width() - M.l - this.right()) / Math.max(1, n - 1) / 2;
  }

  /** La línea sin cortar los meses sin datos (cada tramo con datos va por separado). */
  protected path(s: Series): string {
    let d = '';
    let pen = false;
    s.vals.forEach((v, i) => {
      if (v < 0) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${this.x(i).toFixed(1)},${this.y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  }

  protected points(s: Series): { i: number; v: number }[] {
    return s.vals.map((v, i) => ({ i, v })).filter((p) => p.v >= 0);
  }

  protected bandX(): number {
    const sel = this.selectedMonths();
    return Math.max(M.l - 6, this.x(sel[0]) - this.half());
  }

  protected bandW(): number {
    const sel = this.selectedMonths();
    return Math.min(this.width() - this.right() + 6, this.x(sel[sel.length - 1]) + this.half()) - this.bandX();
  }

  /** Etiquetas al final, sin pisarse (13 px entre una y otra). */
  protected ends(): { s: Series; y: number; v: number }[] {
    const out = this.series().map((s) => {
      const last = [...s.vals].reverse().find((v) => v >= 0) ?? -1;
      return { s, v: last, y: last >= 0 ? this.y(last) : -1 };
    }).filter((e) => e.v >= 0).sort((a, b) => a.y - b.y);
    for (let i = 1; i < out.length; i++) if (out[i].y - out[i - 1].y < 13) out[i].y = out[i - 1].y + 13;
    return out;
  }

  protected tipRows(i: number): { s: Series; v: number }[] {
    return this.series().map((s) => ({ s, v: s.vals[i] })).filter((r) => r.v >= 0).sort((a, b) => b.v - a.v);
  }

  /** El tooltip va al lado del cursor y no se sale del gráfico. */
  protected tipLeft(i: number): number {
    const px = this.x(i) + 8;
    return px + 12 + 170 > this.width() ? px - 12 - 170 : px + 12;
  }

  protected readonly chartH = H;
  protected readonly mT = M.t;
  protected readonly mB = M.b;
  protected readonly mL = M.l;

  // ===== Textos =====

  protected month(ym: string): string {
    return monthShort(ym, this.prefs.language());
  }

  protected monthTitle(ym: string): string {
    return monthLong(ym, this.prefs.language());
  }

  protected periodKey(p: MgmtPeriod): MessageKey {
    return `mg.p.${p}` as MessageKey;
  }

  protected periodIn(): string {
    return this.i18n.t(`mg.pIn.${this.period()}` as MessageKey);
  }

  protected dur(s: number): string {
    return durationText(s, this.prefs.language());
  }

  protected loadPct(n: number): number {
    const t = this.loadTotal();
    return t ? Math.round((n / t) * 100) : 0;
  }

  // ===== Acciones =====

  protected isChosen(id: string): boolean {
    return this.chosen().has(id);
  }

  protected colorOf(id: string): string | null {
    const slot = this.chosen().get(id);
    return slot === undefined ? null : SLOTS[slot];
  }

  /** Marca o desmarca una fila para el gráfico; el color queda con la fila. */
  protected toggle(id: string): void {
    const next = new Map(this.chosen());
    if (next.has(id)) next.delete(id);
    else {
      if (next.size >= MAX_SERIES) return;
      const used = new Set(next.values());
      next.set(id, [0, 1, 2, 3, 4].find((s) => !used.has(s))!);
    }
    this.chosen.set(next);
    if (this.focus() === id) this.focus.set(null);
  }

  protected setFocus(id: string): void {
    this.focus.set(this.focus() === id ? null : id);
  }

  protected exportSummary(): void {
    const list = this.clients();
    if (!list.length) return;
    const data: ExportDialogData = { clientId: list[0].id, period: this.period(), clients: list.map((c) => ({ id: c.id, name: c.name })) };
    this.dialog.open(ExportDialogComponent, { data, ariaLabel: this.i18n.t('mg.exp.title') });
  }

  protected async saveTarget(): Promise<void> {
    const v = Number(this.target());
    if (!(v >= 50 && v <= 100)) return;
    try {
      const r = await this.api.updateSettings(v);
      this.metaChange.emit({ ...this.meta(), slaTarget: r.slaTarget });
      void this.load();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.saveError')));
    }
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }
}
