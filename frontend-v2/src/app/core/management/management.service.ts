import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import { ActionKind } from '../agenda/agenda.service';
import { SlaClock, TicketPriority, TicketStatus } from '../tickets/tickets.service';

export type HealthState = 'green' | 'amber' | 'red';

/** Por qué la cuenta tiene su color; la pantalla arma el texto. */
export interface HealthReason {
  code: 'ticketBreached' | 'noContact' | 'keyLate' | 'noMeeting';
  ticket?: string;
  task?: string;
  count?: number;
  days?: number;
}

/** Salud de la cuenta, calculada sola (spec/16 §4.4.1). */
export interface ClientHealth {
  state: HealthState;
  reasons: HealthReason[];
  tickets: { state: HealthState; open: number; breached: number; first?: string };
  contact: { state: HealthState; contactDays: number; contactKind?: ActionKind; meetingDays: number; meetingKind?: ActionKind; fromBaseline: boolean };
  keyTasks: { state: HealthState; late: number; first?: string };
}

export interface MgmtClient {
  id: string;
  name: string;
  active: boolean;
  csmId?: string;
  csmName?: string;
  /** El CSM a cargo es el usuario («Mis cuentas»). */
  mine: boolean;
  serviceStart?: string;
  renewal?: string;
  renewalDays?: number;
  slaTarget?: number;
  openTickets: number;
  breached: number;
  lateActions: number;
  health: ClientHealth;
  nextAction?: { name: string; due: string };
}

export interface MgmtTicket {
  id: string;
  number: string;
  title: string;
  area: string;
  priority: TicketPriority;
  status: TicketStatus;
  source: 'app' | 'glpi';
  resolution?: SlaClock;
}

export interface MgmtAction {
  occurrenceId: string;
  taskId: string;
  name: string;
  kind?: ActionKind;
  key: boolean;
  ticketNumber?: string;
  due: string;
  late: boolean;
  holder?: string;
  assigneeKind: 'person' | 'level' | 'guard';
  person?: string;
  area: string;
  level?: string;
  team?: string;
}

export interface MgmtFigures {
  /** -1 sin datos. */
  onTimePct: number;
  slaPct: number;
  slaTarget: number;
  openLate: number;
  avgResponseSecs: number;
  avgResolutionSecs: number;
}

export interface MgmtTimelineEvent { at: string; kind: string; title: string; detail?: string; }
export interface MgmtComm { kind: string; title: string; at: string; }
export interface MgmtRenewalStep { name: string; due: string; status: string; closedAt?: string; }

export interface MgmtClientDetail {
  client: MgmtClient;
  figures: MgmtFigures;
  tickets: MgmtTicket[];
  actions: MgmtAction[];
  goals: Goal[];
  comms: MgmtComm[];
  timeline: MgmtTimelineEvent[];
  renewal: MgmtRenewalStep[];
  /** Plantillas del sistema ya aplicadas (onboarding, qbr, renewal → fecha). */
  applied: Record<string, string>;
  /** Notas internas del CSM (solo llega al perfil Gestión). */
  notesCount?: number;
}

/** Una nota interna del CSM sobre un cliente (spec/16 §4.7.1). */
export interface ClientNote {
  id: string;
  authorId: string | null;
  authorName: string;
  content: string;
  pinned: boolean;
  editedAt: string | null;
  createdAt: string;
  mine: boolean;
}

/** areaId null: todavía no está en un área (solo le llega al admin). */
export interface MgmtPerson { id: string; name: string; areaId: string | null; areaName: string; level?: string; }

export interface MgmtMeta {
  slaTarget: number;
  me: string;
  admin: boolean;
  gestion: boolean;
  leadAreas: string[];
  csms: { id: string; name: string }[];
  /** A quién el usuario le puede poner metas por persona. */
  people: MgmtPerson[];
}

export type GoalScope = 'client' | 'area' | 'person';
/** done = lograda; failed = no lograda (marcada o vencida); not_needed = la cerró la regla de la persona. */
export type GoalState = 'open' | 'risk' | 'confirm' | 'done' | 'failed' | 'not_needed';
export type GoalKind = 'certification' | 'action' | 'other';
/** Escalón de la meta de una persona. */
export type GoalBonus = 'primary' | 'secondary' | 'tertiary';
/** Regla de las metas de una persona: todas cuentan, basta una, basta la primaria o la secundaria. */
export type GoalRule = 'all' | 'any' | 'primary' | 'secondary';

export interface GoalStep {
  id: string;
  name: string;
  doneAt?: string;
  doneByName?: string;
  doneSource?: 'manual' | 'ticket' | 'task';
  ticketId?: string;
  ticketNumber?: string;
  ticketStatus?: string;
  ticketArea?: string;
  taskId?: string;
  taskName?: string;
  taskArea?: string;
  taskNextDue?: string;
}

