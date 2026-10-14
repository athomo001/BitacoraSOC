import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AssetKind, InventoryMeta, InventoryService, KindField } from '../../core/inventory/inventory.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/admin';
import '../../core/i18n/packs/inventory';

const FIELD_KINDS: KindField['kind'][] = ['text', 'number', 'list', 'date'];

/**
 * Administración → Inventario (9.2): qué datos tiene cada tipo de equipo
 * (un switch no tiene los mismos que un servidor) y la lista de tipos de
 * responsabilidad. Quitar un campo no borra lo ya cargado.
 */
@Component({
  selector: 'app-admin-inventory',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="adm-head">
      <div>
        <h2 class="adm-title">{{ i18n.t('invAdmin.title') }}</h2>
        <p class="adm-muted">{{ i18n.t('invAdmin.subtitle') }}</p>
      </div>
    </header>
    @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }

    <div class="ai__grid">
      <section class="adm-card">
        <div class="adm-card__head">
          <h3 class="adm-card__title"><mat-icon>category</mat-icon>{{ i18n.t('invAdmin.kinds') }}</h3>
          <button type="button" class="adm-btn adm-push" (click)="newKind()"><mat-icon>add</mat-icon>{{ i18n.t('invAdmin.newKind') }}</button>
        </div>
        @for (k of kinds(); track k.code) {
          <button type="button" class="ai__kind" [attr.aria-current]="k.code === draft()?.code" (click)="pick(k)">
            <mat-icon>{{ k.icon }}</mat-icon><b>{{ k.name }}</b>
            <span class="adm-small adm-secondary adm-push">{{ k.fields.length }}</span>
          </button>
        }
      </section>

      <section class="adm-card">
        @if (draft(); as d) {
          <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>{{ d.icon || 'category' }}</mat-icon>{{ i18n.tf('invAdmin.fieldsOf', (d.name || '…').toLowerCase()) }}</h3></div>
          <div class="adm-card__body ai__body">
            <div class="ai__row ai__row--kind">
              <label class="adm-field"><span class="adm-label">{{ i18n.t('invAdmin.kindName') }}</span><input class="adm-input" name="kindName" [value]="d.name" (input)="patch({ name: val($event) })" /></label>
              <label class="adm-field"><span class="adm-label">{{ i18n.t('invAdmin.icon') }}</span><input class="adm-input mono" name="kindIcon" [value]="d.icon" (input)="patch({ icon: val($event) })" /></label>
            </div>
            <div class="ai__row ai__row--field ai__row--head"><span>{{ i18n.t('invAdmin.field') }}</span><span>{{ i18n.t('invAdmin.fieldKind') }}</span><span>{{ i18n.t('invAdmin.options') }}</span><span></span></div>
            @for (f of d.fields; track $index; let i = $index) {
              <div class="ai__row ai__row--field">
                <input class="adm-input" [name]="'fl-' + i" [attr.aria-label]="i18n.t('invAdmin.field')" [value]="f.label" (input)="setField(i, { label: val($event) })" />
                <select class="adm-input" [name]="'fk-' + i" [attr.aria-label]="i18n.t('invAdmin.fieldKind')" (change)="setField(i, { kind: $any(val($event)) })">
                  @for (k of fieldKinds; track k) { <option [value]="k" [selected]="f.kind === k">{{ i18n.t(kindLabel(k)) }}</option> }
                </select>
                <input class="adm-input" [name]="'fo-' + i" [attr.aria-label]="i18n.t('invAdmin.options')" [disabled]="f.kind !== 'list'" [value]="(f.options ?? []).join(', ')" (change)="setOptions(i, val($event))" />
                <span class="ai__btns">
                  <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('invAdmin.up')" [disabled]="i === 0" (click)="move(i, -1)"><mat-icon>arrow_upward</mat-icon></button>
                  <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('inv.remove')" (click)="removeField(i)"><mat-icon>close</mat-icon></button>
                </span>
              </div>
            }
            <button type="button" class="adm-btn ai__add" (click)="addField()"><mat-icon>add</mat-icon>{{ i18n.t('invAdmin.addField') }}</button>
            <p class="adm-hint">{{ i18n.t('invAdmin.common') }}</p>
            <div class="ai__actions">
              @if (notice(); as n) { <span class="pill tone-ok" role="status">{{ n }}</span> }
              <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy() || !d.name.trim()" (click)="saveKind()"><mat-icon>save</mat-icon>{{ i18n.t('invAdmin.save') }}</button>
            </div>
          </div>
        }
      </section>
    </div>

    <section class="adm-card">
      <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>badge</mat-icon>{{ i18n.t('invAdmin.respTypes') }}</h3></div>
      <div class="adm-card__body ai__body">
        @for (t of meta()?.responsibleTypes ?? []; track t.code) {
          <div class="ai__row ai__row--resp">
            <input class="adm-input" [name]="'rt-' + t.code" [value]="t.name" [attr.aria-label]="t.name" (change)="saveResp(t.code, val($event), t.active)" />
            <label class="ai__check"><input type="checkbox" [name]="'ra-' + t.code" [checked]="t.active" (change)="saveResp(t.code, t.name, $any($event.target).checked)" />{{ i18n.t('invAdmin.active') }}</label>
          </div>
        }
        <div class="ai__row ai__row--resp">
          <input #nr class="adm-input" name="newResp" [placeholder]="i18n.t('invAdmin.respNew')" [attr.aria-label]="i18n.t('invAdmin.respNew')" />
          <button type="button" class="adm-btn" (click)="addResp(nr.value); nr.value = ''"><mat-icon>add</mat-icon>{{ i18n.t('invAdmin.respAdd') }}</button>
        </div>
      </div>
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ai__grid { display: grid; grid-template-columns: minmax(0, 0.7fr) minmax(0, 1.6fr); gap: 16px; align-items: start; }
    .ai__kind { display: flex; align-items: center; gap: 8px; width: 100%; padding: 9px 14px; border: none; border-bottom: 1px solid var(--border-subtle); background: transparent; color: var(--text-primary); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
    .ai__kind:hover { background: var(--bg-surface-hover); }
    .ai__kind[aria-current="true"] { background: var(--accent-soft); }
    .ai__body { display: flex; flex-direction: column; gap: 8px; }
    .ai__row { display: grid; gap: 8px; align-items: center; }
    .ai__row--kind { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .ai__row--field { grid-template-columns: minmax(0, 1.3fr) 110px minmax(0, 1.5fr) 64px; }
    .ai__row--head { color: var(--text-muted); font-size: 10.5px; font-weight: 700; text-transform: uppercase; }
    .ai__row--resp { grid-template-columns: minmax(0, 1fr) auto; max-width: 520px; }
    .ai__btns { display: flex; }
    .ai__add { align-self: flex-start; }
    .ai__actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
    .ai__check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
    @media (width <= 1100px) { .ai__grid { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class AdminInventoryComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(InventoryService);

  protected readonly meta = signal<InventoryMeta | null>(null);
  protected readonly kinds = computed(() => this.meta()?.kinds ?? []);
  protected readonly draft = signal<AssetKind | null>(null);
  protected readonly fieldKinds = FIELD_KINDS;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.reload();
    const first = this.kinds()[0];
    if (first) this.pick(first);
  }

  private async reload(): Promise<void> {
    try {
      this.meta.set(await this.api.meta());
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('inv.loadError')));
    }
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected kindLabel(k: KindField['kind']): MessageKey {
    return `invAdmin.kind.${k}` as MessageKey;
  }

  protected pick(k: AssetKind): void {
    this.notice.set(null);
    this.draft.set({ ...k, fields: k.fields.map((f) => ({ ...f, options: f.options ? [...f.options] : undefined })) });
  }

  protected newKind(): void {
    this.notice.set(null);
    this.draft.set({ code: '', name: '', icon: 'category', baseType: 'device', fields: [], sortOrder: 100, active: true });
  }

  protected patch(p: Partial<AssetKind>): void {
    this.draft.update((d) => (d ? { ...d, ...p } : d));
  }

  protected setField(i: number, p: Partial<KindField>): void {
    this.draft.update((d) => (d ? { ...d, fields: d.fields.map((f, j) => (j === i ? { ...f, ...p } : f)) } : d));
  }

  protected setOptions(i: number, raw: string): void {
    this.setField(i, { options: raw.split(',').map((o) => o.trim()).filter(Boolean) });
  }

  protected addField(): void {
    this.draft.update((d) => (d ? { ...d, fields: [...d.fields, { key: '', label: '', kind: 'text' }] } : d));
  }

  protected removeField(i: number): void {
    this.draft.update((d) => (d ? { ...d, fields: d.fields.filter((_, j) => j !== i) } : d));
  }

  protected move(i: number, delta: number): void {
    this.draft.update((d) => {
      if (!d) return d;
      const fields = [...d.fields];
      [fields[i + delta], fields[i]] = [fields[i], fields[i + delta]];
      return { ...d, fields };
    });
  }

  private slug(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  protected async saveKind(): Promise<void> {
    const d = this.draft();
    if (!d) return;
    const code = d.code || this.slug(d.name);
    this.busy.set(true);
    this.error.set(null);
    try {
      const saved = await this.api.saveKind({ ...d, code, fields: d.fields.filter((f) => f.label.trim()) });
      await this.reload();
      this.pick(saved);
      this.notice.set(this.i18n.t('invAdmin.saved'));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('inv.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveResp(code: string, name: string, active: boolean): Promise<void> {
    if (!name.trim()) return;
    try {
      await this.api.saveResponsibleType(code, name.trim(), active);
      await this.reload();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('inv.saveError')));
    }
  }

  protected async addResp(name: string): Promise<void> {
    if (!name.trim()) return;
    await this.saveResp(this.slug(name), name, true);
  }
}
