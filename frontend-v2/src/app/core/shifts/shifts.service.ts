import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export interface RotationCycle {
  id: string;
  teamId: string;
  startDayOfWeek: number;
  startTimeUtc: string;
  durationDays: number;
  timezone: string;
  active: boolean;
}

export interface RotationSlot {
  id: string;
  cycleId: string;
  teamMemberId: string;
  displayName: string;
  weekStartDate: string;
  weekEndDate: string;
  isPaused: boolean;
  pausedReason?: string;
}

export interface RotationOverride {
  id: string;
  cycleId: string;
  originalTeamMemberId?: string;
  replacementTeamMemberId: string;
  startDate: string;
  endDate: string;
  reason: string;
  createdBy: string;
}

export interface CurrentGuard {
  currentMember: { teamMemberId: string; name: string } | null;
  since?: string;
  until?: string;
}

export interface WorkShift {
  id: string;
  rotationCycleId?: string;
  name: string;
  startTime: string;
  endTime: string;
  timezone: string;
  shiftType: string;
  checklistTemplateStartId?: string;
  checklistTemplateEndId?: string;
  emailRecipients: string[];
  active: boolean;
}

export type TeleworkCondition = 'telework' | 'office' | 'guardia' | 'vacation' | 'medical_leave' | 'medical_appointment' | 'training';

/** Mismo texto/orden de relevancia que internal/rotation.Meta en el backend. */
export const CONDITION_LABELS: Record<TeleworkCondition, string> = {
  medical_leave: 'Licencia Médica',
  vacation: 'Vacaciones',
  medical_appointment: 'Trámite Médico',
  training: 'Capacitación',
  guardia: 'Guardia',
  telework: 'Teletrabajo',
  office: 'En Oficina',
};

/**
 * Color por condición para la grilla — SIEMPRE los 5 tokens `--status-*` ya
 * definidos (spec/06-frontend-arquitectura-y-ui.md sección 1.1), nunca hex
 * propio: la paleta legacy quedó descartada (spec/02-alcance-y-roadmap.md
 * sección 4). El backend usa el mismo mapeo (internal/rotation.Meta) para
 * pintar la página pública de TV, que no puede leer variables CSS de
 * Angular y por eso repite los valores hex de esos mismos tokens.
 */
export const CONDITION_COLOR_VAR: Record<TeleworkCondition, string> = {
  medical_leave: 'var(--status-critical)',
  vacation: 'var(--status-critical)',
  medical_appointment: 'var(--status-warning)',
  training: 'var(--status-system)',
  guardia: 'var(--status-carrier)',
  telework: 'var(--status-ok)',
  office: 'var(--text-secondary)',
};

export interface MatrixColumn {
  date: string;
  dayShort: string;
  isToday: boolean;
}

export interface MatrixCell {
  date: string;
  condition: TeleworkCondition;
  label: string;
  marker: string;
}

export interface MatrixRow {
  userId: string;
  name: string;
  role: string;
  days: MatrixCell[];
}

export interface Matrix {
  columns: MatrixColumn[];
  rows: MatrixRow[];
}

export interface Assignment {
  id: string;
  userId: string;
  assignedDate: string;
  condition: TeleworkCondition;
  notes?: string;
}

export interface PublicShare {
  token?: string;
  publicUrl?: string;
  isActive: boolean;
}

export type NotificationFrequency = 'weekly' | 'monthly';

export interface NotificationSchedule {
  id: string;
  name: string;
  enabled: boolean;
  frequency: NotificationFrequency;
  dayOfWeek: number;
  sendTime: string;
  roleFilter: string[];
  recipients: string[];
  ccRecipients: string[];
  lastSentAt?: string;
}

/** Turnos, rotación de guardia y dotación/teletrabajo (Fase 8). */
@Injectable({ providedIn: 'root' })
export class ShiftsService {
  private readonly http = inject(HttpClient);

  // ===== Ciclos de rotación =====

  async listCycles(teamId?: string): Promise<RotationCycle[]> {
    const params: Record<string, string> = {};
    if (teamId) params['teamId'] = teamId;
    return (await firstValueFrom(this.http.get<ApiEnvelope<RotationCycle[]>>('/api/rotation-cycles', { params }))).data;
  }

