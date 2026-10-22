import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import { MapPoint, MapTiles } from '../map/map.models';

/** Lo que muestra un enlace público (10h). Teletrabajo tiene su propia página en /p/telework. */
export type PublicLinkKind = 'telework' | 'guards' | 'tickets' | 'map' | 'client';

export interface PublicLink {
  id: string;
  kind: PublicLinkKind;
  name: string;
  active: boolean;
  areaIds: string[];
  organizationId?: string;
  organizationName?: string;
  createdAt: string;
  createdBy: string;
  lastAccessedAt?: string;
  /** Solo al crearlo o cambiarlo: después no se puede volver a ver. */
  url?: string;
}

export interface PublicGuard {
  label: string;
  people: string[];
  until?: string;
  next: string[];
  nextFrom?: string;
  mustBeCovered: boolean;
}

export interface PublicTicket {
  number: string;
  title: string;
  client: string;
  assignee: string;
  dueAt?: string;
  onHold: boolean;
}

export interface PublicMapEvent { place: string; title: string; at: string; }

export interface PublicClient {
  name: string;
  services: { name: string; incidentSince?: string; maintenanceUntil?: string }[];
  windows: { title: string; startsAt: string; endsAt: string; service: string }[];
  recent: { service: string; openedAt: string; closedAt: string }[];
}

export interface PublicView {
  kind: Exclude<PublicLinkKind, 'telework'>;
  name: string;
  generatedAt: string;
  areaNames?: string[];
  guards?: { area: string; guards: PublicGuard[] }[];
  tickets?: PublicTicket[];
  map?: { tiles: MapTiles; points: MapPoint[]; incidents: PublicMapEvent[]; windows: PublicMapEvent[] };
  client?: PublicClient;
}

/** Administración → Enlaces públicos y la vista sin sesión (/p/v/:token). */
@Injectable({ providedIn: 'root' })
export class PublicLinksService {
  private readonly http = inject(HttpClient);

  async kinds(): Promise<PublicLinkKind[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<{ kinds: PublicLinkKind[] }>>('/api/public-links/meta'))).data.kinds;
  }

  async list(): Promise<PublicLink[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<PublicLink[]>>('/api/public-links'))).data;
  }

  async create(link: { kind: PublicLinkKind; name: string; areaIds: string[]; organizationId?: string }): Promise<PublicLink> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<PublicLink>>('/api/public-links', link))).data;
  }

  async rotate(id: string): Promise<string> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ url: string }>>(`/api/public-links/${id}/rotate`, {}))).data.url;
  }

  async patch(id: string, change: { name?: string; active?: boolean }): Promise<void> {
    await firstValueFrom(this.http.patch(`/api/public-links/${id}`, change));
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/public-links/${id}`));
  }

  async view(token: string): Promise<PublicView> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<PublicView>>(`/api/public/views/${encodeURIComponent(token)}`))).data;
  }
}
