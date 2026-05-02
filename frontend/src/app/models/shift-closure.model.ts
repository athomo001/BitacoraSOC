/**
 * File Purpose: frontend/src/app/models/shift-closure.model.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

export interface ShiftClosure {
  _id: string;
  userId: string;
  shiftStartAt: Date;
  shiftEndAt: Date;
  closureCheckId: string;
  summary: {
    totalEntries: number;
    totalIncidents: number;
    servicesDown: string[];
    observaciones: string;
  };
  sentVia: 'email' | 'api' | 'webhook' | 'none';
  integrationName?: string;
  sentAt?: Date;
  sentStatus: 'pending' | 'success' | 'failed';
  sentError?: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface ShiftClosureRequest {
  checkId: string;
  observaciones?: string;
  servicesDown?: string[];
}
