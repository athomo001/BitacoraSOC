import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { OrganizationsService, TeamDetail, TeamSummary } from '../../core/organizations/organizations.service';
import {
  CurrentGuard,
  NotificationFrequency,
  NotificationSchedule,
  NotificationTargetPeriod,
  RotationCycle,
  RotationSlot,
  ShiftsService,
  WorkShift,
} from '../../core/shifts/shifts.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { problemDetail } from '../../core/http-error';
import { AdminShiftRemindersComponent } from './admin-shift-reminders';
import { AdminShiftMembersComponent } from './admin-shift-members';

import '../../core/i18n/packs/admin';
function splitList(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Administración → Turnos (Fase 8, HU-4/HU-5/HU-5b), re-vestido con los
 * componentes del artboard "Administración". Tres bloques, del más usado al
 * menos: los turnos de trabajo (horario y a quién le llega el reporte de
 * cierre), la rotación de guardia de cada equipo (ciclos, rol semanal y
 * reemplazos), el correo periódico de dotación y los recordatorios por
 * correo a los turnos en curso, en pestañas como el artboard. La operación del día a día
 * (la grilla, el enlace TV) vive en /shifts.
 *
 * Sin panel de "reemplazos activos" a propósito: no hay GET de overrides en
 * el contrato; su efecto se ve en "De guardia ahora".
 */

/** "Condiciones a notificar" del legacy, con sus códigos (roleFilter). */
interface StaffingCondition {
  codes: string[];
  labelKey: MessageKey;
}

const STAFFING_CONDITIONS: readonly StaffingCondition[] = [
  { codes: ['N2', 'N1_NO_HABIL'], labelKey: 'shiftsAdmin.cond.guard' },
  { codes: ['TI'], labelKey: 'shiftsAdmin.cond.ti' },
  { codes: ['TELEWORK'], labelKey: 'shiftsAdmin.cond.telework' },
  { codes: ['OL'], labelKey: 'shiftsAdmin.cond.training' },
  { codes: ['VACATION'], labelKey: 'shiftsAdmin.cond.vacation' },
  { codes: ['MEDICAL_APPOINTMENT'], labelKey: 'shiftsAdmin.cond.medicalAppointment' },
  { codes: ['MEDICAL_LEAVE'], labelKey: 'shiftsAdmin.cond.medicalLeave' },
];

/** Asunto por defecto del Reporte de Turno, igual que el legacy (WorkShift.emailReportConfig). */
const DEFAULT_REPORT_SUBJECT = 'Reporte SOC [fecha] [turno]';

@Component({
  selector: 'app-admin-shifts',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule, AdminShiftRemindersComponent, AdminShiftMembersComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-shifts.html',
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .sa__lead { padding-bottom: 0; }
    .sa__form { border-top: 1px solid var(--border-subtle); }
    .sa__chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .sa__on, .sa__on:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
    .sa__block { border-top: 1px solid var(--border-subtle); }
    .sa__report { display: flex; flex-wrap: wrap; gap: 8px 20px; }
    .sa__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .sa__team { display: flex; align-items: center; gap: 8px; min-width: 240px; }
    .sa__guard { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; font-size: 12.5px; }
    .sa__calendar { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
    .sa__week { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--accent); border-radius: var(--radius-md); background: var(--accent-soft); font-size: 12px; }
    .sa__week--paused { border-color: var(--border-subtle); background: var(--bg-app); }
    .sa__row-actions { white-space: nowrap; }
    .sa__row-actions .adm-btn { margin-right: 4px; }
    .sa__tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-left: auto; }
  `,
})
export class AdminShiftsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly orgs = inject(OrganizationsService);
  private readonly api = inject(ShiftsService);

  /** Domingo..sábado en el idioma elegido (0 = domingo, como el backend). */
  protected readonly weekdays = computed(() => {
    const locale = this.prefs.language() === 'es' ? 'es-CL' : 'en-US';
    return Array.from({ length: 7 }, (_, i) => {
      const name = new Date(2024, 0, 7 + i).toLocaleDateString(locale, { weekday: 'long' });
      return name.charAt(0).toUpperCase() + name.slice(1);
    });
  });

  protected readonly tab = signal<'shifts' | 'staffing' | 'reminders'>('shifts');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  // Turnos de trabajo
  protected readonly workShifts = signal<WorkShift[]>([]);
  protected readonly editingShiftId = signal<string | null>(null);
  protected readonly wsName = signal('');
  protected readonly wsStart = signal('08:00');
  protected readonly wsEnd = signal('20:00');
  protected readonly wsTimezone = signal('America/Santiago');
  protected readonly wsEmails = signal('');
  protected readonly wsIncludeChecklist = signal(true);
  protected readonly wsIncludeEntries = signal(true);
  protected readonly wsSubject = signal(DEFAULT_REPORT_SUBJECT);

  // Rotación de guardia
  protected readonly teams = signal<TeamSummary[]>([]);
  protected readonly selectedTeamId = signal('');
  protected readonly teamMembers = signal<TeamDetail['members']>([]);
  protected readonly cycles = signal<RotationCycle[]>([]);
  protected readonly selectedCycle = signal<RotationCycle | null>(null);
  protected readonly slots = signal<RotationSlot[]>([]);
  protected readonly guard = signal<CurrentGuard | null>(null);

  /** "Ana, Pedro y Luis": todas las personas de guardia ahora. */
  protected guardNames(g: CurrentGuard): string {
    const names = (g.currentMembers?.length ? g.currentMembers : g.currentMember ? [g.currentMember] : []).map((m) => m.name);
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} ${this.i18n.t('shiftsAdmin.and')} ${names[names.length - 1]}` : (names[0] ?? '');
  }
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

  // Notificaciones de dotación
  protected readonly schedules = signal<NotificationSchedule[]>([]);
  protected readonly editingScheduleId = signal<string | null>(null);
  protected readonly nsName = signal('');
  protected readonly nsFrequency = signal<NotificationFrequency>('weekly');
  protected readonly nsDayOfWeek = signal(1);
  protected readonly nsSendTime = signal('09:00');
  protected readonly nsRecipients = signal('');
  protected readonly nsCc = signal('');
  /** Códigos del legacy que incluye el correo en lista (vacío = las guardias). */
  protected readonly nsRoleFilter = signal<string[]>([]);
  protected readonly nsEmailFormat = signal<NotificationSchedule['emailFormat']>('calendar');
  protected readonly conditions = STAFFING_CONDITIONS;
  protected readonly nsTargetPeriod = signal<NotificationTargetPeriod>('current_week');

  async ngOnInit(): Promise<void> {
    await this.run(async () => {
      const [teams, shifts, schedules] = await Promise.all([this.orgs.listTeams(), this.api.listWorkShifts(), this.api.listNotificationSchedules()]);
      this.teams.set(teams);
      this.workShifts.set(shifts);
      this.schedules.set(schedules);
      if (teams.length > 0) await this.selectTeam(teams[0].id);
    });
  }

  protected weekday(day: number): string {
    return this.weekdays()[day] ?? String(day);
  }

  // ===== Turnos de trabajo =====

  protected editShift(shift: WorkShift): void {
    this.editingShiftId.set(shift.id);
    this.wsName.set(shift.name);
    this.wsStart.set(shift.startTime);
    this.wsEnd.set(shift.endTime);
    this.wsTimezone.set(shift.timezone);
    this.wsEmails.set(shift.emailRecipients.join(', '));
    this.wsIncludeChecklist.set(shift.emailIncludeChecklist ?? true);
    this.wsIncludeEntries.set(shift.emailIncludeEntries ?? true);
    this.wsSubject.set(shift.emailSubjectTemplate || DEFAULT_REPORT_SUBJECT);
  }

  protected resetShiftForm(): void {
    this.editingShiftId.set(null);
    this.wsName.set('');
    this.wsStart.set('08:00');
    this.wsEnd.set('20:00');
    this.wsTimezone.set('America/Santiago');
    this.wsEmails.set('');
    this.wsIncludeChecklist.set(true);
    this.wsIncludeEntries.set(true);
    this.wsSubject.set(DEFAULT_REPORT_SUBJECT);
  }

  protected async saveShift(): Promise<void> {
    if (!this.wsName().trim()) return;
    const draft = { name: this.wsName().trim(), startTime: this.wsStart(), endTime: this.wsEnd(), timezone: this.wsTimezone().trim(), emailRecipients: splitList(this.wsEmails()) };
    const report = { emailIncludeChecklist: this.wsIncludeChecklist(), emailIncludeEntries: this.wsIncludeEntries(), emailSubjectTemplate: this.wsSubject().trim() || DEFAULT_REPORT_SUBJECT };
    const editing = this.editingShiftId();
    await this.run(async () => {
      if (editing) await this.api.patchWorkShift(editing, { ...draft, ...report });
      else {
        const created = await this.api.createWorkShift({ ...draft, shiftType: 'regular' });
        await this.api.patchWorkShift(created.id, report);
      }
      this.resetShiftForm();
      this.workShifts.set(await this.api.listWorkShifts());
    }, this.i18n.t('admin.saved'));
  }

  protected async toggleShift(shift: WorkShift): Promise<void> {
    await this.run(async () => {
      await this.api.patchWorkShift(shift.id, { active: !shift.active });
      this.workShifts.set(await this.api.listWorkShifts());
    });
  }

  // ===== Rotación de guardia =====

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
      this.teamMembers.set(detail.members);
      const cycles = await this.api.listCycles(teamId);
      this.cycles.set(cycles);
      if (cycles.length > 0) await this.selectCycle(cycles[0]);
      await this.refreshGuard();
    });
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
      await this.api.createSlot({ cycleId: cycle.id, teamMemberId: this.slotMemberId(), weekStartDate: this.slotWeekStart(), weekEndDate: this.slotWeekEnd() });
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
      this.overrideReason.set('');
      await this.refreshGuard();
    }, this.i18n.t('shiftsAdmin.overrideCreated'));
  }

  private async refreshGuard(): Promise<void> {
    const teamId = this.selectedTeamId();
    if (teamId) this.guard.set(await this.api.currentGuard(teamId));
  }

  // ===== Notificaciones de dotación =====

  protected async saveSchedule(): Promise<void> {
    if (!this.nsName().trim() || !this.nsRecipients().trim()) return;
    await this.run(async () => {
      const draft = {
        name: this.nsName().trim(), frequency: this.nsFrequency(), dayOfWeek: this.nsDayOfWeek(), sendTime: this.nsSendTime(),
        recipients: splitList(this.nsRecipients()), ccRecipients: splitList(this.nsCc()), roleFilter: this.nsRoleFilter(),
        targetPeriod: this.nsTargetPeriod(), emailFormat: this.nsEmailFormat(),
      };
      const editing = this.editingScheduleId();
      if (editing) await this.api.patchNotificationSchedule(editing, draft);
      else await this.api.createNotificationSchedule(draft);
      this.cancelScheduleEdit();
      this.schedules.set(await this.api.listNotificationSchedules());
    }, this.i18n.t('admin.saved'));
  }

  protected beginScheduleEdit(schedule: NotificationSchedule): void {
    this.editingScheduleId.set(schedule.id);
    this.nsName.set(schedule.name);
    this.nsFrequency.set(schedule.frequency);
    this.nsDayOfWeek.set(schedule.dayOfWeek);
    this.nsSendTime.set(schedule.sendTime);
    this.nsRecipients.set(schedule.recipients.join(', '));
    this.nsCc.set(schedule.ccRecipients.join(', '));
    this.nsRoleFilter.set(schedule.roleFilter.map((code) => code.toUpperCase()));
    this.nsEmailFormat.set(schedule.emailFormat ?? 'calendar');
    this.nsTargetPeriod.set(schedule.targetPeriod ?? 'current_week');
  }

  protected cancelScheduleEdit(): void {
    this.editingScheduleId.set(null);
    this.nsName.set('');
    this.nsRecipients.set('');
    this.nsCc.set('');
    this.nsRoleFilter.set([]);
    this.nsEmailFormat.set('calendar');
    this.nsTargetPeriod.set('current_week');
  }

  protected hasCondition(c: StaffingCondition, filter: readonly string[] = this.nsRoleFilter()): boolean {
    return c.codes.some((code) => filter.includes(code));
  }

  protected toggleCondition(c: StaffingCondition): void {
    const on = this.hasCondition(c);
    this.nsRoleFilter.update((list) => (on ? list.filter((code) => !c.codes.includes(code)) : [...list, ...c.codes.filter((code) => !list.includes(code))]));
  }

  protected conditionsOf(schedule: NotificationSchedule): StaffingCondition[] {
    const filter = schedule.roleFilter.map((code) => code.toUpperCase());
    return STAFFING_CONDITIONS.filter((c) => this.hasCondition(c, filter));
  }

  protected async testSchedule(schedule: NotificationSchedule): Promise<void> {
    await this.run(async () => this.api.testNotificationSchedule(schedule.id), this.i18n.tf('shiftsAdmin.testSent', schedule.recipients.join(', ')));
  }

  protected async toggleSchedule(schedule: NotificationSchedule): Promise<void> {
    await this.run(async () => {
      await this.api.patchNotificationSchedule(schedule.id, { enabled: !schedule.enabled });
      this.schedules.set(await this.api.listNotificationSchedules());
    });
  }

  /** Ejecuta una acción; si sale bien y hay mensaje, lo muestra. */
  private async run(action: () => Promise<unknown>, successText?: string): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    this.busy.set(true);
    try {
      await action();
      if (successText) this.notice.set(successText);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('shiftsAdmin.error')));
    } finally {
      this.busy.set(false);
    }
  }
}
