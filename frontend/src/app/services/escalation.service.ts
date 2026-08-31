/**
 * File Purpose: frontend/src/app/services/escalation.service.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  Client,
  Service,
  Contact,
  ContactType,
  EscalationRule,
  ShiftRotationCycle,
  ShiftAssignment,
  ShiftOverride,
  EscalationView,
  ClientFormData,
  ServiceFormData,
  ContactFormData,
  EscalationRuleFormData,
  ShiftRotationCycleFormData,
  ShiftAssignmentFormData,
  ShiftOverrideFormData,
  ExternalPerson,
  RaciEntry,
  RaciEntryFormData,
  ClientAlertRule,
  ClientAlertRuleFormData,
  ClientAlertEvaluation,
  NewsletterRecipientValidation,
  ClientAlertAckPayload,
  ClientAlertContext,
  EscalationFlowConfig,
  EscalationFlowStep
} from '../models/escalation.model';

@Injectable({
  providedIn: 'root'
})
export class EscalationService {
  private apiUrl = `${environment.apiUrl}/escalation`;

  constructor(private http: HttpClient) {}

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 📖 LECTURA (Analyst/Admin)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Obtener información de escalamiento para un servicio (quién informar AHORA)
   */
  getEscalationView(serviceId: string, nowIso?: string): Observable<EscalationView> {
    let params = new HttpParams();
    if (nowIso) {
      params = params.set('now', nowIso);
    }
    return this.http.get<EscalationView>(`${this.apiUrl}/view/${serviceId}`, { params });
  }

  getInternalShiftsNow(nowIso?: string): Observable<{ internalShifts: any[]; timestamp: string }> {
    let params = new HttpParams();
    if (nowIso) {
      params = params.set('now', nowIso);
    }
    return this.http.get<{ internalShifts: any[]; timestamp: string }>(
      `${this.apiUrl}/internal-shifts`,
      { params }
    );
  }

  /**
   * Obtener lista de clientes activos
   */
  getActiveClients(): Observable<Client[]> {
    return this.http.get<Client[]>(`${this.apiUrl}/clients`);
  }

  /**
   * Obtener todos los clientes (alias para compatibilidad)
   */
  getClients(): Observable<Client[]> {
    return this.getActiveClients();
  }

  /**
   * Obtener lista de servicios (opcionalmente filtrados por cliente)
   */
  getServices(clientId?: string): Observable<Service[]> {
    let params = new HttpParams();
    if (clientId) {
      params = params.set('clientId', clientId);
    }
    return this.http.get<Service[]>(`${this.apiUrl}/services`, { params });
  }

  /**
   * Obtener contactos activos (sin permisos de admin)
   */
  getContacts(contactType: ContactType = 'escalation', search?: string): Observable<Contact[]> {
    let params = new HttpParams().set('contactType', contactType);
    if (search) {
      params = params.set('search', search);
    }
    return this.http.get<Contact[]>(`${this.apiUrl}/contacts`, { params });
  }

  /**
   * Obtener matriz RACI por cliente/servicio
   */
  getRaci(clientId: string, serviceId?: string): Observable<RaciEntry[]> {
    let params = new HttpParams().set('clientId', clientId);
    if (serviceId) {
      params = params.set('serviceId', serviceId);
    }
    return this.http.get<RaciEntry[]>(`${this.apiUrl}/raci`, { params });
  }

  getEscalationFlow(clientId: string): Observable<EscalationFlowConfig> {
    return this.http.get<EscalationFlowConfig>(`${this.apiUrl}/flow/${clientId}`);
  }

  saveEscalationFlow(clientId: string, payload: { flow: EscalationFlowStep[]; legend: string }): Observable<EscalationFlowConfig> {
    return this.http.put<EscalationFlowConfig>(`${this.apiUrl}/flow/${clientId}`, payload);
  }

  /**
   * Evaluar alerta especial por cliente para el contexto actual del analista
   */
  evaluateClientAlert(
    clientId: string,
    context: ClientAlertContext = 'report'
  ): Observable<ClientAlertEvaluation> {
    const params = new HttpParams()
      .set('clientId', clientId)
      .set('context', context);
    return this.http.get<ClientAlertEvaluation>(`${this.apiUrl}/client-alert`, { params });
  }

  /**
   * Confirmar lectura de alerta especial (acknowledgement)
   */
  acknowledgeClientAlert(payload: ClientAlertAckPayload): Observable<{
    acknowledged: boolean;
    ruleId: string;
    clientId: string;
    context: ClientAlertContext;
    acknowledgedAt: string;
  }> {
    return this.http.post<{
      acknowledged: boolean;
      ruleId: string;
      clientId: string;
      context: ClientAlertContext;
      acknowledgedAt: string;
    }>(`${this.apiUrl}/client-alert/ack`, payload);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔧 CRUD ADMIN - Clientes
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  getAllClients(): Observable<Client[]> {
    return this.http.get<Client[]>(`${this.apiUrl}/admin/clients`);
  }

  createClient(data: ClientFormData): Observable<Client> {
    return this.http.post<Client>(`${this.apiUrl}/admin/clients`, data);
  }

  updateClient(id: string, data: ClientFormData): Observable<Client> {
    return this.http.put<Client>(`${this.apiUrl}/admin/clients/${id}`, data);
  }

  deleteClient(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/admin/clients/${id}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔧 CRUD ADMIN - Servicios
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  getAllServices(): Observable<Service[]> {
    return this.http.get<Service[]>(`${this.apiUrl}/admin/services`);
  }

  createService(data: ServiceFormData): Observable<Service> {
    return this.http.post<Service>(`${this.apiUrl}/admin/services`, data);
  }

  updateService(id: string, data: ServiceFormData): Observable<Service> {
    return this.http.put<Service>(`${this.apiUrl}/admin/services/${id}`, data);
  }

  deleteService(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/admin/services/${id}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔧 CRUD ADMIN - Contactos
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  getAllContacts(contactType?: ContactType | 'all', search?: string): Observable<Contact[]> {
    let params = new HttpParams();
    if (contactType) {
      params = params.set('contactType', contactType);
    }
    if (search) {
      params = params.set('search', search);
    }
    return this.http.get<Contact[]>(`${this.apiUrl}/admin/contacts`, { params });
  }

  createContact(data: ContactFormData): Observable<Contact> {
    return this.http.post<Contact>(`${this.apiUrl}/admin/contacts`, data);
  }

  updateContact(id: string, data: ContactFormData): Observable<Contact> {
    return this.http.put<Contact>(`${this.apiUrl}/admin/contacts/${id}`, data);
  }

  deleteContact(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/admin/contacts/${id}`);
  }

  importContactsCsv(file: File, contactType: ContactType = 'preventive'): Observable<{
    message: string;
    created: number;
    updated: number;
    errorCount: number;
    errors: Array<{ row: number | string; message: string }>;
  }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('contactType', contactType);
    return this.http.post<{
      message: string;
      created: number;
      updated: number;
      errorCount: number;
      errors: Array<{ row: number | string; message: string }>;
    }>(`${this.apiUrl}/admin/contacts/import-csv`, formData);
  }

  exportContactsCsv(contactType: ContactType | 'all' = 'preventive'): Observable<Blob> {
    const params = new HttpParams().set('contactType', contactType);
    return this.http.get(`${this.apiUrl}/admin/contacts/export-csv`, {
      params,
      responseType: 'blob'
    });
  }

  validateNewsletterRecipients(recipients: string[]): Observable<NewsletterRecipientValidation> {
    return this.http.post<NewsletterRecipientValidation>(`${environment.backendBaseUrl}/api/reports/newsletter/validate`, {
      recipients
    });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔧 CRUD ADMIN - RACI
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  getRaciAdmin(clientId?: string, serviceId?: string, topic?: string): Observable<RaciEntry[]> {
    let params = new HttpParams();
    if (clientId) {
      params = params.set('clientId', clientId);
    }
    if (serviceId) {
      params = params.set('serviceId', serviceId);
    }
    if (topic) {
      params = params.set('topic', topic);
    }
    return this.http.get<RaciEntry[]>(`${this.apiUrl}/admin/raci`, { params });
  }

  createRaci(data: RaciEntryFormData): Observable<RaciEntry> {
    return this.http.post<RaciEntry>(`${this.apiUrl}/admin/raci`, data);
  }

  updateRaci(id: string, data: RaciEntryFormData): Observable<RaciEntry> {
    return this.http.put<RaciEntry>(`${this.apiUrl}/admin/raci/${id}`, data);
  }

  deleteRaci(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/admin/raci/${id}`);
  }

  /**
   * CRUD ADMIN - Reglas especiales por cliente (B22)
   */
  getClientAlertRules(clientId?: string, enabled?: boolean): Observable<ClientAlertRule[]> {
    let params = new HttpParams();
    if (clientId) {
      params = params.set('clientId', clientId);
    }
    if (enabled !== undefined) {
      params = params.set('enabled', String(enabled));
    }
    return this.http.get<ClientAlertRule[]>(`${this.apiUrl}/admin/client-alert-rules`, { params });
  }

  createClientAlertRule(data: ClientAlertRuleFormData): Observable<ClientAlertRule> {
    return this.http.post<ClientAlertRule>(`${this.apiUrl}/admin/client-alert-rules`, data);
  }

  updateClientAlertRule(id: string, data: ClientAlertRuleFormData): Observable<ClientAlertRule> {
    return this.http.put<ClientAlertRule>(`${this.apiUrl}/admin/client-alert-rules/${id}`, data);
  }

  deleteClientAlertRule(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/admin/client-alert-rules/${id}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔧 ESC-MAINT-042 — Mantenimientos (Analistas y Admins)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  getMaintenanceRules(clientId?: string): Observable<ClientAlertRule[]> {
    let params = new HttpParams();
    if (clientId) params = params.set('clientId', clientId);
    return this.http.get<ClientAlertRule[]>(`${this.apiUrl}/maintenance-rules`, { params });
  }

  createMaintenanceRule(data: Partial<ClientAlertRule>): Observable<ClientAlertRule> {
    return this.http.post<ClientAlertRule>(`${this.apiUrl}/maintenance-rules`, data);
  }

  updateMaintenanceRule(id: string, data: Partial<ClientAlertRule>): Observable<ClientAlertRule> {
    return this.http.put<ClientAlertRule>(`${this.apiUrl}/maintenance-rules/${id}`, data);
  }

  deleteMaintenanceRule(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/maintenance-rules/${id}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔧 CRUD ADMIN - Reglas de Escalamiento
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  getRules(serviceId?: string): Observable<EscalationRule[]> {
    let params = new HttpParams();
    if (serviceId) {
      params = params.set('serviceId', serviceId);
    }
    return this.http.get<EscalationRule[]>(`${this.apiUrl}/admin/rules`, { params });
  }

  createRule(data: EscalationRuleFormData): Observable<EscalationRule> {
    return this.http.post<EscalationRule>(`${this.apiUrl}/admin/rules`, data);
  }

  updateRule(id: string, data: EscalationRuleFormData): Observable<EscalationRule> {
    return this.http.put<EscalationRule>(`${this.apiUrl}/admin/rules/${id}`, data);
  }

  deleteRule(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/admin/rules/${id}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔧 CRUD ADMIN - Ciclos de Rotación
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  getCycles(): Observable<ShiftRotationCycle[]> {
    return this.http.get<ShiftRotationCycle[]>(`${this.apiUrl}/admin/cycles`);
  }

  createCycle(data: ShiftRotationCycleFormData): Observable<ShiftRotationCycle> {
    return this.http.post<ShiftRotationCycle>(`${this.apiUrl}/admin/cycles`, data);
  }

  updateCycle(id: string, data: ShiftRotationCycleFormData): Observable<ShiftRotationCycle> {
    return this.http.put<ShiftRotationCycle>(`${this.apiUrl}/admin/cycles/${id}`, data);
  }

  deleteCycle(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/admin/cycles/${id}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔧 CRUD ADMIN - Asignaciones de Turno
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Consulta pública de asignaciones de turno (accesible para analistas autenticados).
   * Usada para poblar la tabla de teletrabajo/vacaciones en la vista operativa.
   */
  getAssignments(roleCode?: string, fromDate?: string, toDate?: string, limit?: number): Observable<ShiftAssignment[]> {
    let params = new HttpParams();
    if (roleCode) {
      params = params.set('roleCode', roleCode);
    }
    if (fromDate) {
      params = params.set('fromDate', fromDate);
    }
    if (toDate) {
      params = params.set('toDate', toDate);
    }
    if (limit && limit > 0) {
      params = params.set('limit', String(limit));
    }
    // Usa ruta pública (/assignments) accesible para todos los analistas autenticados
    return this.http.get<ShiftAssignment[]>(`${this.apiUrl}/assignments`, { params });
  }

  /**
   * Consulta administrativa de asignaciones (requiere rol admin).
   * Usada en /main/admin/work-shifts para gestión completa.
   */
  getAssignmentsAdmin(roleCode?: string, fromDate?: string, toDate?: string, limit?: number): Observable<ShiftAssignment[]> {
    let params = new HttpParams();
    if (roleCode) {
      params = params.set('roleCode', roleCode);
    }
    if (fromDate) {
      params = params.set('fromDate', fromDate);
    }
    if (toDate) {
      params = params.set('toDate', toDate);
    }
    if (limit && limit > 0) {
      params = params.set('limit', String(limit));
    }
    return this.http.get<ShiftAssignment[]>(`${this.apiUrl}/admin/assignments`, { params });
  }

  createAssignment(data: ShiftAssignmentFormData): Observable<ShiftAssignment> {
    return this.http.post<ShiftAssignment>(`${this.apiUrl}/admin/assignments`, data);
  }

  importAssignmentsCsv(file: File): Observable<{
    message: string;
    created: number;
    updated: number;
    errorCount: number;
    errors: Array<{ row: number | string; message: string }>;
  }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{
      message: string;
      created: number;
      updated: number;
      errorCount: number;
      errors: Array<{ row: number | string; message: string }>;
    }>(`${this.apiUrl}/admin/assignments/import-csv`, formData);
  }

  downloadAssignmentsTemplateCsv(): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/admin/assignments/template-csv`, {
      responseType: 'blob'
    });
  }

  updateAssignment(id: string, data: ShiftAssignmentFormData): Observable<ShiftAssignment> {
    return this.http.put<ShiftAssignment>(`${this.apiUrl}/admin/assignments/${id}`, data);
  }

  deleteAssignment(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/admin/assignments/${id}`);
  }

  bulkDeleteAssignments(ids: string[]): Observable<{ message: string; deletedCount: number; restoredCount?: number }> {
    // Permite eliminar múltiples asignaciones de forma masiva en el panel administrativo
    return this.http.post<{ message: string; deletedCount: number; restoredCount?: number }>(
      `${this.apiUrl}/admin/assignments/bulk-delete`,
      { ids }
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔧 CRUD ADMIN - Overrides Manuales
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  getOverrides(roleCode?: string, active?: boolean): Observable<ShiftOverride[]> {
    let params = new HttpParams();
    if (roleCode) {
      params = params.set('roleCode', roleCode);
    }
    if (active !== undefined) {
      params = params.set('active', String(active));
    }
    return this.http.get<ShiftOverride[]>(`${this.apiUrl}/admin/overrides`, { params });
  }

  createOverride(data: ShiftOverrideFormData): Observable<ShiftOverride> {
    return this.http.post<ShiftOverride>(`${this.apiUrl}/admin/overrides`, data);
  }

  updateOverride(id: string, data: ShiftOverrideFormData): Observable<ShiftOverride> {
    return this.http.put<ShiftOverride>(`${this.apiUrl}/admin/overrides/${id}`, data);
  }

  deleteOverride(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/admin/overrides/${id}`);
  }

  // 👤 PERSONAS EXTERNAS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  getExternalPeople(): Observable<ExternalPerson[]> {
    return this.http.get<ExternalPerson[]>(`${this.apiUrl}/admin/external-people`);
  }

  createExternalPerson(data: Partial<ExternalPerson>): Observable<ExternalPerson> {
    return this.http.post<ExternalPerson>(`${this.apiUrl}/admin/external-people`, data);
  }

  updateExternalPerson(id: string, data: Partial<ExternalPerson>): Observable<ExternalPerson> {
    return this.http.put<ExternalPerson>(`${this.apiUrl}/admin/external-people/${id}`, data);
  }

  deleteExternalPerson(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/admin/external-people/${id}`);
  }

  testEscalationReminder(cargoLabels: string[] = []): Observable<{
    message: string;
    cargoLabels: string[];
    totalRecipients: number;
    recipients: string[];
  }> {
    return this.http.post<{
      message: string;
      cargoLabels: string[];
      totalRecipients: number;
      recipients: string[];
    }>(`${this.apiUrl}/admin/reminder/test`, { cargoLabels });
  }

  // 👥 USUARIOS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  getUsers(): Observable<any[]> {
    // Endpoint público que no requiere permisos de admin
    return this.http.get<any[]>(`${environment.apiUrl}/users/list`);
  }

  /**
   * Disparar manualmente el envío de turnos automatizado (ESC-SHIFT-111)
   */
  triggerAutomationSend(payload?: { recipients?: string[]; ccRecipients?: string[] }): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/admin/automation/trigger-send`, payload || {});
  }

  /**
   * Obtiene la lista completa de todas las programaciones de notificaciones de turnos.
   */
  getNotificationSchedules(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/admin/notification-schedules`);
  }

  /**
   * Crea una nueva programación de notificación automatizada.
   */
  createNotificationSchedule(data: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/admin/notification-schedules`, data);
  }

  /**
   * Actualiza una programación de notificación existente por su ID.
   */
  updateNotificationSchedule(id: string, data: any): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/admin/notification-schedules/${id}`, data);
  }

  /**
   * Elimina una programación de notificación por su ID.
   */
  deleteNotificationSchedule(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/admin/notification-schedules/${id}`);
  }

  /**
   * Dispara manualmente el envío de correo inmediato para una programación específica.
   */
  triggerNotificationScheduleSend(id: string, payload?: { recipients?: string[]; ccRecipients?: string[] }): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/admin/notification-schedules/${id}/trigger-send`, payload || {});
  }

  /**
   * Envía una notificación de turnos de prueba (sin ID) con configuración libre.
   */
  testNotificationScheduleSend(payload: any): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/admin/notification-schedules/test-send`, payload);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔗 Enlace público de solo lectura — "Personal en Teletrabajo y Apoyo" (admin)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /** Estado actual del enlace público de la grilla de teletrabajo. */
  getTeleworkPublicLink(): Observable<TeleworkPublicLink> {
    return this.http.get<TeleworkPublicLink>(`${this.apiUrl}/admin/telework-public-link`);
  }

  /** Genera o regenera el enlace (rota el token e invalida el anterior). */
  rotateTeleworkPublicLink(): Observable<TeleworkPublicLink> {
    return this.http.post<TeleworkPublicLink>(`${this.apiUrl}/admin/telework-public-link/rotate`, {});
  }

  /** Activa o desactiva el enlace sin cambiar el token. */
  setTeleworkPublicLinkEnabled(enabled: boolean): Observable<TeleworkPublicLink> {
    return this.http.post<TeleworkPublicLink>(`${this.apiUrl}/admin/telework-public-link/set-enabled`, { enabled });
  }
}

export interface TeleworkPublicLink {
  exists: boolean;
  enabled: boolean;
  token?: string;
  path?: string;
  url?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
  lastAccessedAt?: string | null;
  accessCount?: number;
}
