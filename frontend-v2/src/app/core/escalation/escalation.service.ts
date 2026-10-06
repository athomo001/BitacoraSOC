import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

/** Exactamente uno de los tres (spec/04-contratos-api.md, escalación). */
export interface EscalationScope {
  serviceId?: string;
  assetId?: string;
  territorialUnitId?: string;
}

export type ResolvedVia = 'service' | 'asset' | 'territorial_unit' | 'team_coverage';
export type StepMode = 'unique' | 'pool' | 'sequential';
/** escalated_next_tier = el operador escala a mano al paso siguiente (botón "Escalar"). */
export type ContactResult = 'answered' | 'no_answer' | 'busy' | 'unreachable' | 'escalated_next_tier';
export type ChannelType = 'call' | 'sms' | 'whatsapp' | 'email' | 'other';

export const RESULT_LABELS: Record<ContactResult, string> = {
  answered: 'Contestó',
  no_answer: 'No contesta',
  busy: 'Ocupado',
  unreachable: 'Inalcanzable',
  escalated_next_tier: 'Escaló',
};

export const MODE_LABELS: Record<StepMode, string> = {
  unique: 'Único',
  pool: 'Todos a la vez',
  sequential: 'Uno tras otro',
};

export const VIA_LABELS: Record<ResolvedVia, string> = {
  service: 'política del servicio',
  asset: 'política propia del activo',
  territorial_unit: 'política de la zona',
  team_coverage: 'cobertura territorial de equipos',
};

export interface ResolvedChannel {
  channelType: ChannelType;
  value: string;
  label?: string;
  preferred: boolean;
  href?: string;
}

export interface ResolvedMember {
  id: string;
  contactId?: string;
  userId?: string;
  name: string;
  position?: string;
  specialty?: string;
  organization?: string;
  roleInTeam: 'primary' | 'backup' | 'lead';
  recipientType: 'to' | 'cc';
  priority: number;
  onCallNow: boolean;
  channels: ResolvedChannel[];
  /** La persona viene de un pool del nivel (TI-Mundo…), que se llama en orden. */
  pool?: { id: string; name: string; organization?: string };
  poolPosition?: number;
}

export interface ResolvedTeam {
  id: string;
  name: string;
  kind: string;
  audience: 'internal' | 'client';
  organization?: { name: string; type: string };
  members: ResolvedMember[];
}

export interface ResolvedStep {
  order: number;
  mode: StepMode;
  waitBeforeEscalateMinutes: number;
  team: ResolvedTeam;
}

export interface Resolution {
  resolvedVia: ResolvedVia;
  policyId?: string;
  resolvedUnit?: { id: string; name: string; code: string; kind: string };
  scope: EscalationScope;
  steps: ResolvedStep[];
  /** Recordatorio del cliente bajo el flujo ("Llamar 3 veces y 1 minuto por cada llamada"). */
  reminder?: string;
}

/** Un evento escalado ("Virus en RRHH 15:02") enlazado a un ticket GLPI o interno. */
export interface EscalationIncident extends EscalationScope {
  id: string;
  title: string;
  glpiTicket?: string;
  ticketId?: string;
  ticketNumber?: string;
  openedBy: string;
  openedAt: string;
  closedAt?: string;
}

export interface IncidentNote {
  id: string;
  note: string;
  username: string;
  createdAt: string;
}

/** Pool: grupo con nombre de personas de una empresa o área (TI-Mundo, Redes-Mundo…). */
export interface EscalationPool {
  id: string;
  name: string;
  organizationId?: string;
  organizationName?: string;
  active: boolean;
  members: number;
  usedIn: number;
}

export interface EscalationPoolMember {
  id: string;
  contactId?: string;
  userId?: string;
  name: string;
  organizationName?: string;
  position: number;
}

export interface ActionLog {
  id: string;
  policyId?: string;
  stepOrder: number;
  contactId?: string;
  contactName?: string;
  channelType: ChannelType;
  result: ContactResult;
  notes?: string;
  entryId?: string;
  operatorId: string;
  operatorUsername?: string;
  incidentId?: string;
  createdAt: string;
}

export interface ActionOutcome {
  actionLog: ActionLog;
  escalatedToNextStep: boolean;
  exhausted: boolean;
  nextMember?: ResolvedMember;
  nextStepOrder?: number;
  nextStepTeam?: ResolvedTeam;
  waitBeforeEscalateMinutes?: number;
  entryCommentPending?: boolean;
}

export interface NotifyOutcome {
  sent: boolean;
  reason?: 'maintenance_window' | 'no_email_recipients' | 'smtp_not_configured' | 'smtp_error';
  maintenanceWindowId?: string;
  maintenanceWindowTitle?: string;
  recipients?: { name: string; email?: string; recipientType?: string; skipped?: string }[];
  error?: string;
  auditLogId?: string;
}

