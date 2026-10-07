import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export type TicketStatus = 'new' | 'assigned' | 'in_progress' | 'pending_vendor' | 'resolved' | 'closed' | 'cancelled';
export type TicketType = 'incident' | 'service_request';
export type TicketPriority = 'p1_critical' | 'p2_high' | 'p3_medium' | 'p4_low';
export type Impact = 'low' | 'medium' | 'high';
export type Urgency = 'low' | 'medium' | 'high' | 'critical';
export type ClockState = 'on_time' | 'at_risk' | 'breached' | 'paused' | 'met';

/** Un reloj de SLA ya calculado por el backend (internal/tickets): la pantalla solo lo pinta. */
export interface SlaClock {
  state: ClockState;
  dueAt: string;
  percent: number;
  remainingSeconds: number;
  elapsedSeconds: number;
  pausedForSeconds?: number;
}

export interface Ticket {
  id: string;
  ticketNumber: string;
  ticketType: TicketType;
  scope: 'soc' | 'noc' | 'general';
  clientId: string;
  clientName: string;
  assignedTeamId?: string;
  teamName: string | null;
  assignedUserId?: string;
  assigneeUsername: string | null;
  status: TicketStatus;
  impact: Impact;
  urgency: Urgency;
  priority: TicketPriority;
  title: string;
  description: string;
  slaPausedSeconds: number;
  reopenedCount: number;
  onHoldSince: string | null;
  sla: { response?: SlaClock; resolution?: SlaClock };
  allowedTransitions: TicketStatus[];
  createdAt: string;
  updatedAt: string;
  createdById?: string;
  /** Padre/hijo y unir: un solo nivel; un ticket unido queda cerrado apuntando al principal. */
  parentId?: string;
  parentNumber?: string;
  mergedIntoId?: string;
  mergedIntoNumber?: string;
  childCount: number;
}

export interface TicketImage { id: string; fileName: string; sizeBytes: number; createdAt: string; }
/** origin: '' propio, 'parent:TKT-…' (del padre), 'child:TKT-…' (de un hijo), 'merged:TKT-…' (de un ticket unido). */
export interface TicketComment { id: string; authorName: string; content: string; isPublic: boolean; createdAt: string; images: TicketImage[]; origin: string; }
export interface TicketTask { id: string; username: string; content: string; timeSpentSeconds: number; isPublic: boolean; performedAt: string; }
export interface TicketEntry { id: string; entryType: string; content: string; authorUsername: string; createdAt: string; }

export interface TicketDetail {
  ticket: Ticket;
  publicTrackingToken: string | null;
  publicTrackingPin: string | null;
  comments: TicketComment[];
  tasks: TicketTask[];
  entries: TicketEntry[];
  totalTimeSpentSeconds: number;
  /** Quienes trabajan el ticket: quien lo tomó y los que se sumen después. */
  resolvers: TicketPerson[];
  parent: TicketRef | null;
  mergedInto: TicketRef | null;
  children: TicketChild[];
}

export interface TicketRef { id: string; ticketNumber: string; title: string; }
export interface TicketChild extends TicketRef { status: TicketStatus; clientName: string; }

export interface TicketPerson { userId: string; username: string; fullName: string | null; }

export interface QueueSummary { open: number; breached: number; paused: number; resolvedToday: number; }
export interface TicketList { items: Ticket[]; total: number; summary: QueueSummary; }

/**
 * Vista pública del ticket (spec/06 §6.4): sin técnicos ni comentarios
 * internos; cada comunicado lo firma "Mesa de Operaciones".
 */
export interface PublicTicket {
  ticketNumber: string;
  title: string;
  ticketType: TicketType;
  status: TicketStatus;
  priority: TicketPriority;
  clientName: string;
  openAt: string | null;
  lastUpdateAt: string | null;
  publicComments: { author: string; content: string; createdAt: string; imageIds?: string[] }[];
  /** Si este ticket se unió a otro: su número (lo de arriba es el avance de ese principal). */
  mergedInto?: string;
}

export interface TicketFilters { ticketType?: TicketType; openOnly?: boolean; q?: string; }

export interface NewTicket {
  ticketType: TicketType;
  scope: 'soc' | 'noc' | 'general';
  clientId: string;
  /** Opcional: el equipo resolutor se puede elegir después. */
  teamId?: string;
  impact: Impact;
  urgency: Urgency;
  title: string;
  description: string;
  /** "Crear hijo": el ticket nace como hijo de este. */
  parentId?: string;
}

@Injectable({ providedIn: 'root' })
export class TicketsService {
  private readonly http = inject(HttpClient);

