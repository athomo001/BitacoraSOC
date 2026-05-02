/**
 * File Purpose: frontend/src/app/models/audit-log.model.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

export interface AuditLog {
  _id: string;
  event: string;
  level: 'info' | 'warn' | 'error';
  timestamp: string;
  source?: string;
  sourceId?: string | null;
  actor?: {
    userId?: string;
    username?: string;
    role?: string;
    isGuest?: boolean;
  };
  request?: {
    ip?: string;
    path?: string;
    method?: string;
    userAgent?: string;
    isLikelyVpnOrProxy?: boolean;
    ipChanged?: boolean;
    previousIp?: string;
  };
  result?: {
    success?: boolean;
    reason?: string;
    statusCode?: number;
  };
  metadata?: Record<string, any>;
}

export interface AuditLogFilters {
  page?: number;
  limit?: number;
  category?: string;
  userId?: string;
  event?: string;
  level?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  sourceSlug?: string;
}

export interface AuditLogResponse {
  logs: AuditLog[];
  pagination: {
    totalItems: number;
    totalPages: number;
    currentPage: number;
    itemsPerPage: number;
  };
}

export interface AuditStats {
  totalLogs: number;
  totalUsers: number;
  successCount: number;
  failureCount: number;
  topActions: Array<{
    action: string;
    count: number;
  }>;
  topUsers: Array<{
    username: string;
    count: number;
  }>;
}
