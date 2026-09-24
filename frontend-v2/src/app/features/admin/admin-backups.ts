import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { problemDetail } from '../../core/http-error';
import { BackupRun, BackupsService } from '../../core/backups/backups.service';

@Component({ selector: 'app-admin-backups', standalone: true, imports: [FormsModule, DatePipe], changeDetection: ChangeDetectionStrategy.OnPush, template: `
  <section class="panel backup-panel">
    <header><div><h2>Respaldos del sistema</h2><p>Snapshot completo cifrado y comprimido, con historial verificable.</p></div><span class="status">{{ backups().length }} respaldos</span></header>
    <form class="backup-create" (submit)="$event.preventDefault(); create()"><label>Passphrase del backup<input type="password" name="passphrase" [(ngModel)]="passphrase" required /></label><button type="submit" [disabled]="busy()">{{ busy() ? 'Generando...' : 'Crear backup completo' }}</button></form>
    @if (error()) { <p class="error">{{ error() }}</p> }
    <table><thead><tr><th>Tipo</th><th>Estado</th><th>Registros</th><th>Fecha</th><th></th></tr></thead><tbody>@for (backup of backups(); track backup.id) { <tr><td>{{ backup.kind }}</td><td>{{ backup.status }}</td><td>{{ backup.records_count }}</td><td>{{ backup.started_at | date:'dd/MM/yyyy HH:mm' }}</td><td><a [href]="api.downloadUrl(backup.id)">Descargar</a><button type="button" (click)="remove(backup)">Eliminar</button></td></tr> } @empty { <tr><td colspan="5">No hay respaldos registrados.</td></tr> }</tbody></table>
  </section>
`, styles: [`
  .backup-panel { display:grid; gap:18px; } header { display:flex; justify-content:space-between; gap:24px; align-items:start; border-bottom:1px solid var(--border-subtle); padding-bottom:16px; } h2 { margin:0; } p { color:var(--text-secondary); } .status { color:var(--accent-cyan); } .backup-create { display:flex; align-items:end; gap:12px; } label { display:grid; gap:6px; flex:1; font-size:13px; } input { width:100%; box-sizing:border-box; border:1px solid var(--border-subtle); border-radius:var(--radius-sm); padding:9px; background:var(--bg-app); color:var(--text-primary); } button { border:0; border-radius:var(--radius-sm); padding:9px 12px; background:var(--accent-cyan); color:var(--bg-app); cursor:pointer; } button:disabled { opacity:.55; cursor:not-allowed; } table { width:100%; border-collapse:collapse; } th,td { border-bottom:1px solid var(--border-subtle); padding:10px; text-align:left; } td a { color:var(--accent-cyan); margin-right:12px; } td button { background:transparent; color:var(--text-secondary); } .error { color:var(--status-critical); }
` ] })
export class AdminBackupsComponent implements OnInit {
  protected readonly api = inject(BackupsService); protected readonly backups = signal<BackupRun[]>([]); protected readonly error = signal<string | null>(null); protected readonly busy = signal(false); protected passphrase = '';
  async ngOnInit(): Promise<void> { await this.load(); }
  protected async load(): Promise<void> { try { this.backups.set((await this.api.history()).items); } catch (error) { this.error.set(problemDetail(error, 'No se pudo cargar el historial de backups.')); } }
  protected async create(): Promise<void> { this.busy.set(true); try { await this.api.create(this.passphrase); this.passphrase = ''; await this.load(); } catch (error) { this.error.set(problemDetail(error, 'No se pudo crear el backup.')); } finally { this.busy.set(false); } }
  protected async remove(backup: BackupRun): Promise<void> { try { await this.api.remove(backup.id); this.backups.update(items => items.filter(item => item.id !== backup.id)); } catch (error) { this.error.set(problemDetail(error, 'No se pudo eliminar el backup.')); } }
}