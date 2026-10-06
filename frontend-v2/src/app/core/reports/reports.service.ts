import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import { PageMeta } from '../territory/territory.models';

/** Informe de incidente o boletín de seguridad (comentario del dueño #10). */
export type ReportKind = 'incident' | 'bulletin';
export type Criticality = 'Baja' | 'Media' | 'Alta' | 'Crítica';

/** Campos del "Reporte de Detección" legacy, con sus nombres originales. */
export interface IncidentFields {
  codigoTicket: string;
  ofensa: string;
  tipoOperacion: string;
  nombreEvento: string;
  fecha: string;
  criticidad: string;
  motivoEvento: string;
  observaciones: string;
  recomendacion: string;
  informacionAdicional: string;
  origenConexion: string;
  destino: string;
  reputacionOrigen: string;
  evidenciaTexto: string;
  logSource: string;
}

export interface BulletinFields {
  tituloBoletin: string;
  marcaFabricante: string;
  cveIdentificadores: string;
  criticidad: string;
  productosAfectados: string;
  impacto: string;
  recomendacion: string;
  referencias: string;
}

export interface ReportImage {
  name: string;
  contentType: string;
  base64: string;
  width: number;
  height: number;
}

export interface ReportRequest {
  organizationId?: string;
  serviceId?: string;
  incident?: IncidentFields;
  bulletin?: BulletinFields;
  images: ReportImage[];
  to: string[];
  cc: string[];
  subject: string;
  greeting: string;
  groupByDomain?: boolean;
}

export interface SendResult {
  status: 'sent' | 'partial';
  batches: number;
  failures: string[];
  historyId?: string;
}

export interface ReportHistoryItem {
  id: string;
  kind: ReportKind;
  title: string;
  subject: string;
  organizationId?: string;
  organizationName?: string;
  recipients: string[];
  cc: string[];
  status: 'sent' | 'partial' | 'failed' | 'legacy';
  error?: string;
  sentBy: string;
  createdAt: string;
  /** Tiene el formulario guardado: sirve para "Usar como base". */
  reusable: boolean;
  html?: string;
  payload?: Partial<ReportRequest>;
}

export type AlertContext = 'report' | 'copy-report';

export interface AlertWindow {
  mode: 'always' | 'outside_business_hours' | 'between_hours' | 'after_hour' | 'before_hour' | 'weekend_only' | 'weekdays_only';
  startTime: string;
  endTime: string;
  /** 0 = domingo; vacío = todos los días. */
  daysOfWeek: number[];
  holidayOnly: boolean;
}

/** Aviso por cliente: lo que el operador debe leer antes de enviarle algo. */
export interface ClientAlertRule {
  id: string;
  organizationId: string;
  organizationName?: string;
  name: string;
  enabled: boolean;
  contexts: AlertContext[];
  timezone: string;
  priority: number;
  validFrom?: string | null;
  validTo?: string | null;
  holidayDates: string[];
  windows: AlertWindow[];
  channels: string[];
  message: string;
  requiresAck: boolean;
  acked?: boolean;
}

/** Tipo de operación del informe: al elegirlo rellena "Información adicional". */
export interface OperationType {
  id: string;
  name: string;
  infoDefault: string;
  enabled: boolean;
}

export type ClientAlertForm = Omit<ClientAlertRule, 'id' | 'organizationName' | 'acked'>;

/** /api/reports/* y /api/client-alerts/*. */
@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly http = inject(HttpClient);

  async preview(kind: ReportKind, req: ReportRequest): Promise<{ html: string; title: string }> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ html: string; title: string }>>(`/api/reports/${kind}/preview`, req))).data;
  }

  async send(kind: ReportKind, req: ReportRequest): Promise<SendResult> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<SendResult>>(`/api/reports/${kind}/send`, req))).data;
  }

  /** Para/CC propuestos desde el escalamiento del cliente. */
  async recipients(organizationId: string, serviceId?: string): Promise<{ to: string[]; cc: string[] }> {
    const params: Record<string, string> = { organizationId };
    if (serviceId) {
      params['serviceId'] = serviceId;
    }
    return (await firstValueFrom(this.http.get<ApiEnvelope<{ to: string[]; cc: string[] }>>('/api/reports/recipients', { params }))).data;
  }

  async history(kind: ReportKind | '', page: number): Promise<{ items: ReportHistoryItem[]; meta: PageMeta }> {
    const params: Record<string, string> = { page: String(page) };
    if (kind) {
      params['kind'] = kind;
    }
    const res = await firstValueFrom(this.http.get<ApiEnvelope<ReportHistoryItem[]>>('/api/reports/history', { params }));
    return { items: res.data, meta: res.meta as PageMeta };
  }

  async historyItem(id: string): Promise<ReportHistoryItem> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ReportHistoryItem>>(`/api/reports/history/${id}`))).data;
  }

  async deleteHistory(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/reports/history/${id}`));
  }

  /** Avisos vigentes ahora para ese cliente y contexto. */
  async activeAlerts(organizationId: string, context: AlertContext): Promise<ClientAlertRule[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ClientAlertRule[]>>('/api/client-alerts/active', { params: { organizationId, context } }))).data;
  }

  async ackAlert(id: string, context: AlertContext): Promise<void> {
    await firstValueFrom(this.http.post(`/api/client-alerts/${id}/ack`, { context }));
  }

  async operationTypes(): Promise<OperationType[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<OperationType[]>>('/api/report-operation-types'))).data;
  }

  async saveOperationType(type: Omit<OperationType, 'id'>, id?: string): Promise<OperationType> {
    const req = id
      ? this.http.put<ApiEnvelope<OperationType>>(`/api/report-operation-types/${id}`, type)
      : this.http.post<ApiEnvelope<OperationType>>('/api/report-operation-types', type);
    return (await firstValueFrom(req)).data;
  }

  async deleteOperationType(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/report-operation-types/${id}`));
  }

  async listAlerts(): Promise<ClientAlertRule[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<ClientAlertRule[]>>('/api/client-alerts'))).data;
  }

  async createAlert(rule: ClientAlertForm): Promise<ClientAlertRule> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<ClientAlertRule>>('/api/client-alerts', rule))).data;
  }

  async updateAlert(id: string, rule: ClientAlertForm): Promise<ClientAlertRule> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<ClientAlertRule>>(`/api/client-alerts/${id}`, rule))).data;
  }

  async deleteAlert(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/client-alerts/${id}`));
  }
}
