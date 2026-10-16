import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

/** El enlace propio para ver la Agenda en Outlook (suscripción ICS, 9.7). */
export interface CalendarFeed {
  url: string;
  includeWindows: boolean;
  createdAt: string;
  lastReadAt?: string;
}

/** available: la funcionalidad está prendida; feed: null si todavía no lo creó. */
export interface CalendarFeedState {
  available: boolean;
  feed: CalendarFeed | null;
}

/** Calendario en Outlook (spec/16 §6.1, 9.7): Perfil → Calendario. */
@Injectable({ providedIn: 'root' })
export class CalendarFeedService {
  private readonly http = inject(HttpClient);

  /** Apagada en Funcionalidades responde 403: la pestaña no aparece. */
  async mine(): Promise<CalendarFeedState> {
    try {
      const r = await firstValueFrom(this.http.get<ApiEnvelope<CalendarFeed | null>>('/api/users/me/calendar'));
      return { available: true, feed: r.data };
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 403) return { available: false, feed: null };
      throw e;
    }
  }

  /** Crea el enlace o genera uno nuevo (el anterior deja de funcionar). */
  async create(): Promise<CalendarFeed> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<CalendarFeed>>('/api/users/me/calendar', {}))).data;
  }

  async setWindows(includeWindows: boolean): Promise<CalendarFeed> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<CalendarFeed>>('/api/users/me/calendar', { includeWindows }))).data;
  }

  async remove(): Promise<void> {
    await firstValueFrom(this.http.delete('/api/users/me/calendar'));
  }
}
