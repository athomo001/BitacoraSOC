/**
 * File Purpose: frontend/src/app/models/catalog.model.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Modelos de Catálogos - Frontend
 * 
 * Interfaces TypeScript para los catálogos de eventos, log sources y operation types.
 * Coinciden con los modelos de backend y respuestas de API.
 */

/**
 * Evento del catálogo SOC
 */
export interface CatalogEvent {
  _id: string;
  name: string;
  parent?: string | null;
  description?: string;
  motivoDefault?: string;
  enabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Log Source / Cliente del catálogo
 */
export interface CatalogLogSource {
  _id: string;
  name: string;
  parent?: string | null;
  description?: string;
  enabled: boolean;
  isInternal?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Tipo de Operación del catálogo
 */
export interface CatalogOperationType {
  _id: string;
  name: string;
  parent?: string | null;
  description?: string;
  infoAdicionalDefault?: string;
  enabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Respuesta genérica de búsqueda de catálogo con cursor pagination
 */
export interface CatalogSearchResponse<T> {
  items: T[];
  nextCursor: string | null;
}
