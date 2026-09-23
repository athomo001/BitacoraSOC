import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, AuthUser } from '../auth/auth.models';
import { AuthService } from '../auth/auth.service';
import { BootstrapRequest, ModuleFlags, SetupStatus } from './setup.models';

/**
 * Estado del setup inicial y de los módulos SOC/NOC (HU-0/0b). El status se
 * pide una sola vez por carga de la app y se cachea: los guards de ruta lo
 * consultan en cada navegación y no tiene sentido ir al backend cada vez —
 * solo cambia vía bootstrap() o updateModules(), que actualizan el caché.
 */
@Injectable({ providedIn: 'root' })
export class SetupService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private readonly _status = signal<SetupStatus | null>(null);
  readonly status = this._status.asReadonly();

  private inFlight: Promise<SetupStatus> | null = null;

  loadStatus(): Promise<SetupStatus> {
    const cached = this._status();
    if (cached) {
      return Promise.resolve(cached);
    }
    this.inFlight ??= firstValueFrom(
      this.http.get<ApiEnvelope<SetupStatus>>('/api/setup/status'),
    )
      .then((response) => {
        this._status.set(response.data);
        return response.data;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /** Crea el primer admin y deja su sesión iniciada. */
  async bootstrap(request: BootstrapRequest): Promise<AuthUser> {
    const response = await firstValueFrom(
      this.http.post<ApiEnvelope<{ user: AuthUser; token: string }>>('/api/setup/bootstrap', request),
    );
    this.auth.acceptToken(response.data.token);
    this._status.set({
      setupCompleted: true,
      socEnabled: request.socEnabled,
      nocEnabled: request.nocEnabled,
    });
    return response.data.user;
  }

  /** PATCH /api/config/modules — nunca borra datos del módulo apagado. */
  async updateModules(patch: Partial<ModuleFlags>): Promise<ModuleFlags> {
    const response = await firstValueFrom(
      this.http.patch<ApiEnvelope<ModuleFlags>>('/api/config/modules', patch),
    );
    this._status.update((current) => ({ setupCompleted: current?.setupCompleted ?? true, ...response.data }));
    return response.data;
  }
}
