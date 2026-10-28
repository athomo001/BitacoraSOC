import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export interface TeamArea {
  code: string;
  name: string;
  /** Es jefatura del área (el auditor ve las demás solo para la Calidad). */
  lead?: boolean;
  /** El área usa la Bitácora y tiene la pestaña Calidad (10f). */
  quality?: boolean;
  /** Es un departamento completo (code «dep:<id>»): solo para mirar. */
  department?: boolean;
}

/** Un departamento que dirige (spec/16 §3.5.1), con sus áreas. */
export interface TeamDepartment {
  id: string;
  name: string;
  areas: TeamArea[];
  quality: boolean;
  lead: boolean;
}

/** «dep:<id>» es el departamento completo; si no, el código del área. */
function scope(area: string): { area: string } | { department: string } {
  return area.startsWith('dep:') ? { department: area.slice(4) } : { area };
}

export interface TeamCandidate {
  id: string;
  username: string;
  name: string;
  /** Las áreas en que ya está (sigue en ellas). */
  areas: string[];
}

export type QualityRuleKey = 'copy' | 'burst' | 'batch' | 'gaps' | 'short' | 'routine' | 'vocabulary';
export type QualityStatus = 'excelente' | 'estable' | 'simplificado' | 'relleno' | 'sin_evaluar';

/** Una muestra para explicar una regla (según la regla: texto, racha o turno). */
export interface QualityExample {
  text?: string;
  times?: number;
  at?: string;
  until?: string;
  shift?: string;
  count?: number;
}

export interface QualityRule {
  key: QualityRuleKey;
  /** Porcentaje medido sobre entradas o turnos. */
  pct: number;
  count: number;
  of: number;
  /** Negativo baja; positivo suma (vocabulario). */
  points: number;
  /** Pasa el límite que el legacy marcaba como vicio. */
  flagged: boolean;
  examples?: QualityExample[];
}

export interface QualityPerson {
  id: string;
  name: string;
  level: string;
  absence: { kind: 'vacation' | 'medical_leave'; days: number } | null;
  entries: number;
  shifts: number;
  evaluated: boolean;
  score: number;
  status: QualityStatus;
  rules: QualityRule[];
}

export interface QualityView {
  areaCode: string;
  areaName: string;
  /** 7, 15 o 30; 0 si se pidió un mes. */
  days: number;
  month?: string;
  from: string;
  to: string;
  minEntries: number;
  people: QualityPerson[];
}

export type ActivityKind = 'entries' | 'mail' | 'escalation' | 'tickets' | 'shift';

/** Las acciones de una persona de un tipo en un día (1 = lunes … 7 = domingo) y una hora (0-23). */
export interface ActivityCell {
  userId: string;
  kind: ActivityKind;
  day: number;
  hour: number;
  count: number;
}

export interface ActivityView {
  areaCode: string;
  areaName: string;
  /** 7, 30 o 90; 0 si se pidió un mes. */
  days: number;
  month?: string;
  from: string;
  to: string;
  kinds: ActivityKind[];
  people: { id: string; name: string; level: string }[];
  cells: ActivityCell[];
}

export interface TeamGroup {
  id: string;
  name: string;
  level?: string;
}

/** Condición del día: la de Dotación, o la guardia. */
export type TeamCondition = 'office' | 'telework' | 'guardia' | 'vacation' | 'medical_leave' | 'medical_appointment' | 'training';

export interface TeamPerson {
  id: string;
  /** En la vista del departamento, las áreas en que está. */
  areas?: string[];
  username: string;
  fullName: string;
  email: string;
  active: boolean;
  /** La jefatura puede tocarla (no es admin, ni ella misma, ni tiene grupos de otras áreas). */
  editable: boolean;
  /** La jefatura la puede sacar del área («Sacar del equipo»; la cuenta sigue activa). */
  removable?: boolean;
  groups: TeamGroup[];
  today: TeamCondition;
  week: { date: string; condition: TeamCondition }[];
  tickets: number;
  breached: number;
}

export interface TeamView {
  area: TeamArea;
  stats: { people: number; tickets: number; breached: number; away: number };
  people: TeamPerson[];
  /** Los grupos del área que la jefatura puede asignar. */
  groups: TeamGroup[];
}

