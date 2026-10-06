import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { EscalationPool, EscalationService } from '../../core/escalation/escalation.service';
import { Organization, OrganizationsService } from '../../core/organizations/organizations.service';
import { DirectoryContact, DirectoryService } from '../../core/directory/directory.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { problemDetail } from '../../core/http-error';

interface DraftMember {
  contactId?: string;
  userId?: string;
  name: string;
  organizationName?: string;
}

/**
 * Pools de escalamiento (decisión del dueño 2026-10-05): un grupo con nombre
 * de personas de una empresa o área — TI-Mundo, Redes-Mundo, Ciber-Mundo; una
 * empresa puede tener varios — que se agrega a un nivel (Administración →
 * Equipos) como un solo integrante. Se llama en orden: si uno no contesta,
 * el siguiente.
 */
@Component({
  selector: 'app-admin-escalation-pools',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ep__form { padding: 12px 14px; border-bottom: 1px solid var(--border-subtle); }
    .ep__grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .ep__list { border-right: 1px solid var(--border-subtle); }
    .ep__detail { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; }
    .ep__members { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
    .ep__member { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); font-size: 12px; }
    .ep__pos { width: 20px; color: var(--text-muted); font-weight: 700; text-align: center; }
    .ep__who { flex: 1; min-width: 0; }
    .ep__results { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
    .ep__results li { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .ep__actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .ep__confirm { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; }
    @media (width <= 900px) { .ep__grid { grid-template-columns: minmax(0, 1fr); } .ep__list { border-right: none; } }
  `,
  template: `
    <section class="adm-card">
      <div class="adm-card__head">
        <h3 class="adm-card__title"><mat-icon>diversity_3</mat-icon>{{ i18n.t('pools.title') }} <span class="mono adm-secondary">{{ pools().length }}</span></h3>
      </div>
      <p class="adm-card__note">{{ i18n.t('pools.hint') }}</p>
      @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }
      <form class="adm-row ep__form" (ngSubmit)="create()">
        <label class="adm-field">
          <span class="adm-label">{{ i18n.t('pools.org') }}</span>
          <select class="adm-input" name="poolOrg" [ngModel]="newOrg()" (ngModelChange)="newOrg.set($event)">
            <option value="">{{ i18n.t('pools.noOrg') }}</option>
            @for (o of orgList(); track o.id) { <option [value]="o.id">{{ o.name }}</option> }
          </select>
        </label>
        <label class="adm-field"><span class="adm-label">{{ i18n.t('pools.name') }}</span><input class="adm-input" name="poolName" placeholder="TI" [ngModel]="newName()" (ngModelChange)="newName.set($event)" /></label>
        <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !newName().trim()"><mat-icon>add</mat-icon>{{ i18n.t('pools.create') }}</button>
      </form>
      <div class="ep__grid">
        <div class="adm-table-wrap ep__list">
          <table class="adm-table">
            <thead><tr><th>{{ i18n.t('pools.name') }}</th><th class="adm-num">{{ i18n.t('pools.people') }}</th><th class="adm-num">{{ i18n.t('pools.usedIn') }}</th></tr></thead>
            <tbody>
              @for (p of pools(); track p.id) {
                <tr class="adm-row-click" [class.adm-row--active]="selectedId() === p.id" tabindex="0" (click)="select(p)" (keydown.enter)="select(p)">
                  <td><strong>{{ p.name }}</strong>@if (p.organizationName) { <span class="adm-small adm-secondary">-{{ p.organizationName }}</span> }@if (!p.active) { <span class="pill tone-neutral">{{ i18n.t('pools.inactive') }}</span> }</td>
                  <td class="mono adm-num">{{ p.members }}</td>
                  <td class="mono adm-num">{{ p.usedIn }}</td>
                </tr>
              }
            </tbody>
          </table>
          @if (!pools().length) { <p class="adm-empty">{{ i18n.t('pools.empty') }}</p> }
        </div>
        <div class="ep__detail">
          @if (selected(); as p) {
            <div class="adm-row">
              <label class="adm-field"><span class="adm-label">{{ i18n.t('pools.name') }}</span><input class="adm-input" name="editName" [ngModel]="editName()" (ngModelChange)="editName.set($event)" /></label>
              <label class="switch">
                <input class="switch__input" type="checkbox" role="switch" name="poolActive" [checked]="p.active" [disabled]="busy()" (change)="toggleActive(p)" />
                <span class="switch__track" aria-hidden="true"></span>{{ i18n.t('pools.active') }}
              </label>
            </div>
            <span class="adm-label">{{ i18n.t('pools.order') }}</span>
            <ol class="ep__members">
              @for (m of draft(); track $index; let i = $index; let first = $first; let last = $last) {
                <li class="ep__member">
                  <span class="ep__pos mono">{{ i + 1 }}</span>
                  <span class="ep__who"><strong>{{ m.name }}</strong>@if (m.organizationName) { <span class="adm-small adm-secondary"> · {{ m.organizationName }}</span> }</span>
                  <button type="button" class="adm-icon-btn" [disabled]="first" [attr.aria-label]="i18n.t('pools.up') + ' ' + m.name" [title]="i18n.t('pools.up')" (click)="move(i, -1)"><mat-icon>arrow_upward</mat-icon></button>
                  <button type="button" class="adm-icon-btn" [disabled]="last" [attr.aria-label]="i18n.t('pools.down') + ' ' + m.name" [title]="i18n.t('pools.down')" (click)="move(i, 1)"><mat-icon>arrow_downward</mat-icon></button>
                  <button type="button" class="adm-icon-btn adm-icon-btn--danger" [attr.aria-label]="i18n.t('teams.remove') + ' ' + m.name" [title]="i18n.t('teams.remove')" (click)="removeAt(i)"><mat-icon>close</mat-icon></button>
                </li>
              } @empty {
                <li class="adm-hint">{{ i18n.t('pools.noPeople') }}</li>
              }
            </ol>
            <label class="adm-field">
              <span class="adm-label">{{ i18n.t('pools.addPerson') }}</span>
              <input class="adm-input" name="poolSearch" [placeholder]="i18n.t('teams.searchContact')" [ngModel]="query()" (ngModelChange)="search($event)" />
            </label>
            @if (results().length) {
              <ul class="ep__results">
                @for (c of results(); track c.id) {
                  <li>
                    <button type="button" class="adm-btn" (click)="add(c)"><mat-icon>person_add</mat-icon>{{ i18n.t('teams.add') }}</button>
                    <span><strong>{{ c.name }}</strong> <span class="adm-small adm-secondary">· {{ c.organizationName }}</span></span>
                  </li>
                }
              </ul>
            }
            <div class="ep__actions">
              @if (confirmDelete()) {
                <span class="ep__confirm">
                  {{ i18n.t('pools.confirmDelete') }}
                  <button type="button" class="adm-btn" (click)="confirmDelete.set(false)">{{ i18n.t('adminChecklist.cancel') }}</button>
                  <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy()" (click)="remove(p)">{{ i18n.t('adminChecklist.delete') }}</button>
                </span>
              } @else {
                <button type="button" class="adm-btn adm-btn--danger" (click)="confirmDelete.set(true)"><mat-icon>delete_outline</mat-icon>{{ i18n.t('pools.delete') }}</button>
              }
              <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy() || !editName().trim()" (click)="save(p)"><mat-icon>save</mat-icon>{{ i18n.t('admin.save') }}</button>
            </div>
          } @else {
            <p class="adm-empty">{{ i18n.t('pools.pick') }}</p>
          }
        </div>
      </div>
    </section>
  `,
})
export class AdminEscalationPoolsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(EscalationService);
  private readonly orgs = inject(OrganizationsService);
  private readonly directory = inject(DirectoryService);

  protected readonly pools = signal<EscalationPool[]>([]);
  protected readonly orgList = signal<Organization[]>([]);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = signal<EscalationPool | null>(null);
  protected readonly draft = signal<DraftMember[]>([]);
  protected readonly editName = signal('');
  protected readonly newName = signal('');
  protected readonly newOrg = signal('');
  protected readonly query = signal('');
  protected readonly results = signal<DirectoryContact[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmDelete = signal(false);
  private searchTimer?: ReturnType<typeof setTimeout>;

  async ngOnInit(): Promise<void> {
    await this.run(async () => {
      const [pools, orgs] = await Promise.all([this.api.listPools(), this.orgs.list()]);
      this.pools.set(pools);
      this.orgList.set(orgs);
    });
  }

  protected async select(p: EscalationPool): Promise<void> {
    this.selectedId.set(p.id);
    this.selected.set(p);
    this.editName.set(p.name);
    this.confirmDelete.set(false);
    this.query.set('');
    this.results.set([]);
    await this.run(async () => {
      const members = await this.api.listPoolMembers(p.id);
      this.draft.set(members.map((m) => ({ contactId: m.contactId, userId: m.userId, name: m.name, organizationName: m.organizationName })));
    });
  }

  protected async create(): Promise<void> {
    const name = this.newName().trim();
    if (!name) return;
    await this.run(async () => {
      const p = await this.api.createPool({ name, organizationId: this.newOrg() || undefined });
      this.newName.set('');
      await this.reload();
      await this.select({ ...p, organizationName: this.orgList().find((o) => o.id === p.organizationId)?.name });
    });
  }

  protected search(value: string): void {
    this.query.set(value);
    clearTimeout(this.searchTimer);
    if (value.trim().length < 2) {
      this.results.set([]);
      return;
    }
    this.searchTimer = setTimeout(async () => {
      try {
        const found = await this.directory.search(value.trim());
        const taken = new Set(this.draft().map((m) => m.contactId));
        this.results.set(found.filter((c) => !taken.has(c.id)));
      } catch {
        this.results.set([]);
      }
    }, 250);
  }

  protected add(c: DirectoryContact): void {
    this.draft.update((list) => [...list, { contactId: c.id, name: c.name, organizationName: c.organizationName }]);
    this.results.update((list) => list.filter((x) => x.id !== c.id));
  }

  protected move(i: number, delta: number): void {
    this.draft.update((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      next.splice(i + delta, 0, item);
      return next;
    });
  }

  protected removeAt(i: number): void {
    this.draft.update((list) => list.filter((_, j) => j !== i));
  }

  protected async save(p: EscalationPool): Promise<void> {
    await this.run(async () => {
      if (this.editName().trim() !== p.name) await this.api.patchPool(p.id, { name: this.editName().trim() });
      await this.api.setPoolMembers(p.id, this.draft().map((m) => (m.contactId ? { contactId: m.contactId } : { userId: m.userId })));
      await this.reload();
    });
  }

  protected async toggleActive(p: EscalationPool): Promise<void> {
    await this.run(async () => {
      await this.api.patchPool(p.id, { active: !p.active });
      await this.reload();
    });
  }

  protected async remove(p: EscalationPool): Promise<void> {
    await this.run(async () => {
      await this.api.deletePool(p.id);
      this.selectedId.set(null);
      this.selected.set(null);
      this.draft.set([]);
      await this.reload();
    });
  }

  private async reload(): Promise<void> {
    const pools = await this.api.listPools();
    this.pools.set(pools);
    const id = this.selectedId();
    if (id) this.selected.set(pools.find((p) => p.id === id) ?? null);
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('escAdmin.error')));
    } finally {
      this.busy.set(false);
    }
  }
}
