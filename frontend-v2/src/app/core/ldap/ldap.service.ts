import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

/** A quién encontró el directorio en «Probar». */
export interface LdapEntry {
  dn: string;
  username: string;
  name: string;
  email: string;
}

export interface LdapTest {
  at: string;
  ok: boolean;
  error?: string;
  username?: string;
  entry?: LdapEntry;
}

/** GET /api/ldap/config: la contraseña de servicio nunca vuelve (hasBindPassword). */
export interface LdapConfig {
  url: string;
  startTls: boolean;
  verifyTls: boolean;
  caPem: string;
  bindDn: string;
  hasBindPassword: boolean;
  baseDn: string;
  userFilter: string;
  usernameAttr: string;
  nameAttr: string;
  emailAttr: string;
  groupDn: string;
  timeoutSeconds: number;
  /** Admins activos «Solo local»: la puerta si el directorio falla. */
  localAdmins: number;
  lastTest?: LdapTest;
}

/** PUT /api/ldap/config: bindPassword null o vacío conserva la guardada. */
export type LdapConfigInput = Omit<LdapConfig, 'hasBindPassword' | 'localAdmins' | 'lastTest'> & { bindPassword: string | null };

/** Entrar con la cuenta del dominio (spec/20, 10k): Administración → LDAP. */
@Injectable({ providedIn: 'root' })
export class LdapService {
  private readonly http = inject(HttpClient);

  async config(): Promise<LdapConfig> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<LdapConfig>>('/api/ldap/config'))).data;
  }

  async save(input: LdapConfigInput): Promise<LdapConfig> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<LdapConfig>>('/api/ldap/config', input))).data;
  }

  async test(username: string): Promise<LdapTest> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<LdapTest>>('/api/ldap/test', { username }))).data;
  }
}
