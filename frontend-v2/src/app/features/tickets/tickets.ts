import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { problemDetail } from '../../core/http-error';
import { Ticket, TicketDetail, TicketStatus, TicketType, TicketsService } from '../../core/tickets/tickets.service';

@Component({
  selector: 'app-tickets', standalone: true, imports: [FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './tickets.html', styleUrl: './tickets.css',
})
export class TicketsComponent implements OnInit {
  private readonly api = inject(TicketsService);
  protected readonly tickets = signal<Ticket[]>([]);
  protected readonly selected = signal<TicketDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly statuses: TicketStatus[] = ['new', 'assigned', 'in_progress', 'pending_vendor', 'resolved', 'closed', 'cancelled'];
  protected readonly type: TicketType = 'incident';
  protected filter = '';
  protected ticketForm = { ticketType: 'incident' as TicketType, scope: 'general', clientId: '', teamId: '', impact: 'medium', urgency: 'medium', title: '', description: '' };
  protected comment = '';
  protected task = { content: '', timeSpentSeconds: 15 };
  async ngOnInit(): Promise<void> { await this.load(); }
  protected async load(): Promise<void> { this.loading.set(true); this.error.set(null); try { const result = await this.api.list(this.filter ? { q: this.filter } : {}); this.tickets.set(result.items); } catch (error) { this.error.set(problemDetail(error, 'No se pudieron cargar los tickets.')); } finally { this.loading.set(false); } }
  protected async createTicket(): Promise<void> { try { const created = await this.api.create(this.ticketForm); this.tickets.update(items => [created, ...items]); this.ticketForm.title = ''; this.ticketForm.description = ''; } catch (error) { this.error.set(problemDetail(error, 'No se pudo crear el ticket.')); } }
  protected async open(ticket: Ticket): Promise<void> { try { this.selected.set(await this.api.get(ticket.id)); } catch (error) { this.error.set(problemDetail(error, 'No se pudo abrir el ticket.')); } }
  protected async changeStatus(detail: TicketDetail, status: TicketStatus): Promise<void> { try { const updated = await this.api.updateStatus(detail.ticket.id, status); this.tickets.update(items => items.map(item => item.id === updated.id ? updated : item)); this.selected.set({ ...detail, ticket: updated }); } catch (error) { this.error.set(problemDetail(error, 'No se pudo actualizar el estado.')); } }
  protected async addComment(detail: TicketDetail): Promise<void> { if (!this.comment.trim()) return; try { const comment = await this.api.addComment(detail.ticket.id, this.comment.trim(), false); this.selected.set({ ...detail, comments: [...detail.comments, comment] }); this.comment = ''; } catch (error) { this.error.set(problemDetail(error, 'No se pudo agregar el comentario.')); } }
  protected async addTask(detail: TicketDetail): Promise<void> { if (!this.task.content.trim() || this.task.timeSpentSeconds <= 0) return; try { await this.api.addTask(detail.ticket.id, this.task.content.trim(), this.task.timeSpentSeconds, false); this.selected.set(await this.api.get(detail.ticket.id)); this.task.content = ''; } catch (error) { this.error.set(problemDetail(error, 'No se pudo registrar la tarea.')); } }
  protected close(): void { this.selected.set(null); }
}
