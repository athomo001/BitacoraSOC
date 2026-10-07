import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import { downloadFile } from '../download';

/** Una guardia (equipo "oncall": N2, TI, N1 No hábil, OL) con su configuración. */
export interface Guard {
  cycleId: string;
  teamId: string;
  label: string;
  /** N1 y N2: no pueden quedar sin nadie (los huecos se marcan en rojo). */
  mustBeCovered: boolean;
  /** 0 = domingo … 6 = sábado. */
  changeDay: number;
  /** "09:00": sale del turno de trabajo enlazado (Turnos de trabajo). */
  changeTime: string;
  workShiftId?: string;
  workShiftName?: string;
  timezone: string;
  members: GuardMember[];
}

export interface GuardMember { teamMemberId: string; name: string; userId?: string; }

export interface GuardSlot {
  id: string;
  cycleId: string;
  teamMemberId: string;
  name: string;
  userId?: string;
  startsAt: string;
  endsAt: string;
  paused: boolean;
}

export interface GuardOverride {
  id: string;
  cycleId: string;
  originalTeamMemberId?: string;
  replacementTeamMemberId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}

/** Vacaciones / licencia / trámite médico de Dotación (días AAAA-MM-DD, inclusive). */
export interface Absence { userId: string; from: string; to: string; condition: 'vacation' | 'medical_leave' | 'medical_appointment'; }

export interface GuardTimeline {
  from: string;
  to: string;
  now: string;
  guards: Guard[];
  slots: GuardSlot[];
  overrides: GuardOverride[];
  absences: Absence[];
  workShifts: { id: string; name: string; startTime: string }[];
}

export interface GuardImportResult { guards: number; dotacionDays: number; errors: { row: number; message: string }[]; }

/** Guardias en línea de tiempo (canvas "Turnos: guardias", aprobado 2026-10-07). */
@Injectable({ providedIn: 'root' })
export class GuardsService {
  private readonly http = inject(HttpClient);

  async timeline(from: Date, to: Date): Promise<GuardTimeline> {
    const params = { from: from.toISOString(), to: to.toISOString() };
    return (await firstValueFrom(this.http.get<ApiEnvelope<GuardTimeline>>('/api/guards', { params }))).data;
  }

  async saveSlot(slot: { cycleId: string; teamMemberId: string; startsAt: Date; endsAt: Date }, id?: string): Promise<void> {
    const body = { cycleId: slot.cycleId, teamMemberId: slot.teamMemberId, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString() };
    await firstValueFrom(id ? this.http.put(`/api/guards/slots/${id}`, body) : this.http.post('/api/guards/slots', body));
  }

  async deleteSlot(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/guards/slots/${id}`));
  }

  async generateRotation(cycleId: string, teamMemberIds: string[], startsAt: Date, daysEach: number, count: number): Promise<void> {
    await firstValueFrom(this.http.post('/api/guards/rotation', { cycleId, teamMemberIds, startsAt: startsAt.toISOString(), daysEach, count }));
  }

  async updateGuard(cycleId: string, patch: { mustBeCovered?: boolean; changeDay?: number; workShiftId?: string; clearWorkShift?: boolean }): Promise<void> {
    await firstValueFrom(this.http.patch(`/api/guards/${cycleId}`, patch));
  }

  /** "Reemplazo por unos días": no toca la guardia (rotation_overrides). */
  async addOverride(cycleId: string, originalTeamMemberId: string, replacementTeamMemberId: string, startsAt: Date, endsAt: Date, reason: string): Promise<void> {
    await firstValueFrom(this.http.post('/api/rotation-overrides', { cycleId, originalTeamMemberId, replacementTeamMemberId, startDate: startsAt.toISOString(), endDate: endsAt.toISOString(), reason }));
  }

  /** Carga masiva con el CSV del legacy (condicion,usuario,fechaInicio,horaInicio,fechaFin,horaFin). */
  async importCsv(text: string): Promise<GuardImportResult> {
    const headers = new HttpHeaders({ 'Content-Type': 'text/csv' });
    return (await firstValueFrom(this.http.post<ApiEnvelope<GuardImportResult>>('/api/guards/import', text, { headers }))).data;
  }

  async downloadTemplate(): Promise<void> {
    await downloadFile(this.http, '/api/guards/import/template', 'turnos-internos-template.csv');
  }
}
