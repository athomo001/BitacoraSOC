import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export type YearFormat = 'none' | 'yyyy' | 'yy';

export interface TicketSeries {
  id: string;
  name: string;
  prefix: string;
  yearFormat: YearFormat;
  digits: number;
  nextNumber: number;
  isDefault: boolean;
  /** Cómo saldrá el próximo ticket. */
  preview: string;
}

export interface TicketSeriesArea {
  id: string;
  code: string;
  name: string;
  active: boolean;
  /** Sin numeración propia usa la general. */
  seriesId?: string;
}

export interface TicketSeriesState {
  series: TicketSeries[];
  areas: TicketSeriesArea[];
}

export type TicketSeriesForm = Omit<TicketSeries, 'id' | 'preview'>;

/** Mismo formato que el servidor (internal/tickets/numbering.go). */
export function formatTicketNumber(prefix: string, yearFormat: YearFormat, digits: number, n: number, now = new Date()): string {
  const parts = [prefix];
  if (yearFormat === 'yyyy') parts.push(String(now.getFullYear()));
  if (yearFormat === 'yy') parts.push(String(now.getFullYear() % 100).padStart(2, '0'));
  parts.push(String(n).padStart(digits, '0'));
  return parts.join('-');
}

/** /api/config/ticket-series — numeración de tickets (Administración → Ticketera). */
@Injectable({ providedIn: 'root' })
export class TicketSeriesService {
  private readonly http = inject(HttpClient);

  async list(): Promise<TicketSeriesState> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TicketSeriesState>>('/api/config/ticket-series'))).data;
  }

  async save(form: TicketSeriesForm, id?: string): Promise<TicketSeriesState> {
    const req = id
      ? this.http.put<ApiEnvelope<TicketSeriesState>>(`/api/config/ticket-series/${id}`, form)
      : this.http.post<ApiEnvelope<TicketSeriesState>>('/api/config/ticket-series', form);
    return (await firstValueFrom(req)).data;
  }

  async remove(id: string): Promise<TicketSeriesState> {
    return (await firstValueFrom(this.http.delete<ApiEnvelope<TicketSeriesState>>(`/api/config/ticket-series/${id}`))).data;
  }

  async assign(areaId: string, seriesId: string | null): Promise<TicketSeriesState> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<TicketSeriesState>>('/api/config/ticket-series/areas', { assignments: [{ areaId, seriesId }] }))).data;
  }
}
