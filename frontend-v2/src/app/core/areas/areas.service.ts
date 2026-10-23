import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

/** Un área (spec/16 §3.1): de quién son los datos. SOC y NOC son de sistema. */
export interface Area {
  id: string;
  code: string;
  name: string;
  active: boolean;
  system: boolean;
  /** Perfil de los grupos que se arman solos al ubicar a alguien en el área. */
  profile: Profile;
  groupCount: number;
  /** Cómo numera los tickets que pide (se configura en Administración → Ticketera). */
  ticketSeries?: { name: string; preview: string; general: boolean };
  /** Su departamento (null = ninguno) y si comparte equipo con las otras áreas marcadas de él. */
  departmentId?: string | null;
  sharesTeam?: boolean;
}

/** Lo que tiene un área: su gente y sus datos (empty = se puede borrar). */
export interface AreaUsage {
  people: number;
  tickets: number;
  assets: number;
  teams: number;
  policies: number;
  tasks: number;
  goals: number;
  windows: number;
  other: number;
  empty: boolean;
}

/** Un departamento (spec/16 §3.5.1): agrupa áreas, con su jefatura y las que comparten equipo. */
export interface Department {
  id: string;
  name: string;
  /** Códigos de sus áreas; shared: las que comparten equipo. */
  areas: string[];
  shared: string[];
  leads: { id: string; name: string }[];
  /** Las CSM asignadas y a qué áreas va cada una (vacío = todas las del departamento). */
  csms: { id: string; name: string; areas: string[] }[];
}

/** Una persona de un área (ficha del área): su nivel, si es jefe y sus permisos extra. */
export interface AreaPerson {
  id: string;
  username: string;
  fullName: string;
  email: string;
  active: boolean;
  levelId: string;
  lead: boolean;
  extras: string[];
}

/** Dónde está una persona: área + nivel ('' = sin nivel) + jefatura, y permisos extra. */
export interface Placement {
  areas: { code: string; levelId: string; lead: boolean }[];
  extras: string[];
}

/** Un nivel (N1, N2, N3…): se combina con el área; el orden decide quién asigna a quién. */
export interface Level {
  id: string;
  code: string;
  name: string;
  rank: number;
  groupCount: number;
}

/** Perfiles (spec/16 §3.2): qué pantallas tiene un grupo. */
export type Profile = 'operativo' | 'resolutor' | 'gestion';
export const PROFILES: readonly Profile[] = ['operativo', 'resolutor', 'gestion'];

/** Administración → Áreas y niveles (spec/16, 9b). */
@Injectable({ providedIn: 'root' })
export class AreasService {
  private readonly http = inject(HttpClient);

  async areas(): Promise<Area[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<Area[]>>('/api/areas'))).data;
  }

  async createArea(name: string): Promise<Area> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<Area>>('/api/areas', { name }))).data;
  }

  /** Renombrar o encender/apagar. Apagar SOC o NOC sigue la regla de Módulos (queda al menos uno). */
  async patchArea(code: string, change: { name?: string; active?: boolean; profile?: Profile }): Promise<Area> {
    return (await firstValueFrom(this.http.patch<ApiEnvelope<Area>>(`/api/areas/${encodeURIComponent(code)}`, change))).data;
  }

  async levels(): Promise<Level[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<Level[]>>('/api/levels'))).data;
  }

  async createLevel(name: string): Promise<Level> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<Level>>('/api/levels', { name }))).data;
  }

  async renameLevel(id: string, name: string): Promise<Level> {
    return (await firstValueFrom(this.http.patch<ApiEnvelope<Level>>(`/api/levels/${id}`, { name }))).data;
  }

  async orderLevels(ids: string[]): Promise<void> {
    await firstValueFrom(this.http.put('/api/levels/order', { ids }));
  }

  /** Ficha del área: la gente del área. */
  async areaPeople(code: string): Promise<AreaPerson[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<AreaPerson[]>>(`/api/areas/${encodeURIComponent(code)}/people`))).data;
  }

  /** Persona nueva directo al área, con su nivel; la contraseña temporal se muestra una vez. */
  async createAreaPerson(code: string, person: { fullName: string; username: string; email: string; levelId: string }): Promise<{ id: string; username: string; tempPassword: string }> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ id: string; username: string; tempPassword: string }>>(`/api/areas/${encodeURIComponent(code)}/people`, person))).data;
  }

  /** Usuarios por área y nivel: los grupos se arman solos en el servidor. */
  async placement(userId: string): Promise<Placement> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<Placement>>(`/api/users/${userId}/placement`))).data;
  }

  async savePlacement(userId: string, placement: Placement): Promise<Placement> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<Placement>>(`/api/users/${userId}/placement`, placement))).data;
  }

  async areaUsage(code: string): Promise<AreaUsage> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<AreaUsage>>(`/api/areas/${code}/usage`))).data;
  }

  /** Pasa toda la gente y los datos del área a otra; queda vacía. */
  async mergeArea(code: string, into: string): Promise<{ moved: number; usage: AreaUsage }> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ moved: number; usage: AreaUsage }>>(`/api/areas/${code}/merge`, { into }))).data;
  }

  async deleteArea(code: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/areas/${code}`));
  }

  async departments(): Promise<Department[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<Department[]>>('/api/departments'))).data;
  }

  async createDepartment(name: string): Promise<Department> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<Department>>('/api/departments', { name }))).data;
  }

  /** Cambia el nombre, sus áreas o las que comparten equipo (marcarlas iguala su gente). */
  async patchDepartment(id: string, change: { name?: string; areas?: string[]; shared?: string[] }): Promise<Department> {
    return (await firstValueFrom(this.http.patch<ApiEnvelope<Department>>(`/api/departments/${id}`, change))).data;
  }

  async setDepartmentLeads(id: string, userIds: string[]): Promise<Department> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<Department>>(`/api/departments/${id}/leads`, { userIds }))).data;
  }

  async deleteDepartment(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/departments/${id}`));
  }

  /** Quienes están marcados como CSM (Usuarios y grupos → permisos extra). */
  async csmPeople(): Promise<{ id: string; name: string }[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<{ id: string; name: string }[]>>('/api/departments/csm-people'))).data;
  }

  /** Las CSM del departamento y a qué áreas va cada una (vacío = todas). */
  async setDepartmentCSMs(id: string, csms: { id: string; areas: string[] }[]): Promise<Department> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<Department>>(`/api/departments/${id}/csms`, { csms }))).data;
  }
}
