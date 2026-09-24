export interface AuthUser {
  id: string;
  username: string;
  email: string;
  fullName?: string;
  phone?: string;
  birthday?: string;
  avatarUrl?: string;
  role: string;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  active: boolean;
  createdAt: string;
}

export interface LoginSuccess {
  token: string;
  mustChangePassword: boolean;
}

export interface LoginMfaPending {
  tempToken: string;
  mfaPending: true;
}

export type LoginResult = LoginSuccess | LoginMfaPending;

export function isMfaPending(result: LoginResult): result is LoginMfaPending {
  return 'mfaPending' in result && result.mfaPending === true;
}

/** Envoltorio {data, meta?} — spec/04-contratos-api.md convención global. */
export interface ApiEnvelope<T> {
  data: T;
  meta?: unknown;
}
