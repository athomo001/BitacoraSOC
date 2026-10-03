import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogRef } from '@angular/cdk/dialog';
import { ModalComponent } from '../../shared/ui/modal/modal';
import { ButtonComponent } from '../../shared/ui/button/button';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { Organization, OrganizationsService, TeamSummary } from '../../core/organizations/organizations.service';
import { Impact, TicketType, TicketsService, Urgency } from '../../core/tickets/tickets.service';
import { PRIORITY_SHORT, PRIORITY_TONE, priorityOf, resolverTeams } from '../../core/tickets/ticket-view';
import { ModuleAccessService } from '../../core/auth/module-access.service';

const IMPACTS: readonly Impact[] = ['low', 'medium', 'high'];
const URGENCIES: readonly Urgency[] = ['low', 'medium', 'high', 'critical'];

/**
 * Alta de ticket (diseño aprobado): cliente y equipo desde listas reales —
 * nunca un UUID escrito a mano — e impacto/urgencia con un clic, mostrando la
 * prioridad ITIL resultante antes de crear. Cierra devolviendo el id creado.
 */
@Component({
  selector: 'app-new-ticket-dialog',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal>
      <span app-modal-title>{{ i18n.t('tickets.newDialog.title') }}</span>
      <form class="nt" id="new-ticket-form" (submit)="$event.preventDefault(); create()">
        <div class="nt__row">
          <button type="button" class="seg" [attr.aria-pressed]="type() === 'incident'" (click)="type.set('incident')">{{ i18n.t('tickets.type.incident') }}</button>
          <button type="button" class="seg" [attr.aria-pressed]="type() === 'service_request'" (click)="type.set('service_request')">{{ i18n.t('tickets.type.service_request') }}</button>
          <span class="nt__hint">{{ i18n.t(type() === 'incident' ? 'tickets.newDialog.hintIncident' : 'tickets.newDialog.hintRequest') }}</span>
        </div>
        <div class="field-grid">
          <label class="field">
            <span>{{ i18n.t('tickets.newDialog.client') }}</span>
            <select name="clientId" [(ngModel)]="clientId" required>
              <option value="" disabled>{{ i18n.t('tickets.newDialog.choose') }}</option>
              @for (c of clients(); track c.id) { <option [value]="c.id">{{ c.name }}{{ c.viaName ? ' (' + i18n.tf('orgs.viaShort', c.viaName) + ')' : '' }}</option> }
            </select>
          </label>
          <label class="field">
            <span>{{ i18n.t('tickets.newDialog.team') }}</span>
            <select name="teamId" [(ngModel)]="teamId">
              <option value="">{{ i18n.t('tickets.newDialog.teamLater') }}</option>
              @for (tm of teams(); track tm.id) { <option [value]="tm.id">{{ tm.name }}</option> }
            </select>
          </label>
          <label class="field">
            <span>{{ i18n.t('tickets.newDialog.scope') }}</span>
            <select name="scope" [(ngModel)]="scope">
              @if (modules.noc()) { <option value="noc">NOC</option> }
              @if (modules.soc()) { <option value="soc">SOC</option> }
              <option value="general">General</option>
            </select>
          </label>
        </div>
        <label class="field">
          <span>{{ i18n.t('tickets.newDialog.ticketTitle') }}</span>
          <input name="title" [(ngModel)]="title" required maxlength="200" />
        </label>
        <label class="field">
          <span>{{ i18n.t('tickets.newDialog.description') }}</span>
          <textarea name="description" class="nt__textarea" [(ngModel)]="description" required></textarea>
        </label>
        <div class="nt__levels">
          <div class="field">
            <span>{{ i18n.t('tickets.newDialog.impact') }}</span>
            <div class="nt__row">
              @for (v of impacts; track v) {
                <button type="button" class="seg" [attr.aria-pressed]="impact() === v" (click)="impact.set(v)">{{ i18n.t(levelKey(v)) }}</button>
              }
            </div>
          </div>
          <div class="field">
            <span>{{ i18n.t('tickets.newDialog.urgency') }}</span>
            <div class="nt__row">
              @for (v of urgencies; track v) {
                <button type="button" class="seg" [attr.aria-pressed]="urgency() === v" (click)="urgency.set(v)">{{ i18n.t(urgencyKey(v)) }}</button>
              }
            </div>
          </div>
        </div>
        <div class="nt__preview" role="status">
          <span class="pill mono" [class]="'tone-' + priorityTone[priority()]">{{ priorityShort[priority()] }}</span>
          <span>{{ i18n.t('tickets.newDialog.priority') }} {{ i18n.t(priorityKey()) }}</span>
          <span class="mono nt__sla">{{ i18n.tf('tickets.newDialog.slaPreview', type() === 'incident' ? '8 h' : '72 h') }}</span>
        </div>
        @if (error()) { <p class="msg msg--error" role="alert">{{ error() }}</p> }
      </form>
      <ng-container app-modal-actions>
        <app-button (pressed)="dialogRef.close()">{{ i18n.t('tickets.newDialog.cancel') }}</app-button>
        <app-button variant="primary" [disabled]="!valid() || busy()" (pressed)="create()">{{ i18n.t('tickets.newDialog.create') }}</app-button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .nt {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: min(560px, calc(100vw - 64px));
    }

    .nt__row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }

    .nt__hint {
      margin-left: auto;
      color: var(--text-muted);
      font-size: 11px;
    }

    .nt__textarea {
      min-height: 72px;
      padding: 8px 10px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm);
      background: var(--bg-app);
      color: var(--text-primary);
      font: inherit;
      font-size: 13px;
      resize: vertical;
    }

    .nt__levels {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }

    .nt__preview {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      background: var(--bg-app);
      font-size: 12px;
    }

    .nt__sla {
      margin-left: auto;
      color: var(--text-muted);
      font-size: 11px;
    }
  `,
})
export class NewTicketDialogComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly dialogRef = inject(DialogRef<string | undefined>);
  private readonly orgs = inject(OrganizationsService);
  private readonly api = inject(TicketsService);
  /** Sin NOC (o sin SOC) ese ámbito no se ofrece. */
  protected readonly modules = inject(ModuleAccessService);

  protected readonly impacts = IMPACTS;
  protected readonly urgencies = URGENCIES;
  protected readonly priorityShort = PRIORITY_SHORT;
  protected readonly priorityTone = PRIORITY_TONE;

  protected readonly clients = signal<Organization[]>([]);
  protected readonly teams = signal<TeamSummary[]>([]);
  protected readonly type = signal<TicketType>('incident');
  protected readonly impact = signal<Impact>('medium');
  protected readonly urgency = signal<Urgency>('medium');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected clientId = '';
  protected teamId = '';
  protected scope: 'soc' | 'noc' | 'general' = 'general';
  protected title = '';
  protected description = '';

  protected readonly priority = computed(() => priorityOf(this.impact(), this.urgency()));
  protected readonly priorityKey = computed(() => `tickets.priority.${this.priority()}` as MessageKey);

  async ngOnInit(): Promise<void> {
    try {
      const [clients, teams] = await Promise.all([this.orgs.list({ clients: true, active: true }), this.orgs.listTeams()]);
      this.clients.set(clients);
      await this.modules.load();
      this.scope = this.modules.soc() ? 'soc' : this.modules.noc() ? 'noc' : 'general';
      this.teams.set(resolverTeams(teams));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('tickets.error.load')));
    }
  }

  protected levelKey(level: string): MessageKey {
    return `tickets.level.${level}` as MessageKey;
  }

  protected urgencyKey(level: string): MessageKey {
    return `tickets.urgency.${level}` as MessageKey;
  }

  protected valid(): boolean {
    return !!this.clientId && !!this.title.trim() && !!this.description.trim();
  }

  protected async create(): Promise<void> {
    if (!this.valid() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const created = await this.api.create({
        ticketType: this.type(), scope: this.scope, clientId: this.clientId, teamId: this.teamId || undefined,
        impact: this.impact(), urgency: this.urgency(), title: this.title.trim(), description: this.description.trim(),
      });
      this.dialogRef.close(created.id);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('tickets.error.create')));
    } finally {
      this.busy.set(false);
    }
  }
}