export interface TeamTicket {
  id: string;
  number: string;
  title: string;
  status: string;
  breached: boolean;
}

export interface NewTeamPerson {
  area: string;
  fullName: string;
  username: string;
  email: string;
  groupId: string;
}

/** Mi equipo: la jefatura de área (spec/16 §3.5, 9d). */
/** Una persona (o el total) del resumen mensual (9.7). */
export interface MonthlyPerson {
  id: string;
  name: string;
  level: string;
  tasks: number;
  onTime: number;
  doneLate: number;
  openLate: number;
  skipped: number;
  tickets: number;
  ticketsSla: number;
  absentDays: number;
  /** Metas propias cumplidas en el mes (las del bono, confirmadas). */
  goalsDone?: number;
  /** Entradas en la Bitácora del mes (10f). */
  entries?: number;
  /** Puntaje de calidad del mes; -1 = sin evaluar (en el total, el promedio). */
  quality?: number;
}

export interface MonthlySummary {
  month: string;
  areaCode: string;
  areaName: string;
  bizDays: number;
  people: MonthlyPerson[];
  total: MonthlyPerson;
  computedAt: string;
}

export interface MonthlyView {
  summary: MonthlySummary;
  /** El mes ya se congeló (foto del primer día hábil del mes siguiente). */
  frozen: boolean;
  /** -1 = sin datos. */
  onTimePct: number;
  slaPct: number;
  previous: { onTimePct: number; slaPct: number; quality?: number };
  /** El área usa la Bitácora: muestra entradas y calidad (10f). */
  bitacora?: boolean;
  /** La Ticketera está encendida; si no, sus columnas no aparecen. */
  tickets?: boolean;
}

@Injectable({ providedIn: 'root' })
export class TeamService {
  private readonly http = inject(HttpClient);

  async areas(): Promise<TeamArea[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TeamArea[]>>('/api/team/areas'))).data;
  }

  async departments(): Promise<TeamDepartment[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TeamDepartment[]>>('/api/team/departments'))).data;
  }

  async team(area: string): Promise<TeamView> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TeamView>>('/api/team', { params: scope(area) }))).data;
  }

  async tickets(area: string, personId: string): Promise<TeamTicket[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TeamTicket[]>>(`/api/team/people/${personId}/tickets`, { params: { area } }))).data;
  }

  /** Alta con contraseña temporal: se muestra una sola vez. */
  async create(person: NewTeamPerson): Promise<{ id: string; username: string; tempPassword: string }> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ id: string; username: string; tempPassword: string }>>('/api/team/people', person))).data;
  }

  async setGroup(area: string, personId: string, groupId: string): Promise<void> {
    await firstValueFrom(this.http.put(`/api/team/people/${personId}/group`, { area, groupId }));
  }

  /** Resumen mensual del área (month = YYYY-MM). */
  async monthly(area: string, month: string): Promise<MonthlyView> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<MonthlyView>>('/api/team/monthly', { params: { ...scope(area), month } }))).data;
  }

  /** Calidad de registro del área en los últimos 7, 15 o 30 días, o en un mes YYYY-MM (10f). */
  async quality(area: string, period: { days: number } | { month: string }): Promise<QualityView> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<QualityView>>('/api/team/quality', { params: { ...scope(area), ...period } }))).data;
  }

  async activity(area: string, period: { days: number } | { month: string }): Promise<ActivityView> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ActivityView>>('/api/team/activity', { params: { ...scope(area), ...period } }))).data;
  }

  async sendMonthly(area: string, month: string, to: string[]): Promise<void> {
    await firstValueFrom(this.http.post('/api/team/monthly/send', { ...scope(area), month, to }));
  }

  /** Cuentas activas que todavía no están en el área (para agregar a alguien que ya existe). */
  async candidates(area: string): Promise<TeamCandidate[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TeamCandidate[]>>('/api/team/candidates', { params: { area } }))).data;
  }

  async join(area: string, personId: string, groupId: string): Promise<void> {
    await firstValueFrom(this.http.post(`/api/team/people/${personId}/join`, { area, groupId }));
  }

  /** Saca a la persona del área; su cuenta y sus entradas quedan. */
  async leave(area: string, personId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/team/people/${personId}`, { params: { area } }));
  }
}
