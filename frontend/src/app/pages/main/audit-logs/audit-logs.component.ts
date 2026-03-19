import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuditLogService } from '../../../services/audit-log.service';
import { AuditLog, AuditLogFilters } from '../../../models/audit-log.model';

@Component({
  selector: 'app-audit-logs',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
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
  displayedColumns: string[] = ['timestamp', 'actor', 'level', 'username', 'reason'];
  logs: AuditLog[] = [];
  totalLogs = 0;
  pageSize = 20;
  currentPage = 1;

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
    private fb: FormBuilder
  ) {
    this.filterForm = this.fb.group({
      search: [''],
      category: [''],
      event: [''],
      level: [''],
      startDate: [''],
      endDate: ['']
    });
  }

  categoryOptions = [
    { value: '', label: 'Todas' },
    { value: 'mail', label: 'Mail / SMTP' },
    { value: 'admin', label: 'Admin' },
    { value: 'user', label: 'Usuario' },
    { value: 'security', label: 'Seguridad' }
  ];

  ngOnInit(): void {
    this.loadLogs();
    this.loadEvents();
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
    this.filterForm.reset();
    this.currentPage = 1;
    this.loadLogs();
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
    
    if (!log.actor || !log.actor.username) {
      return true;
    }
    
    if (event.includes('scheduler') || event.includes('cron') || event.includes('system') || event.includes('automation')) {
      return true;
    }
    
    return false;
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
    
    // ====== CORREO / SMTP ======
    if (event.includes('mail') || event.includes('smtp')) {
      const status = result.success ? '✅' : '❌';
      const recipients = (meta.toMasked as string[] | undefined)?.length ? (meta.toMasked as string[]).join(', ') : 'sin destinatarios';
      const subject = meta.subject ? ` | ${meta.subject}` : '';
      const category = meta.category || 'correo';
      return `${status} [${category.toUpperCase()}] Para: ${recipients}${subject}`;
    }

    // ====== INTEGRACIÓN (GLPI, LOG FORWARDING) ======
    if (event.includes('glpi') || event.includes('integration') || event.includes('log-forward')) {
      const status = result.success ? '✅' : '❌';
      const target = meta.target || meta.endpoint || 'servicio externo';
      const detail = meta.detail || meta.message || result.reason || '';
      return `${status} [INTEGRACIÓN] → ${target} ${detail ? '| ' + detail : ''}`;
    }

    // ====== AUTENTICACIÓN - LOGIN ======
    if (event === 'auth.login' || event === 'user.login') {
      const status = result.success ? '✅' : '❌';
      const method = meta.method || 'local';
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
      const prev = meta.previousIp || meta.prev || '-';
      const curr = log.request?.ip || meta.currentIp || '-';
      const vpn = log.request?.isLikelyVpnOrProxy ? '(probable VPN/Proxy)' : '';
      return `⚠️ [CAMBIO IP] ${prev} → ${curr} ${vpn}`;
    }

    // ====== ENTRADA ======
    if (event.includes('entry.')) {
      const status = result.success ? '✅' : '❌';
      const action = event.replace('entry.', '').toUpperCase();
      const type = meta.entryType || '';
      const typeLabel = type ? `[${type.toUpperCase()}]` : '';
      const reason = result.reason ? `| ${result.reason}` : '';
      return `${status} [ENTRADA ${action}] ${typeLabel} ${reason}`;
    }

    // ====== CHECKLIST / SHIFTCHECK ======
    if (event.includes('checklist') || event.includes('shiftcheck')) {
      const status = result.success ? '✅' : '❌';
      const action = event.includes('complete') ? 'COMPLETADO' : event.replace(/checklist\.|shiftcheck\./, '').toUpperCase();
      const template = meta.templateName || meta.checklistName || 'checklist';
      const reason = result.reason ? `| ${result.reason}` : '';
      return `${status} [CHECKLIST ${action}] ${template} ${reason}`;
    }

    // ====== ESCALACIÓN ======
    if (event.includes('escalation')) {
      const status = result.success ? '✅' : '❌';
      const action = event.replace('escalation.', '').toUpperCase();
      const rule = meta.ruleName || 'escala';
      const detail = meta.detail || result.reason || '';
      return `${status} [ESCALACIÓN ${action}] ${rule} ${detail ? '| ' + detail : ''}`;
    }

    // ====== CONFIGURACIÓN / ADMIN ======
    if (event.includes('config') || event.includes('admin')) {
      const status = result.success ? '✅' : '❌';
      const section = meta.section || meta.config || 'configuración';
      const detail = meta.detail || result.reason || '';
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
