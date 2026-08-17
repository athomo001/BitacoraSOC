/**
 * File Purpose: frontend/src/app/pages/main/audit-logs/audit-logs.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AuditLogDetailDialogComponent } from './audit-log-detail-dialog.component';
import { AuthService } from '../../../services/auth.service';
import { OnboardingService } from '../../../services/onboarding.service';
import { AuditLogService } from '../../../services/audit-log.service';
import { UserService } from '../../../services/user.service';
import { AuditLog, AuditLogFilters } from '../../../models/audit-log.model';

@Component({
  selector: 'app-audit-logs',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatTooltipModule,
    MatProgressBarModule,
    MatDialogModule
  ],
  templateUrl: './audit-logs.component.html',
  styleUrls: ['./audit-logs.component.scss']
})
export class AuditLogsComponent implements OnInit {
  @ViewChild('auditGuideCard') auditGuideCard?: ElementRef<HTMLElement>;
  displayedColumns: string[] = ['timestamp', 'actor', 'level', 'username', 'reason'];
  logs: AuditLog[] = [];
  totalLogs = 0;
  pageSize = 20;
  currentPage = 1;
  isLoading = false;
  exporting = false;
  /** GET /users/list responde con "name" (no "fullName") para cada usuario. */
  users: { _id: string; name: string; username: string }[] = [];
  exportModes = [
    { value: 'filters', label: 'Filtros actuales (incluye fechas)' },
    { value: 'max', label: 'Por cantidad (N registros)' },
    { value: 'days', label: 'Últimos días (N días)' },
    { value: 'months', label: 'Últimos meses (N meses)' },
    { value: 'all', label: 'Todos (máximo permitido)' }
  ];
  exportFormats = [
    { value: 'csv', label: 'CSV' },
    { value: 'json', label: 'JSON' }
  ];
  auditGuideVisible = false;

  filterForm: FormGroup;
  levelOptions = [
    { value: '', label: 'Todos' },
    { value: 'info', label: 'Info' },
    { value: 'warn', label: 'Advertencia' },
    { value: 'error', label: 'Error' }
  ];

  constructor(
    private auditLogService: AuditLogService,
    private userService: UserService,
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
    private authService: AuthService,
    private onboardingService: OnboardingService,
    private dialog: MatDialog
  ) {
    this.filterForm = this.fb.group({
      search: [''],
      category: [''],
      userId: [''],
      level: [''],
      startDate: [null],
      endDate: [null],
      exportMode: ['filters'],
      exportValue: [1000],
      exportFormat: ['csv']
    });
  }

  categoryOptions = [
    { value: '', label: 'Todas' },
    { value: 'mail', label: 'Mail / SMTP' },
    { value: 'backup', label: 'Backup' },
    { value: 'complement', label: 'Complementos' },
    { value: 'admin', label: 'Admin' },
    { value: 'user', label: 'Usuario' },
    { value: 'security', label: 'Seguridad' }
  ];

  ngOnInit(): void {
    const username = this.authService.getCurrentUser()?.username;
    this.auditGuideVisible = this.onboardingService.shouldShow('audit-logs', username);
    this.loadLogs();
    this.loadUsers();
  }

  closeAuditGuide(dontShowAgain = false): void {
    const username = this.authService.getCurrentUser()?.username;
    if (dontShowAgain) {
      this.onboardingService.hide('audit-logs', username);
    }
    this.auditGuideVisible = false;
  }

  openAuditGuide(): void {
    this.auditGuideVisible = true;
    setTimeout(() => {
      const card = this.auditGuideCard?.nativeElement;
      card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  loadLogs(): void {
    const raw = this.filterForm.value;
    const filters: AuditLogFilters = {
      page: this.currentPage,
      limit: this.pageSize,
      search: raw.search || undefined,
      category: raw.category || undefined,
      userId: raw.userId || undefined,
      level: raw.level || undefined,
      startDate: this.toDateOnlyString(raw.startDate),
      endDate: this.toDateOnlyString(raw.endDate)
    };

    // Filtrar valores vacíos
    Object.keys(filters).forEach(key => {
      if (filters[key as keyof AuditLogFilters] === '' || filters[key as keyof AuditLogFilters] == null) {
        delete filters[key as keyof AuditLogFilters];
      }
    });

    this.isLoading = true;
    this.auditLogService.getAuditLogs(filters).subscribe({
      next: (response) => {
        this.logs = response.logs;
        this.totalLogs = response.pagination.totalItems;
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading audit logs:', error);
        this.snackBar.open('No se pudieron cargar los logs. Revisa filtros o estado de API.', 'Cerrar', { duration: 4500 });
        this.isLoading = false;
      }
    });
  }

  loadUsers(): void {
    this.userService.getUsersList().subscribe({
      next: (users) => {
        this.users = users as unknown as { _id: string; name: string; username: string }[];
      },
      error: (error) => {
        console.error('Error loading users:', error);
      }
    });
  }

  /**
   * Convierte una fecha (Date del datepicker o string) a formato YYYY-MM-DD
   * usando componentes locales, evitando desfaces de zona horaria.
   */
  private toDateOnlyString(value: unknown): string | undefined {
    if (!value) return undefined;
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return undefined;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  onSearch(): void {
    this.currentPage = 1;
    this.loadLogs();
  }

  onClearFilters(): void {
    this.filterForm.reset({
      exportMode: 'filters',
      exportValue: 1000,
      exportFormat: 'csv'
    });
    this.currentPage = 1;
    this.loadLogs();
  }

  onExport(): void {
    if (this.exporting) return;

    const raw = this.filterForm.value;
    const exportMode = raw.exportMode || 'max';
    const exportFormat = raw.exportFormat === 'json' ? 'json' : 'csv';
    const exportValue = Number(raw.exportValue);
    const needsValue = exportMode === 'max' || exportMode === 'days' || exportMode === 'months';

    if (needsValue && (!Number.isFinite(exportValue) || exportValue <= 0)) {
      console.error('Export inválido: valor numérico requerido');
      this.snackBar.open(
        'Valor inválido para exportación. Ingresa un número mayor a 0.',
        'Cerrar',
        { duration: 4000 }
      );
      return;
    }

    const filters: AuditLogFilters = {
      category: raw.category || undefined,
      userId: raw.userId || undefined,
      level: raw.level || undefined,
      startDate: this.toDateOnlyString(raw.startDate),
      endDate: this.toDateOnlyString(raw.endDate),
      search: raw.search || undefined
    };

    this.exporting = true;
    this.auditLogService.exportAuditLogs(filters, {
      format: exportFormat,
      mode: exportMode,
      exportValue: needsValue ? exportValue : undefined
    }).subscribe({
      next: (response) => {
        const blob = response.body;
        if (!blob) {
          this.exporting = false;
          return;
        }
        const disposition = response.headers.get('content-disposition') || '';
        const match = disposition.match(/filename="?([^"]+)"?/i);
        const fileName = match?.[1] || `audit-logs.${exportFormat}`;
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        window.URL.revokeObjectURL(url);
        this.exporting = false;
      },
      error: (error) => {
        this.exporting = false;
        console.error('Error exportando logs de auditoría:', error);
        const raw = String(error?.error?.message || error?.message || 'error desconocido');
        this.snackBar.open(
          `Error exportando logs (${raw}). Siguiente paso: ajusta filtros o reintenta.`,
          'Cerrar',
          { duration: 7000 }
        );
      }
    });
  }

  shouldShowExportValue(): boolean {
    const mode = this.filterForm.get('exportMode')?.value;
    return mode === 'max' || mode === 'days' || mode === 'months';
  }

  getExportValueLabel(): string {
    const mode = this.filterForm.get('exportMode')?.value;
    if (mode === 'days') return 'Cantidad de días';
    if (mode === 'months') return 'Cantidad de meses';
    return 'Cantidad de registros';
  }

  getExportValueHint(): string {
    const mode = this.filterForm.get('exportMode')?.value;
    if (mode === 'days') return 'Ejemplo: 2, 7, 15, 30.';
    if (mode === 'months') return 'Ejemplo: 1, 3, 6, 12.';
    return 'Ejemplo: 500, 1000, 5000.';
  }

  getExportModeHint(): string {
    const mode = this.filterForm.get('exportMode')?.value;
    if (mode === 'months') return 'Ejemplo: 3 = últimos 3 meses desde hoy.';
    if (mode === 'days') return 'Ejemplo: 7 = últimos 7 días desde hoy.';
    if (mode === 'max') return 'Exporta hasta N registros recientes.';
    if (mode === 'filters') return 'Usa los filtros actuales (buscar, categoría, evento, nivel y fechas).';
    return 'Exporta todos los registros hasta el máximo permitido por seguridad.';
  }

  onPageChange(event: PageEvent): void {
    this.currentPage = event.pageIndex + 1;
    this.pageSize = event.pageSize;
    this.loadLogs();
  }

  getLevelColor(level: string): string {
    switch (level) {
      case 'error':
        return 'warn';
      case 'warn':
        return 'accent';
      case 'info':
      default:
        return 'primary';
    }
  }

  getSuccessIcon(success: boolean): string {
    return success ? 'check_circle' : 'error';
  }

  getSuccessColor(success: boolean): string {
    return success ? 'primary' : 'warn';
  }

  getEventType(event: string): 'operativa' | 'checklist' | null {
    // Eventos operativos
    const operativos = [
      'entry.create',
      'entry.update',
      'entry.delete',
      'escalation.trigger',
      'user.login',
      'user.logout',
      'config.update',
      'admin.action'
    ];

    // Eventos de checklist
    const checklists = [
      'checklist.create',
      'checklist.update',
      'checklist.complete',
      'checklist.delete',
      'checklist.opened',
      'checklist.abandoned',
      'shiftcheck.create',
      'shiftcheck.update',
      'shiftcheck.complete'
    ];

    if (operativos.some(op => event.includes(op))) return 'operativa';
    if (checklists.some(ch => event.includes(ch))) return 'checklist';
    return null;
  }

  /**
   * Detecta el tipo de acción: integración, correo, autenticación, entrada, checklist, escalación, configuración
   */
  getActionType(log: AuditLog): string {
    const event = log.event?.toLowerCase() || '';
        // Backup
        if (event.includes('backup') || event.startsWith('backup_')) {
          return 'backup';
        }

    if (log.source === 'complement' || event.startsWith('complement.')) {
      return 'complement';
    }

    
    // Integración (GLPI, Log Forwarding, etc)
    if (event.includes('glpi') || event.includes('integration') || event.includes('log-forward') || event.includes('logforward')) {
      return 'integration';
    }
    
    // Correo / SMTP
    if (event.includes('mail') || event.includes('smtp') || event.includes('email')) {
      return 'email';
    }
    
    // Autenticación
    if (event.includes('auth') || event.includes('login') || event.includes('logout') || event.includes('password') || event.includes('session')) {
      return 'auth';
    }
    
    // Turnos de Trabajo
    if (event.startsWith('workshift.')) {
      return 'workshift';
    }

    // Entrada
    if (event.includes('entry')) {
      return 'entry';
    }
    
    // Checklist
    if (event.includes('checklist') || event.includes('shiftcheck')) {
      return 'checklist';
    }
    
    // Escalación
    if (event.includes('escalation')) {
      return 'escalation';
    }
    
    // Configuración / Admin
    if (event.includes('config') || event.includes('admin')) {
      return 'config';
    }
    
    return 'other';
  }

  /**
   * Detecta si es una acción del SISTEMA o del USUARIO
   */
  isSystemAction(log: AuditLog): boolean {
    // Es acción del sistema si:
    // - No tiene actor (acción automática/scheduler)
    // - El actor no tiene username (sistema/proceso)
    // - El evento es del patrón scheduler.*, cron.*, sistema.*, etc
    const event = log.event?.toLowerCase() || '';

    if (!this.getActorUsername(log)) {
      return true;
    }
    
    if (event.includes('scheduler') || event.includes('cron') || event.includes('system') || event.includes('automation')) {
      return true;
    }
    
    return false;
  }

    getActorUsername(log: AuditLog): string {
      const actorUsername = (log.actor?.username || '').trim();
      if (actorUsername) {
        return actorUsername;
      }

      const metadataUsername = typeof log.metadata?.['username'] === 'string'
        ? log.metadata['username'].trim()
        : '';

      return metadataUsername;
    }

  /**
   * Obtiene el indicador visual de acción usuario/sistema
   */
  getActorIndicator(log: AuditLog): { icon: string; label: string; class: string } {
    if (this.isSystemAction(log)) {
      return { icon: '⚙️', label: 'Sistema', class: 'actor-system' };
    }
    return { icon: '👤', label: 'Usuario', class: 'actor-user' };
  }

  /**
   * Obtiene la etiqueta legible de la categoría de acción
   */
  getActionCategoryLabel(log: AuditLog): string {
    const category = this.getActionType(log);
    const categoryLabels: { [key: string]: string } = {
      'integration': '🔗 Integración',
      'email': '📧 Correo',
      'backup': '💾 Backup',
      'complement': '🧩 Complemento',
      'auth': '🔐 Autenticación',
      'workshift': '⏰ Turnos',
      'entry': '📝 Entrada',
      'checklist': '✓ Checklist',
      'escalation': '🚨 Escalación',
      'config': '⚙️ Configuración',
      'other': '📋 Evento'
    };
    return categoryLabels[category] || categoryLabels['other'];
  }

  getEntryTypeBadge(entryType: string): string {
    const badges: { [key: string]: string } = {
      'incidente': '🚨 Incidente',
      'operativa': '🔧 Operativa',
      'urgente': '⚡ Urgente',
      'checklist': '✓ Checklist',
      'nota': '📝 Nota',
      'reporte': '📊 Reporte'
    };
    return badges[entryType.toLowerCase()] || `📌 ${entryType}`;
  }

  getEntryTypeBadgeClass(entryType: string): string {
    const classes: { [key: string]: string } = {
      'incidente': 'incidente',
      'operativa': 'operativa',
      'urgente': 'urgente',
      'checklist': 'checklist',
      'nota': 'nota',
      'reporte': 'reporte'
    };
    return classes[entryType.toLowerCase()] || 'default';
  }

  private humanizeEventLabel(event: string): string {
    return event
      .split('.')
      .filter(Boolean)
      .map((part) => part.replace(/[_-]+/g, ' '))
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' > ');
  }

  private getSimpleMetadataText(metadata: Record<string, any>): string {
    const preferredKeys = ['days', 'items', 'count', 'section', 'detail', 'type', 'scope', 'name'];
    const chunks = preferredKeys
      .filter((key) => metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== '')
      .slice(0, 3)
      .map((key) => `${key}: ${String(metadata[key])}`);
    return chunks.join(' | ');
  }

  getReasonText(log: AuditLog): string {
    const event = log.event?.toLowerCase() || '';
    const meta = log.metadata || {};
    const result = log.result || {};

    if (log.source === 'complement' || event.startsWith('complement.')) {
      const slug = log.sourceId || (typeof meta['slug'] === 'string' ? meta['slug'] : 'desconocido');
      const message = typeof meta['message'] === 'string' ? meta['message'] : (result.reason || 'Evento de complemento');
      return `🧩 [${slug}] ${message}`;
    }

    // ====== BACKUP ======
    if (event.includes('backup') || event.startsWith('backup_')) {
      const status = result.success ? '✅' : '❌';
      const fileName = (meta['fileName'] as string | undefined) || (meta['filename'] as string | undefined) || '';
      const detail = result.reason ? ` | ${result.reason}` : '';

      if (event.includes('retention_file_deleted')) {
        return `${status} [BACKUP RETENCIÓN] Archivo eliminado${fileName ? `: ${fileName}` : ''}${detail}`;
      }

      if (event.includes('retention_file_skipped')) {
        return `${status} [BACKUP RETENCIÓN] Archivo conservado${fileName ? `: ${fileName}` : ''}${detail}`;
      }

      if (event.includes('retention_cleanup_started')) {
        const scanned = Number(meta['scannedFiles'] || 0);
        return `${status} [BACKUP RETENCIÓN] Inicio de limpieza | archivos revisados: ${scanned}`;
      }

      if (event.includes('run.started')) {
        const source = (meta['source'] as string | undefined) || 'manual';
        return `${status} [BACKUP] Inicio de ejecución (${source})${detail}`;
      }

      if (event.includes('run.completed')) {
        const source = (meta['source'] as string | undefined) || 'manual';
        return `${status} [BACKUP] Ejecución completada (${source})${fileName ? ` | ${fileName}` : ''}${detail}`;
      }

      if (event.includes('run.failed')) {
        const source = (meta['source'] as string | undefined) || 'manual';
        return `${status} [BACKUP] Ejecución fallida (${source})${detail}`;
      }

      if (event.includes('run.skipped')) {
        const source = (meta['source'] as string | undefined) || 'manual';
        return `${status} [BACKUP] Ejecución omitida (${source})${detail}`;
      }

      if (event.includes('auto_triggered')) {
        return `${status} [BACKUP AUTO] Intervalo alcanzado, ejecución disparada${detail}`;
      }

      if (event.includes('auto_completed')) {
        return `${status} [BACKUP AUTO] Ejecución automática completada${fileName ? ` | ${fileName}` : ''}${detail}`;
      }

      if (event.includes('auto_scheduled')) {
        return `${status} [BACKUP AUTO] Scheduler inicializado${detail}`;
      }

      if (event.includes('admin.backup.delete')) {
        return `${status} [BACKUP] Eliminación manual${fileName ? `: ${fileName}` : ''}${detail}`;
      }

      return `${status} [BACKUP] ${result.reason || 'evento de backup registrado'}`;
    }

    // ====== CONFIGURACIÓN SMTP (no envío de correo) ======
    if (event.startsWith('smtp.config.')) {
      const status = result.success ? '✅' : '❌';
      const action = event.replace('smtp.config.save.', '').toUpperCase();
      const detail = result.reason ? ` — ${result.reason}` : '';
      return `${status} [CONFIG SMTP] Guardar configuración: ${action}${detail}`;
    }

    // ====== TURNOS DE TRABAJO ======
    if (event.startsWith('workshift.')) {
      const status = result.success ? '✅' : '❌';
      const action = event.replace('workshift.', '').toUpperCase();
      const code = meta['code'] ? ` (código: ${meta['code']})` : '';
      const name = meta['name'] ? ` "${meta['name']}"` : '';
      
      if (action === 'CREATE') {
        return `${status} [TURNO CREADO] Turno${name}${code} creado con éxito`;
      }
      if (action === 'UPDATE') {
        const updated = meta['updatedFields'] ? ` | campos: ${meta['updatedFields'].join(', ')}` : '';
        return `${status} [TURNO MODIFICADO] Turno${name}${code} actualizado${updated}`;
      }
      if (action === 'DELETE') {
        return `${status} [TURNO ELIMINADO] Turno${name}${code} eliminado`;
      }
      if (action === 'REORDER') {
        const count = meta['shiftsCount'] ? ` (${meta['shiftsCount']} turnos)` : '';
        return `${status} [TURNOS REORDENADOS] Orden de turnos actualizado${count}`;
      }
      return `${status} [TURNO ${action}]${name}${code}`;
    }
    
    // ====== CORREO / SMTP ======
    if (event.includes('mail') || event.includes('smtp') || event.includes('email')) {
      const status = result.success ? '✅' : '❌';
      const toRecipientArr = (val: unknown): string[] => {
        if (!val) return [];
        if (Array.isArray(val)) return val as string[];
        if (typeof val === 'object') return Object.values(val as Record<string, string>);
        return [];
      };
      const previewArr = toRecipientArr(meta['resolvedRecipientsPreview']).length
        ? toRecipientArr(meta['resolvedRecipientsPreview'])
        : toRecipientArr(meta['toMasked']);
      const recipientsPreview = previewArr.length ? previewArr.join(', ') : 'sin destinatarios';
      const recipientsCount = Number(meta['resolvedRecipientsCount'] ?? meta['recipientsCount'] ?? 0);
      const subject = meta['subject'] ? ` | ${meta['subject']}` : '';
      const category = meta['category'] || 'correo';
      const eventLabel = event.startsWith('smtp.test.')
        ? 'SMTP TEST'
        : String(category).toUpperCase();
      const sourceModule = meta['sourceModule'] ? ` | modulo:${meta['sourceModule']}` : '';
      const triggerType = meta['triggerType'] ? ` | trigger:${meta['triggerType']}` : '';
      const triggerContext = meta['triggerContext'] ? ` | origen:${meta['triggerContext']}` : '';
      const smtpConfigId = meta['smtpConfigId'] ? ` | smtp:${String(meta['smtpConfigId']).slice(0, 8)}...` : '';
      const failureCategory = meta['failureCategory'] ? ` | causa:${meta['failureCategory']}` : '';
      const reasonText = !result.success && result.reason ? ` | motivo:${result.reason}` : '';
      const retryText = meta['retryAttempt']
        ? ` | reintento:${Number(meta['retryCount'] || 1)}`
        : '';
      const noise = (meta['noiseControl'] as any) || null;
      const noiseText = noise && Number(noise.suppressedInWindow || 0) > 0
        ? ` | repetidos:${noise.suppressedInWindow}`
        : '';

      return `${status} [${eventLabel}] Para: ${recipientsPreview} (${recipientsCount})${subject}${sourceModule}${triggerType}${triggerContext}${smtpConfigId}${failureCategory}${reasonText}${retryText}${noiseText}`;
    }

    // ====== INTEGRACIÓN (GLPI, LOG FORWARDING) ======
    if (event.includes('glpi') || event.includes('integration') || event.includes('log-forward')) {
      const status = result.success ? '✅' : '❌';
      const target = meta['target'] || meta['endpoint'] || 'servicio externo';
      const detail = meta['detail'] || meta['message'] || result.reason || '';
      const retryText = meta['retryAttempt']
        ? ` | reintento:${Number(meta['retryCount'] || 1)}`
        : '';
      return `${status} [INTEGRACIÓN] → ${target} ${detail ? '| ' + detail : ''}${retryText}`;
    }

    // ====== AUTENTICACIÓN - LOGIN ======
    if (event === 'auth.login' || event === 'user.login') {
      const status = result.success ? '✅' : '❌';
      const method = meta['method'] || 'local';
      const reason = !result.success ? `| ${result.reason || 'intento fallido'}` : '';
      return `${status} [LOGIN] vía ${method.toUpperCase()} ${reason}`;
    }

    // ====== AUTENTICACIÓN - LOGOUT ======
    if (event === 'auth.logout' || event === 'user.logout') {
      return `✅ [LOGOUT] Sesión cerrada correctamente`;
    }

    // ====== AUTENTICACIÓN - PASSWORD / CONTRASEÑA ======
    if (event.includes('password') || event.includes('reset') || event.includes('change')) {
      const status = result.success ? '✅' : '❌';
      const typeLabel = event.includes('reset') ? 'RESET' : 'CAMBIO';
      const reason = !result.success ? `| ${result.reason || 'error'}` : '';
      return `${status} [${typeLabel} CONTRASEÑA] ${reason}`;
    }

    // ====== CAMBIO DE IP / SESIÓN SOSPECHOSA ======
    if (event === 'auth.session.ip_change') {
      const prev = meta['previousIp'] || meta['prev'] || '-';
      const curr = log.request?.ip || meta['currentIp'] || '-';
      const vpn = log.request?.isLikelyVpnOrProxy ? '(probable VPN/Proxy)' : '';
      return `⚠️ [CAMBIO IP] ${prev} → ${curr} ${vpn}`;
    }

    // ====== ENTRADA ======
    if (event.includes('entry.')) {
      const status = result.success ? '✅' : '❌';
      const action = event.replace('entry.', '').toUpperCase();
      const type = meta['entryType'] || '';
      const typeLabel = type ? `[${type.toUpperCase()}]` : '';
      const reason = result.reason ? `| ${result.reason}` : '';
      if (action === 'CREATE') return `${status} [NUEVA ENTRADA] Entrada ${typeLabel} creada con éxito${reason}`;
      if (action === 'UPDATE') return `${status} [ENTRADA MODIFICADA] Entrada ${typeLabel} editada con éxito${reason}`;
      if (action === 'DELETE') return `${status} [ENTRADA ELIMINADA] Entrada ${typeLabel} eliminada con éxito${reason}`;
      return `${status} [ENTRADA ${action}] ${typeLabel} ${reason}`;
    }

    // ====== REPORTES ======
    if (event.startsWith('user.reports.')) {
      const status = result.success ? '✅' : '❌';
      const reportLabels: Record<string, string> = {
        'user.reports.overview.view': 'Resumen general',
        'user.reports.tags_trend.view': 'Tendencia de tags',
        'user.reports.heatmap.view': 'Mapa de calor',
        'user.reports.entries_by_logsource.view': 'Entradas por Log Source',
        'user.reports.export.entries': 'Exportar entradas'
      };
      const label = reportLabels[event] || this.humanizeEventLabel(event);
      const details = this.getSimpleMetadataText(meta);
      return `${status} [REPORTES] ${label}${details ? ` | ${details}` : ''}`;
    }

    // ====== DIRECTORIO DE CONTACTOS ======
    if (event.startsWith('directory.')) {
      const status = result.success ? '✅' : '❌';
      const op = event.includes('.list.')
        ? 'Listado consultado'
        : event.includes('.detail.')
          ? 'Detalle consultado'
          : this.humanizeEventLabel(event);
      const details = this.getSimpleMetadataText(meta);
      return `${status} [DIRECTORIO] ${op}${details ? ` | ${details}` : ''}`;
    }

    // ====== COMPLEMENTOS ======
    if (event.startsWith('complement.')) {
      const status = result.success ? '✅' : '❌';
      const slug = typeof meta['slug'] === 'string' ? meta['slug'] : log.sourceId || '';
      const label = this.humanizeEventLabel(event.replace('complement.', ''));
      return `${status} [COMPLEMENTO] ${label}${slug ? ` | slug: ${slug}` : ''}`;
    }

    // ====== CHECKLIST / SHIFTCHECK ======
    if (event.includes('checklist') || event.includes('shiftcheck')) {
      const status = result.success ? '✅' : '❌';
      const template = meta['templateName'] || meta['checklistName'] || 'checklist';
      const rawType = meta['checkType'] || meta['type'];
      const checkType = rawType ? ` (${rawType})` : '';
      const reason = result.reason ? ` — ${result.reason}` : '';

      if (event === 'checklist.opened') {
        const items = meta['itemCount'] ? ` | ${meta['itemCount']} ítems` : '';
        return `👁️ [CHECKLIST ABIERTO] ${template}${checkType}${items} — sin enviar aún`;
      }
      if (event === 'checklist.abandoned') {
        return `⚠️ [CHECKLIST ABANDONADO] ${template}${checkType} — abierto y cerrado sin enviar`;
      }

      // Checklist completado y guardado con éxito
      if (event === 'shiftcheck.submit' && result.success) {
        const greenCount = Number(meta['greenCount'] || 0);
        const redCount = Number(meta['redCount'] || 0);
        const totals = (greenCount || redCount)
          ? ` | verdes:${greenCount} rojos:${redCount}`
          : '';
        return `✅ [CHECKLIST REALIZADO] ${template}${checkType}${totals}`;
      }

      // Caso en que falla el envío del checklist debido a alguna validación o error
      if (event === 'shiftcheck.submit.fail') {
        return `❌ [CHECKLIST FALLIDO] ${template}${checkType}${reason}`;
      }

      // Caso de intento consecutividad bloqueado
      if (event === 'shiftcheck.block.consecutive') {
        const tipoConsecutivo = meta['type'] || 'acción';
        return `❌ [CHECKLIST BLOQUEADO] ${template}${checkType} — Intento de registrar dos "${tipoConsecutivo}" consecutivos`;
      }

      // Caso de cooldown de tiempo bloqueado
      if (event === 'shiftcheck.block.cooldown') {
        const rem = meta['remainingMinutes'] ? ` (${meta['remainingMinutes']} min restantes)` : '';
        return `❌ [CHECKLIST BLOQUEADO] ${template}${checkType} — No se cumplió el cooldown de tiempo${rem}`;
      }

      // Mapeo genérico para otros eventos de checklist no especificados
      const action = event.includes('complete') ? 'COMPLETADO' : event.replace(/checklist\.|shiftcheck\./, '').toUpperCase();
      return `${status} [CHECKLIST ${action}] ${template}${reason}`;
    }

    // ====== ESCALACIÓN ======
    if (event.startsWith('escalation.view.') || event.startsWith('escalation.admin.')) {
      const status = result.success ? '✅' : '❌';
      const escalationLabels: Record<string, string> = {
        'escalation.view.service.read': 'Vista de escalación por servicio',
        'escalation.view.internal_shifts.read': 'Consulta de turnos internos',
        'escalation.view.contacts.read': 'Consulta de contactos de escalación',
        'escalation.view.raci.read': 'Consulta de matriz RACI',
        'escalation.view.flow.read': 'Consulta de flujo de escalación',
        'escalation.admin.raci.read': 'Consulta RACI (admin)',
        'escalation.admin.rules.read': 'Consulta de reglas de escalación (admin)',
        'escalation.admin.assignments.read': 'Consulta de asignaciones de turno (admin)'
      };
      const label = escalationLabels[event] || this.humanizeEventLabel(event);
      const details = this.getSimpleMetadataText(meta);
      return `${status} [ESCALACIÓN] ${label}${details ? ` | ${details}` : ''}`;
    }

    if (event.includes('escalation')) {
      const status = result.success ? '✅' : '❌';
      const action = event.replace('escalation.', '').toUpperCase();
      const rule = meta['ruleName'] || 'escala';
      const detail = meta['detail'] || result.reason || '';
      return `${status} [ESCALACIÓN ${action}] ${rule} ${detail ? '| ' + detail : ''}`;
    }

    // ====== CONFIGURACIÓN / ADMIN ======
    if (event.includes('config') || event.includes('admin')) {
      const status = result.success ? '✅' : '❌';
      const section = meta['section'] || meta['config'] || 'configuración';
      const detail = meta['detail'] || result.reason || '';
      return `${status} [CONFIG] ${section} ${detail ? '| ' + detail : ''}`;
    }

    // ====== FALLBACK ======
    const status = result.success ? '✅' : '❌';
    const label = this.humanizeEventLabel(event || 'evento') || 'Evento';
    const details = this.getSimpleMetadataText(meta);
    const reason = result.reason || details || 'evento registrado';
    return `${status} [${label}] ${reason}`;
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleString('es-CL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  /**
   * Abre el modal de diálogo con el detalle completo del log de auditoría.
   * @param log Log de auditoría seleccionado.
   */
  openLogDetails(log: AuditLog): void {
    this.dialog.open(AuditLogDetailDialogComponent, {
      width: '750px',
      maxWidth: '90vw',
      data: {
        log,
        formattedDate: this.formatDate(log.timestamp),
        reasonText: this.getReasonText(log),
        categoryLabel: this.getActionCategoryLabel(log),
        actionType: this.getActionType(log)
      }
    });
  }
}
