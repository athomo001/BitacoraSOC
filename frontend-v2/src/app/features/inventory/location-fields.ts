import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';

import '../../core/i18n/packs/inventory';

/** Lo que se guarda de un lugar: localidad, dirección y coordenadas (todo opcional). */
export interface PlaceValue {
  territorialUnitId?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export interface PlaceOption { id: string; label: string; }

/**
 * «-33.4489, -70.6693» (lo que copia Google Maps o OpenStreetMap), también
 * con «;» o espacio entre ambas y coma decimal si va con «;». Vacío = sin
 * coordenadas; null = no se entiende o está fuera de rango.
 */
export function parseCoords(text: string): { latitude?: number; longitude?: number } | null {
  const t = text.trim();
  if (!t) return {};
  const parts = t.includes(';') ? t.split(';').map((p) => p.trim().replace(',', '.')) : t.split(/\s*,\s*|\s+/);
  if (parts.length !== 2 || parts.some((p) => !/^-?\d+(\.\d+)?$/.test(p))) return null;
  const [latitude, longitude] = parts.map(Number);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function coordsLabel(lat?: number, lng?: number): string {
  return lat == null || lng == null ? '' : `${lat}, ${lng}`;
}

/**
 * Localidad, dirección y coordenadas de un equipo o de un grupo. Las
 * coordenadas van en un solo campo para pegarlas tal como las copia un mapa.
 * Con `locked`, se muestran sin editar (el equipo las toma de su grupo).
 */
@Component({
  selector: 'app-location-fields',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.f.place') }}</span>
      <input class="adm-input" name="place" [attr.list]="listId" [value]="placeText()" [disabled]="locked()" (change)="setPlace(val($event))" [placeholder]="locked() ? '' : i18n.t('inv.f.placeHint')" />
      <datalist [id]="listId">@for (u of units(); track u.id) { <option [value]="u.label"></option> }</datalist></label>
    <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.f.address') }}</span>
      <input class="adm-input" name="address" maxlength="300" [value]="value().address ?? ''" [disabled]="locked()" (input)="emit({ address: val($event) })" /></label>
    <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.f.coords') }}</span>
      <input class="adm-input mono" name="coords" [value]="coordsText()" [disabled]="locked()" placeholder="-33.4489, -70.6693"
        [attr.aria-invalid]="badCoords() !== null" (change)="setCoords(val($event))" />
      @if (badCoords() !== null) { <span class="adm-small lf__bad" role="alert">{{ i18n.t('inv.f.coordsBad') }}</span> }</label>
  `,
  styles: `
    :host { display: contents; }
    .lf__bad { color: var(--status-critical); }
  `,
})
export class LocationFieldsComponent {
  protected readonly i18n = inject(I18nService);

  readonly value = input.required<PlaceValue>();
  readonly units = input.required<PlaceOption[]>();
  readonly locked = input(false);
  /** Solo lo que cambió: el formulario lo suma a lo suyo. */
  readonly valueChange = output<Partial<PlaceValue>>();
  /** false mientras las coordenadas escritas no se entiendan (el formulario no guarda). */
  readonly validChange = output<boolean>();

  private static seq = 0;
  protected readonly listId = `loc-places-${++LocationFieldsComponent.seq}`;
  /** Lo escrito que no se entiende: se deja a la vista para corregirlo. */
  protected readonly badCoords = signal<string | null>(null);

  protected readonly placeText = computed(() => this.units().find((u) => u.id === this.value().territorialUnitId)?.label ?? '');
  protected readonly coordsText = computed(() => this.badCoords() ?? coordsLabel(this.value().latitude, this.value().longitude));

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected emit(patch: Partial<PlaceValue>): void {
    this.valueChange.emit(patch);
  }

  protected setPlace(label: string): void {
    const u = this.units().find((x) => x.label === label.trim());
    this.emit({ territorialUnitId: label.trim() ? u?.id : undefined });
  }

  protected setCoords(text: string): void {
    const c = parseCoords(text);
    this.badCoords.set(c ? null : text);
    this.validChange.emit(!!c);
    if (c) this.emit({ latitude: c.latitude, longitude: c.longitude });
  }
}
