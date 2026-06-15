/**
 * File Purpose: frontend/src/app/models/report.model.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

export interface ReportOverview {
  period: string;
  entriesByType: {
    operativa?: number;
    incidente?: number;
    ofensa?: number;
  };
  incidentsByUser: Array<{
    _id: string;
    count: number;
  }>;
  topTags: Array<{
    _id: string;
    count: number;
  }>;
  redsByService: Array<{
    _id: string;
    count: number;
  }>;
  entriesTrend: Array<{
    _id: string;
    count: number;
  }>;
  totalUsers: number;
  totalChecks: number;
}

export interface TagStats {
  tag: string;
  count: number;
}

export interface ChartDatum {
  name: string;
  value: number;
}

export interface MultiSeriesDatum {
  name: string;
  series: ChartDatum[];
}

export interface MailAnalytics {
  period: string;
  sentMessages: {
    newsletter: number;
    incident: number;
    combined: number;
  };
  recipientCounts: {
    newsletter: number;
    incident: number;
    combined: number;
  };
  uniqueRecipients: number;
  statusSummary: {
    success: number;
    fail: number;
    attempt: number;
  };
  statusByType: {
    newsletter: {
      success: number;
      fail: number;
      attempt: number;
    };
    incident: {
      success: number;
      fail: number;
      attempt: number;
    };
  };
  recipientBreakdown: {
    newsletter: ChartDatum[];
    incident: ChartDatum[];
    combined: ChartDatum[];
  };
  domainBreakdown: {
    newsletter: ChartDatum[];
    incident: ChartDatum[];
    combined: ChartDatum[];
  };
  clientBreakdown: {
    incident: ChartDatum[];
    combined: ChartDatum[];
  };
  criticalityBreakdown: {
    newsletter: ChartDatum[];
    incident: ChartDatum[];
    combined: ChartDatum[];
  };
  criticalityComparison: MultiSeriesDatum[];
  generationTrend: MultiSeriesDatum[];
  deliveryStatusTrend: MultiSeriesDatum[];
  hourlyActivity: ChartDatum[];
  deliveryStatusSummary: ChartDatum[];
  statusByTypeSeries: MultiSeriesDatum[];
  metadataQuality: {
    criticalityKnown: number;
    criticalityMissing: number;
    clientKnown: number;
    clientMissing: number;
  };
}

export interface PeriodSummaryReport {
  period: { startDate: string | Date; endDate: string | Date };
  entriesCount: {
    total: number;
    operativa: number;
    incidente: number;
    ofensa: number;
  };
  checklistsCount: {
    total: number;
    ok: number;
    nok: number;
  };
  topTags: Array<{ name: string; value: number }>;
  topAnalysts: Array<{ name: string; value: number }>;
  topClients: Array<{ name: string; value: number }>;
  topNokServices: Array<{ name: string; value: number }>;
  checklistObservations: Array<{
    serviceTitle: string;
    observation: string;
    user: string;
    createdAt: string | Date;
  }>;
  criticalIncidents: Array<{
    _id: string;
    entryType: string;
    content: string;
    clientName: string;
    createdByUsername: string;
    createdAt: string | Date;
  }>;
  narrative: {
    resumenEjecutivo: string;
    analisisActividad: string;
    analisisInfraestructura: string;
    diagnosticoActual: string;
  };
  periodTrend: Array<{
    name: string;
    series: Array<{ name: string; value: number }>;
  }>;
  mailClientsBreakdown: Array<{ name: string; value: number }>;
  recentBulletins: Array<{ title: string; timestamp: string | Date }>;
}

