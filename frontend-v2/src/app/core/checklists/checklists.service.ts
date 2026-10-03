import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export interface ChecklistItem { id: string; parentItemId?: string; title: string; itemOrder: number; }
export interface ChecklistTemplate { id: string; name: string; items: ChecklistItem[]; }
export interface ShiftCheckService { id: string; checklistItemId?: string; serviceTitle: string; status: 'verde' | 'rojo'; isComputed: boolean; observation?: string; }
export interface ShiftCheck { id: string; checklistTemplateId: string; userId: string; username: string; workShiftId: string; checkType: 'inicio' | 'cierre'; checkDate: string; hasRedServices: boolean; services: ShiftCheckService[]; }
/** Cierre formal de turno (camelCase, shift_closures_handler.go). */
export interface ShiftClosure {
  id: string;
  username?: string;
  shiftStartAt: string;
  shiftEndAt: string;
  closureCheckId: string;
  totalEntries: number;
  totalIncidents: number;
  servicesDown: string[];
  observations?: string | null;
  pendingForNextShift?: string | null;
  acknowledgedAt?: string | null;
  acknowledgedByName?: string;
  ticketsResolvedCount: number;
  slaBreachesCount: number;
  sentStatus: string;
}
export interface ShiftStats {
  shiftStartAt: string;
  totalEntries: number;
  totalIncidents: number;
  ticketsResolvedCount: number;
  slaBreachesCount: number;
  inicioWrittenAt: string | null;
  cierreWrittenAt: string | null;
}

export interface Handover {
  previousClosure: ShiftClosure | null;
  upcomingMaintenanceWindows: Array<{ id: string; title: string; startsAt: string; endsAt: string; suppressNotifications: boolean }>;
  onCallSummary: Array<{ teamId: string; teamName: string; onCallMember: string }>;
}

@Injectable({ providedIn: 'root' })
export class ChecklistsService {
  private readonly http = inject(HttpClient);

  async activeTemplates(): Promise<ChecklistTemplate[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ChecklistTemplate[]>>('/api/checklist-templates/active'))).data;
  }
  async create(payload: { checklistTemplateId: string; workShiftId: string; checkType: 'inicio' | 'cierre'; services: Array<{ checklistItemId: string; serviceTitle: string; status: 'verde' | 'rojo'; observation?: string }> }): Promise<ShiftCheck> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<ShiftCheck>>('/api/shift-checks', payload))).data;
  }
  /** Más recientes primero, de a 50. */
  async list(params: { workShiftId?: string; page?: number } = {}): Promise<ShiftCheck[]> {
    const query: Record<string, string> = {};
    if (params.workShiftId) query['workShiftId'] = params.workShiftId;
    if (params.page) query['page'] = String(params.page);
    return (await firstValueFrom(this.http.get<ApiEnvelope<ShiftCheck[]>>('/api/shift-checks', { params: query }))).data;
  }
  async close(payload: { closureCheckId: string; observations?: string; pendingForNextShift?: string; notifyEmail: boolean; syncGlpi: boolean }): Promise<ShiftClosure> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<ShiftClosure>>('/api/shift-checks/close', payload))).data;
  }
  /** Cifras del turno en curso y si ya se escribió su inicio/cierre (popup de turno). */
  async shiftStats(workShiftId: string): Promise<ShiftStats> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ShiftStats>>('/api/shift-checks/stats', { params: { workShiftId } }))).data;
  }
  async handover(): Promise<Handover> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<Handover>>('/api/shift-checks/handover'))).data;
  }
  async acknowledge(closureId: string): Promise<ShiftClosure> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<ShiftClosure>>(`/api/shift-checks/closures/${closureId}/acknowledge`, {}))).data;
  }
  async abandoned(): Promise<void> {
    await firstValueFrom(this.http.post('/api/shift-checks/abandoned', {}));
  }
}
