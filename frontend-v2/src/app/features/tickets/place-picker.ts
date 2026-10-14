import { ChangeDetectionStrategy, Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TerritoryService } from '../../core/territory/territory.service';
import { TerritorialUnit } from '../../core/territory/territory.models';
import { Asset, EscalationService } from '../../core/escalation/escalation.service';
import { TicketPlace } from '../../core/tickets/tickets.service';
import { I18nService } from '../../core/i18n/i18n.service';

import '../../core/i18n/packs/tickets';

const MAX_SHOWN = 6;

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** "Calama · RT-CAL-06" o "Calama". */
export function placeLabel(p: TicketPlace): string {
  if (!p.name) return p.assetName ?? '';
  return p.assetName ? `${p.name} · ${p.assetName}` : p.name;
}

/**
 * Buscador del lugar de un ticket (#24, 7b): localidades del Territorio y
 * activos en una sola lista. Con un activo, la localidad sale del activo.
 * Lo usan el alta del ticket y su panel.
 */
@Component({
  selector: 'app-place-picker',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pp">
      <label class="pp__q">
        <mat-icon>search</mat-icon>
        <input #q type="search" name="placeSearch" autocomplete="off" [placeholder]="i18n.t('tickets.place.search')" [attr.aria-label]="i18n.t('tickets.place.search')"
          (input)="query.set(q.value)" (keydown.enter)="$event.preventDefault(); pickFirst()" />
      </label>
      @if (query().trim()) {
        <div class="pp__list">
          @if (units().length) { <div class="pp__grp">{{ i18n.t('tickets.place.units') }}</div> }
          @for (u of units(); track u.id) {
            <button type="button" class="pp__opt" (click)="pickUnit(u)">
              <mat-icon>place</mat-icon><span class="pp__name">{{ u.name }}</span><span class="pp__hint">{{ parentName(u.parentId) }}</span>
            </button>
          }
          @if (assets().length) { <div class="pp__grp">{{ i18n.t('tickets.place.assets') }}</div> }
          @for (a of assets(); track a.id) {
            <button type="button" class="pp__opt" (click)="pickAsset(a)">
              <mat-icon>router</mat-icon><span class="pp__name mono">{{ a.name }}</span><span class="pp__hint">{{ unitName(a.territorialUnitId) }}</span>
            </button>
          }
          @if (!units().length && !assets().length) { <p class="pp__none">{{ i18n.t('tickets.place.none') }}</p> }
        </div>
      }
    </div>
  `,
  styles: `
    .pp { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); }
    .pp:focus-within { border-color: var(--accent); }
    .pp__q { display: flex; align-items: center; gap: 6px; padding: 0 9px; color: var(--text-muted); }
    .pp__q mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .pp__q input { flex: 1; min-width: 0; min-height: 30px; border: none; outline: none; background: transparent; color: var(--text-primary); font: inherit; font-size: 12.5px; }
    .pp__list { max-height: 260px; overflow: auto; border-top: 1px solid var(--border-subtle); }
    .pp__grp { padding: 6px 10px 2px; color: var(--text-muted); font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
    .pp__opt { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; gap: 8px; align-items: center; width: 100%; padding: 6px 10px; border: none; background: transparent; color: var(--text-primary); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
    .pp__opt:hover, .pp__opt:focus-visible { background: var(--bg-surface-hover); outline: none; }
    .pp__opt mat-icon { width: 16px; height: 16px; font-size: 16px; color: var(--text-muted); }
    .pp__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pp__hint { color: var(--text-muted); font-size: 11px; }
    .pp__none { margin: 0; padding: 10px; color: var(--text-muted); font-size: 12px; }
  `,
})
export class PlacePickerComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly territory = inject(TerritoryService);
  private readonly escalation = inject(EscalationService);

  readonly picked = output<{ territorialUnitId?: string; assetId?: string; place: TicketPlace }>();

  protected readonly query = signal('');
  private readonly allUnits = signal<TerritorialUnit[]>([]);
  private readonly allAssets = signal<Asset[]>([]);
  private readonly byId = computed(() => new Map(this.allUnits().map((u) => [u.id, u])));

  protected readonly units = computed(() => {
    const q = normalize(this.query().trim());
    if (!q) return [];
    return this.allUnits().filter((u) => u.active && u.kind !== 'country' && normalize(u.name).includes(q)).slice(0, MAX_SHOWN);
  });
  protected readonly assets = computed(() => {
    const q = normalize(this.query().trim());
    if (!q) return [];
    return this.allAssets().filter((a) => normalize(`${a.name} ${a.code} ${this.unitName(a.territorialUnitId)}`).includes(q)).slice(0, MAX_SHOWN);
  });

  async ngOnInit(): Promise<void> {
    const [units, assets] = await Promise.all([
      this.territory.list(1, 5000).then((r) => r.units).catch(() => []),
      this.escalation.listAssets().catch(() => []),
    ]);
    this.allUnits.set(units);
    this.allAssets.set(assets);
  }

  protected unitName(id: string | null | undefined): string {
    return (id && this.byId().get(id)?.name) || '';
  }

  protected parentName(id: string | null): string {
    return this.unitName(id);
  }

  protected pickUnit(u: TerritorialUnit): void {
    this.picked.emit({ territorialUnitId: u.id, place: { territorialUnitId: u.id, name: u.name, parentName: this.parentName(u.parentId) || undefined } });
  }

  protected pickAsset(a: Asset): void {
    const unit = a.territorialUnitId ? this.byId().get(a.territorialUnitId) : undefined;
    this.picked.emit({
      assetId: a.id,
      place: { territorialUnitId: a.territorialUnitId || undefined, name: unit?.name ?? '', parentName: this.parentName(unit?.parentId ?? null) || undefined, assetId: a.id, assetName: a.name },
    });
  }

  protected pickFirst(): void {
    const u = this.units()[0];
    if (u) this.pickUnit(u);
    else if (this.assets()[0]) this.pickAsset(this.assets()[0]);
  }
}