export interface SocService {
  id: string;
  organizationId: string;
  organizationName?: string;
  name: string;
  code: string;
  active: boolean;
}

export interface Asset {
  id: string;
  type: 'circuit' | 'link' | 'site' | 'device';
  name: string;
  code: string;
  ipAddress?: string;
  territorialUnitId: string;
}

export interface PolicyStep {
  stepOrder: number;
  teamId: string;
  teamName: string;
  mode: StepMode;
  waitBeforeEscalateMinutes: number;
}

export interface Policy extends EscalationScope {
  id: string;
  active: boolean;
  steps: PolicyStep[];
  reminder?: string;
}

export interface MaintenanceWindow extends EscalationScope {
  id: string;
  title: string;
  notes?: string;
  startsAt: string;
  endsAt: string;
  suppressNotifications: boolean;
  active: boolean;
}

export interface ShiftReportDelivery {
  id: string;
  shiftEndAt: string | null;
  status: 'pending' | 'success' | 'failed' | 'skipped';
  error: string | null;
  sentAt: string | null;
  closedBy: string;
  shiftName: string | null;
  recipients: string[];
}

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  fromAddress: string;
  /** Nombre visible del remitente ("Bitácora Ops <noc@empresa.cl>"); vacío = solo la dirección. */
  fromName: string;
  requireTls: boolean;
  hasPassword: boolean;
  /** Última prueba de envío; null si nunca se probó. */
  lastTest: { at: string; ok: boolean; error?: string } | null;
}

function scopeParams(scope: EscalationScope): Record<string, string> {
  const params: Record<string, string> = {};
  if (scope.serviceId) params['serviceId'] = scope.serviceId;
  if (scope.assetId) params['assetId'] = scope.assetId;
  if (scope.territorialUnitId) params['territorialUnitId'] = scope.territorialUnitId;
  return params;
}

/** Motor de escalación, ventanas de mantenimiento y SMTP (Fase 7). */
@Injectable({ providedIn: 'root' })
export class EscalationService {
  private readonly http = inject(HttpClient);

