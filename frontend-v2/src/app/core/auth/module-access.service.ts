import { Injectable, computed, inject } from '@angular/core';
import { SetupService } from '../setup/setup.service';
import { PermissionsService } from './permissions.service';

export type DomainModule = 'soc' | 'noc';

/**
 * ¿El usuario actual puede usar el módulo SOC/NOC? Misma regla que
 * middleware.RequireModule: el módulo tiene que estar encendido en la
 * instalación (para todos, admin incluido) y, si no es admin, su grupo de
 * permisos tiene que incluirlo. La UI lo usa para **no mostrar** menús,
 * pestañas ni opciones de un módulo que no aplica — nunca para dejar un
 * aviso de "módulo desactivado" (pedido del dueño: si no está, no aparece).
 */
@Injectable({ providedIn: 'root' })
export class ModuleAccessService {
  private readonly setup = inject(SetupService);
  private readonly perms = inject(PermissionsService);

  readonly soc = computed(() => this.allows('soc'));
  readonly noc = computed(() => this.allows('noc'));

  /** Estado de la instalación y permisos del usuario; ambos se cachean. */
  async load(): Promise<void> {
    await Promise.all([this.setup.loadStatus(), this.perms.load()]);
  }

  has(module: DomainModule): boolean {
    return module === 'soc' ? this.soc() : this.noc();
  }

  private allows(module: DomainModule): boolean {
    const status = this.setup.status();
    const enabled = module === 'soc' ? status?.socEnabled : status?.nocEnabled;
    if (!enabled) return false;
    if (this.perms.isAdmin()) return true;
    const scope = this.perms.moduleScope();
    return scope === module || scope === 'both';
  }
}
