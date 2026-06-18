/**
 * File Purpose: frontend/src/app/models/checklist.model.ts
 * Responsibilities: Definir las interfaces de TypeScript de los checklists de turnos.
 * QA Notes: Mantener sincronizados los tipos con las entidades del backend.
 */

export interface ChecklistItem {
  _id: string;
  title: string;
  order: number;
  isActive: boolean;
  description?: string;
  parentId?: string;
  children?: ChecklistItem[];
}

// Alias legacy para compatibilidad
export type ServiceCatalog = ChecklistItem;

export interface ChecklistTemplate {
  _id: string | null;
  name: string;
  description?: string;
  isActive: boolean;
  assignedTo?: { shiftId: string, type: string }[];
  items: ChecklistItem[];
  flatItems?: ChecklistItem[];
  source?: 'template' | 'legacy';
  createdAt?: Date;
  updatedAt?: Date;
}

export type ServiceStatus = 'verde' | 'rojo';
export type CheckType = 'inicio' | 'cierre';

export interface ServiceCheck {
  serviceId: string;
  parentServiceId?: string | null;
  serviceTitle: string;
  status: ServiceStatus;
  observation: string;
  // Propiedad virtual inyectada en cliente para representar correlación de incidentes
  correlatedFrom?: {
    serviceTitle: string;
    observation: string;
  };
}

export interface ShiftCheck {
  _id: string;
  userId: {
    _id: string;
    username: string;
    fullName: string;
  };
  username: string;
  type: CheckType;
  checkDate: Date;
  checklistId?: string | null;
  checklistName?: string;
  services: ServiceCheck[];
  hasRedServices: boolean;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}

export interface CreateCheckRequest {
  type: CheckType;
  checklistId?: string | null;
  services: Array<{
    serviceId: string;
    parentServiceId?: string | null;
    serviceTitle: string;
    status: ServiceStatus;
    observation: string;
  }>;
}

export interface CheckHistoryResponse {
  checks: ShiftCheck[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