  /** null = no hay política ni cobertura (404 ruidoso del backend, HU-1). */
  async resolve(scope: EscalationScope): Promise<Resolution | null> {
    try {
      return (await firstValueFrom(this.http.get<ApiEnvelope<Resolution>>('/api/escalation/resolve', { params: scopeParams(scope) }))).data;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) return null;
      throw error;
    }
  }

  async recordAction(action: EscalationScope & {
    policyId?: string;
    stepOrder: number;
    memberId: string;
    channelType: ChannelType;
    result: ContactResult;
    notes?: string;
    since?: string;
    incidentId?: string;
  }): Promise<ActionOutcome> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<ActionOutcome>>('/api/escalation/actions', action))).data;
  }

  async listActions(policyId: string, since: string): Promise<ActionLog[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ActionLog[]>>('/api/escalation/actions', { params: { policyId, since } }))).data;
  }

  /** Intentos de un incidente (su historial forense). */
  async listIncidentActions(incidentId: string): Promise<ActionLog[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ActionLog[]>>('/api/escalation/actions', { params: { incidentId } }))).data;
  }

  async listIncidents(scope: EscalationScope): Promise<EscalationIncident[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<EscalationIncident[]>>('/api/escalation/incidents', { params: scopeParams(scope) }))).data;
  }

  async createIncident(scope: EscalationScope, incident: { title: string; glpiTicket?: string; ticketId?: string }): Promise<EscalationIncident> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<EscalationIncident>>('/api/escalation/incidents', { ...scope, ...incident }))).data;
  }

  async setIncidentClosed(id: string, closed: boolean): Promise<EscalationIncident> {
    return (await firstValueFrom(this.http.patch<ApiEnvelope<EscalationIncident>>(`/api/escalation/incidents/${id}`, { closed }))).data;
  }

  async listIncidentNotes(id: string): Promise<IncidentNote[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<IncidentNote[]>>(`/api/escalation/incidents/${id}/notes`))).data;
  }

  async addIncidentNote(id: string, note: string): Promise<IncidentNote> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<IncidentNote>>(`/api/escalation/incidents/${id}/notes`, { note }))).data;
  }

  async setPolicyReminder(policyId: string, reminder: string): Promise<void> {
    await firstValueFrom(this.http.patch(`/api/escalation/policies/${policyId}`, { reminder }));
  }

  async listPools(): Promise<EscalationPool[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<EscalationPool[]>>('/api/escalation/pools'))).data;
  }

  async createPool(pool: { name: string; organizationId?: string }): Promise<EscalationPool> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<EscalationPool>>('/api/escalation/pools', pool))).data;
  }

  async patchPool(id: string, patch: { name?: string; active?: boolean; organizationId?: string; clearOrganization?: boolean }): Promise<EscalationPool> {
    return (await firstValueFrom(this.http.patch<ApiEnvelope<EscalationPool>>(`/api/escalation/pools/${id}`, patch))).data;
  }

  async deletePool(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/escalation/pools/${id}`));
  }

  async listPoolMembers(id: string): Promise<EscalationPoolMember[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<EscalationPoolMember[]>>(`/api/escalation/pools/${id}/members`))).data;
  }

  /** La lista completa en orden de llamada (reemplaza la anterior). */
  async setPoolMembers(id: string, members: { contactId?: string; userId?: string }[]): Promise<EscalationPoolMember[]> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<EscalationPoolMember[]>>(`/api/escalation/pools/${id}/members`, { members }))).data;
  }

  /** El backend responde 502 con cuerpo útil cuando falla el SMTP: se devuelve igual. */
  /** Aviso por correo; sin stepOrder va al primer paso, con él al paso indicado (escalar). */
  async notify(scope: EscalationScope, message: string, severity: string, stepOrder?: number): Promise<NotifyOutcome> {
    try {
      const body = stepOrder === undefined ? { ...scope, message, severity } : { ...scope, message, severity, stepOrder };
      return (await firstValueFrom(this.http.post<ApiEnvelope<NotifyOutcome>>('/api/escalation/notify', body))).data;
    } catch (error) {
      const body = error instanceof HttpErrorResponse ? error.error : null;
      if (body?.data && typeof body.data.sent === 'boolean') return body.data as NotifyOutcome;
      throw error;
    }
  }

  async listServices(): Promise<SocService[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<SocService[]>>('/api/services'))).data;
  }

  async createService(service: { organizationId: string; name: string; code: string }): Promise<SocService> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<SocService>>('/api/services', service))).data;
  }

  async listAssets(): Promise<Asset[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<Asset[]>>('/api/assets'))).data;
  }

  async listPolicies(): Promise<Policy[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<Policy[]>>('/api/escalation/policies'))).data;
  }

  async createPolicy(scope: EscalationScope): Promise<Policy> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<Policy>>('/api/escalation/policies', scope))).data;
  }

  async deletePolicy(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/escalation/policies/${id}`));
  }

  async addStep(policyId: string, step: { stepOrder: number; teamId: string; mode: StepMode; waitBeforeEscalateMinutes: number }): Promise<void> {
    await firstValueFrom(this.http.post(`/api/escalation/policies/${policyId}/steps`, step));
  }

  async deleteStep(policyId: string, stepOrder: number): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/escalation/policies/${policyId}/steps/${stepOrder}`));
  }

  async listWindows(scope: EscalationScope = {}, onlyCurrent = false): Promise<MaintenanceWindow[]> {
    const params = scopeParams(scope);
    if (onlyCurrent) params['active'] = 'true';
    return (await firstValueFrom(this.http.get<ApiEnvelope<MaintenanceWindow[]>>('/api/maintenance-windows', { params }))).data;
  }

  async createWindow(window: EscalationScope & { title: string; notes?: string; startsAt: string; endsAt: string; suppressNotifications: boolean }): Promise<MaintenanceWindow> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<MaintenanceWindow>>('/api/maintenance-windows', window))).data;
  }

  async closeWindow(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/maintenance-windows/${id}`));
  }

  /** null = todavía no se configuró el SMTP. */
  async getSmtp(): Promise<SmtpConfig | null> {
    try {
      return (await firstValueFrom(this.http.get<ApiEnvelope<SmtpConfig>>('/api/config/smtp'))).data;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) return null;
      throw error;
    }
  }

  async putSmtp(config: { host: string; port: number; username?: string; password?: string; fromAddress: string; fromName: string; requireTls: boolean }): Promise<SmtpConfig> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<SmtpConfig>>('/api/config/smtp', config))).data;
  }

  /** El backend responde 502 con el error del servidor de correo en el cuerpo: se devuelve para mostrarlo tal cual. */
  async testSmtp(to: string): Promise<{ sent: boolean; error?: string }> {
    try {
      return (await firstValueFrom(this.http.post<ApiEnvelope<{ sent: boolean; error?: string }>>('/api/config/smtp/test-send', { to }))).data;
    } catch (error) {
      const body = error instanceof HttpErrorResponse ? error.error : null;
      if (body?.data && typeof body.data.sent === 'boolean') return body.data as { sent: boolean; error?: string };
      throw error;
    }
  }

  /** Últimos 20 cierres de turno y cómo salió su reporte por correo. */
  async recentShiftReports(): Promise<ShiftReportDelivery[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ShiftReportDelivery[]>>('/api/reports/shift/recent'))).data;
  }

  async dispatchPendingShiftReports(): Promise<void> {
    await firstValueFrom(this.http.post('/api/reports/shift/dispatch', {}));
  }
}
