import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../../services/auth.service';
import { OnboardingService } from '../../../services/onboarding.service';
import { AuditLogService } from '../../../services/audit-log.service';
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
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatTooltipModule
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
  exporting = false;
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
  events: string[] = [];
  levelOptions = [
    { value: '', label: 'Todos' },
    { value: 'info', label: 'Info' },
    { value: 'warn', label: 'Advertencia' },
    { value: 'error', label: 'Error' }
  ];

  constructor(
    private auditLogService: AuditLogService,
    private fb: FormBuilder,
    private snackBar: MatSnackBar,
    private authService: AuthService,
    private onboardingService: OnboardingService
  ) {
    this.filterForm = this.fb.group({
      search: [''],
      category: [''],
      sourceSlug: [''],
      event: [''],
      level: [''],
      startDate: [''],
      endDate: [''],
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
    this.loadEvents();
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
    const filters: AuditLogFilters = {
      page: this.currentPage,
      limit: this.pageSize,
      ...this.filterForm.value
    };

    // Filtrar valores vacíos
    Object.keys(filters).forEach(key => {
      if (filters[key as keyof AuditLogFilters] === '' || filters[key as keyof AuditLogFilters] === null) {
        delete filters[key as keyof AuditLogFilters];
      }
    });

    this.auditLogService.getAuditLogs(filters).subscribe({
      next: (response) => {
        this.logs = response.logs;
        this.totalLogs = response.pagination.totalItems;
      },
      error: (error) => {
        console.error('Error loading audit logs:', error);
        this.snackBar.open('No se pudieron cargar los logs. Revisa filtros o estado de API.', 'Cerrar', { duration: 4500 });
      }
    });
  }

  loadEvents(): void {
    this.auditLogService.getEvents().subscribe({
      next: (response) => {
        this.events = response.events;
      },
      error: (error) => {
        console.error('Error loading events:', error);
      }
    });
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
      sourceSlug: raw.sourceSlug || undefined,
      event: raw.event || undefined,
      level: raw.level || undefined,
      startDate: raw.startDate || undefined,
      endDate: raw.endDate || undefined,
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
    
    // ====== CORREO / SMTP ======
    if (event.includes('mail') || event.includes('smtp')) {
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
      const sourceModule = meta['sourceModule'] ? ` | modulo:${meta['sourceModule']}` : '';
      const triggerType = meta['triggerType'] ? ` | trigger:${meta['triggerType']}` : '';
      const triggerContext = meta['triggerContext'] ? ` | origen:${meta['triggerContext']}` : '';
      const smtpConfigId = meta['smtpConfigId'] ? ` | smtp:${String(meta['smtpConfigId']).slice(0, 8)}...` : '';
      const failureCategory = meta['failureCategory'] ? ` | causa:${meta['failureCategory']}` : '';
      const retryText = meta['retryAttempt']
        ? ` | reintento:${Number(meta['retryCount'] || 1)}`
        : '';
      const noise = (meta['noiseControl'] as any) || null;
      const noiseText = noise && Number(noise.suppressedInWindow || 0) > 0
        ? ` | repetidos:${noise.suppressedInWindow}`
        : '';

      return `${status} [${String(category).toUpperCase()}] Para: ${recipientsPreview} (${recipientsCount})${subject}${sourceModule}${triggerType}${triggerContext}${smtpConfigId}${failureCategory}${retryText}${noiseText}`;
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
      return `${status} [ENTRADA ${action}] ${typeLabel} ${reason}`;
    }

    // ====== CHECKLIST / SHIFTCHECK ======
    if (event.includes('checklist') || event.includes('shiftcheck')) {
      const status = result.success ? '✅' : '❌';
      const action = event.includes('complete') ? 'COMPLETADO' : event.replace(/checklist\.|shiftcheck\./, '').toUpperCase();
      const template = meta['templateName'] || meta['checklistName'] || 'checklist';
      const reason = result.reason ? `| ${result.reason}` : '';
      return `${status} [CHECKLIST ${action}] ${template} ${reason}`;
    }

    // ====== ESCALACIÓN ======
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
    const reason = result.reason || 'acción completada';
    return `${status} [${event.toUpperCase()}] ${reason}`;
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleString('es-CL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
}