export interface Goal {
  id: string;
  name: string;
  scope: GoalScope;
  clientId?: string;
  clientName?: string;
  areaId?: string;
  areaName?: string;
  personId?: string;
  personName?: string;
  /** Solo alguien sin cuenta: el correo con que pasará a su cuenta. */
  personEmail?: string;
  personAreas?: string[];
  ownerId?: string;
  ownerName?: string;
  kind?: GoalKind;
  bonus?: GoalBonus;
  dueDate: string;
  bizDaysLeft: number;
  estimateBizDays?: number;
  evidenceRequired: boolean;
  evidenceCount: number;
  manualRisk: boolean;
  autoRisk: boolean;
  state: GoalState;
  /** No lograda o no hace falta: el motivo (vacío en una vencida). */
  outcomeReason?: string;
  /** La regla de la persona (solo con cuenta). */
  personRule?: GoalRule;
  canOutcome?: boolean;
  canRule?: boolean;
  milestones: number;
  milestonesDone: number;
  completedAt?: string;
  confirmedAt?: string;
  confirmedByName?: string;
  createdByName?: string;
  canEdit: boolean;
  canMark: boolean;
  canConfirm: boolean;
  steps?: GoalStep[];
  events?: { text: string; at: string; userName?: string }[];
  evidence?: { id: string; fileName?: string; url?: string; sizeBytes?: number; at: string; uploadedByName?: string }[];
}

export interface GoalInput {
  name: string;
  scope: GoalScope;
  clientId?: string;
  areaId?: string;
  personId?: string;
  /** Alguien sin cuenta: nombre y correo en vez de personId. */
  personName?: string;
  personEmail?: string;
  ownerId?: string;
  kind?: GoalKind | '';
  bonus?: GoalBonus | '';
  dueDate?: string;
  estimateBizDays?: number;
  evidenceRequired?: boolean;
  steps?: string[];
}

export type MgmtPeriod = 'month' | 'prev' | '90';

export interface IndicatorRow {
  id: string;
  name: string;
  onTimePct: number;
  slaPct: number;
  slaTarget: number;
  openLate: number;
  avgResponseSecs: number;
  avgResolutionSecs: number;
  /** Cumplimiento del SLA de los últimos 6 meses (-1 sin datos). */
  trend: number[];
}

export interface Indicators {
  by: 'client' | 'area';
  period: MgmtPeriod;
  from: string;
  to: string;
  /** «2026-05» … «2026-10». */
  months: string[];
  slaTarget: number;
  rows: IndicatorRow[];
  load: { id: string; name: string; tickets: number; slaPct: number }[];
}

export interface ClientSummary {
  clientId: string;
  clientName: string;
  period: MgmtPeriod;
  from: string;
  to: string;
  slaPct: number;
  slaTarget: number;
  avgResponseSecs: number;
  avgResolutionSecs: number;
  incidents: { area: string; p1: number; p2: number; p3: number; p4: number }[];
  goals: Goal[];
}

export interface TicketAction {
  occurrenceId: string;
  name: string;
  kind?: ActionKind;
  key: boolean;
  due: string;
  status: 'pending' | 'done' | 'skipped' | 'waiting';
  late: boolean;
  who: string;
  closedAt?: string;
}

export type PlaybookAnchor = 'apply' | 'date' | 'renewal';

export interface PlaybookItem {
  id?: string;
  name: string;
  actionKind?: ActionKind;
  isKey: boolean;
  assignee: 'csm' | 'level' | 'guard';
  areaId?: string;
  areaName?: string;
  levelId?: string;
  levelName?: string;
  teamId?: string;
  teamName?: string;
  /** Días antes (negativo) o después de la fecha. */
  offsetDays: number;
  offsetUnit: 'biz' | 'cal';
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  anchor: PlaybookAnchor;
  systemKey?: 'onboarding' | 'qbr' | 'renewal';
  items: PlaybookItem[];
}

