import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

/** Cuándo toca una tarea (internal/agenda.Recurrence). */
export type RecurrenceKind = 'once' | 'days' | 'weekly' | 'bizN' | 'lastBiz' | 'fixed';
export interface Recurrence {
  kind: RecurrenceKind;
  date?: string;
  start?: string;
  every?: number;
  weekdays?: number[];
  n?: number;
  day?: number;
  shift?: 'prev' | 'next';
}

export type AssigneeKind = 'person' | 'level' | 'guard';
export type ReportKind = 'incident' | 'bulletin';

export interface AgendaTask {
  id: string;
  name: string;
  description: string;
  areaId: string;
  areaName: string;
  clientId?: string;
  clientName?: string;
  paused: boolean;
  assigneeKind: AssigneeKind;
  assigneeId?: string;
  assigneeName: string;
  recurrence: Recurrence;
  warnDays: number[];
  steps: string[];
  docUrl?: string;
  reportKind?: ReportKind;
  active: boolean;
  createdBy?: string;
  createdByName: string;
  canEdit: boolean;
  /** Es un paso de un flujo (9.7): se edita desde el flujo. */
  flowId?: string;
  /** Acciones de la Gestión CSM (9.4): tipo, tarea clave y el ticket que sigue. */
  actionKind?: ActionKind;
  isKey?: boolean;
  ticketId?: string;
  ticketNumber?: string;
}

/** Reunión, Comité y Contacto cuentan como contacto con el cliente (spec/16 §4.4.1). */
export type ActionKind = 'meeting' | 'committee' | 'contact' | 'report' | 'other';

/** El paso de un flujo en una ocurrencia y, si espera, a qué paso espera (9.7). */
export interface AgendaOccurrenceFlow {
  id: string;
  name: string;
  position: number;
  total: number;
  waitingFor?: string;
  waitingArea?: string;
}

export interface AgendaOccurrence {
  id: string;
  task: AgendaTask;
  dueDate: string;
  dueAt: string;
  movedFrom?: string;
  /** waiting: paso de un flujo que espera que termine el anterior. */
  status: 'pending' | 'done' | 'skipped' | 'waiting';
  late: boolean;
  /** Días hábiles desde hoy hasta el vencimiento (negativo si ya pasó). */
  bizDays: number;
  holderId?: string;
  holderName?: string;
  offeredLevel?: string;
  absentName?: string;
  stepsDone: number[];
  note?: string;
  link?: string;
  skipReason?: string;
  closedByName?: string;
  closedAt?: string;
  onTime: boolean;
  byReport: boolean;
  /** Más allá de lo generado: se proyecta desde la recurrencia (sin acciones). */
  projected?: boolean;
  mine: boolean;
  canTake: boolean;
  canAct: boolean;
  canSkip: boolean;
  canRelease: boolean;
  canReopen: boolean;
  flow?: AgendaOccurrenceFlow;
}

export interface AgendaAssignee { id: string; name: string; rank?: number; allowed: boolean; }
export interface AgendaAreaOptions {
  id: string;
  code: string;
  name: string;
  mine: boolean;
  lead: boolean;
  myRank: number;
  levels: AgendaAssignee[];
  people: AgendaAssignee[];
  guards: AgendaAssignee[];
}

export interface AgendaMeta {
  today: string;
  workDays: number[];
  dayStart: string;
  dayEnd: string;
  holidays: Record<string, string>;
  areas: AgendaAreaOptions[];
  me: string;
  admin: boolean;
  viewAll: boolean;
  leadAreas: string[];
  crossArea: boolean;
}

export interface AgendaManagedRow {
  task: AgendaTask;
  next?: AgendaOccurrence;
  /** Últimas veces: ok (a tiempo), late (tarde), skip (omitida), open (atrasada abierta). */
  history: ('ok' | 'late' | 'skip' | 'open')[];
  state: 'ok' | 'risk' | 'late' | 'paused';
  openLate: number;
}

