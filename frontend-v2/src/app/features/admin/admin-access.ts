import { ChangeDetectionStrategy, Component, Injector, OnInit, computed, effect, inject, output, signal, untracked } from '@angular/core';
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
import { AdminBirthdaysComponent } from './admin-birthdays';
import { AdminPasswordPolicyComponent } from './admin-password-policy';
import { UserRetireComponent } from './user-retire';
import { Area, AreasService, Level, PROFILES, Placement, Profile } from '../../core/areas/areas.service';
import { openCsvImport } from '../../shared/csv-import/open-csv-import';

import '../../core/i18n/packs/admin';
import '../../core/i18n/packs/imports';
type Role = 'admin' | 'user' | 'auditor';

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
  /** AAAA-MM-DD; lo usan los correos de cumpleaños. */
  birthday?: string;
}
/** Un grupo es área(s) + nivel + perfil (spec/16, 000033); areas son códigos ("soc", "noc"…). */
interface PermissionGroup { id: string; code: string; name: string; areas: string[]; profile: Profile; levelId?: string; capabilities: string[]; active: boolean; }

/** Lo que se edita de un grupo en el panel: áreas, nivel y perfil. */
interface GroupShape { areas: string[]; levelId: string; profile: Profile; }

/**
 * El menú de cada perfil (spec/16 §3.2), para la vista previa "Así se verá
 * su menú": lo que hoy existe. Lo marcado con soc lo abre solo un grupo
 * Operativo con SOC o NOC (el backend aplica la misma regla, 9c). Inventario,
 * trabajos y metas se suman cuando existan (9.2–9.4).
 */
const PROFILE_MENU: Record<Profile, readonly { icon: string; labelKey: MessageKey; soc?: boolean }[]> = {
  operativo: [
    { icon: 'edit_note', labelKey: 'access.menu.entries', soc: true }, { icon: 'schedule', labelKey: 'access.menu.shifts', soc: true },
    { icon: 'call_split', labelKey: 'access.menu.escalation', soc: true }, { icon: 'contacts', labelKey: 'access.menu.directory' },
    { icon: 'summarize', labelKey: 'access.menu.reports', soc: true }, { icon: 'confirmation_number', labelKey: 'access.menu.tickets' },
  ],
  resolutor: [
    { icon: 'confirmation_number', labelKey: 'access.menu.queue' }, { icon: 'contacts', labelKey: 'access.menu.directory' },
  ],
  gestion: [
    { icon: 'confirmation_number', labelKey: 'access.menu.clientTickets' }, { icon: 'contacts', labelKey: 'access.menu.directory' },
  ],
};

const PROFILE_ICON: Record<Profile, string> = { operativo: 'monitor_heart', resolutor: 'build', gestion: 'insights' };
const PROFILE_TONE: Record<Profile, string> = { operativo: 'tone-info', resolutor: 'tone-ok', gestion: 'tone-system' };

/**
 * Lista cerrada del backend (handler.KnownCapabilities): el backend rechaza
 * cualquier otra, así que la pantalla las ofrece como casillas.
 */
export const CAPABILITIES: readonly { code: string; labelKey: MessageKey }[] = [
  { code: 'directory:write', labelKey: 'access.cap.directoryWrite' },
  { code: 'directory:delete', labelKey: 'access.cap.directoryDelete' },
  { code: 'tickets:change_client', labelKey: 'access.cap.ticketsChangeClient' },
  { code: 'notices:send', labelKey: 'access.cap.noticesSend' },
  { code: 'area:lead', labelKey: 'access.cap.areaLead' },
  { code: 'csm', labelKey: 'access.cap.csm' },
];

const ROLES: readonly Role[] = ['admin', 'user', 'auditor'];

/**
 * Usuarios y grupos (artboard aprobado "Administración"): tabla densa con
 * rol, grupos, último acceso y estado; panel del usuario con rol, grupos,
 * MFA, forzar cambio de contraseña y activar/desactivar. Pestaña Grupos con
 * las capacidades como casillas (antes se escribían a mano).
 */
