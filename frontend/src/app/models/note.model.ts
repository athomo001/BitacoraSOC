/**
 * File Purpose: frontend/src/app/models/note.model.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

export interface AdminNote {
  _id: string;
  content: string;
  lastEditedBy?: string;
  lastEditedByUsername?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PersonalNote {
  _id: string;
  userId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateNoteRequest {
  content: string;
}