export interface AgendaManaged {
  tasks: AgendaManagedRow[];
  /** -1 si no hay nada cerrado todavía. */
  onTimePct: number;
  openLate: number;
  atRisk: number;
  occurrences: number;
}

export interface AgendaTaskInput {
  name: string;
  description: string;
  areaId: string;
  clientId?: string | null;
  assigneeKind: AssigneeKind;
  assigneeId: string;
  recurrence: Recurrence;
  warnDays: number[];
  steps: string[];
  docUrl: string;
  reportKind: ReportKind | '';
  /** Ventana de mantenimiento con la misma fecha (solo tareas de una vez, al crearlas). */
  window?: { start: string; end: string; suppress: boolean } | null;
  /** Acciones de la Gestión CSM; sin enviar, al editar se conservan. */
  actionKind?: ActionKind | '';
  isKey?: boolean;
  ticketId?: string | null;
}

export interface PreviewDate { date: string; movedFrom?: string; reason?: string; }

/** Un paso de un flujo entre áreas (9.7). after: espera que termine el anterior. */
export interface AgendaFlowStep {
  taskId?: string;
  position?: number;
  name: string;
  description: string;
  areaId: string;
  areaName?: string;
  assigneeKind: AssigneeKind;
  assigneeId: string;
  assigneeName?: string;
  /** true: empieza al terminar el anterior (days hábiles desde ahí); false: en paralelo (days desde el inicio). */
  after: boolean;
  days: number;
  steps: string[];
  docUrl?: string;
  warnDays: number[];
}

export interface AgendaFlowRunStep {
  taskId: string;
  occurrenceId: string;
  status: 'pending' | 'done' | 'skipped' | 'waiting';
  dueDate: string;
  late: boolean;
  holderName?: string;
  offeredLevel?: string;
  closedAt?: string;
}

export interface AgendaFlow {
  id: string;
  name: string;
  clientId?: string;
  clientName?: string;
  paused: boolean;
  recurrence: Recurrence;
  createdByName: string;
  canEdit: boolean;
  steps: AgendaFlowStep[];
  /** La vuelta que se muestra: la abierta que ya empezó, si no la próxima, si no la última. */
  run?: { id: string; startDate: string; done: number; steps: AgendaFlowRunStep[] };
  state: 'ok' | 'late' | 'done' | 'waiting' | 'paused';
}

export interface AgendaFlowInput {
  name: string;
  clientId?: string | null;
  recurrence: Recurrence;
  steps: AgendaFlowStep[];
}

export interface AgendaPerson { id: string; name: string; shift?: string; }
export interface AgendaHandover { items: AgendaOccurrence[]; entering: AgendaPerson[]; }

/** Una ventana de mantenimiento para el calendario (9.5). */
export interface CalendarWindow {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  suppressNotifications: boolean;
  targetName: string;
  agendaTaskId?: string;
  areaId?: string;
}

export interface AgendaHoliday { date: string; name: string; source: 'manual' | 'import'; }
export interface AgendaSettings {
  workDays: number[];
  dayStart: string;
  dayEnd: string;
  timezone: string;
  holidayCountry: string;
  countries: { country: string; name: string; years: number[] }[];
  importableYears: number[];
  year: number;
  holidays: AgendaHoliday[];
}

/** Agenda (spec/16 §4.3, 9.3): tareas programadas y sus ocurrencias. */
@Injectable({ providedIn: 'root' })
export class AgendaService {
  private readonly http = inject(HttpClient);

