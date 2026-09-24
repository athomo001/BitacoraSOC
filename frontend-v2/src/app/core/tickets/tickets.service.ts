import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export type TicketStatus = 'new' | 'assigned' | 'in_progress' | 'pending_vendor' | 'resolved' | 'closed' | 'cancelled';
export type TicketType = 'incident' | 'service_request';

export interface Ticket {
  id: string; ticketNumber: string; ticketType: TicketType; scope: string; clientId: string;
  assignedTeamId?: string; status: TicketStatus; impact: string; urgency: string; priority: string;
  title: string; description: string; slaResponseDueAt?: string; slaResolutionDueAt?: string;
  slaPausedSeconds: number; reopenedCount: number; createdAt: string; updatedAt: string;
}
export interface TicketComment { id: string; authorName: string; content: string; isPublic: boolean; createdAt: string; }
export interface TicketTask { id: string; userId: string; content: string; timeSpentSeconds: number; isPublic: boolean; performedAt: string; }
export interface TicketList { items: Ticket[]; total: number; }
export interface TicketDetail { ticket: Ticket; comments: TicketComment[]; entries: unknown[]; totalTimeSpentSeconds: number; }

@Injectable({ providedIn: 'root' })
export class TicketsService {
  private readonly http = inject(HttpClient);

  async list(params: Record<string, string> = {}): Promise<TicketList> {
    const response = await firstValueFrom(this.http.get<ApiEnvelope<TicketList>>('/api/tickets', { params }));
    return response.data;
  }
  async get(id: string): Promise<TicketDetail> {
    const response = await firstValueFrom(this.http.get<ApiEnvelope<TicketDetail>>(`/api/tickets/${id}`));
    return response.data;
  }
  async create(payload: { ticketType: TicketType; scope: string; clientId: string; teamId: string; impact: string; urgency: string; title: string; description: string }): Promise<Ticket> {
    const response = await firstValueFrom(this.http.post<ApiEnvelope<Ticket>>('/api/tickets', payload));
    return response.data;
  }
  async updateStatus(id: string, status: TicketStatus): Promise<Ticket> {
    const response = await firstValueFrom(this.http.patch<ApiEnvelope<Ticket>>(`/api/tickets/${id}`, { status }));
    return response.data;
  }
  async addComment(id: string, content: string, isPublic: boolean): Promise<TicketComment> {
    const response = await firstValueFrom(this.http.post<ApiEnvelope<TicketComment>>(`/api/tickets/${id}/comments`, { content, isPublic }));
    return response.data;
  }
  async tasks(id: string): Promise<{ items: TicketTask[]; totalTimeSpentSeconds: number }> {
    const response = await firstValueFrom(this.http.get<ApiEnvelope<{ items: TicketTask[]; totalTimeSpentSeconds: number }>>(`/api/tickets/${id}/tasks`));
    return response.data;
  }
  async addTask(id: string, content: string, timeSpentSeconds: number, isPublic: boolean): Promise<TicketTask> {
    const response = await firstValueFrom(this.http.post<ApiEnvelope<TicketTask>>(`/api/tickets/${id}/tasks`, { content, timeSpentSeconds, isPublic }));
    return response.data;
  }
}