  async list(filters: TicketFilters = {}): Promise<TicketList> {
    const params: Record<string, string> = {};
    if (filters.ticketType) params['ticketType'] = filters.ticketType;
    if (filters.openOnly) params['openOnly'] = 'true';
    if (filters.q?.trim()) params['q'] = filters.q.trim();
    return (await firstValueFrom(this.http.get<ApiEnvelope<TicketList>>('/api/tickets', { params }))).data;
  }

  async get(id: string): Promise<TicketDetail> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TicketDetail>>(`/api/tickets/${id}`))).data;
  }

  async create(ticket: NewTicket): Promise<{ id: string }> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ id: string }>>('/api/tickets', ticket))).data;
  }

  /**
   * Cambia de estado; al pasar a "asignado" se envía quién lo toma. En un
   * padre, alsoChildren al resolver resuelve también sus hijos abiertos.
   */
  async transition(id: string, status: TicketStatus, assignedUserId?: string, alsoChildren = false): Promise<Ticket> {
    const body: Record<string, string | boolean> = { status };
    if (assignedUserId) body['assignedUserId'] = assignedUserId;
    if (alsoChildren) body['alsoChildren'] = true;
    return (await firstValueFrom(this.http.patch<ApiEnvelope<Ticket>>(`/api/tickets/${id}`, body))).data;
  }

  /** Usuarios que se pueden sumar como resolutores (admin y analistas activos). */
  async assignees(): Promise<TicketPerson[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<TicketPerson[]>>('/api/tickets/assignees'))).data;
  }

  async addResolver(id: string, userId: string): Promise<void> {
    await firstValueFrom(this.http.post(`/api/tickets/${id}/resolvers`, { userId }));
  }

  async removeResolver(id: string, userId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/tickets/${id}/resolvers/${userId}`));
  }

  /** Cambia el equipo resolutor (se puede dejar para después de crear). */
  async setTeam(id: string, teamId: string): Promise<Ticket> {
    return (await firstValueFrom(this.http.patch<ApiEnvelope<Ticket>>(`/api/tickets/${id}`, { teamId }))).data;
  }

  /** DELETE /api/tickets/{id} — solo admin; borra el ticket entero. */
  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/tickets/${id}`));
  }

  /** alsoChildren: en un padre, el comentario llega también a sus hijos abiertos. */
  async addComment(id: string, content: string, isPublic: boolean, imageIds: string[] = [], alsoChildren = false): Promise<TicketComment> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<TicketComment>>(`/api/tickets/${id}/comments`, { content, isPublic, imageIds, alsoChildren }))).data;
  }

  /** Une `otherId` en `mainId` (no se deshace): devuelve el detalle del principal. */
  async merge(mainId: string, otherId: string, reason: string): Promise<TicketDetail> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<TicketDetail>>('/api/tickets/merge', { mainId, otherId, reason }))).data;
  }

  /** Hace hijo de `parentNumber` (TKT-…); vacío quita el padre. */
  async setParent(id: string, parentNumber: string): Promise<void> {
    await firstValueFrom(this.http.put(`/api/tickets/${id}/parent`, { parentNumber }));
  }

  /** Corrige el cliente (admin o permiso tickets:change_client); renueva enlace público y PIN. */
  async changeClient(id: string, clientId: string, reason: string): Promise<TicketDetail> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<TicketDetail>>(`/api/tickets/${id}/client`, { clientId, reason }))).data;
  }

  /** Sube una imagen; queda pendiente hasta que el comentario la incluye en imageIds. */
  async uploadImage(id: string, file: File): Promise<TicketImage> {
    const form = new FormData();
    form.append('image', file);
    return (await firstValueFrom(this.http.post<ApiEnvelope<TicketImage>>(`/api/tickets/${id}/images`, form))).data;
  }

  /** Quita una imagen pendiente (antes de comentar). */
  async removePendingImage(id: string, imageId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/tickets/${id}/images/${imageId}`));
  }

  imageUrl(ticketId: string, imageId: string): string {
    return `/api/tickets/${ticketId}/images/${imageId}`;
  }

  async addTask(id: string, content: string, timeSpentSeconds: number): Promise<TicketTask> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<TicketTask>>(`/api/tickets/${id}/tasks`, { content, timeSpentSeconds, isPublic: false }))).data;
  }

  async regeneratePin(id: string): Promise<string> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ publicTrackingPin: string }>>(`/api/tickets/${id}/public-pin`, {}))).data.publicTrackingPin;
  }

  /** Seguimiento sin login: 401 si falta el PIN o no coincide, 404 si el enlace no existe o se desactivó. */
  async getPublic(token: string, pin?: string): Promise<PublicTicket> {
    const params: Record<string, string> = pin ? { pin } : {};
    return (await firstValueFrom(this.http.get<ApiEnvelope<PublicTicket>>(`/api/public/tickets/${encodeURIComponent(token)}`, { params }))).data;
  }
}
