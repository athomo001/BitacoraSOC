import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, AuthUser } from './auth.models';

interface Capabilities {
  moduleScope: 'none' | 'soc' | 'noc' | 'both';
  capabilities: string[];
}

/**
 * Qué puede hacer el usuario actual en la UI (HU-PERM-1/2). Solo decide qué
 * botones mostrar: la regla real la aplica el backend (RequireCapability /
 * RequireRole), así que un botón escondido nunca es la única protección.
 * Reemplaza el cálculo por cargo del legacy (canDirectoryWrite a partir de
 * cargoLabel hardcodeado en escalation-admin-simple.component.ts).
 */
@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private readonly http = inject(HttpClient);

  private readonly _user = signal<AuthUser | null>(null);
  private readonly _caps = signal<Capabilities | null>(null);
  private inFlight: Promise<void> | null = null;

  readonly isAdmin = computed(() => this._user()?.role === 'admin');
  readonly can = (capability: string) => computed(() => this.isAdmin() || !!this._caps()?.capabilities.includes(capability));
  readonly canWriteDirectory = this.can('directory:write');
  readonly canDeleteDirectory = this.can('directory:delete');

  load(): Promise<void> {
    this.inFlight ??= Promise.all([
      firstValueFrom(this.http.get<ApiEnvelope<AuthUser>>('/api/users/me')),
      firstValueFrom(this.http.get<ApiEnvelope<Capabilities>>('/api/users/me/capabilities')),
    ])
      .then(([me, caps]) => {
        this._user.set(me.data);
        this._caps.set(caps.data);
      })
      .catch(() => {
        // Sin permisos conocidos la UI queda en solo lectura; el backend manda.
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
