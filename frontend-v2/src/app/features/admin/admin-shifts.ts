import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SlicePipe } from '@angular/common';
import { OrganizationsService, TeamDetail, TeamSummary } from '../../core/organizations/organizations.service';
import {
  CurrentGuard,
  NotificationFrequency,
  NotificationSchedule,
  RotationCycle,
  RotationSlot,
  ShiftsService,
  WorkShift,
} from '../../core/shifts/shifts.service';
import { problemDetail } from '../../core/http-error';

const DAYS_OF_WEEK = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function splitList(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Administración → Turnos (Fase 8, HU-4/HU-5/HU-5b): la configuración de
 * fondo del motor de rotación (ciclos, rol semanal, reemplazos), los
 * `work_shifts` y el correo periódico de dotación. La operación del día a
 * día (ver la grilla, editar un día, generar el enlace TV) vive en
 * `/shifts` — mismo criterio que Escalación (políticas acá, despacho allá).
 *
 * Sin panel de "reemplazos activos" con listado propio a propósito: no hay
 * `GET /api/rotation-overrides` en el contrato (solo POST) — el efecto de
 * un override ya se puede verificar con el indicador "guardia actual" de
 * este mismo panel, sin agregar un endpoint nuevo fuera del alcance
 * documentado de esta fase.
 */
@Component({
  selector: 'app-admin-shifts',
  standalone: true,
  imports: [FormsModule, SlicePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <h2 class="panel__title">Ciclos de rotación de guardia</h2>
      <p class="panel__hint">Quién cubre la guardia de un equipo, semana a semana. "Quién está de guardia ahora" se resuelve solo — acá se arma el rol.</p>

      <label class="field shifts-admin__team-picker">
        <span>Equipo</span>
        <select name="teamPicker" [ngModel]="selectedTeamId()" (ngModelChange)="selectTeam($event)">
          <option value="">Elegir…</option>
          @for (t of teams(); track t.id) { <option [value]="t.id">{{ t.name }}</option> }
        </select>
      </label>

      @if (error()) { <p class="msg msg--error">{{ error() }}</p> }

      @if (selectedTeamId()) {
        @if (guard(); as g) {
          <p class="shifts-admin__guard">
            Guardia actual: <strong>{{ g.currentMember?.name ?? 'nadie de turno' }}</strong>
            @if (g.currentMember && g.until) { <span class="shifts-admin__muted"> · hasta {{ g.until | slice:0:16 }}</span> }
          </p>
        }

        <form class="field-grid shifts-admin__form" (ngSubmit)="createCycle()">
          <label class="field">
            <span>Día de inicio</span>
            <select name="cycleDay" [ngModel]="cycleStartDay()" (ngModelChange)="cycleStartDay.set(+$event)">
              @for (d of daysOfWeek; track $index) { <option [value]="$index">{{ d }}</option> }
            </select>
          </label>
          <label class="field"><span>Hora UTC (HH:MM)</span><input name="cycleTime" [ngModel]="cycleStartTime()" (ngModelChange)="cycleStartTime.set($event)" /></label>
          <label class="field"><span>Duración (días)</span><input name="cycleDuration" type="number" min="1" [ngModel]="cycleDuration()" (ngModelChange)="cycleDuration.set(+$event)" /></label>
          <label class="field"><span>Zona horaria</span><input name="cycleTz" [ngModel]="cycleTimezone()" (ngModelChange)="cycleTimezone.set($event)" /></label>
          <div class="actions"><button type="submit" class="shifts-admin__submit">Crear ciclo</button></div>
        </form>

        <table class="shifts-admin__table">
          <thead><tr><th>Día</th><th>Hora UTC</th><th>Duración</th><th>Zona</th><th>Activo</th></tr></thead>
          <tbody>
            @for (c of cycles(); track c.id) {
              <tr [class.shifts-admin__row--selected]="selectedCycle()?.id === c.id" (click)="selectCycle(c)">
                <td>{{ daysOfWeek[c.startDayOfWeek] }}</td>
                <td class="mono">{{ c.startTimeUtc }}</td>
                <td class="mono">{{ c.durationDays }}</td>
                <td>{{ c.timezone }}</td>
                <td>{{ c.active ? 'Sí' : 'No' }}</td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="shifts-admin__empty">Este equipo todavía no tiene ciclo de rotación.</td></tr>
            }
          </tbody>
        </table>
      }
    </section>

    @if (selectedCycle(); as cycle) {
      <section class="panel">
        <h2 class="panel__title">Rol semanal</h2>
        <p class="panel__hint">Una fila por semana y persona. Pausar conserva el historial (HU-5) — no borra la fila.</p>

        <form class="field-grid shifts-admin__form" (ngSubmit)="createSlot()">
          <label class="field">
            <span>Persona</span>
            <select name="slotMember" [ngModel]="slotMemberId()" (ngModelChange)="slotMemberId.set($event)">
              <option value="">Elegir…</option>
              @for (m of teamMembers(); track m.id) { <option [value]="m.id">{{ m.displayName }}</option> }
            </select>
          </label>
          <label class="field"><span>Semana desde</span><input name="slotStart" type="date" [ngModel]="slotWeekStart()" (ngModelChange)="slotWeekStart.set($event)" /></label>
          <label class="field"><span>Semana hasta</span><input name="slotEnd" type="date" [ngModel]="slotWeekEnd()" (ngModelChange)="slotWeekEnd.set($event)" /></label>
          <div class="actions"><button type="submit" class="shifts-admin__submit" [disabled]="!slotMemberId()">Agregar al rol</button></div>
        </form>

        <table class="shifts-admin__table">
          <thead><tr><th>Persona</th><th>Desde</th><th>Hasta</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            @for (s of slots(); track s.id) {
              <tr>
                <td>{{ s.displayName }}</td>
                <td class="mono">{{ s.weekStartDate }}</td>
                <td class="mono">{{ s.weekEndDate }}</td>
                <td>
                  @if (s.isPaused) {
                    <span class="shifts-admin__muted">Pausado @if (s.pausedReason) { ({{ s.pausedReason }}) }</span>
                  } @else {
                    <span>Vigente</span>
                  }
                </td>
                <td>
                  @if (pausingId() === s.id) {
                    <input class="shifts-admin__pause-reason" placeholder="Motivo (ej. licencia médica)" [ngModel]="pauseReason()" (ngModelChange)="pauseReason.set($event)" [ngModelOptions]="{ standalone: true }" />
                    <button type="button" class="shifts-admin__btn" (click)="confirmPause(s)">Confirmar</button>
                    <button type="button" class="shifts-admin__btn" (click)="pausingId.set(null)">Cancelar</button>
                  } @else if (s.isPaused) {
                    <button type="button" class="shifts-admin__btn" (click)="resumeSlot(s)">Reanudar</button>
                  } @else {
                    <button type="button" class="shifts-admin__btn" (click)="startPause(s)">Pausar</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="shifts-admin__empty">Sin filas en el rol de este ciclo.</td></tr>
            }
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h2 class="panel__title">Reemplazo puntual</h2>
        <p class="panel__hint">Ej. alguien de licencia médica: reemplaza al titular del rol solo durante la ventana indicada, sin tocar su fila regular.</p>
        <form class="field-grid shifts-admin__form" (ngSubmit)="createOverride()">
          <label class="field">
            <span>Reemplaza a (opcional)</span>
            <select name="ovOriginal" [ngModel]="overrideOriginal()" (ngModelChange)="overrideOriginal.set($event)">
              <option value="">Cualquiera (cobertura ad-hoc)</option>
              @for (m of teamMembers(); track m.id) { <option [value]="m.id">{{ m.displayName }}</option> }
            </select>
          </label>
          <label class="field">
            <span>Reemplazante</span>
            <select name="ovReplacement" [ngModel]="overrideReplacement()" (ngModelChange)="overrideReplacement.set($event)">
              <option value="">Elegir…</option>
              @for (m of teamMembers(); track m.id) { <option [value]="m.id">{{ m.displayName }}</option> }
            </select>
          </label>
          <label class="field"><span>Desde</span><input name="ovStart" type="datetime-local" [ngModel]="overrideStart()" (ngModelChange)="overrideStart.set($event)" /></label>
          <label class="field"><span>Hasta</span><input name="ovEnd" type="datetime-local" [ngModel]="overrideEnd()" (ngModelChange)="overrideEnd.set($event)" /></label>
          <label class="field"><span>Motivo</span><input name="ovReason" [ngModel]="overrideReason()" (ngModelChange)="overrideReason.set($event)" /></label>
          <div class="actions"><button type="submit" class="shifts-admin__submit" [disabled]="!overrideReplacement() || !overrideReason().trim()">Crear reemplazo</button></div>
        </form>
        @if (overrideOk()) { <p class="msg msg--ok">{{ overrideOk() }}</p> }
      </section>
    }

    <section class="panel">
      <h2 class="panel__title">Turnos</h2>
      <p class="panel__hint">Horario + checklist de inicio/cierre (la plantilla de checklist llega en la Fase 11).</p>
      <form class="field-grid shifts-admin__form" (ngSubmit)="createWorkShift()">
        <label class="field"><span>Nombre</span><input name="wsName" placeholder="Turno Día" [ngModel]="wsName()" (ngModelChange)="wsName.set($event)" /></label>
        <label class="field"><span>Inicio (HH:MM)</span><input name="wsStart" [ngModel]="wsStart()" (ngModelChange)="wsStart.set($event)" /></label>
        <label class="field"><span>Fin (HH:MM)</span><input name="wsEnd" [ngModel]="wsEnd()" (ngModelChange)="wsEnd.set($event)" /></label>
        <label class="field"><span>Zona horaria</span><input name="wsTz" [ngModel]="wsTimezone()" (ngModelChange)="wsTimezone.set($event)" /></label>
        <label class="field"><span>Correos de reporte (separados por coma)</span><input name="wsEmails" [ngModel]="wsEmails()" (ngModelChange)="wsEmails.set($event)" /></label>
        <div class="actions"><button type="submit" class="shifts-admin__submit" [disabled]="!wsName().trim()">Crear turno</button></div>
      </form>
      <table class="shifts-admin__table">
        <thead><tr><th>Nombre</th><th>Horario</th><th>Zona</th><th>Tipo</th></tr></thead>
        <tbody>
          @for (w of workShifts(); track w.id) {
            <tr><td>{{ w.name }}</td><td class="mono">{{ w.startTime }}–{{ w.endTime }}</td><td>{{ w.timezone }}</td><td>{{ w.shiftType }}</td></tr>
          } @empty {
            <tr><td colspan="4" class="shifts-admin__empty">Todavía no hay turnos definidos.</td></tr>
          }
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2 class="panel__title">Notificaciones de dotación</h2>
      <p class="panel__hint">Envío periódico de la matriz de dotación a RRHH/jefatura (HU-5b) — distinto de las alertas en pantalla.</p>
      <form class="field-grid shifts-admin__form" (ngSubmit)="createSchedule()">
        <label class="field"><span>Nombre</span><input name="nsName" placeholder="Reporte de Guardia RRHH" [ngModel]="nsName()" (ngModelChange)="nsName.set($event)" /></label>
        <label class="field">
          <span>Frecuencia</span>
          <select name="nsFrequency" [ngModel]="nsFrequency()" (ngModelChange)="nsFrequency.set($event)">
            <option value="weekly">Semanal</option>
            <option value="monthly">Mensual</option>
          </select>
        </label>
        <label class="field">
          <span>Día</span>
          <select name="nsDay" [ngModel]="nsDayOfWeek()" (ngModelChange)="nsDayOfWeek.set(+$event)">
            @for (d of daysOfWeek; track $index) { <option [value]="$index">{{ d }}</option> }
          </select>
        </label>
        <label class="field"><span>Hora (HH:MM)</span><input name="nsTime" [ngModel]="nsSendTime()" (ngModelChange)="nsSendTime.set($event)" /></label>
        <label class="field"><span>Destinatarios (coma)</span><input name="nsRecipients" placeholder="rrhh@empresa.cl" [ngModel]="nsRecipients()" (ngModelChange)="nsRecipients.set($event)" /></label>
        <label class="field"><span>CC (coma, opcional)</span><input name="nsCc" [ngModel]="nsCc()" (ngModelChange)="nsCc.set($event)" /></label>
        <label class="field"><span>Filtrar por rol (coma, opcional)</span><input name="nsRoleFilter" placeholder="Analista N1" [ngModel]="nsRoleFilter()" (ngModelChange)="nsRoleFilter.set($event)" /></label>
        <div class="actions"><button type="submit" class="shifts-admin__submit" [disabled]="!nsName().trim() || !nsRecipients().trim()">Crear notificación</button></div>
      </form>
      <table class="shifts-admin__table">
        <thead><tr><th>Nombre</th><th>Frecuencia</th><th>Envío</th><th>Destinatarios</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          @for (s of schedules(); track s.id) {
            <tr>
              <td>{{ s.name }}</td>
              <td>{{ s.frequency === 'weekly' ? 'Semanal' : 'Mensual' }}</td>
              <td class="mono">{{ daysOfWeek[s.dayOfWeek] }} {{ s.sendTime }}</td>
              <td class="shifts-admin__muted">{{ s.recipients.join(', ') }}</td>
              <td>{{ s.enabled ? 'Activa' : 'Pausada' }}</td>
              <td><button type="button" class="shifts-admin__btn" (click)="toggleSchedule(s)">{{ s.enabled ? 'Pausar' : 'Activar' }}</button></td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="shifts-admin__empty">Sin notificaciones configuradas.</td></tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .shifts-admin__form { align-items: end; margin: 12px 0; }
    .shifts-admin__team-picker { max-width: 320px; margin-bottom: 8px; }
    .shifts-admin__submit {
      min-height: var(--row-height); padding: 0 14px; background: var(--border-active); border: none;
      border-radius: var(--radius-sm); color: var(--bg-app); font: inherit; font-weight: 600; cursor: pointer;
    }
    .shifts-admin__submit[disabled] { opacity: 0.6; cursor: default; }
    .shifts-admin__table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .shifts-admin__table th { padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); color: var(--text-muted); font-size: 11px; text-align: left; }
    .shifts-admin__table td { height: var(--row-height); padding: 4px 8px; border-bottom: 1px solid var(--border-subtle); }
    .shifts-admin__table tbody tr { cursor: default; }
    .shifts-admin__row--selected td { background: var(--bg-surface-hover); }
    .shifts-admin__empty { color: var(--text-secondary); text-align: center; }
    .shifts-admin__muted { color: var(--text-muted); font-size: 12px; }
    .shifts-admin__guard { margin: 4px 0 12px; font-size: 13px; }
    .shifts-admin__btn {
      min-height: 28px; padding: 0 10px; background: none; border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm); color: var(--text-primary); font: inherit; font-size: 12px; cursor: pointer;
    }
    .shifts-admin__pause-reason {
      min-height: 28px; padding: 0 8px; margin-right: 4px; background: var(--bg-app); border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm); color: var(--text-primary); font: inherit; font-size: 12px;
    }
  `,
})
export class AdminShiftsComponent implements OnInit {
  protected readonly daysOfWeek = DAYS_OF_WEEK;

  private readonly orgs = inject(OrganizationsService);
  private readonly api = inject(ShiftsService);

  protected readonly teams = signal<TeamSummary[]>([]);
  protected readonly selectedTeamId = signal('');
  protected readonly teamDetail = signal<TeamDetail | null>(null);
  protected readonly teamMembers = signal<TeamDetail['members']>([]);
  protected readonly cycles = signal<RotationCycle[]>([]);
  protected readonly selectedCycle = signal<RotationCycle | null>(null);
  protected readonly slots = signal<RotationSlot[]>([]);
  protected readonly guard = signal<CurrentGuard | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly cycleStartDay = signal(1);
  protected readonly cycleStartTime = signal('08:00');
  protected readonly cycleDuration = signal(7);
  protected readonly cycleTimezone = signal('America/Santiago');

  protected readonly slotMemberId = signal('');
  protected readonly slotWeekStart = signal('');
  protected readonly slotWeekEnd = signal('');
  protected readonly pausingId = signal<string | null>(null);
  protected readonly pauseReason = signal('');

  protected readonly overrideOriginal = signal('');
  protected readonly overrideReplacement = signal('');
  protected readonly overrideStart = signal('');
  protected readonly overrideEnd = signal('');
  protected readonly overrideReason = signal('');
  protected readonly overrideOk = signal<string | null>(null);

  protected readonly workShifts = signal<WorkShift[]>([]);
  protected readonly wsName = signal('');
  protected readonly wsStart = signal('08:00');
  protected readonly wsEnd = signal('20:00');
  protected readonly wsTimezone = signal('America/Santiago');
  protected readonly wsEmails = signal('');

  protected readonly schedules = signal<NotificationSchedule[]>([]);
  protected readonly nsName = signal('');
  protected readonly nsFrequency = signal<NotificationFrequency>('weekly');
  protected readonly nsDayOfWeek = signal(1);
  protected readonly nsSendTime = signal('09:00');
  protected readonly nsRecipients = signal('');
  protected readonly nsCc = signal('');
  protected readonly nsRoleFilter = signal('');

  async ngOnInit(): Promise<void> {
    await this.run(async () => {
      this.teams.set(await this.orgs.listTeams());
      this.workShifts.set(await this.api.listWorkShifts());
      this.schedules.set(await this.api.listNotificationSchedules());
    });
  }

  protected async selectTeam(teamId: string): Promise<void> {
    this.selectedTeamId.set(teamId);
    this.selectedCycle.set(null);
    this.slots.set([]);
    this.guard.set(null);
    if (!teamId) {
      this.teamMembers.set([]);
      this.cycles.set([]);
      return;
    }
    await this.run(async () => {
      const detail = await this.orgs.getTeam(teamId);
      this.teamDetail.set(detail);
      this.teamMembers.set(detail.members);
      this.cycles.set(await this.api.listCycles(teamId));
      await this.refreshGuard();
    });
  }

  private async refreshGuard(): Promise<void> {
    const teamId = this.selectedTeamId();
    if (!teamId) return;
    this.guard.set(await this.api.currentGuard(teamId));
  }

  protected async createCycle(): Promise<void> {
    const teamId = this.selectedTeamId();
    if (!teamId) return;
    await this.run(async () => {
      await this.api.createCycle({
        teamId, startDayOfWeek: this.cycleStartDay(), startTimeUtc: this.cycleStartTime(),
        durationDays: this.cycleDuration(), timezone: this.cycleTimezone(),
      });
      this.cycles.set(await this.api.listCycles(teamId));
      await this.refreshGuard();
    });
  }

  protected async selectCycle(cycle: RotationCycle): Promise<void> {
    this.selectedCycle.set(cycle);
    await this.run(async () => this.slots.set(await this.api.listSlots(cycle.id)));
  }

  protected async createSlot(): Promise<void> {
    const cycle = this.selectedCycle();
    if (!cycle || !this.slotMemberId()) return;
    await this.run(async () => {
      await this.api.createSlot({
        cycleId: cycle.id, teamMemberId: this.slotMemberId(),
        weekStartDate: this.slotWeekStart(), weekEndDate: this.slotWeekEnd(),
      });
      this.slotMemberId.set('');
      this.slots.set(await this.api.listSlots(cycle.id));
      await this.refreshGuard();
    });
  }

  protected startPause(slot: RotationSlot): void {
    this.pausingId.set(slot.id);
    this.pauseReason.set('');
  }

  protected async confirmPause(slot: RotationSlot): Promise<void> {
    const cycle = this.selectedCycle();
    if (!cycle) return;
    await this.run(async () => {
      await this.api.pauseSlot(slot.id, true, this.pauseReason().trim() || undefined);
      this.pausingId.set(null);
      this.slots.set(await this.api.listSlots(cycle.id));
      await this.refreshGuard();
    });
  }

  protected async resumeSlot(slot: RotationSlot): Promise<void> {
    const cycle = this.selectedCycle();
    if (!cycle) return;
    await this.run(async () => {
      await this.api.pauseSlot(slot.id, false);
      this.slots.set(await this.api.listSlots(cycle.id));
      await this.refreshGuard();
    });
  }

  protected async createOverride(): Promise<void> {
    const cycle = this.selectedCycle();
    if (!cycle || !this.overrideReplacement() || !this.overrideReason().trim()) return;
    await this.run(async () => {
      await this.api.createOverride({
        cycleId: cycle.id,
        originalTeamMemberId: this.overrideOriginal() || undefined,
        replacementTeamMemberId: this.overrideReplacement(),
        startDate: new Date(this.overrideStart()).toISOString(),
        endDate: new Date(this.overrideEnd()).toISOString(),
        reason: this.overrideReason().trim(),
      });
      this.overrideOk.set('Reemplazo creado.');
      this.overrideReason.set('');
      await this.refreshGuard();
    });
  }

  protected async createWorkShift(): Promise<void> {
    if (!this.wsName().trim()) return;
    await this.run(async () => {
      await this.api.createWorkShift({
        name: this.wsName().trim(), startTime: this.wsStart(), endTime: this.wsEnd(),
        timezone: this.wsTimezone(), shiftType: 'regular', emailRecipients: splitList(this.wsEmails()),
      });
      this.wsName.set('');
      this.wsEmails.set('');
      this.workShifts.set(await this.api.listWorkShifts());
    });
  }

  protected async createSchedule(): Promise<void> {
    if (!this.nsName().trim() || !this.nsRecipients().trim()) return;
    await this.run(async () => {
      await this.api.createNotificationSchedule({
        name: this.nsName().trim(), frequency: this.nsFrequency(), dayOfWeek: this.nsDayOfWeek(),
        sendTime: this.nsSendTime(), recipients: splitList(this.nsRecipients()),
        ccRecipients: splitList(this.nsCc()), roleFilter: splitList(this.nsRoleFilter()),
      });
      this.nsName.set('');
      this.nsRecipients.set('');
      this.nsCc.set('');
      this.nsRoleFilter.set('');
      this.schedules.set(await this.api.listNotificationSchedules());
    });
  }

  protected async toggleSchedule(schedule: NotificationSchedule): Promise<void> {
    await this.run(async () => {
      await this.api.patchNotificationSchedule(schedule.id, { enabled: !schedule.enabled });
      this.schedules.set(await this.api.listNotificationSchedules());
    });
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo completar la acción.'));
    }
  }
}