  async createCycle(cycle: { teamId: string; startDayOfWeek: number; startTimeUtc: string; durationDays: number; timezone: string }): Promise<RotationCycle> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<RotationCycle>>('/api/rotation-cycles', cycle))).data;
  }

  // ===== Rol semanal (slots) =====

  async listSlots(cycleId: string): Promise<RotationSlot[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<RotationSlot[]>>('/api/rotation-slots', { params: { cycleId } }))).data;
  }

  async createSlot(slot: { cycleId: string; teamMemberId: string; weekStartDate: string; weekEndDate: string }): Promise<RotationSlot> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<RotationSlot>>('/api/rotation-slots', slot))).data;
  }

  /** HU-5: pausar sin borrar la fila. */
  async pauseSlot(id: string, isPaused: boolean, pausedReason?: string): Promise<RotationSlot> {
    return (await firstValueFrom(this.http.patch<ApiEnvelope<RotationSlot>>(`/api/rotation-slots/${id}`, { isPaused, pausedReason }))).data;
  }

  async currentGuard(teamId: string): Promise<CurrentGuard> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<CurrentGuard>>('/api/rotation-slots/current', { params: { teamId } }))).data;
  }

  // ===== Reemplazos puntuales =====

  async createOverride(override: { cycleId: string; originalTeamMemberId?: string; replacementTeamMemberId: string; startDate: string; endDate: string; reason: string }): Promise<RotationOverride> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<RotationOverride>>('/api/rotation-overrides', override))).data;
  }

  // ===== Turnos (checklist inicio/cierre, Fase 11 los conecta) =====

  async listWorkShifts(active?: boolean): Promise<WorkShift[]> {
    const params: Record<string, string> = {};
    if (active !== undefined) params['active'] = String(active);
    return (await firstValueFrom(this.http.get<ApiEnvelope<WorkShift[]>>('/api/work-shifts', { params }))).data;
  }

  async createWorkShift(shift: { name: string; startTime: string; endTime: string; timezone: string; shiftType: string; rotationCycleId?: string; emailRecipients: string[] }): Promise<WorkShift> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<WorkShift>>('/api/work-shifts', shift))).data;
  }

  // ===== Matriz y asignaciones de dotación (HU-4b) =====

  async matrix(from?: string, to?: string): Promise<Matrix> {
    const params: Record<string, string> = {};
    if (from) params['from'] = from;
    if (to) params['to'] = to;
    return (await firstValueFrom(this.http.get<ApiEnvelope<Matrix>>('/api/work-shifts/matrix', { params }))).data;
  }

  async setAssignment(assignment: { userId: string; assignedDate: string; condition: TeleworkCondition; notes?: string }): Promise<Assignment> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<Assignment>>('/api/work-shifts/assignments', assignment))).data;
  }

  // ===== Enlace público TV =====

  async publicShareAction(action: 'generate' | 'regenerate' | 'deactivate'): Promise<PublicShare> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<PublicShare>>('/api/public-shares/telework', { action }))).data;
  }

  // ===== Notificación periódica a RRHH (HU-5b) =====

  async listNotificationSchedules(): Promise<NotificationSchedule[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<NotificationSchedule[]>>('/api/work-shifts/notification-schedules'))).data;
  }

  async createNotificationSchedule(schedule: {
    name: string; frequency: NotificationFrequency; dayOfWeek: number; sendTime: string;
    roleFilter?: string[]; recipients: string[]; ccRecipients?: string[];
  }): Promise<NotificationSchedule> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<NotificationSchedule>>('/api/work-shifts/notification-schedules', schedule))).data;
  }

  async patchNotificationSchedule(id: string, patch: Partial<{
    enabled: boolean; name: string; frequency: NotificationFrequency; dayOfWeek: number; sendTime: string;
    roleFilter: string[]; recipients: string[]; ccRecipients: string[];
  }>): Promise<NotificationSchedule> {
    return (await firstValueFrom(this.http.patch<ApiEnvelope<NotificationSchedule>>(`/api/work-shifts/notification-schedules/${id}`, patch))).data;
  }
}
