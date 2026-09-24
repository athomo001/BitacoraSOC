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
export type ContactResult = 'answered' | 'no_answer' | 'busy' | 'unreachable';
export type ChannelType = 'call' | 'sms' | 'whatsapp' | 'email' | 'other';

export const RESULT_LABELS: Record<ContactResult, string> = {
  answered: 'Contestó',
  no_answer: 'No contesta',
  busy: 'Ocupado',
  unreachable: 'Inalcanzable',
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

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  fromAddress: string;
  requireTls: boolean;
  hasPassword: boolean;
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
  }): Promise<ActionOutcome> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<ActionOutcome>>('/api/escalation/actions', action))).data;
  }

  async listActions(policyId: string, since: string): Promise<ActionLog[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ActionLog[]>>('/api/escalation/actions', { params: { policyId, since } }))).data;
  }

  /** El backend responde 502 con cuerpo útil cuando falla el SMTP: se devuelve igual. */
  async notify(scope: EscalationScope, message: string, severity: string): Promise<NotifyOutcome> {
    try {
      return (await firstValueFrom(this.http.post<ApiEnvelope<NotifyOutcome>>('/api/escalation/notify', { ...scope, message, severity }))).data;
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

  async putSmtp(config: { host: string; port: number; username?: string; password?: string; fromAddress: string; requireTls: boolean }): Promise<SmtpConfig> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<SmtpConfig>>('/api/config/smtp', config))).data;
  }

  async testSmtp(to: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/config/smtp/test-send', { to }));
  }

  async dispatchPendingShiftReports(): Promise<void> {
    await firstValueFrom(this.http.post('/api/reports/shift/dispatch', {}));
  }
}
