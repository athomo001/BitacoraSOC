import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import { ChecklistItem } from './checklists.service';

/** Un cargo en uso y cuántas personas activas lo tienen (GET /api/users/cargos). */
export interface CargoCount { cargo: string; people: number; }

export interface TemplateAssignment { workShiftId: string; moment: 'inicio' | 'cierre'; }

/** Plantilla tal como la ve Administración (checklist_templates_handler.go). */
export interface AdminTemplate {
  id: string;
  name: string;
  isActive: boolean;
  alertNokEnabled: boolean;
  /** Cargos a los que avisa la alerta NOK (como el legacy: "N2"). */
  alertNokCargos: string[];
  items: ChecklistItem[];
  assignments: TemplateAssignment[];
  checksCount: number;
}

export interface SaveTemplate {
  name: string;
  isActive: boolean;
  alertNokEnabled: boolean;
  alertNokCargos: string[];
  items: Array<{ key: string; parentKey: string; title: string }>;
  assignments: TemplateAssignment[];
}

@Injectable({ providedIn: 'root' })
export class ChecklistAdminService {
  private readonly http = inject(HttpClient);

  async list(): Promise<AdminTemplate[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<AdminTemplate[]>>('/api/checklist-templates'))).data;
  }
  async create(template: SaveTemplate): Promise<AdminTemplate> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<AdminTemplate>>('/api/checklist-templates', template))).data;
  }
  async update(id: string, template: SaveTemplate): Promise<AdminTemplate> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<AdminTemplate>>(`/api/checklist-templates/${id}`, template))).data;
  }
  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/checklist-templates/${id}`));
  }
  async cooldown(): Promise<number> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<{ cooldownMinutes: number }>>('/api/config/checklist'))).data.cooldownMinutes;
  }
  async setCooldown(minutes: number): Promise<number> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<{ cooldownMinutes: number }>>('/api/config/checklist', { cooldownMinutes: minutes }))).data.cooldownMinutes;
  }

  async cargos(): Promise<CargoCount[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<CargoCount[]>>('/api/users/cargos'))).data;
  }
}