/** Gestión CSM (spec/16 §4.4, 9.4): Clientes, Metas, Indicadores y Plantillas. */
@Injectable({ providedIn: 'root' })
export class ManagementService {
  async clientNotes(clientId: string): Promise<ClientNote[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ClientNote[]>>(`/api/management/clients/${clientId}/notes`))).data;
  }

  async createClientNote(clientId: string, content: string): Promise<ClientNote> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<ClientNote>>(`/api/management/clients/${clientId}/notes`, { content }))).data;
  }

  async updateClientNote(id: string, content: string): Promise<ClientNote> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<ClientNote>>(`/api/management/notes/${id}`, { content }))).data;
  }

  async pinClientNote(id: string, pinned: boolean): Promise<ClientNote> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<ClientNote>>(`/api/management/notes/${id}/pin`, { pinned }))).data;
  }

  async deleteClientNote(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/management/notes/${id}`));
  }

  private readonly http = inject(HttpClient);

  private async get<T>(url: string, params: Record<string, string> = {}): Promise<T> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<T>>(url, { params }))).data;
  }

  private async send<T>(method: 'POST' | 'PUT', url: string, body: unknown = {}): Promise<T> {
    return (await firstValueFrom(this.http.request<ApiEnvelope<T>>(method, url, { body }))).data;
  }

  meta(): Promise<MgmtMeta> { return this.get('/api/management/meta'); }
  /** Admin: el objetivo general del SLA. */
  updateSettings(slaTarget: number): Promise<{ slaTarget: number }> { return this.send('PUT', '/api/management/settings', { slaTarget }); }
  clients(): Promise<MgmtClient[]> { return this.get('/api/management/clients'); }
  client(id: string): Promise<MgmtClientDetail> { return this.get(`/api/management/clients/${id}`); }

  async updateClient(id: string, input: { csmUserId?: string | null; serviceStart?: string; renewal?: string; slaTarget?: number | null }): Promise<void> {
    await firstValueFrom(this.http.put(`/api/management/clients/${id}`, input));
  }

  summary(id: string, period: MgmtPeriod): Promise<ClientSummary> { return this.get(`/api/management/clients/${id}/summary`, { period }); }
  sendSummary(id: string, period: MgmtPeriod, to: string[]): Promise<{ sent: number }> {
    return this.send('POST', `/api/management/clients/${id}/summary/send`, { period, to });
  }

  indicators(by: 'client' | 'area', period: MgmtPeriod): Promise<Indicators> { return this.get('/api/management/indicators', { by, period }); }
  ticketActions(ticketId: string): Promise<TicketAction[]> { return this.get(`/api/management/tickets/${ticketId}/actions`); }

  goals(filter: { mine?: boolean; person?: string; client?: string } = {}): Promise<Goal[]> {
    const params: Record<string, string> = {};
    if (filter.mine) params['mine'] = '1';
    if (filter.person) params['person'] = filter.person;
    if (filter.client) params['client'] = filter.client;
    return this.get('/api/goals', params);
  }

  goal(id: string): Promise<Goal> { return this.get(`/api/goals/${id}`); }
  createGoal(input: GoalInput): Promise<Goal> { return this.send('POST', '/api/goals', input); }
  updateGoal(id: string, input: GoalInput): Promise<Goal> { return this.send('PUT', `/api/goals/${id}`, input); }
  async deleteGoal(id: string): Promise<void> { await firstValueFrom(this.http.delete(`/api/goals/${id}`)); }

  addStep(goalId: string, step: { name: string; ticketId?: string; taskId?: string }): Promise<Goal> {
    return this.send('POST', `/api/goals/${goalId}/milestones`, step);
  }
  async deleteStep(goalId: string, stepId: string): Promise<Goal> {
    return (await firstValueFrom(this.http.delete<ApiEnvelope<Goal>>(`/api/goals/${goalId}/milestones/${stepId}`))).data;
  }
  markStep(goalId: string, stepId: string, done: boolean): Promise<Goal> {
    return this.send('POST', `/api/goals/${goalId}/milestones/${stepId}/done`, { done });
  }

  setRisk(goalId: string, risk: boolean): Promise<Goal> { return this.send('POST', `/api/goals/${goalId}/risk`, { risk }); }
  complete(goalId: string): Promise<Goal> { return this.send('POST', `/api/goals/${goalId}/complete`); }
  confirm(goalId: string): Promise<Goal> { return this.send('POST', `/api/goals/${goalId}/confirm`); }
  reopen(goalId: string, dueDate: string): Promise<Goal> { return this.send('POST', `/api/goals/${goalId}/reopen`, { dueDate }); }
  notAchieved(goalId: string, reason: string): Promise<Goal> { return this.send('POST', `/api/goals/${goalId}/not-achieved`, { reason }); }
  async setPersonRule(userId: string, rule: GoalRule): Promise<void> { await this.send('PUT', `/api/goal-rules/${userId}`, { rule }); }

  async addEvidenceFile(goalId: string, file: File): Promise<Goal> {
    const form = new FormData();
    form.append('file', file);
    return (await firstValueFrom(this.http.post<ApiEnvelope<Goal>>(`/api/goals/${goalId}/evidence`, form))).data;
  }
  addEvidenceUrl(goalId: string, url: string): Promise<Goal> { return this.send('POST', `/api/goals/${goalId}/evidence`, { url }); }
  async deleteEvidence(goalId: string, id: string): Promise<Goal> {
    return (await firstValueFrom(this.http.delete<ApiEnvelope<Goal>>(`/api/goals/${goalId}/evidence/${id}`))).data;
  }
  evidenceUrl(goalId: string, id: string): string { return `/api/goals/${goalId}/evidence/${id}`; }

  playbooks(): Promise<Playbook[]> { return this.get('/api/playbooks'); }
  savePlaybook(p: { id?: string; name: string; description: string; anchor: PlaybookAnchor; items: PlaybookItem[] }): Promise<Playbook> {
    return p.id ? this.send('PUT', `/api/playbooks/${p.id}`, p) : this.send('POST', '/api/playbooks', p);
  }
  async deletePlaybook(id: string): Promise<void> { await firstValueFrom(this.http.delete(`/api/playbooks/${id}`)); }
  applyPlaybook(id: string, clientId: string, anchorDate?: string): Promise<{ applicationId: string; tasks: number; anchorDate: string }> {
    return this.send('POST', `/api/playbooks/${id}/apply`, { clientId, anchorDate });
  }
}
