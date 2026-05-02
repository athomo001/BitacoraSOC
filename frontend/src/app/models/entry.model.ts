/**
 * File Purpose: frontend/src/app/models/entry.model.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Modelo de Entry - DEBE coincidir con backend Entry schema
 * 
 * Campos críticos SOC:
 *   - entryType: OBLIGATORIO ('operativa' | 'incidente' | 'ofensa')
 *   - entryDate + entryTime: fecha/hora del evento (no creación)
 *   - tags: extraídos automáticamente de hashtags en backend
 */
export interface Entry {
  _id: string;
  content: string;
  entryType: EntryType;
  entryDate: string; // ISO date string
  entryTime: string; // HH:mm format
  tags: string[];
  clientId?: string; // ID del cliente/log source (B2i)
  clientName?: string; // Nombre del cliente
  createdBy: {
    _id: string;
    username: string;
    fullName: string;
    role: string;
  };
  createdByUsername: string;
  isGuestEntry: boolean;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt?: Date;
  checklistType?: 'inicio' | 'cierre';
  checklistMetrics?: {
    totalServices: number;
    totalProblems: number;
  };
}

export type EntryType = 'operativa' | 'incidente' | 'ofensa' | 'checklist';
export type CreateEntryType = 'operativa' | 'incidente' | 'ofensa';

export interface CreateEntryRequest {
  content: string;
  entryType: CreateEntryType;
  entryDate: string;
  entryTime: string;
  clientId?: string; // Cliente/Log Source (B2i)
}

export interface EntriesResponse {
  entries: Entry[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface EntryFilters {
  page?: number;
  limit?: number;
  search?: string;
  tags?: string;
  clientId?: string; // Filtro por cliente (B2i)
  entryType?: EntryType;
  startDate?: string;
  endDate?: string;
  userId?: string;
}

export interface TagSuggestion {
  tag: string;
  count: number;
}