  private async get<T>(url: string, params?: HttpParams): Promise<T> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<T>>(url, { params }))).data;
  }

  private async send<T>(method: 'POST' | 'PUT', url: string, body: unknown = {}): Promise<T> {
    return (await firstValueFrom(this.http.request<ApiEnvelope<T>>(method, url, { body }))).data;
  }

  meta(): Promise<AgendaMeta> { return this.get('/api/agenda/meta'); }
  mine(): Promise<AgendaOccurrence[]> { return this.get('/api/agenda/mine'); }

  calendar(from: string, to: string, filter: { area?: string; client?: string; user?: string } = {}): Promise<AgendaOccurrence[]> {
    let params = new HttpParams().set('from', from).set('to', to);
    for (const [k, v] of Object.entries(filter)) if (v) params = params.set(k, v);
    return this.get('/api/agenda/calendar', params);
  }

  managed(scope: 'mine' | 'area', area?: string): Promise<AgendaManaged> {
    let params = new HttpParams().set('scope', scope);
    if (area) params = params.set('area', area);
    return this.get('/api/agenda/managed', params);
  }

  preview(rec: Recurrence): Promise<PreviewDate[]> { return this.send('POST', '/api/agenda/preview', rec); }
  task(id: string): Promise<AgendaTask> { return this.get(`/api/agenda/tasks/${id}`); }
  createTask(input: AgendaTaskInput): Promise<AgendaTask> { return this.send('POST', '/api/agenda/tasks', input); }
  updateTask(id: string, input: AgendaTaskInput): Promise<AgendaTask> { return this.send('PUT', `/api/agenda/tasks/${id}`, input); }
  async deleteTask(id: string): Promise<void> { await firstValueFrom(this.http.delete(`/api/agenda/tasks/${id}`)); }

  /** Flujos entre áreas (9.7). */
  flows(): Promise<AgendaFlow[]> { return this.get('/api/agenda/flows'); }
  createFlow(input: AgendaFlowInput): Promise<{ id: string }> { return this.send('POST', '/api/agenda/flows', input); }
  async updateFlow(id: string, input: AgendaFlowInput): Promise<void> {
    await firstValueFrom(this.http.put(`/api/agenda/flows/${id}`, input));
  }
  async deleteFlow(id: string): Promise<void> { await firstValueFrom(this.http.delete(`/api/agenda/flows/${id}`)); }

  private occ(id: string, action: string, body: unknown = {}, method: 'POST' | 'PUT' = 'POST'): Promise<AgendaOccurrence> {
    return this.send(method, `/api/agenda/occurrences/${id}/${action}`, body);
  }
  take(id: string): Promise<AgendaOccurrence> { return this.occ(id, 'take'); }
  release(id: string): Promise<AgendaOccurrence> { return this.occ(id, 'release'); }
  handover(id: string, userId: string): Promise<AgendaOccurrence> { return this.occ(id, 'handover', { userId }); }
  steps(id: string, steps: number[]): Promise<AgendaOccurrence> { return this.occ(id, 'steps', { steps }, 'PUT'); }
  done(id: string, note: string, link: string): Promise<AgendaOccurrence> { return this.occ(id, 'done', { note, link }); }
  skip(id: string, reason: string): Promise<AgendaOccurrence> { return this.occ(id, 'skip', { reason }); }
  reopen(id: string): Promise<AgendaOccurrence> { return this.occ(id, 'reopen'); }

  handoverInfo(): Promise<AgendaHandover> { return this.get('/api/agenda/handover'); }

  /** Ventanas de mantenimiento que tocan el rango (se ven en el calendario). */
  windows(from: Date, to: Date): Promise<CalendarWindow[]> {
    return this.get('/api/maintenance-windows/overview', new HttpParams().set('from', from.toISOString()).set('to', to.toISOString()));
  }

  settings(year?: number): Promise<AgendaSettings> {
    return this.get('/api/agenda/settings', year ? new HttpParams().set('year', year) : undefined);
  }
  saveSettings(workDays: number[], dayStart: string, dayEnd: string): Promise<AgendaSettings> {
    return this.send('PUT', '/api/agenda/settings', { workDays, dayStart, dayEnd });
  }
  saveHoliday(date: string, name: string): Promise<AgendaSettings> { return this.send('PUT', '/api/agenda/holidays', { date, name }); }
  async deleteHoliday(date: string): Promise<AgendaSettings> {
    return (await firstValueFrom(this.http.delete<ApiEnvelope<AgendaSettings>>(`/api/agenda/holidays/${date}`))).data;
  }
  importHolidays(year: number): Promise<AgendaSettings> { return this.send('POST', '/api/agenda/holidays/import', { year }); }
}