@Component({
  selector: 'app-admin-access',
  standalone: true,
  imports: [FormsModule, DatePipe, MatIconModule, AdminBirthdaysComponent, AdminPasswordPolicyComponent, UserRetireComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-access.html',
  styleUrl: './admin-access.css',
})
export class AdminAccessComponent implements OnInit {
  /** Lleva a Áreas y niveles (para crear el área que falta). */
  readonly goToAreas = output<void>();

  protected readonly i18n = inject(I18nService);
  private readonly http = inject(HttpClient);
  private readonly perms = inject(PermissionsService);
  private readonly areasApi = inject(AreasService);
  private readonly injector = inject(Injector);

  protected readonly roles = ROLES;
  protected readonly profiles = PROFILES;
  protected readonly profileIcon = PROFILE_ICON;
  protected readonly profileTone = PROFILE_TONE;
  protected readonly areaList = signal<Area[]>([]);
  protected readonly levelList = signal<Level[]>([]);
  protected readonly activeAreas = computed(() => this.areaList().filter((a) => a.active));
  /** El grupo que se edita (null = ninguno; en un alta se usa la misma forma). */
  protected readonly editingGroupId = signal<string | null>(null);
  protected readonly shape = signal<GroupShape>({ areas: [], levelId: '', profile: 'operativo' });
  /** Vista previa del menú de la forma que se edita. */
  protected readonly menuPreview = computed(() => {
    const s = this.shape();
    const hasModule = s.areas.includes('soc') || s.areas.includes('noc');
    return PROFILE_MENU[s.profile].filter((m) => hasModule || !m.soc);
  });
  protected readonly previewWithoutModules = computed(() => {
    const s = this.shape();
    return s.profile === 'operativo' && !s.areas.includes('soc') && !s.areas.includes('noc');
  });
  protected readonly capabilities = CAPABILITIES;
  /** Permisos extra del panel de la persona (la jefatura va por área). */
  protected readonly extraCapabilities = CAPABILITIES.filter((c) => c.code !== 'area:lead');

  // ===== Usuarios por área y nivel (los grupos se arman solos) =====
  private readonly placement = signal<Placement | null>(null);
  protected readonly draft = signal<Placement | null>(null);
  protected readonly placeDirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.placement()));
  /** Menú que verá con lo marcado: el de cada perfil de sus áreas, más Mi equipo si es jefe. */
  protected readonly placeMenu = computed(() => {
    const d = this.draft();
    if (!d) return [];
    const seen = new Map<string, { icon: string; labelKey: MessageKey }>();
    for (const row of d.areas) {
      const area = this.areaList().find((a) => a.code === row.code);
      if (!area) continue;
      const module = row.code === 'soc' || row.code === 'noc';
      for (const m of PROFILE_MENU[area.profile]) if (module || !m.soc) seen.set(m.labelKey, m);
    }
    seen.set('access.menu.directory', { icon: 'contacts', labelKey: 'access.menu.directory' });
    if (d.areas.some((r) => r.lead)) seen.set('access.menu.team', { icon: 'groups', labelKey: 'access.menu.team' });
    return [...seen.values()];
  });
  private readonly loadPlacementOnSelect = effect(() => {
    const id = this.selectedId();
    untracked(() => void this.loadPlacement(id));
  });

  protected readonly tab = signal<'users' | 'groups'>('users');
  protected readonly users = signal<AdminUser[]>([]);
  protected readonly groups = signal<PermissionGroup[]>([]);
  protected readonly userGroups = signal<Record<string, string[]>>({});
  protected readonly groupsLoaded = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly query = signal('');
  protected readonly showInactive = signal(false);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly creating = signal<'user' | 'group' | null>(null);

  protected userForm = { username: '', email: '', password: '', role: 'user' as Role };
  protected groupForm = { code: '', name: '', capabilities: [] as string[] };

  protected readonly visibleUsers = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.users().filter((user) =>
      (this.showInactive() || user.active) &&
      (!q || [user.username, user.email, user.fullName ?? ''].some((value) => value.toLowerCase().includes(q))),
    );
  });
  protected readonly selected = computed(() => this.users().find((user) => user.id === this.selectedId()) ?? null);
  /** Usuarios activos sin ningún grupo con área: no aparecen en la Agenda, las metas ni Mi equipo. */
  protected readonly noArea = computed(() => {
    const out = new Set<string>();
    if (!this.groupsLoaded()) return out;
    const withArea = new Set(this.groups().filter((g) => g.active && g.areas.length).map((g) => g.id));
    for (const user of this.users()) {
      if (user.active && !(this.userGroups()[user.id] ?? []).some((id) => withArea.has(id))) out.add(user.id);
    }
    return out;
  });
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

  /** Carga masiva de usuarios (10g); las contraseñas temporales se ven en el diálogo. */
  protected async importCsv(): Promise<void> {
    if (await openCsvImport(this.injector, 'users')) await this.loadUsers();
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
      const [groups, areas, levels] = await Promise.all([
        firstValueFrom(this.http.get<ApiEnvelope<PermissionGroup[]>>('/api/permission-groups')),
        this.areasApi.areas(),
        this.areasApi.levels(),
      ]);
      this.groups.set(groups.data);
      this.areaList.set(areas);
      this.levelList.set(levels);
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

  protected areaName(code: string): string {
    return this.areaList().find((a) => a.code === code)?.name ?? code;
  }

  /** "SOC · NOC" o "Sin áreas". */
  protected areasLabel(group: PermissionGroup): string {
    return group.areas.length ? group.areas.map((c) => this.areaName(c)).join(' · ') : this.i18n.t('access.noAreas');
  }

  protected levelName(id?: string): string {
    return this.levelList().find((l) => l.id === id)?.name ?? '—';
  }

  protected profileKey(p: Profile): MessageKey {
    return `access.profile.${p}` as MessageKey;
  }

  protected profileDescKey(p: Profile): MessageKey {
    return `access.profileDesc.${p}` as MessageKey;
  }

  // ===== Áreas, nivel y perfil de un grupo (spec/16 9b) =====

  protected editGroup(group: PermissionGroup): void {
    this.creating.set(null);
    this.editingGroupId.set(group.id);
    this.shape.set({ areas: [...group.areas], levelId: group.levelId ?? '', profile: group.profile });
  }

  protected closeGroupEditor(): void {
    this.editingGroupId.set(null);
  }

  protected toggleShapeArea(code: string): void {
    this.shape.update((s) => ({ ...s, areas: s.areas.includes(code) ? s.areas.filter((c) => c !== code) : [...s.areas, code] }));
  }

  protected setShapeLevel(levelId: string): void {
    this.shape.update((s) => ({ ...s, levelId }));
  }

  protected setShapeProfile(profile: Profile): void {
    this.shape.update((s) => ({ ...s, profile }));
  }

  protected async saveGroupShape(): Promise<void> {
    const group = this.groups().find((g) => g.id === this.editingGroupId());
    if (!group) return;
    const s = this.shape();
    this.busy.set(true);
    this.error.set(null);
    try {
      const saved = (await firstValueFrom(this.http.patch<ApiEnvelope<PermissionGroup>>(`/api/permission-groups/${group.id}`, {
        areas: s.areas, profile: s.profile, setLevel: true, levelId: s.levelId || null,
      }))).data;
      this.groups.update((list) => list.map((g) => (g.id === saved.id ? saved : g)));
      this.editingGroupId.set(null);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('access.saveError')));
    } finally {
      this.busy.set(false);
    }
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

  protected setBirthday(user: AdminUser, birthday: string): Promise<void> {
    return (birthday || '') === (user.birthday || '') ? Promise.resolve() : this.patchUser(user, { birthday });
  }

  /** Hoy, para que el selector no deje elegir una fecha futura. */
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected setActive(user: AdminUser, active: boolean): Promise<void> {
    this.notice.set(null);
    return this.patchUser(user, { active });
  }

  /** Eliminado de verdad (sin historial) o, si tenía historial, bloqueado. */
  protected onRemoved(user: AdminUser, deleted: boolean): void {
    if (deleted) {
      this.users.update((list) => list.filter((u) => u.id !== user.id));
      this.selectedId.set(this.users()[0]?.id ?? null);
    } else {
      this.users.update((list) => list.map((u) => (u.id === user.id ? { ...u, active: false } : u)));
    }
    this.notice.set(this.i18n.tf(deleted ? 'access.retire.deleted' : 'access.retire.kept', user.fullName || user.username));
  }

  private async loadPlacement(id: string | null): Promise<void> {
    this.placement.set(null);
    this.draft.set(null);
    if (!id) return;
    try {
      const p = await this.areasApi.placement(id);
      if (this.selectedId() !== id) return;
      this.placement.set(p);
      this.draft.set(structuredClone(p));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('access.loadError')));
    }
  }

  protected placeRow(code: string): Placement['areas'][number] | undefined {
    return this.draft()?.areas.find((a) => a.code === code);
  }

  /** null = fuera del área. */
  protected setPlaceLevel(code: string, levelId: string | null): void {
    this.draft.update((d) => {
      if (!d) return d;
      const rest = d.areas.filter((a) => a.code !== code);
      if (levelId === null) return { ...d, areas: rest };
      const lead = d.areas.find((a) => a.code === code)?.lead ?? false;
      const areas = [...rest, { code, levelId, lead }];
      // Mismo orden que la lista de áreas, para comparar con lo guardado.
      const order = this.activeAreas().map((a) => a.code);
      areas.sort((x, y) => order.indexOf(x.code) - order.indexOf(y.code));
      return { ...d, areas };
    });
  }

  protected togglePlaceLead(code: string): void {
    this.draft.update((d) => d && { ...d, areas: d.areas.map((a) => (a.code === code ? { ...a, lead: !a.lead } : a)) });
  }

  protected togglePlaceExtra(cap: string): void {
    this.draft.update((d) => d && { ...d, extras: d.extras.includes(cap) ? d.extras.filter((c) => c !== cap) : [...d.extras, cap].sort() });
  }

  protected resetPlacement(): void {
    const p = this.placement();
    this.draft.set(p && structuredClone(p));
  }

  protected async savePlacement(user: AdminUser): Promise<void> {
    const d = this.draft();
    if (!d) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const saved = await this.areasApi.savePlacement(user.id, d);
      this.placement.set(saved);
      this.draft.set(structuredClone(saved));
      // Pueden haber nacido grupos nuevos («Infra N1»): se recargan la lista y los de la persona.
      const [groups, mine] = await Promise.all([
        firstValueFrom(this.http.get<ApiEnvelope<PermissionGroup[]>>('/api/permission-groups')),
        firstValueFrom(this.http.get<ApiEnvelope<PermissionGroup[]>>(`/api/users/${user.id}/permission-groups`)),
      ]);
      this.groups.set(groups.data);
      this.userGroups.update((current) => ({ ...current, [user.id]: mine.data.map((g) => g.id) }));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('access.groupsError')));
    } finally {
      this.busy.set(false);
    }
  }

  // ===== Altas =====

  protected startCreate(kind: 'user' | 'group'): void {
    this.creating.set(kind);
    this.error.set(null);
    if (kind === 'group') {
      this.editingGroupId.set(null);
      this.shape.set({ areas: [], levelId: '', profile: 'operativo' });
    }
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
      const s = this.shape();
      await firstValueFrom(this.http.post('/api/permission-groups', { ...this.groupForm, areas: s.areas, profile: s.profile, levelId: s.levelId || undefined }));
      this.groupForm = { code: '', name: '', capabilities: [] };
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


  protected setGroupActive(group: PermissionGroup, active: boolean): Promise<void> {
    return this.patchGroup(group, { active });
  }
}
