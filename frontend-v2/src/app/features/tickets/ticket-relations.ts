import { ChangeDetectionStrategy, Component, Injector, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth/auth.service';
import { PermissionsService } from '../../core/auth/permissions.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { Organization, OrganizationsService } from '../../core/organizations/organizations.service';
import { Ticket, TicketDetail, TicketStatus, TicketsService } from '../../core/tickets/tickets.service';
import { STATUS_TONE } from '../../core/tickets/ticket-view';

import '../../core/i18n/packs/tickets';

type Dialog = 'merge' | 'parent' | 'client' | 'resolve' | null;
const CLOSED: readonly TicketStatus[] = ['resolved', 'closed', 'cancelled'];

/**
 * Unir tickets, padre/hijo y cambiar el cliente (canvas "Ticketera: unir y
 * padre/hijo", aprobado 2026-10-07). Va dentro del detalle: la barra de
 * acciones, los avisos de "hijo de" / "unido a", el panel de hijos con su
 * avance y los diálogos. Las reglas las valida el servidor; aquí solo se
 * ofrece lo que tiene sentido.
 */
@Component({
  selector: 'app-ticket-relations',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = detail();
    @let t = d.ticket;
    @if (d.mergedInto; as m) {
      <div class="tr__banner">
        <mat-icon>call_merge</mat-icon>
        <span class="tr__grow">{{ i18n.tf('tkrel.mergedInto', m.ticketNumber) }}</span>
        <button type="button" class="adm-btn" (click)="open.emit(m.id)">{{ i18n.t('tkrel.seeMain') }}</button>
      </div>
    } @else {
      @if (d.parent; as p) {
        <div class="tr__banner tr__banner--child">
          <mat-icon>subdirectory_arrow_right</mat-icon>
          <span class="tr__grow">{{ i18n.t('tkrel.childOf') }} <span class="mono">{{ p.ticketNumber }}</span> · {{ p.title }}
            <small>{{ i18n.t('tkrel.childHint') }}</small></span>
          <button type="button" class="adm-btn" (click)="open.emit(p.id)">{{ i18n.t('tkrel.seeParent') }}</button>
          <button type="button" class="adm-btn" [disabled]="busy()" (click)="removeParent()">{{ i18n.t('tkrel.removeParent') }}</button>
        </div>
      }
      <div class="tr__bar">
        @if (canMerge()) {
          <button type="button" class="adm-btn" (click)="openDialog('merge')"><mat-icon>call_merge</mat-icon>{{ i18n.t('tkrel.merge') }}</button>
        }
        @if (canBeChild()) {
          <button type="button" class="adm-btn" (click)="openDialog('parent')"><mat-icon>account_tree</mat-icon>{{ i18n.t('tkrel.makeChild') }}</button>
        }
        @if (canHaveChildren()) {
          <button type="button" class="adm-btn" [disabled]="busy()" (click)="createChild()"><mat-icon>add</mat-icon>{{ i18n.t('tkrel.newChild') }}</button>
        }
        @if (canChangeClient()) {
          <button type="button" class="adm-btn" (click)="openDialog('client')"><mat-icon>edit</mat-icon>{{ i18n.t('tkrel.changeClient') }}</button>
        }
      </div>
      @if (d.children.length) {
        <section class="tr__children">
          <div class="tr__row">
            <span class="tr__label">{{ i18n.t('tkrel.children') }}</span>
            <span class="mono tr__muted">{{ i18n.tf('tkrel.progress', doneChildren() + ' / ' + d.children.length) }}</span>
            <span class="tr__add">
              <input class="adm-input mono" name="childNumber" [placeholder]="i18n.t('tkrel.addExistingPh')" [attr.aria-label]="i18n.t('tkrel.addExisting')" [ngModel]="childNumber()" (ngModelChange)="childNumber.set($event)" (keydown.enter)="addExisting()" />
              <button type="button" class="adm-btn" [disabled]="busy() || !childNumber().trim()" (click)="addExisting()"><mat-icon>link</mat-icon>{{ i18n.t('tkrel.addExisting') }}</button>
            </span>
          </div>
          <span class="meter tr__meter"><span [style.width.%]="(100 * doneChildren()) / d.children.length"></span></span>
          @for (c of d.children; track c.id) {
            <button type="button" class="tr__child" (click)="open.emit(c.id)">
              <span class="mono">{{ c.ticketNumber }}</span>
              <span class="tr__grow tr__ellipsis">{{ c.clientName }} · {{ c.title }}</span>
              <span class="pill" [class]="'tone-' + statusTone[c.status]">{{ i18n.t(statusKey(c.status)) }}</span>
            </button>
          }
          @if (allChildrenDone() && isOpen(t.status)) {
            <div class="tr__done">
              <mat-icon>task_alt</mat-icon>{{ i18n.t('tkrel.allDone') }}
              <button type="button" class="adm-btn adm-btn--primary" (click)="openDialog('resolve')">{{ i18n.t('tkrel.resolveParent') }}</button>
            </div>
          }
        </section>
      }
    }
    @if (error(); as e) { <p class="adm-error tr__error" role="alert">{{ e }}</p> }

    @if (dialog(); as kind) {
      <div class="tr__overlay" (click)="close()">
        <div class="tr__dialog" role="dialog" aria-modal="true" [attr.aria-label]="i18n.t(titleKey(kind))" (click)="$event.stopPropagation()" (keydown.escape)="close()">
          <header class="tr__dialog-head">
            <strong>{{ i18n.t(titleKey(kind)) }} <span class="mono">{{ t.ticketNumber }}</span></strong>
            <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('tkrel.cancel')" (click)="close()"><mat-icon>close</mat-icon></button>
          </header>
          <div class="tr__dialog-body">
            @switch (kind) {
              @case ('merge') {
                <label class="adm-field"><span class="adm-label">{{ i18n.t('tkrel.mergeWith') }}</span>
                  <span class="tr__add">
                    <input class="adm-input mono" name="mergeNumber" placeholder="TKT-2026-00055" [ngModel]="otherNumber()" (ngModelChange)="otherNumber.set($event)" (keydown.enter)="findOther()" />
                    <button type="button" class="adm-btn" [disabled]="busy() || !otherNumber().trim()" (click)="findOther()"><mat-icon>search</mat-icon>{{ i18n.t('tkrel.find') }}</button>
                  </span>
                </label>
                @if (other(); as o) {
                  <span class="adm-label">{{ i18n.t('tkrel.whichStays') }}</span>
                  <div class="tr__cards">
                    @for (c of [t, o]; track c.id) {
                      <button type="button" class="tr__card" [class.tr__card--on]="mainId() === c.id" [attr.aria-pressed]="mainId() === c.id" (click)="mainId.set(c.id)">
                        <span class="tr__row"><mat-icon>{{ mainId() === c.id ? 'radio_button_checked' : 'radio_button_unchecked' }}</mat-icon><span class="mono">{{ c.ticketNumber }}</span>
                          <span class="pill tr__push" [class.tone-ok]="mainId() === c.id">{{ i18n.t(mainId() === c.id ? 'tkrel.stays' : 'tkrel.joins') }}</span></span>
                        <span>{{ c.title }}</span>
                        <small class="tr__muted">{{ c.clientName }} · {{ c.createdAt.slice(0, 16).replace('T', ' ') }}</small>
                      </button>
                    }
                  </div>
                  <div class="tr__what">
                    <span>• {{ i18n.tf('tkrel.what1', mergeLabels().other + ' → ' + mergeLabels().main) }}</span>
                    <span>• {{ i18n.tf('tkrel.what2', mergeLabels().main) }}</span>
                    <span>• {{ i18n.t('tkrel.what3') }}</span>
                  </div>
                }
              }
              @case ('parent') {
                <label class="adm-field"><span class="adm-label">{{ i18n.t('tkrel.parentNumber') }}</span>
                  <input class="adm-input mono" name="parentNumber" placeholder="TKT-2026-00050" [ngModel]="parentNumber()" (ngModelChange)="parentNumber.set($event)" (keydown.enter)="confirm()" />
                </label>
                <span class="tr__muted">{{ i18n.t('tkrel.parentHint') }}</span>
              }
              @case ('client') {
                <span class="tr__muted">{{ i18n.t('tkrel.currentClient') }} <strong>{{ t.clientName }}</strong></span>
                <label class="adm-field"><span class="adm-label">{{ i18n.t('tkrel.newClient') }}</span>
                  <select class="adm-input" name="newClient" [ngModel]="clientId()" (ngModelChange)="clientId.set($event)">
                    <option value="" disabled>{{ i18n.t('tkrel.pickClient') }}</option>
                    @for (o of clients(); track o.id) { @if (o.id !== t.clientId) { <option [value]="o.id">{{ o.name }}</option> } }
                  </select>
                </label>
                <div class="tr__what">
                  <span>• {{ i18n.t('tkrel.clientWhat1') }}</span>
                  <span>• {{ i18n.t('tkrel.clientWhat2') }}</span>
                  <span>• {{ i18n.t('tkrel.clientWhat3') }}</span>
                </div>
              }
              @case ('resolve') {
                <label class="adm-field"><span class="adm-label">{{ i18n.t('tkrel.solution') }}</span>
                  <textarea class="adm-input" name="solution" rows="3" [ngModel]="solution()" (ngModelChange)="solution.set($event)"></textarea>
                </label>
                @if (openChildren() > 0) {
                  <label class="tr__check">
                    <input type="checkbox" name="alsoChildren" [ngModel]="alsoChildren()" (ngModelChange)="alsoChildren.set($event)" />
                    <span>{{ i18n.tf('tkrel.alsoResolve', openChildren()) }}<small class="tr__muted">{{ i18n.t('tkrel.alsoResolveHint') }}</small></span>
                  </label>
                }
              }
            }
            @if (kind === 'merge' || kind === 'client') {
              <label class="adm-field"><span class="adm-label">{{ i18n.t('tkrel.reason') }}</span>
                <input class="adm-input" name="reason" [ngModel]="reason()" (ngModelChange)="reason.set($event)" />
              </label>
            }
            @if (kind === 'merge') { <span class="tr__muted">{{ i18n.t('tkrel.mergeRule') }}</span> }
            @if (dialogError(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }
          </div>
          <footer class="tr__dialog-foot">
            <button type="button" class="adm-btn" (click)="close()">{{ i18n.t('tkrel.cancel') }}</button>
            <button type="button" class="adm-btn adm-btn--primary" [disabled]="busy() || !canConfirm()" (click)="confirm()">{{ i18n.t(confirmKey(kind)) }}</button>
          </footer>
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; padding: 0 18px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .tr__banner { display: flex; align-items: flex-start; gap: 8px; margin-top: 10px; padding: 9px 11px; border-radius: var(--radius-md); background: var(--bg-surface-hover); font-size: 12px; }
    .tr__banner--child { background: var(--status-system-bg); }
    .tr__banner small { display: block; color: var(--text-secondary); font-size: 11px; }
    .tr__bar, .tr__row, .tr__add, .tr__done { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .tr__bar:empty { display: none; }
    .tr__bar { padding-top: 8px; }
    .tr__grow { flex: 1; min-width: 0; }
    .tr__push { margin-left: auto; }
    .tr__ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tr__muted { color: var(--text-muted); font-size: 11px; }
    .tr__label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
    .tr__children { display: flex; flex-direction: column; gap: 6px; padding: 10px 0; border-bottom: 1px solid var(--border-subtle); }
    .tr__add { margin-left: auto; }
    .tr__add .adm-input { width: 160px; }
    .tr__dialog .tr__add { margin-left: 0; }
    .tr__dialog .tr__add .adm-input { flex: 1; width: auto; }
    .tr__meter { display: block; }
    .tr__child { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text-primary); font-size: 12px; text-align: left; cursor: pointer; }
    .tr__child:hover { background: var(--bg-surface-hover); }
    .tr__done { padding: 8px 10px; border-radius: var(--radius-md); background: var(--status-ok-bg); color: var(--status-ok); font-size: 12px; font-weight: 600; }
    .tr__done .adm-btn { margin-left: auto; }
    .tr__error { margin: 0; }
    .tr__overlay { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; background: rgb(1 4 9 / 55%); }
    .tr__dialog { width: min(640px, calc(100vw - 32px)); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-surface); box-shadow: 0 16px 40px rgb(0 0 0 / 35%); }
    .tr__dialog-head, .tr__dialog-foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
    .tr__dialog-head { justify-content: space-between; border-bottom: 1px solid var(--border-subtle); }
    .tr__dialog-foot { justify-content: flex-end; border-top: 1px solid var(--border-subtle); }
    .tr__dialog-body { display: flex; flex-direction: column; gap: 12px; padding: 16px; font-size: 12px; }
    .tr__cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .tr__card { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 2px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); color: var(--text-primary); text-align: left; cursor: pointer; }
    .tr__card--on { border-color: var(--accent); }
    .tr__what { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); line-height: 1.45; }
    .tr__check { display: flex; align-items: flex-start; gap: 8px; }
    .tr__check small { display: block; }
  `,
})
export class TicketRelationsComponent {
  readonly detail = input.required<TicketDetail>();
  /** Algo cambió: el detalle se recarga. */
  readonly reload = output<void>();
  /** Abrir otro ticket (padre, hijo o principal). */
  readonly open = output<string>();

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(TicketsService);
  private readonly auth = inject(AuthService);
  private readonly perms = inject(PermissionsService);
  private readonly orgs = inject(OrganizationsService);
  private readonly injector = inject(Injector);
  protected readonly statusTone = STATUS_TONE;

  protected readonly dialog = signal<Dialog>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly dialogError = signal<string | null>(null);
  protected readonly childNumber = signal('');
  protected readonly parentNumber = signal('');
  protected readonly otherNumber = signal('');
  protected readonly other = signal<Ticket | null>(null);
  protected readonly mainId = signal('');
  protected readonly reason = signal('');
  protected readonly clients = signal<Organization[]>([]);
  protected readonly clientId = signal('');
  protected readonly solution = signal('');
  protected readonly alsoChildren = signal(true);

  private readonly canChangeClientCap = this.perms.can('tickets:change_client');

  constructor() {
    void this.perms.load(); // permisos de grupo (cambiar cliente); el servidor igual los exige
  }

  protected readonly doneChildren = computed(() => this.detail().children.filter((c) => !this.isOpen(c.status)).length);
  protected readonly openChildren = computed(() => this.detail().children.length - this.doneChildren());
  protected readonly allChildrenDone = computed(() => this.detail().children.length > 0 && this.openChildren() === 0);
  private readonly live = computed(() => !this.detail().mergedInto && this.detail().ticket.status !== 'closed');
  /** Pueden unir el admin o quien creó el ticket (el servidor acepta también al creador del otro). */
  protected readonly canMerge = computed(() => this.live() && (this.perms.isAdmin() || this.detail().ticket.createdById === this.auth.user()?.id));
  protected readonly canBeChild = computed(() => this.live() && !this.detail().parent && this.detail().children.length === 0);
  protected readonly canHaveChildren = computed(() => this.live() && !this.detail().parent);
  protected readonly canChangeClient = computed(() => !this.detail().mergedInto && this.canChangeClientCap());
  protected readonly mergeLabels = computed(() => {
    const t = this.detail().ticket;
    const o = this.other();
    const main = this.mainId() === o?.id ? o : t;
    const other = main === t ? o : t;
    return { main: main.ticketNumber, other: other?.ticketNumber ?? '' };
  });

  protected isOpen(status: TicketStatus): boolean {
    return !CLOSED.includes(status);
  }

  protected statusKey(status: TicketStatus): MessageKey {
    return `tickets.status.${status}` as MessageKey;
  }

  protected titleKey(kind: Exclude<Dialog, null>): MessageKey {
    return `tkrel.title.${kind}` as MessageKey;
  }

  protected confirmKey(kind: Exclude<Dialog, null>): MessageKey {
    return `tkrel.confirm.${kind}` as MessageKey;
  }

  /** El detalle lo usa al resolver un padre con hijos abiertos. */
  askResolve(): void {
    this.openDialog('resolve');
  }

  protected openDialog(kind: Exclude<Dialog, null>): void {
    this.dialogError.set(null);
    this.reason.set('');
    this.other.set(null);
    this.otherNumber.set('');
    this.parentNumber.set('');
    this.clientId.set('');
    this.solution.set('');
    this.alsoChildren.set(true);
    this.dialog.set(kind);
    if (kind === 'client' && !this.clients().length) {
      this.orgs.list({ clients: true, active: true }).then((list) => this.clients.set(list), () => this.clients.set([]));
    }
  }

  protected close(): void {
    this.dialog.set(null);
  }

  protected canConfirm(): boolean {
    switch (this.dialog()) {
      case 'merge':
        return !!this.other() && !!this.reason().trim();
      case 'parent':
        return !!this.parentNumber().trim();
      case 'client':
        return !!this.clientId() && !!this.reason().trim();
      case 'resolve':
        return true;
      default:
        return false;
    }
  }

  /** Busca el otro ticket por número (la lista filtra por número o título). */
  private async findByNumber(number: string): Promise<Ticket | null> {
    const n = number.trim().toUpperCase();
    const list = await this.api.list({ q: n });
    return list.items.find((x) => x.ticketNumber.toUpperCase() === n) ?? null;
  }

  protected async findOther(): Promise<void> {
    this.dialogError.set(null);
    try {
      const found = await this.findByNumber(this.otherNumber());
      const t = this.detail().ticket;
      if (!found || found.id === t.id) {
        this.dialogError.set(this.i18n.t('tkrel.notFound'));
        return;
      }
      this.other.set(found);
      // Por defecto queda el más antiguo.
      this.mainId.set(found.createdAt < t.createdAt ? found.id : t.id);
    } catch (err) {
      this.dialogError.set(problemDetail(err, this.i18n.t('tkrel.notFound')));
    }
  }

  protected async confirm(): Promise<void> {
    const kind = this.dialog();
    const t = this.detail().ticket;
    this.busy.set(true);
    this.dialogError.set(null);
    try {
      if (kind === 'merge') {
        const o = this.other() as Ticket;
        const main = this.mainId() === o.id ? o.id : t.id;
        await this.api.merge(main, main === t.id ? o.id : t.id, this.reason().trim());
        this.dialog.set(null);
        if (main !== t.id) this.open.emit(main);
      } else if (kind === 'parent') {
        await this.api.setParent(t.id, this.parentNumber().trim());
        this.dialog.set(null);
      } else if (kind === 'client') {
        await this.api.changeClient(t.id, this.clientId(), this.reason().trim());
        this.dialog.set(null);
      } else if (kind === 'resolve') {
        const also = this.alsoChildren() && this.openChildren() > 0;
        const text = this.solution().trim();
        if (text) await this.api.addComment(t.id, text, true, [], also);
        await this.api.transition(t.id, 'resolved', undefined, also);
        this.dialog.set(null);
      }
      this.reload.emit();
    } catch (err) {
      this.dialogError.set(problemDetail(err, this.i18n.t('tickets.error.action')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeParent(): Promise<void> {
    await this.run(() => this.api.setParent(this.detail().ticket.id, ''));
  }

  protected async addExisting(): Promise<void> {
    const number = this.childNumber().trim();
    if (!number) return;
    await this.run(async () => {
      const child = await this.findByNumber(number);
      if (!child) throw new Error(this.i18n.t('tkrel.notFound'));
      await this.api.setParent(child.id, this.detail().ticket.ticketNumber);
      this.childNumber.set('');
    });
  }

  /** "Crear hijo": el diálogo de nuevo ticket, prellenado con el cliente y el ámbito del padre. */
  protected async createChild(): Promise<void> {
    const t = this.detail().ticket;
    const [{ Dialog }, { NewTicketDialogComponent }] = await Promise.all([import('@angular/cdk/dialog'), import('./new-ticket-dialog')]);
    const ref = this.injector.get(Dialog).open<string | undefined>(NewTicketDialogComponent, {
      ariaLabel: this.i18n.tf('tkrel.newChildOf', t.ticketNumber),
      data: { parentId: t.id, parentNumber: t.ticketNumber, clientId: t.clientId, scope: t.scope },
    });
    ref.closed.subscribe((id) => {
      if (id) this.reload.emit();
    });
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      this.reload.emit();
    } catch (err) {
      this.error.set(err instanceof Error && !('status' in err) ? err.message : problemDetail(err, this.i18n.t('tickets.error.action')));
    } finally {
      this.busy.set(false);
    }
  }
}
