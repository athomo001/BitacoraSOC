import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ModalComponent } from '../../shared/ui/modal/modal';
import { ButtonComponent } from '../../shared/ui/button/button';
import { ActionKind, AgendaMeta, AgendaService } from '../../core/agenda/agenda.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { ACTION_KINDS, kindKey } from './mgmt-format';

import '../../core/i18n/packs/management';

/** Para quién y desde dónde se crea la acción. */
export interface ActionDialogData {
  /** Cliente fijo (ficha del cliente o ticket); sin él, se elige de clients. */
  client?: { id: string; name: string };
  clients?: { id: string; name: string }[];
  ticket?: { id: string; number: string };
  /** Arranca como «Reunión de seguimiento» (Agendar reunión). */
  meeting?: boolean;
}

interface Suggestion { key: MessageKey; kind: ActionKind; }

const TICKET_SUGGESTIONS: Suggestion[] = [
  { key: 'mg.sg.follow', kind: 'other' }, { key: 'mg.sg.validate', kind: 'other' },
  { key: 'mg.sg.minutes', kind: 'report' }, { key: 'mg.sg.notify', kind: 'contact' },
];
const SUGGESTIONS: Suggestion[] = [
  { key: 'mg.sg.meeting', kind: 'meeting' }, { key: 'mg.sg.committee', kind: 'committee' },
  { key: 'mg.sg.call', kind: 'contact' }, { key: 'mg.sg.report', kind: 'report' },
];

interface Target { id: string; areaId: string; kind: 'level' | 'guard'; label: string; area: string; name: string; }

/**
 * Nueva acción / Acción de seguimiento (spec/16 §4.4.6, diseño aprobado): por
 * defecto es un compromiso del propio CSM; asignarla a un área técnica (un
 * nivel o una guardia) es la segunda opción. Es una tarea de la Agenda de una
 * vez, ligada al cliente (y al ticket), con su tipo y si es clave.
 */
