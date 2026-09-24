import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export interface ChecklistItem { id: string; parentItemId?: string; title: string; itemOrder: number; }
export interface ChecklistTemplate { id: string; name: string; items: ChecklistItem[]; }
export interface ShiftCheckService { id: string; checklistItemId?: string; serviceTitle: string; status: 'verde' | 'rojo'; isComputed: boolean; observation?: string; }
export interface ShiftCheck { id: string; checklistTemplateId: string; workShiftId: string; checkType: 'inicio' | 'cierre'; checkDate: string; hasRedServices: boolean; services: ShiftCheckService[]; }
export interface Handover { previousClosure: { id: string; pendingForNextShift?: string; acknowledgedAt?: string } | null; upcomingMaintenanceWindows: Array<{ id: string; title: string; startsAt: string; endsAt: string }>; onCallSummary: Array<{ teamName: string; onCallMember: string }>; }

@Injectable({ providedIn: 'root' })
export class ChecklistsService {
  private readonly http = inject(HttpClient);

  async activeTemplates(): Promise<ChecklistTemplate[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ChecklistTemplate[]>>('/api/checklist-templates/active'))).data;
  }
  async create(payload: { checklistTemplateId: string; workShiftId: string; checkType: 'inicio' | 'cierre'; services: Array<{ checklistItemId: string; serviceTitle: string; status: 'verde' | 'rojo'; observation?: string }> }): Promise<ShiftCheck> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<ShiftCheck>>('/api/shift-checks', payload))).data;
  }
  async close(payload: { closureCheckId: string; observations?: string; pendingForNextShift?: string; notifyEmail: boolean; syncGlpi: boolean }): Promise<unknown> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<unknown>>('/api/shift-checks/close', payload))).data;
  }
  async handover(): Promise<Handover> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<Handover>>('/api/shift-checks/handover'))).data;
  }
  async acknowledge(closureId: string): Promise<unknown> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<unknown>>(`/api/shift-checks/closures/${closureId}/acknowledge`, {}))).data;
  }
  async abandoned(): Promise<void> {
    await firstValueFrom(this.http.post('/api/shift-checks/abandoned', {}));
  }
}