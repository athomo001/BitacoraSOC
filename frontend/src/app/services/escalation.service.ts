import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  Client,
  Service,
  Contact,
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
  ClientAlertAckPayload,
  ClientAlertContext
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
  getContacts(): Observable<Contact[]> {
    return this.http.get<Contact[]>(`${this.apiUrl}/contacts`);
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

  getAllContacts(): Observable<Contact[]> {
    return this.http.get<Contact[]>(`${this.apiUrl}/admin/contacts`);
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

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 🔧 CRUD ADMIN - RACI
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  getRaciAdmin(clientId?: string, serviceId?: string): Observable<RaciEntry[]> {
    let params = new HttpParams();
    if (clientId) {
      params = params.set('clientId', clientId);
    }
    if (serviceId) {
      params = params.set('serviceId', serviceId);
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

  getAssignments(roleCode?: string, fromDate?: string): Observable<ShiftAssignment[]> {
    let params = new HttpParams();
    if (roleCode) {
      params = params.set('roleCode', roleCode);
    }
    if (fromDate) {
      params = params.set('fromDate', fromDate);
    }
    return this.http.get<ShiftAssignment[]>(`${this.apiUrl}/admin/assignments`, { params });
  }

  createAssignment(data: ShiftAssignmentFormData): Observable<ShiftAssignment> {
    return this.http.post<ShiftAssignment>(`${this.apiUrl}/admin/assignments`, data);
  }

  updateAssignment(id: string, data: ShiftAssignmentFormData): Observable<ShiftAssignment> {
    return this.http.put<ShiftAssignment>(`${this.apiUrl}/admin/assignments/${id}`, data);
  }

  deleteAssignment(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/admin/assignments/${id}`);
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

  // 👥 USUARIOS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  getUsers(): Observable<any[]> {
    // Endpoint público que no requiere permisos de admin
    return this.http.get<any[]>(`${environment.apiUrl}/users/list`);
  }
}
