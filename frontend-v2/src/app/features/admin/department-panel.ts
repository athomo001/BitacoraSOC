import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../../core/auth/auth.models';
import { Area, AreaPerson, AreasService, Department, Level } from '../../core/areas/areas.service';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';

import '../../core/i18n/packs/departments';

type DeptTab = 'areas' | 'leads' | 'shared' | 'csm';
interface UserOption { id: string; username: string; fullName?: string; active: boolean; }

/**
 * Administración → Departamentos y áreas → un departamento (spec/16 §3.5.1,
 * diseño aprobado por el dueño 2026-10-22): sus áreas, su jefatura (jefatura
 * de todas sus áreas) y las áreas que comparten equipo.
 */
@Component({
  selector: 'app-department-panel',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = department();
    <section class="adm-card">
      <div class="adm-card__head">
        @if (renaming()) {
          <input class="adm-input dp__name" [attr.aria-label]="i18n.t('dep.rename')" maxlength="60" [ngModel]="renameTo()" (ngModelChange)="renameTo.set($event)" (keydown.enter)="rename()" (keydown.escape)="renaming.set(false)" (blur)="rename()" />
        } @else {
          <h3 class="adm-card__title"><mat-icon>domain</mat-icon>{{ i18n.tf('dep.heading', d.name) }}
            <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('dep.rename')" (click)="renameTo.set(d.name); renaming.set(true)"><mat-icon>edit</mat-icon></button>
          </h3>
        }
        <span class="adm-small adm-muted">{{ summary() }}</span>
        <button type="button" class="adm-btn adm-btn--danger adm-push" [disabled]="busy()" (click)="confirmDelete.set(true)"><mat-icon>delete</mat-icon>{{ i18n.t('dep.delete') }}</button>
      </div>
      @if (confirmDelete()) {
        <div class="dp__confirm" role="alert">
          <span>{{ i18n.tf('dep.confirmDelete', d.name) }}</span>
          <button type="button" class="adm-btn" (click)="confirmDelete.set(false)">{{ i18n.t('dep.cancel') }}</button>
          <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy()" (click)="remove()">{{ i18n.t('dep.delete') }}</button>
        </div>
      }
      <div class="dp__tabs" role="tablist">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" class="seg" [attr.aria-selected]="tab() === t.id" [attr.aria-pressed]="tab() === t.id" (click)="tab.set(t.id)"><mat-icon>{{ t.icon }}</mat-icon>{{ i18n.t(t.label) }}</button>
        }
      </div>
      @if (error(); as e) { <p class="adm-error dp__pad" role="alert">{{ e }}</p> }

      @if (tab() === 'areas') {
        @for (a of deptAreas(); track a.code) {
          <div class="dp__row">
            <strong class="dp__w130">{{ a.name }}</strong>
            <span class="adm-small adm-muted dp__w90">{{ i18n.t(profileKey(a.profile)) }}</span>
            <span class="adm-small dp__grow dp__sec">{{ peopleText(a.code) }}</span>
            @if (sharesWith(a.code); as others) { <span class="dp__link"><mat-icon>link</mat-icon>{{ i18n.tf('dep.sharesWith', others) }}</span> }
            <button type="button" class="adm-icon-btn" [disabled]="busy()" [attr.aria-label]="i18n.tf('dep.removeArea', a.name)" (click)="setAreas(without(d.areas, a.code))"><mat-icon>close</mat-icon></button>
          </div>
        }
        <div class="dp__add">
          <span class="adm-small adm-muted">{{ i18n.t('dep.addArea') }}</span>
          @for (a of looseAreas(); track a.code) {
            <button type="button" class="seg" [disabled]="busy()" (click)="setAreas(d.areas.concat([a.code]))"><mat-icon>add</mat-icon>{{ a.name }}</button>
          } @empty {
            <span class="adm-small adm-muted">{{ i18n.t('dep.allPlaced') }}</span>
          }
        </div>
        <p class="adm-card__note">{{ i18n.t('dep.areasHint') }}</p>
      } @else if (tab() === 'leads') {
        <p class="dp__pad dp__sec">{{ i18n.t('dep.leadsHint') }}</p>
        @for (l of d.leads; track l.id) {
          <div class="dp__row">
            <mat-icon class="dp__lead">workspace_premium</mat-icon>
            <strong class="dp__grow">{{ l.name }}</strong>
            <span class="adm-small adm-muted">{{ i18n.tf('dep.leadOf', areaNames(d.areas)) }}</span>
            <button type="button" class="adm-icon-btn" [disabled]="busy()" [attr.aria-label]="i18n.tf('dep.removeLead', l.name)" (click)="setLeads(withoutId(d.leads, l.id))"><mat-icon>close</mat-icon></button>
          </div>
        } @empty {
          <p class="adm-empty">{{ i18n.t('dep.noLeads') }}</p>
        }
        <div class="dp__add">
          <select class="adm-input dp__select" name="newLead" [attr.aria-label]="i18n.t('dep.addLead')" [ngModel]="newLead()" (ngModelChange)="newLead.set($event)">
            <option value="">{{ i18n.t('dep.pickLead') }}</option>
            @for (u of leadCandidates(); track u.id) { <option [value]="u.id">{{ u.fullName || u.username }}</option> }
          </select>
          <button type="button" class="adm-btn" [disabled]="busy() || !newLead()" (click)="addLead()"><mat-icon>add</mat-icon>{{ i18n.t('dep.addLead') }}</button>
        </div>
      } @else if (tab() === 'csm') {
        <p class="dp__pad dp__sec">{{ i18n.t('dep.csmHint2') }}</p>
        @for (c of d.csms; track c.id) {
          <div class="dp__row dp__wrap">
            <mat-icon class="dp__lead">support_agent</mat-icon>
            <strong class="dp__w130">{{ c.name }}</strong>
            <span class="dp__chips dp__grow">
              <button type="button" class="seg" [disabled]="busy()" [attr.aria-pressed]="!c.areas.length" (click)="setCsmAreas(c.id, [])">{{ i18n.t('dep.csmAllAreas') }}</button>
              @for (a of deptAreas(); track a.code) {
                <button type="button" class="seg" [disabled]="busy()" [attr.aria-pressed]="c.areas.includes(a.code)" (click)="toggleCsmArea(c, a.code)">{{ a.name }}</button>
              }
            </span>
            <button type="button" class="adm-icon-btn" [disabled]="busy()" [attr.aria-label]="i18n.tf('dep.removeCsm', c.name)" (click)="removeCsm(c.id)"><mat-icon>close</mat-icon></button>
          </div>
        } @empty {
          <p class="adm-empty">{{ i18n.t('dep.noCsm') }}</p>
        }
        <div class="dp__add">
          @if (csmCandidates().length) {
            <select class="adm-input dp__select" name="newCsm" [attr.aria-label]="i18n.t('dep.addCsm')" [ngModel]="newCsm()" (ngModelChange)="newCsm.set($event)">
              <option value="">{{ i18n.t('dep.pickCsm') }}</option>
              @for (u of csmCandidates(); track u.id) { <option [value]="u.id">{{ u.name }}</option> }
            </select>
            <button type="button" class="adm-btn" [disabled]="busy() || !newCsm()" (click)="addCsm()"><mat-icon>add</mat-icon>{{ i18n.t('dep.addCsm') }}</button>
          } @else {
            <span class="adm-small adm-muted">{{ i18n.t('dep.noCsmPeople') }}</span>
          }
        </div>
      } @else {
        <div class="dp__pad dp__col">
          <span class="dp__sec">{{ i18n.t('dep.sharedHint') }}</span>
          <div class="dp__chips">
            @for (a of deptAreas(); track a.code) {
              <button type="button" class="seg" [attr.aria-pressed]="shareDraft().includes(a.code)" (click)="toggleShare(a.code)"><mat-icon>{{ shareDraft().includes(a.code) ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>{{ a.name }}</button>
            }
          </div>
          @if (mergePreview().length) {
            <div class="dp__note"><mat-icon>info</mat-icon>
              <span><strong>{{ i18n.t('dep.sharedWillEqual') }}</strong>
                @for (m of mergePreview(); track m) { <span class="dp__block">{{ m }}</span> }
              </span>
            </div>
          }
          @if (shareDraft().length < 2) { <span class="adm-small adm-muted">{{ i18n.t('dep.sharedNone') }}</span> }
          <div class="dp__actions">
            <button type="button" class="adm-btn" [disabled]="busy() || !shareChanged()" (click)="shareDraft.set(d.shared)">{{ i18n.t('dep.cancel') }}</button>
            <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy() || !shareChanged()" (click)="saveShared()">{{ i18n.t('dep.save') }}</button>
          </div>
        </div>
      }
    </section>
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .dp__name { max-width: 280px; }
    .dp__tabs { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); }
    .dp__tabs mat-icon { width: 14px; height: 14px; font-size: 14px; margin-right: 4px; }
    .dp__row { display: flex; align-items: center; gap: 10px; padding: 9px 14px; border-bottom: 1px solid var(--border-subtle); }
    .dp__w130 { width: 130px; }
    .dp__w90 { width: 90px; }
    .dp__wrap { flex-wrap: wrap; }
    .dp__grow { flex: 1; min-width: 0; }
    .dp__sec { color: var(--text-secondary); line-height: 1.5; }
    .dp__link { display: inline-flex; align-items: center; gap: 4px; color: var(--status-system); font-size: 11.5px; font-weight: 600; }
    .dp__lead { color: var(--status-system); }
    .dp__add { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 14px; }
    .dp__select { width: auto; min-width: 220px; }
    .dp__pad { margin: 0; padding: 12px 14px; }
    .dp__col { display: flex; flex-direction: column; gap: 12px; }
    .dp__chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .dp__note { display: flex; gap: 8px; align-items: flex-start; padding: 9px 12px; border-radius: var(--radius-md); background: var(--status-warning-bg); font-size: 12px; line-height: 1.45; }
    .dp__note mat-icon { color: var(--status-warning); }
    .dp__block { display: block; }
    .dp__actions { display: flex; justify-content: flex-end; gap: 8px; }
    .dp__confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 10px 14px 0; padding: 10px 12px; border-radius: var(--radius-md); background: var(--status-critical-bg); }
    .dp__confirm span { flex: 1; min-width: 180px; }
  `,
})
export class DepartmentPanelComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(AreasService);
  private readonly http = inject(HttpClient);

  readonly department = input.required<Department>();
  readonly areas = input<Area[]>([]);
  readonly levels = input<Level[]>([]);
  /** Se guardó algo: hay que recargar departamentos y áreas. */
  readonly changed = output<void>();
  /** Se borró el departamento. */
  readonly deleted = output<void>();

  protected readonly tabs: { id: DeptTab; icon: string; label: MessageKey }[] = [
    { id: 'areas', icon: 'lan', label: 'dep.tab.areas' },
    { id: 'leads', icon: 'workspace_premium', label: 'dep.tab.leads' },
    { id: 'shared', icon: 'link', label: 'dep.tab.shared' },
    { id: 'csm', icon: 'support_agent', label: 'dep.tab.csm' },
  ];
  protected readonly tab = signal<DeptTab>('areas');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly renaming = signal(false);
  protected readonly renameTo = signal('');
  protected readonly confirmDelete = signal(false);
  protected readonly newLead = signal('');
  protected readonly users = signal<UserOption[]>([]);
  protected readonly csmPeople = signal<{ id: string; name: string }[]>([]);
  protected readonly newCsm = signal('');
  protected readonly csmCandidates = computed(() => this.csmPeople().filter((p) => !this.department().csms.some((c) => c.id === p.id)));
  /** La gente de cada área del departamento (para contar e igualar). */
  private readonly people = signal<Record<string, AreaPerson[]>>({});
  protected readonly shareDraft = signal<string[]>([]);

  protected readonly deptAreas = computed(() => this.areas().filter((a) => this.department().areas.includes(a.code)));
  protected readonly looseAreas = computed(() => this.areas().filter((a) => !a.departmentId && a.active));
  protected readonly leadCandidates = computed(() => this.users().filter((u) => u.active && !this.department().leads.some((l) => l.id === u.id)));
  protected readonly summary = computed(() => {
    const ids = new Set(this.department().areas.flatMap((c) => (this.people()[c] ?? []).map((p) => p.id)));
    return this.i18n.t('dep.summary').replace('{a}', String(this.department().areas.length)).replace('{b}', String(ids.size));
  });
  protected readonly shareChanged = computed(() => {
    const a = [...this.shareDraft()].sort().join(',');
    const b = [...this.department().shared].sort().join(',');
    return a !== b;
  });
  /** Quién entra a qué área al igualar las marcadas (con su nivel de más rango). */
  protected readonly mergePreview = computed(() => {
    const set = this.shareDraft();
    if (set.length < 2 || !this.shareChanged()) return [];
    const rank = new Map(this.levels().map((l) => [l.id, l.rank]));
    const best = new Map<string, { name: string; levelId: string }>();
    for (const code of set) {
      for (const p of this.people()[code] ?? []) {
        const cur = best.get(p.id);
        if (!cur || (rank.get(p.levelId) ?? -1) > (rank.get(cur.levelId) ?? -1)) best.set(p.id, { name: p.fullName || p.username, levelId: p.levelId });
      }
    }
    const out: string[] = [];
    for (const code of set) {
      const here = new Set((this.people()[code] ?? []).map((p) => p.id));
      const area = this.areas().find((a) => a.code === code)?.name ?? code;
      for (const [id, p] of best) {
        if (here.has(id)) continue;
        const level = this.levels().find((l) => l.id === p.levelId)?.name;
        out.push(this.i18n.t('dep.sharedEnters').replace('{name}', p.name).replace('{area}', area).replace('{level}', level ? this.i18n.tf('dep.asLevel', level) : ''));
      }
    }
    return out;
  });

  constructor() {
    effect(() => {
      const d = this.department();
      untracked(() => {
        this.shareDraft.set(d.shared);
        this.confirmDelete.set(false);
        void this.loadPeople(d.areas);
      });
    });
    void firstValueFrom(this.http.get<ApiEnvelope<UserOption[]>>('/api/users')).then((r) => this.users.set(r.data), () => this.users.set([]));
    void this.api.csmPeople().then((r) => this.csmPeople.set(r), () => this.csmPeople.set([]));
  }

  private async loadPeople(codes: string[]): Promise<void> {
    const entries = await Promise.all(codes.map(async (c) => [c, await this.api.areaPeople(c).catch(() => [])] as const));
    this.people.set(Object.fromEntries(entries));
  }

  protected profileKey(p: string): MessageKey {
    return `access.profile.${p}` as MessageKey;
  }

  private join(items: string[]): string {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + this.i18n.t('dep.and') + items[items.length - 1];
  }

  protected areaNames(codes: string[]): string {
    return this.join(codes.map((c) => this.areas().find((a) => a.code === c)?.name ?? c));
  }

  protected peopleText(code: string): string {
    const list = this.people()[code] ?? [];
    return list.length ? list.map((p) => p.fullName || p.username).join(', ') : this.i18n.t('dep.noPeople');
  }

  /** Con qué áreas comparte equipo (vacío si no comparte). */
  protected sharesWith(code: string): string {
    const shared = this.department().shared;
    return shared.length > 1 && shared.includes(code) ? this.areaNames(shared.filter((c) => c !== code)) : '';
  }

  protected without(list: string[], code: string): string[] {
    return list.filter((c) => c !== code);
  }

  protected withoutId(list: { id: string }[], id: string): string[] {
    return list.filter((l) => l.id !== id).map((l) => l.id);
  }

  protected toggleShare(code: string): void {
    this.shareDraft.update((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code]));
  }

  protected setAreas(codes: string[]): Promise<void> {
    return this.save(() => this.api.patchDepartment(this.department().id, { areas: codes }));
  }

  protected setLeads(ids: string[]): Promise<void> {
    return this.save(() => this.api.setDepartmentLeads(this.department().id, ids));
  }

  protected addLead(): Promise<void> {
    const id = this.newLead();
    this.newLead.set('');
    return this.setLeads([...this.department().leads.map((l) => l.id), id]);
  }

  private csmList(): { id: string; areas: string[] }[] {
    return this.department().csms.map((c) => ({ id: c.id, areas: c.areas }));
  }

  protected addCsm(): Promise<void> {
    const id = this.newCsm();
    this.newCsm.set('');
    return this.save(() => this.api.setDepartmentCSMs(this.department().id, [...this.csmList(), { id, areas: [] }]));
  }

  protected removeCsm(id: string): Promise<void> {
    return this.save(() => this.api.setDepartmentCSMs(this.department().id, this.csmList().filter((c) => c.id !== id)));
  }

  /** Todas las áreas (vacío) o ciertas. */
  protected setCsmAreas(id: string, areas: string[]): Promise<void> {
    return this.save(() => this.api.setDepartmentCSMs(this.department().id, this.csmList().map((c) => (c.id === id ? { id, areas } : c))));
  }

  protected toggleCsmArea(c: { id: string; areas: string[] }, code: string): Promise<void> {
    const areas = c.areas.includes(code) ? c.areas.filter((x) => x !== code) : [...c.areas, code];
    return this.setCsmAreas(c.id, areas);
  }

  protected saveShared(): Promise<void> {
    return this.save(() => this.api.patchDepartment(this.department().id, { shared: this.shareDraft() }));
  }

  protected async rename(): Promise<void> {
    if (!this.renaming()) return;
    this.renaming.set(false);
    const name = this.renameTo().trim();
    if (!name || name === this.department().name) return;
    await this.save(() => this.api.patchDepartment(this.department().id, { name }));
  }

  protected async remove(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.deleteDepartment(this.department().id);
      this.deleted.emit();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('dep.error')));
    } finally {
      this.busy.set(false);
    }
  }

  private async save(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      this.changed.emit();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('dep.error')));
    } finally {
      this.busy.set(false);
    }
  }
}
