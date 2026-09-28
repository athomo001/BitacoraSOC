import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../../core/auth/auth.models';
import { PermissionsService } from '../../core/auth/permissions.service';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';

type Role = 'admin' | 'user' | 'auditor';
type Scope = 'soc' | 'noc' | 'both' | 'none';

interface AdminUser {
  id: string;
  username: string;
  email: string;
  fullName?: string;
  role: Role;
  active: boolean;
  mfaEnabled?: boolean;
  mustChangePassword?: boolean;
  lastLoginAt?: string;
}
interface PermissionGroup { id: string; code: string; name: string; moduleScope: Scope; capabilities: string[]; active: boolean; }

/**
 * Lista cerrada del backend (handler.KnownCapabilities): el backend rechaza
 * cualquier otra, así que la pantalla las ofrece como casillas.
 */
export const CAPABILITIES: readonly { code: string; labelKey: MessageKey }[] = [
  { code: 'directory:write', labelKey: 'access.cap.directoryWrite' },
  { code: 'directory:delete', labelKey: 'access.cap.directoryDelete' },
];

const ROLES: readonly Role[] = ['admin', 'user', 'auditor'];
const SCOPES: readonly Scope[] = ['noc', 'soc', 'both', 'none'];

/**
 * Usuarios y grupos (artboard aprobado "Administración"): tabla densa con
 * rol, grupos, último acceso y estado; panel del usuario con rol, grupos,
 * MFA, forzar cambio de contraseña y activar/desactivar. Pestaña Grupos con
 * las capacidades como casillas (antes se escribían a mano).
 */
