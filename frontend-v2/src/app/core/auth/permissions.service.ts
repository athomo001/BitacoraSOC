import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope, AuthUser } from './auth.models';

interface Capabilities {
  moduleScope: 'none' | 'soc' | 'noc' | 'both';
  capabilities: string[];
  /** Todas las áreas de sus grupos (cualquier perfil). */
  areas?: string[];
  /** Perfiles de sus grupos (operativo, resolutor, gestion). */
  profiles?: string[];
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

  readonly user = this._user.asReadonly();
  readonly isAdmin = computed(() => this._user()?.role === 'admin');
  /** Alcance SOC/NOC efectivo que calcula el backend (ya descuenta los módulos apagados). */
  readonly moduleScope = computed(() => this._caps()?.moduleScope ?? null);
  readonly can = (capability: string) => computed(() => this.isAdmin() || !!this._caps()?.capabilities.includes(capability));
  /**
   * Perfil Operativo de SOC/NOC: Bitácora, Checklist y Reportes. Mientras no
   * se conocen los permisos se asume que sí (el backend igual decide).
   */
  readonly operational = computed(() => this.isAdmin() || !this._caps() || this._caps()!.moduleScope !== 'none');
  /** Áreas propias que no son SOC ni NOC (TI, Infraestructura…). */
  readonly ownAreas = computed(() => (this._caps()?.areas ?? []).filter((a) => a !== 'soc' && a !== 'noc'));
  /** Turnos y Escalamiento: Operativo, o gente de un área propia (9e). */
  readonly areaOps = computed(() => this.operational() || this.ownAreas().length > 0);
  /** Gestión CSM (spec/16 §4.4): el perfil Gestión, las jefaturas y el admin (pregunta 1 del dueño). */
  readonly management = computed(() => this.isAdmin() || !!this._caps()?.profiles?.includes('gestion') || !!this._caps()?.capabilities.includes('area:lead'));
  /** Mi equipo: la jefatura de área, el admin y el auditor (que solo ve la Calidad, 10f). */
  readonly team = computed(() => this.isAdmin() || this._user()?.role === 'auditor' || !!this._caps()?.capabilities.includes('area:lead'));
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