@Component({
  selector: 'app-mgmt-action-dialog',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal>
      <span app-modal-title><mat-icon class="ad__ic">add_task</mat-icon>{{ i18n.t(data.ticket ? 'mg.act.follow' : 'mg.act.new') }}</span>
      <form class="ad" (submit)="$event.preventDefault(); create()">
        <label class="field">
          <span>{{ i18n.t('mg.act.what') }}</span>
          <input name="actName" maxlength="200" [placeholder]="i18n.t('mg.act.whatPh')" [value]="name()" (input)="name.set(val($event))" />
        </label>
        <div class="ad__chips">
          @for (s of suggestions; track s.key) {
            <button type="button" class="seg" [attr.aria-pressed]="name() === i18n.t(s.key)" (click)="suggest(s)">{{ i18n.t(s.key) }}</button>
          }
        </div>
        <div class="field-grid">
          <div class="field">
            <span>{{ i18n.t('mg.act.client') }}</span>
            @if (data.client; as c) {
              <span class="ad__fake"><mat-icon>business</mat-icon>{{ c.name }}</span>
            } @else {
              <select name="actClient" (change)="clientId.set(val($event))">
                <option value="" [selected]="!clientId()">{{ i18n.t('mg.act.clientPick') }}</option>
                @for (c of data.clients ?? []; track c.id) { <option [value]="c.id">{{ c.name }}</option> }
              </select>
            }
          </div>
          <div class="field">
            <span>{{ i18n.t('mg.act.ticket') }}</span>
            <span class="ad__fake" [class.mono]="data.ticket">@if (data.ticket; as t) { <mat-icon>confirmation_number</mat-icon>{{ t.number }} } @else { <span class="ad__muted">{{ i18n.t('mg.act.noTicket') }}</span> }</span>
          </div>
        </div>
        <div class="field">
          <span>{{ i18n.t('mg.act.type') }}</span>
          <div class="ad__chips">
            @for (k of kinds; track k) { <button type="button" class="seg" [attr.aria-pressed]="kind() === k" (click)="kind.set(k)">{{ i18n.t(kindKey(k)) }}</button> }
          </div>
          <span class="ad__hint">{{ i18n.t(counts() ? 'mg.act.countsYes' : 'mg.act.countsNo') }}</span>
        </div>
        <label class="ad__check">
          <input type="checkbox" name="actKey" [checked]="key()" (change)="key.set(!key())" />
          <span><b>{{ i18n.t('mg.act.key') }}</b><span class="ad__hint ad__block">{{ i18n.t('mg.act.keyHint') }}</span></span>
        </label>
        <div class="field">
          <span>{{ i18n.t('mg.act.who') }}</span>
          <div class="ad__chips">
            <button type="button" class="seg" [attr.aria-pressed]="who() === 'me'" (click)="who.set('me')"><mat-icon>person</mat-icon>{{ i18n.t('mg.act.me') }}</button>
            <button type="button" class="seg" [attr.aria-pressed]="who() === 'area'" [disabled]="!targets().length" (click)="who.set('area')"><mat-icon>groups</mat-icon>{{ i18n.t('mg.act.area') }}</button>
          </div>
          @if (who() === 'area') {
            <div class="ad__chips">
              @for (t of targets(); track t.id + t.areaId) {
                <button type="button" class="seg" [attr.aria-pressed]="target()?.id === t.id && target()?.areaId === t.areaId" (click)="target.set(t)">{{ t.label }}</button>
              }
            </div>
            @if (target(); as t) {
              <span class="ad__hint">{{ t.kind === 'guard' ? i18n.tf('mg.act.guardHint', t.area) : i18n.tf('mg.act.levelHint', t.label) }}</span>
            }
          } @else if (!targets().length && meta()) {
            <span class="ad__hint">{{ i18n.t('mg.act.noAreas') }}</span>
          }
        </div>
        <label class="field ad__date">
          <span>{{ i18n.t('mg.act.when') }}</span>
          <input name="actDate" class="mono" type="date" [min]="meta()?.today ?? ''" [value]="date()" (input)="date.set(val($event))" />
        </label>
        @if (error(); as e) { <p class="msg msg--error" role="alert">{{ e }}</p> }
      </form>
      <ng-container app-modal-actions>
        <app-button (pressed)="ref.close()">{{ i18n.t('mg.cancel') }}</app-button>
        <app-button variant="primary" [disabled]="!valid() || busy()" (pressed)="create()">{{ i18n.t('mg.act.create') }}</app-button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .ad { display: flex; flex-direction: column; gap: 12px; width: min(560px, calc(100vw - 64px)); }
    .ad__chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .ad__chips mat-icon, .ad__fake mat-icon { width: 15px; height: 15px; font-size: 15px; }
    .ad__fake { display: flex; align-items: center; gap: 6px; min-height: 34px; padding: 6px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); font-size: 13px; }
    .ad__muted, .ad__hint { color: var(--text-muted); font-size: 11.5px; }
    .ad__block { display: block; }
    .ad__check { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; }
    .ad__check input { margin-top: 3px; accent-color: var(--accent); }
    .ad__date { max-width: 220px; }
    .ad__ic { width: 18px; height: 18px; margin-right: 6px; font-size: 18px; vertical-align: -3px; }
  `,
})
export class ActionDialogComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly data = inject<ActionDialogData>(DIALOG_DATA);
  protected readonly ref = inject(DialogRef<boolean>);
  private readonly agenda = inject(AgendaService);

  protected readonly kinds = ACTION_KINDS;
  protected readonly kindKey = kindKey;
  protected readonly suggestions = this.data.ticket ? TICKET_SUGGESTIONS : SUGGESTIONS;
  protected readonly meta = signal<AgendaMeta | null>(null);
  protected readonly name = signal('');
  protected readonly kind = signal<ActionKind>(this.data.ticket ? 'other' : 'meeting');
  protected readonly key = signal(false);
  protected readonly who = signal<'me' | 'area'>('me');
  protected readonly target = signal<Target | null>(null);
  protected readonly date = signal('');
  protected readonly clientId = signal(this.data.client?.id ?? '');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly counts = computed(() => ['meeting', 'committee', 'contact'].includes(this.kind()));

  /** Los niveles y guardias de otras áreas a los que el usuario puede asignar. */
  protected readonly targets = computed<Target[]>(() => {
    const out: Target[] = [];
    for (const a of this.meta()?.areas ?? []) {
      for (const l of a.levels) if (l.allowed) out.push({ id: l.id, areaId: a.id, kind: 'level', label: `${a.name} ${l.name}`, area: a.name, name: l.name });
      for (const g of a.guards) if (g.allowed) out.push({ id: g.id, areaId: a.id, kind: 'guard', label: g.name, area: a.name, name: g.name });
    }
    return out;
  });

  protected readonly valid = computed(() => !!this.name().trim() && !!this.date() && !!this.clientId() && (this.who() === 'me' || !!this.target()) && !!this.meta());

  async ngOnInit(): Promise<void> {
    if (this.data.meeting) this.suggest(SUGGESTIONS[0]);
    try {
      const m = await this.agenda.meta();
      this.meta.set(m);
      this.date.set(m.today);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.loadError')));
    }
  }

  protected suggest(s: Suggestion): void {
    this.name.set(this.i18n.t(s.key));
    this.kind.set(s.kind);
  }

  /** Las acciones propias van al área del usuario (la primera; el admin sin áreas, la primera que puede). */
  private myArea(): string {
    const areas = this.meta()?.areas ?? [];
    return (areas.find((a) => a.mine) ?? areas[0])?.id ?? '';
  }

  protected async create(): Promise<void> {
    const m = this.meta();
    if (!m || !this.valid() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const t = this.target();
    const mine = this.who() === 'me' || !t;
    const ticket = this.data.ticket;
    let name = this.name().trim();
    if (ticket && !name.includes(ticket.number)) name = `${name}: ${ticket.number}`;
    try {
      await this.agenda.createTask({
        name, description: '', areaId: mine ? this.myArea() : t!.areaId, clientId: this.clientId(),
        assigneeKind: mine ? 'person' : t!.kind, assigneeId: mine ? m.me : t!.id,
        recurrence: { kind: 'once', date: this.date() }, warnDays: [1, 0], steps: [], docUrl: '', reportKind: '',
        actionKind: this.kind(), isKey: this.key(), ticketId: ticket?.id ?? null,
      });
      this.ref.close(true);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