@Component({
  selector: 'app-admin-access',
  standalone: true,
  imports: [FormsModule, DatePipe, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-access.html',
  styleUrl: './admin-access.css',
})
export class AdminAccessComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly http = inject(HttpClient);
  private readonly perms = inject(PermissionsService);

  protected readonly roles = ROLES;
  protected readonly scopes = SCOPES;
  protected readonly capabilities = CAPABILITIES;

  protected readonly tab = signal<'users' | 'groups'>('users');
  protected readonly users = signal<AdminUser[]>([]);
  protected readonly groups = signal<PermissionGroup[]>([]);
  protected readonly userGroups = signal<Record<string, string[]>>({});
  protected readonly groupsLoaded = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly query = signal('');
  protected readonly showInactive = signal(false);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly creating = signal<'user' | 'group' | null>(null);

  protected userForm = { username: '', email: '', password: '', role: 'user' as Role };
  protected groupForm = { code: '', name: '', moduleScope: 'noc' as Scope, capabilities: [] as string[] };

  protected readonly visibleUsers = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.users().filter((user) =>
      (this.showInactive() || user.active) &&
      (!q || [user.username, user.email, user.fullName ?? ''].some((value) => value.toLowerCase().includes(q))),
    );
  });
  protected readonly selected = computed(() => this.users().find((user) => user.id === this.selectedId()) ?? null);
  protected readonly isMe = computed(() => this.selected()?.id === this.perms.user()?.id);
  protected readonly members = computed(() => {
    const counts: Record<string, number> = {};
    for (const ids of Object.values(this.userGroups())) for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
    return counts;
  });

  async ngOnInit(): Promise<void> {
    void this.perms.load();
    await Promise.all([this.loadUsers(), this.loadGroups()]);
  }

  private async loadUsers(): Promise<void> {
    try {
      const users = (await firstValueFrom(this.http.get<ApiEnvelope<AdminUser[]>>('/api/users'))).data;
      this.users.set(users);
      if (!this.selectedId() && users[0]) this.selectedId.set(users[0].id);
      await this.loadUserGroups(users);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('access.loadError')));
    }
  }

  /**
   * Grupos actuales de cada usuario ANTES de habilitar la edición: el PUT
   * reemplaza el conjunto completo, y sin esta carga el selector partía
   * vacío y el primer cambio borraba los grupos reales del usuario.
   */
  private async loadUserGroups(users: AdminUser[]): Promise<void> {
    this.groupsLoaded.set(false);
    const entries = await Promise.all(users.map(async (user) => {
      const groups = (await firstValueFrom(this.http.get<ApiEnvelope<PermissionGroup[]>>(`/api/users/${user.id}/permission-groups`))).data;
      return [user.id, groups.map((group) => group.id)] as const;
    }));
    this.userGroups.set(Object.fromEntries(entries));
    this.groupsLoaded.set(true);
  }

  private async loadGroups(): Promise<void> {
    try {
      this.groups.set((await firstValueFrom(this.http.get<ApiEnvelope<PermissionGroup[]>>('/api/permission-groups'))).data);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('access.loadError')));
    }
  }

  protected groupName(id: string): string {
    return this.groups().find((group) => group.id === id)?.name ?? '—';
  }

  protected roleKey(role: Role): MessageKey {
    return role === 'admin' ? 'access.role.admin' : role === 'auditor' ? 'access.role.auditor' : 'access.role.user';
  }

  protected roleHintKey(role: Role): MessageKey {
    return role === 'admin' ? 'access.roleHint.admin' : role === 'auditor' ? 'access.roleHint.auditor' : 'access.roleHint.user';
  }

  protected scopeKey(scope: Scope): MessageKey {
    return scope === 'soc' ? 'access.scope.soc' : scope === 'noc' ? 'access.scope.noc' : scope === 'both' ? 'access.scope.both' : 'access.scope.none';
  }

  protected select(id: string): void {
    this.selectedId.set(id);
    this.creating.set(null);
    this.error.set(null);
  }

  // ===== Usuario seleccionado =====

  private async patchUser(user: AdminUser, change: Partial<AdminUser>): Promise<void> {
    const previous = user;
    this.users.update((list) => list.map((u) => (u.id === user.id ? { ...u, ...change } : u)));
    this.error.set(null);
    try {
      const saved = (await firstValueFrom(this.http.patch<ApiEnvelope<AdminUser>>(`/api/users/${user.id}`, change))).data;
      this.users.update((list) => list.map((u) => (u.id === user.id ? { ...u, ...saved } : u)));
    } catch (error) {
      this.users.update((list) => list.map((u) => (u.id === user.id ? previous : u)));
      this.error.set(problemDetail(error, this.i18n.t('access.saveError')));
    }
  }

  protected setRole(user: AdminUser, role: Role): Promise<void> {
    return role === user.role ? Promise.resolve() : this.patchUser(user, { role });
  }

  protected forcePasswordChange(user: AdminUser): Promise<void> {
    return this.patchUser(user, { mustChangePassword: true });
  }

  protected setActive(user: AdminUser, active: boolean): Promise<void> {
    return this.patchUser(user, { active });
  }

  protected toggleGroup(user: AdminUser, groupId: string): Promise<void> {
    const current = this.userGroups()[user.id] ?? [];
    return this.assignGroups(user, current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]);
  }

  protected async assignGroups(user: Pick<AdminUser, 'id'>, groupIds: string[]): Promise<void> {
    const previous = this.userGroups()[user.id] ?? [];
    this.userGroups.update((current) => ({ ...current, [user.id]: groupIds }));
    try {
      await firstValueFrom(this.http.put(`/api/users/${user.id}/permission-groups`, { permissionGroupIds: groupIds }));
    } catch (error) {
      this.userGroups.update((current) => ({ ...current, [user.id]: previous }));
      this.error.set(problemDetail(error, this.i18n.t('access.groupsError')));
    }
  }

  // ===== Altas =====

  protected startCreate(kind: 'user' | 'group'): void {
    this.creating.set(kind);
    this.error.set(null);
  }

  protected async createUser(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const created = (await firstValueFrom(this.http.post<ApiEnvelope<AdminUser>>('/api/users', this.userForm))).data;
      this.userForm = { username: '', email: '', password: '', role: 'user' };
      this.creating.set(null);
      await this.loadUsers();
      this.selectedId.set(created.id);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('access.createUserError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected toggleFormCapability(code: string): void {
    const caps = this.groupForm.capabilities;
    this.groupForm = { ...this.groupForm, capabilities: caps.includes(code) ? caps.filter((c) => c !== code) : [...caps, code] };
  }

  protected async createGroup(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.http.post('/api/permission-groups', this.groupForm));
      this.groupForm = { code: '', name: '', moduleScope: 'noc', capabilities: [] };
      this.creating.set(null);
      await this.loadGroups();
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('access.createGroupError')));
    } finally {
      this.busy.set(false);
    }
  }

  // ===== Grupos =====

  private async patchGroup(group: PermissionGroup, change: Partial<PermissionGroup>): Promise<void> {
    this.groups.update((list) => list.map((g) => (g.id === group.id ? { ...g, ...change } : g)));
    this.error.set(null);
    try {
      await firstValueFrom(this.http.patch(`/api/permission-groups/${group.id}`, change));
    } catch (error) {
      this.groups.update((list) => list.map((g) => (g.id === group.id ? group : g)));
      this.error.set(problemDetail(error, this.i18n.t('access.saveError')));
    }
  }

  protected toggleCapability(group: PermissionGroup, code: string): Promise<void> {
    const caps = group.capabilities.includes(code) ? group.capabilities.filter((c) => c !== code) : [...group.capabilities, code];
    return this.patchGroup(group, { capabilities: caps });
  }

  protected setScope(group: PermissionGroup, moduleScope: Scope): Promise<void> {
    return this.patchGroup(group, { moduleScope });
  }

  protected setGroupActive(group: PermissionGroup, active: boolean): Promise<void> {
    return this.patchGroup(group, { active });
  }
}
