import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AuditRecord, AuditService } from '../../core/audit/audit.service';
import { problemDetail } from '../../core/http-error';

@Component({ selector: 'app-admin-audit', standalone: true, imports: [DatePipe], changeDetection: ChangeDetectionStrategy.OnPush, template: `
  <section class="panel audit-panel"><header><div><h2>Auditoría</h2><p>Registro de acciones para revisión y compliance.</p></div><button type="button" class="export" (click)="exportCsv()">Exportar CSV</button></header>@if (error()) { <p class="error">{{ error() }}</p> }<table><thead><tr><th>Fecha</th><th>Evento</th><th>Actor</th><th>Resultado</th><th>Motivo</th></tr></thead><tbody>@for (record of records(); track $index) { <tr><td>{{ record.timestamp | date:'dd/MM/yyyy HH:mm:ss' }}</td><td><code>{{ record.event }}</code></td><td>{{ record.actorUsername || 'Sistema' }}</td><td>{{ record.success ? 'OK' : 'Fallo' }}</td><td>{{ record.reason || '—' }}</td></tr> } @empty { <tr><td colspan="5">No hay eventos de auditoría.</td></tr> }</tbody></table></section>
`, styles: [`
  .audit-panel { display:grid; gap:18px; } header { display:flex; justify-content:space-between; gap:24px; align-items:start; border-bottom:1px solid var(--border-subtle); padding-bottom:16px; } h2 { margin:0; } p { color:var(--text-secondary); } .export { border:0; background:none; color:var(--accent); font:inherit; cursor:pointer; } table { width:100%; border-collapse:collapse; } th,td { border-bottom:1px solid var(--border-subtle); padding:10px; text-align:left; } code { color:var(--accent); } .error { color:var(--status-critical); }
` ] })
export class AdminAuditComponent implements OnInit {
  protected readonly api = inject(AuditService); protected readonly records = signal<AuditRecord[]>([]); protected readonly error = signal<string | null>(null);
  protected async exportCsv(): Promise<void> { this.error.set(null); try { await this.api.exportCsv(); } catch (error) { this.error.set(problemDetail(error, 'No se pudo exportar la auditoría.')); } }
  async ngOnInit(): Promise<void> { try { this.records.set((await this.api.list()).items); } catch (error) { this.error.set(problemDetail(error, 'No se pudo cargar la auditoría.')); } }
}