import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AssetIp, AssetResponsible, InventoryAsset, InventoryInput, InventoryMeta, InventoryService, IpKind } from '../../core/inventory/inventory.service';
import { TerritoryService } from '../../core/territory/territory.service';
import { OrganizationsService, Organization } from '../../core/organizations/organizations.service';
import { TicketsService, TicketPerson } from '../../core/tickets/tickets.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/inventory';

export const IP_KINDS: IpKind[] = ['network', 'vip', 'management', 'other'];

type WhoKind = 'area' | 'person' | 'org';

/**
 * Alta y edición de un equipo (9.2): los campos cambian con el tipo; varias
 * IP, varios responsables y «otros datos» como pares nombre–valor. El
 * historial de lo que cambió lo arma el servidor al guardar.
 */
@Component({
  selector: 'app-asset-form',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="af" (submit)="$event.preventDefault(); save()">
      <div class="af__head">
        <h2 class="adm-card__title"><mat-icon>{{ asset() ? 'edit' : 'add_circle' }}</mat-icon>{{ asset() ? asset()!.name : i18n.t('inv.new') }}</h2>
      </div>

      <div class="af__body">
        @if (asset()?.glpi) { <p class="adm-hint af__glpi"><mat-icon>cloud_download</mat-icon>{{ i18n.t('inv.glpi.formHint') }}</p> }
        <div class="adm-field">
          <span class="adm-label">{{ i18n.t('inv.f.kind') }}</span>
          <div class="af__kinds">
            @for (k of kinds(); track k.code) {
              <button type="button" class="af__kind" [attr.aria-pressed]="draft().kind === k.code" (click)="set('kind', k.code)"><mat-icon>{{ k.icon }}</mat-icon>{{ k.name }}</button>
            }
          </div>
        </div>

        <div class="af__grid">
          <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.f.name') }}</span>
            <input class="adm-input" name="name" required [value]="draft().name" (input)="set('name', val($event))" /></label>
          <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.f.code') }}</span>
            <input class="adm-input mono" name="code" [disabled]="!!asset()" [value]="draft().code ?? ''" (input)="set('code', val($event))" [placeholder]="slug(draft().name)" /></label>
          <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.f.area') }}</span>
            <select class="adm-input" name="area" [value]="draft().area" (change)="set('area', val($event))">
              @for (a of ownableAreas(); track a.code) { <option [value]="a.code" [selected]="a.code === draft().area">{{ a.name }}</option> }
            </select></label>
        </div>

        @if (fields().length) {
          <span class="adm-label af__sec">{{ i18n.tf('inv.sec.fields', kindName().toLowerCase()) }}</span>
          <div class="af__grid">
            @for (f of fields(); track f.key) {
              <label class="adm-field"><span class="adm-label">{{ f.label }}</span>
                @if (f.kind === 'list') {
                  <select class="adm-input" [name]="'attr-' + f.key" (change)="setAttr(f.key, val($event))">
                    <option value="" [selected]="!draft().attributes[f.key]">{{ i18n.t('inv.f.none') }}</option>
                    @for (o of f.options ?? []; track o) { <option [value]="o" [selected]="draft().attributes[f.key] === o">{{ o }}</option> }
                  </select>
                } @else {
                  <input class="adm-input" [name]="'attr-' + f.key" [type]="f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text'"
                    [value]="draft().attributes[f.key] ?? ''" (input)="setAttr(f.key, val($event))" />
                }
              </label>
            }
          </div>
        }

        <span class="adm-label af__sec">{{ i18n.t('inv.sec.ips') }}</span>
        @for (ip of draft().ips; track $index; let i = $index) {
          <div class="af__row af__row--ip">
            <select class="adm-input" [name]="'ipk-' + i" [attr.aria-label]="i18n.t('inv.f.kind')" (change)="setIp(i, 'kind', val($event))">
              @for (k of ipKinds; track k) { <option [value]="k" [selected]="ip.kind === k">{{ i18n.t(ipLabel(k)) }}</option> }
            </select>
            <input class="adm-input mono" [name]="'ipa-' + i" [placeholder]="i18n.t('inv.ip.address')" [attr.aria-label]="i18n.t('inv.ip.address')" [value]="ip.address" (input)="setIp(i, 'address', val($event))" />
            <input class="adm-input" [name]="'ipn-' + i" [placeholder]="i18n.t('inv.ip.note')" [attr.aria-label]="i18n.t('inv.ip.note')" [value]="ip.note ?? ''" (input)="setIp(i, 'note', val($event))" />
            <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('inv.remove')" (click)="removeIp(i)"><mat-icon>close</mat-icon></button>
          </div>
        }
        <button type="button" class="adm-btn af__add" (click)="addIp()"><mat-icon>add</mat-icon>{{ i18n.t('inv.ip.add') }}</button>

        <span class="adm-label af__sec">{{ i18n.t('inv.sec.responsibles') }}</span>
        @for (r of draft().responsibles; track $index; let i = $index) {
          <div class="af__row af__row--resp">
            <select class="adm-input" [name]="'rt-' + i" [attr.aria-label]="i18n.t('inv.resp.what')" (change)="setResp(i, { type: val($event) })">
              @for (t of respTypes(); track t.code) { <option [value]="t.code" [selected]="r.type === t.code">{{ t.name }}</option> }
            </select>
            <select class="adm-input" [name]="'rw-' + i" (change)="setWho(i, $any(val($event)))">
              <option value="area" [selected]="who(r) === 'area'">{{ i18n.t('inv.resp.area') }}</option>
              @if (people().length) { <option value="person" [selected]="who(r) === 'person'">{{ i18n.t('inv.resp.person') }}</option> }
              <option value="org" [selected]="who(r) === 'org'">{{ i18n.t('inv.resp.org') }}</option>
            </select>
            @switch (who(r)) {
              @case ('area') {
                <select class="adm-input" [name]="'rv-' + i" (change)="setResp(i, { area: val($event) })">
                  @for (a of meta().areas; track a.code) { <option [value]="a.code" [selected]="r.area === a.code">{{ a.name }}</option> }
                </select>
              }
              @case ('person') {
                <select class="adm-input" [name]="'rv-' + i" (change)="setResp(i, { userId: val($event) })">
                  @for (p of people(); track p.userId) { <option [value]="p.userId" [selected]="r.userId === p.userId">{{ p.fullName || p.username }}</option> }
                </select>
              }
              @case ('org') {
                <select class="adm-input" [name]="'rv-' + i" (change)="setResp(i, { organizationId: val($event) })">
                  @for (o of orgs(); track o.id) { <option [value]="o.id" [selected]="r.organizationId === o.id">{{ o.name }}</option> }
                </select>
              }
            }
            <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('inv.remove')" (click)="removeResp(i)"><mat-icon>close</mat-icon></button>
          </div>
        }
        <button type="button" class="adm-btn af__add" (click)="addResp()"><mat-icon>add</mat-icon>{{ i18n.t('inv.resp.add') }}</button>

        <span class="adm-label af__sec">{{ i18n.t('inv.sec.ident') }}</span>
        <div class="af__grid">
          <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.f.model') }}</span><input class="adm-input" name="model" [value]="draft().model ?? ''" (input)="set('model', val($event))" /></label>
          <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.f.serial') }}</span><input class="adm-input mono" name="serial" [value]="draft().serial ?? ''" (input)="set('serial', val($event))" /></label>
          <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.f.client') }}</span>
            <select class="adm-input" name="client" (change)="set('clientId', val($event) || undefined)">
              <option value="" [selected]="!draft().clientId">{{ i18n.t('inv.f.none') }}</option>
              @for (o of orgs(); track o.id) { <option [value]="o.id" [selected]="draft().clientId === o.id">{{ o.name }}</option> }
            </select></label>
          <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.f.place') }}</span>
            <input class="adm-input" name="place" list="inv-places" [value]="placeText()" (change)="setPlace(val($event))" [placeholder]="i18n.t('inv.f.placeHint')" />
            <datalist id="inv-places">@for (u of units(); track u.id) { <option [value]="u.label"></option> }</datalist></label>
          <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.f.rack') }}</span><input class="adm-input" name="rack" [value]="draft().rack ?? ''" (input)="set('rack', val($event))" /></label>
          <label class="adm-field"><span class="adm-label">{{ i18n.t('inv.f.position') }}</span><input class="adm-input" name="rackPosition" [value]="draft().rackPosition ?? ''" (input)="set('rackPosition', val($event))" /></label>
        </div>

        <span class="adm-label af__sec">{{ i18n.t('inv.sec.extra') }}</span>
        @for (e of extra(); track $index; let i = $index) {
          <div class="af__row af__row--extra">
            <input class="adm-input" [name]="'exk-' + i" [placeholder]="i18n.t('inv.extra.key')" [attr.aria-label]="i18n.t('inv.extra.key')" [value]="e[0]" (input)="setExtra(i, 0, val($event))" />
            <input class="adm-input" [name]="'exv-' + i" [placeholder]="i18n.t('inv.extra.value')" [attr.aria-label]="i18n.t('inv.extra.value')" [value]="e[1]" (input)="setExtra(i, 1, val($event))" />
            <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('inv.remove')" (click)="removeExtra(i)"><mat-icon>close</mat-icon></button>
          </div>
        }
        <button type="button" class="adm-btn af__add" (click)="addExtra()"><mat-icon>add</mat-icon>{{ i18n.t('inv.extra.add') }}</button>

        @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }
        <div class="af__actions">
          <button type="button" class="adm-btn" (click)="cancelled.emit()">{{ i18n.t('inv.cancel') }}</button>
          <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !draft().name.trim()"><mat-icon>save</mat-icon>{{ i18n.t(asset() ? 'inv.save' : 'inv.create') }}</button>
        </div>
      </div>
    </form>
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .af__head { padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); }
    .af__body { display: flex; flex-direction: column; gap: 10px; padding: 12px 16px 16px; }
    .af__sec { margin-top: 6px; }
    .af__glpi { display: flex; gap: 6px; align-items: flex-start; margin: 0; }
    .af__glpi mat-icon { flex: none; width: 15px; height: 15px; font-size: 15px; color: var(--status-carrier); }
    .af__kinds { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; }
    .af__kind { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 4px; border: 2px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); color: var(--text-primary); font: inherit; font-size: 11.5px; cursor: pointer; }
    .af__kind mat-icon { width: 20px; height: 20px; font-size: 20px; color: var(--text-secondary); }
    .af__kind[aria-pressed="true"] { border-color: var(--accent); }
    .af__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
    .af__row { display: grid; gap: 8px; align-items: center; }
    .af__row--ip { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1.2fr) 30px; }
    .af__row--resp { grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr) minmax(0, 1.4fr) 30px; }
    .af__row--extra { grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr) 30px; }
    .af__add { align-self: flex-start; }
    .af__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
    @media (width <= 700px) { .af__row--ip, .af__row--resp, .af__row--extra { grid-template-columns: minmax(0, 1fr) 30px; } }
  `,
})
export class AssetFormComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(InventoryService);
  private readonly territory = inject(TerritoryService);
  private readonly orgsApi = inject(OrganizationsService);
  private readonly tickets = inject(TicketsService);

  readonly meta = input.required<InventoryMeta>();
  /** null = equipo nuevo. */
  readonly asset = input<InventoryAsset | null>(null);
  readonly saved = output<InventoryAsset>();
  readonly cancelled = output<void>();

  protected readonly ipKinds = IP_KINDS;
  protected readonly draft = signal<InventoryInput>({ kind: 'server', name: '', area: '', attributes: {}, extra: {}, ips: [], responsibles: [] });
  protected readonly extra = signal<[string, string][]>([]);
  protected readonly units = signal<{ id: string; label: string }[]>([]);
  protected readonly orgs = signal<Organization[]>([]);
  protected readonly people = signal<TicketPerson[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly kinds = computed(() => this.meta().kinds.filter((k) => k.active || k.code === this.draft().kind));
  protected readonly fields = computed(() => this.meta().kinds.find((k) => k.code === this.draft().kind)?.fields ?? []);
  protected readonly kindName = computed(() => this.meta().kinds.find((k) => k.code === this.draft().kind)?.name ?? '');
  protected readonly respTypes = computed(() => this.meta().responsibleTypes.filter((t) => t.active));
  /** Dueña: el admin elige cualquiera; los demás, una de sus áreas (o la que ya tiene). */
  protected readonly ownableAreas = computed(() => {
    const m = this.meta();
    return m.admin ? m.areas : m.areas.filter((a) => m.myAreas.includes(a.code) || a.code === this.asset()?.area);
  });
  protected readonly placeText = computed(() => this.units().find((u) => u.id === this.draft().territorialUnitId)?.label ?? this.asset()?.placeName ?? '');

  async ngOnInit(): Promise<void> {
    const a = this.asset();
    if (a) {
      this.draft.set({
        kind: a.kind, name: a.name, code: a.code, area: a.area, territorialUnitId: a.territorialUnitId, clientId: a.clientId,
        model: a.model, serial: a.serial, rack: a.rack, rackPosition: a.rackPosition, attributes: { ...a.attributes }, extra: { ...a.extra },
        ips: a.ips.map((ip) => ({ ...ip })), responsibles: a.responsibles.map((r) => ({ type: r.type, area: r.area, userId: r.userId, organizationId: r.organizationId })),
      });
      this.extra.set(Object.entries(a.extra));
    } else {
      const m = this.meta();
      this.draft.update((d) => ({ ...d, kind: m.kinds.find((k) => k.active)?.code ?? 'server', area: this.ownableAreas()[0]?.code ?? '' }));
    }
    const [units, orgs, people] = await Promise.all([
      this.territory.list(1, 5000).then((r) => r.units).catch(() => []),
      this.orgsApi.list({ active: true }).catch(() => []),
      this.tickets.assignees().catch(() => []),
    ]);
    const nameOf = new Map(units.map((u) => [u.id, u.name]));
    this.units.set(units.filter((u) => u.active && u.kind !== 'country').map((u) => ({ id: u.id, label: u.parentId ? `${u.name} · ${nameOf.get(u.parentId) ?? ''}` : u.name })));
    this.orgs.set(orgs);
    this.people.set(people);
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected slug(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  protected ipLabel(k: IpKind): MessageKey {
    return `inv.ip.${k}` as MessageKey;
  }

  protected set<K extends keyof InventoryInput>(key: K, value: InventoryInput[K]): void {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  protected setAttr(key: string, value: string): void {
    this.draft.update((d) => ({ ...d, attributes: { ...d.attributes, [key]: value } }));
  }

  protected setPlace(label: string): void {
    const u = this.units().find((x) => x.label === label.trim());
    this.set('territorialUnitId', label.trim() ? u?.id : undefined);
  }

  protected addIp(): void {
    this.draft.update((d) => ({ ...d, ips: [...d.ips, { kind: d.ips.length < 2 ? 'network' : 'management', address: '' }] }));
  }

  protected setIp(i: number, key: keyof AssetIp, value: string): void {
    this.draft.update((d) => ({ ...d, ips: d.ips.map((ip, j) => (j === i ? { ...ip, [key]: value } : ip)) }));
  }

  protected removeIp(i: number): void {
    this.draft.update((d) => ({ ...d, ips: d.ips.filter((_, j) => j !== i) }));
  }

  protected who(r: AssetResponsible): WhoKind {
    return r.userId ? 'person' : r.organizationId ? 'org' : 'area';
  }

  protected addResp(): void {
    const type = this.respTypes()[0]?.code ?? 'config';
    this.draft.update((d) => ({ ...d, responsibles: [...d.responsibles, { type, area: this.meta().areas[0]?.code }] }));
  }

  protected setResp(i: number, patch: Partial<AssetResponsible>): void {
    this.draft.update((d) => ({ ...d, responsibles: d.responsibles.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  }

  protected setWho(i: number, kind: WhoKind): void {
    const first = { area: { area: this.meta().areas[0]?.code }, person: { userId: this.people()[0]?.userId }, org: { organizationId: this.orgs()[0]?.id } }[kind];
    this.draft.update((d) => ({ ...d, responsibles: d.responsibles.map((r, j) => (j === i ? { type: r.type, ...first } : r)) }));
  }

  protected removeResp(i: number): void {
    this.draft.update((d) => ({ ...d, responsibles: d.responsibles.filter((_, j) => j !== i) }));
  }

  protected addExtra(): void {
    this.extra.update((e) => [...e, ['', '']]);
  }

  protected setExtra(i: number, pos: 0 | 1, value: string): void {
    this.extra.update((e) => e.map((pair, j) => (j === i ? ((pos === 0 ? [value, pair[1]] : [pair[0], value]) as [string, string]) : pair)));
  }

  protected removeExtra(i: number): void {
    this.extra.update((e) => e.filter((_, j) => j !== i));
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    const input: InventoryInput = {
      ...d,
      ips: d.ips.filter((ip) => ip.address.trim()),
      extra: Object.fromEntries(this.extra().filter(([k, v]) => k.trim() && v.trim())),
      attributes: Object.fromEntries(Object.entries(d.attributes).filter(([, v]) => String(v).trim())),
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      const a = this.asset();
      this.saved.emit(a ? await this.api.update(a.id, input) : await this.api.create(input));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('inv.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
