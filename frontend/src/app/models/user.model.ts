/**
 * File Purpose: frontend/src/app/models/user.model.ts
 * Responsibilities: Definir la estructura y los contratos de datos de usuario.
 * QA Notes: Mantener tipos explícitos para alineación estricta con el backend.
 */

export interface User {
  _id: string;
  username: string;
  email: string;
  fullName: string;
  phone?: string;
  role: 'admin' | 'user' | 'auditor' | 'guest';
  cargoLabel?: string; // Etiqueta de cargo (N1, N2, TI, AUDITOR, etc)
  isActive: boolean;
  theme: Theme;
  avatar?: string;
  guestExpiresAt?: Date;
  mfaEnabled?: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token?: string;
  user: User;
  requireMFA?: boolean;
  mfaToken?: string;
  needsSetup?: boolean;
  easterEgg?: EasterEggSignal;
}

export interface EasterEggSignal {
  scope: 'login' | 'entry';
  payload?: EasterEggPayload;
}

export interface EasterEggPayload {
  blackout?: boolean;
  imageUrl?: string;
  durationMs?: number;
  cooldownMs?: number;
}

export interface CreateUserRequest {
  username: string;
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  role: 'admin' | 'user' | 'auditor' | 'guest';
  cargoLabel?: string | null;
  mfaEnabled?: boolean;
}

export interface UpdateProfileRequest {
  email?: string;
  fullName?: string;
  theme?: Theme;
  currentPassword?: string;
  newPassword?: string;
}

export type Theme = 'light' | 'dark' | 'sepia' | 'pastel' | 'cyberpunk';
