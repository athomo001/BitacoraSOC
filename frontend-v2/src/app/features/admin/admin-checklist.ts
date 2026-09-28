import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../../core/auth/auth.models';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { AdminTemplate, AlertRole, ChecklistAdminService, SaveTemplate, TemplateAssignment } from '../../core/checklists/checklist-admin.service';
import { EditorItem, MAX_DEPTH, addChild, addRoot, childCount, depthOf, move, problems, remove, rename } from '../../core/checklists/template-editor';
import { ShiftsService, WorkShift } from '../../core/shifts/shifts.service';

interface Draft {
  id: string | null;
  name: string;
  isActive: boolean;
  alertNokEnabled: boolean;
  alertNokRoleTarget: AlertRole | null;
  items: EditorItem[];
  assignments: TemplateAssignment[];
}

function toDraft(template: AdminTemplate): Draft {
  return {
    id: template.id,
    name: template.name,
    isActive: template.isActive,
    alertNokEnabled: template.alertNokEnabled,
    alertNokRoleTarget: template.alertNokRoleTarget,
    items: template.items.map((item) => ({ key: item.id, parentKey: item.parentItemId ?? null, title: item.title })),
    assignments: [...template.assignments],
  };
}

const EMPTY: Draft = { id: null, name: '', isActive: true, alertNokEnabled: false, alertNokRoleTarget: null, items: [], assignments: [] };

/**
 * Administración → Checklist (artboard aprobado, del legacy checklist-admin):
 * plantillas a la izquierda; editor de ítems y sub-ítems, en qué turno y
 * momento se usa, activa, alerta NOK por correo a un rol; arriba la espera
 * mínima entre checks. Una plantilla con historial se desactiva, no se borra.
 */
@Component({
  selector: 'app-admin-checklist',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-checklist.html',
  styleUrl: './admin-checklist.css',
})
export class AdminChecklistComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ChecklistAdminService);
  private readonly shiftsApi = inject(ShiftsService);
  private readonly http = inject(HttpClient);

  protected readonly templates = signal<AdminTemplate[]>([]);
  protected readonly shifts = signal<WorkShift[]>([]);
  protected readonly roleCounts = signal<Record<string, number>>({});
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly confirmDelete = signal(false);
  protected readonly preview = signal(false);

  protected readonly draft = signal<Draft>(EMPTY);
  private readonly original = signal<string>(JSON.stringify(EMPTY));
  protected readonly dirty = computed(() => JSON.stringify(this.draft()) !== this.original());
  protected readonly problem = computed(() => problems(this.draft().name, this.draft().items));
  protected readonly selected = computed(() => this.templates().find((t) => t.id === this.draft().id) ?? null);

  protected readonly cooldown = signal(60);
  protected readonly cooldownSaved = signal(60);

  protected readonly roles: AlertRole[] = ['admin', 'user', 'auditor'];
  protected readonly maxDepth = MAX_DEPTH;

  /** Filas del editor con lo que la plantilla necesita pintar. */
  protected readonly rows = computed(() => {
    const items = this.draft().items;
    return items.map((item, index) => {
      const siblings = items.filter((other) => other.parentKey === item.parentKey);
      const position = siblings.indexOf(item);
      return {
        item,
        index,
        depth: depthOf(items, item.key),
        children: childCount(items, item.key),
        first: position === 0,
        last: position === siblings.length - 1,
      };
    });
  });
  protected readonly leafCount = computed(() => this.rows().filter((row) => row.children === 0).length);
  protected readonly groupCount = computed(() => this.rows().filter((row) => row.children > 0).length);

  async ngOnInit(): Promise<void> {
    try {
      const [templates, shifts, cooldown, users] = await Promise.all([
        this.api.list(),
        this.shiftsApi.listWorkShifts(),
        this.api.cooldown(),
        firstValueFrom(this.http.get<ApiEnvelope<Array<{ role: string; active: boolean }>>>('/api/users')).then((r) => r.data).catch(() => []),
      ]);
      this.templates.set(templates);
      this.shifts.set(shifts);
      this.cooldown.set(cooldown);
      this.cooldownSaved.set(cooldown);
      const counts: Record<string, number> = {};
      for (const user of users) if (user.active) counts[user.role] = (counts[user.role] ?? 0) + 1;
      this.roleCounts.set(counts);
      if (templates[0]) this.select(templates[0]);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('adminChecklist.loadError')));
    } finally {
      this.loading.set(false);
    }
  }

  protected select(template: AdminTemplate | null): void {
    const draft = template ? toDraft(template) : { ...EMPTY, items: addRoot([], '') };
    this.draft.set(draft);
    this.original.set(JSON.stringify(template ? draft : EMPTY));
    this.confirmDelete.set(false);
    // Al elegir o crear una plantilla se vuelve al editor, no a la vista previa.
    this.preview.set(false);
    this.notice.set(null);
    this.error.set(null);
  }

  protected patch(change: Partial<Draft>): void {
    this.draft.update((draft) => ({ ...draft, ...change }));
    this.notice.set(null);
  }

  protected setItems(items: EditorItem[] | null): void {
    if (items) this.patch({ items });
  }

  protected addItem(): void {
    this.setItems(addRoot(this.draft().items, ''));
  }
  protected addChild(key: string): void {
    this.setItems(addChild(this.draft().items, key, ''));
  }
  protected remove(key: string): void {
    this.setItems(remove(this.draft().items, key));
  }
  protected move(key: string, delta: -1 | 1): void {
    this.setItems(move(this.draft().items, key, delta));
  }
  protected rename(key: string, title: string): void {
    this.setItems(rename(this.draft().items, key, title));
  }

  protected isAssigned(shiftId: string, moment: 'inicio' | 'cierre'): boolean {
    return this.draft().assignments.some((a) => a.workShiftId === shiftId && a.moment === moment);
  }

  protected toggleAssignment(shiftId: string, moment: 'inicio' | 'cierre'): void {
    const current = this.draft().assignments;
    this.patch({
      assignments: this.isAssigned(shiftId, moment)
        ? current.filter((a) => !(a.workShiftId === shiftId && a.moment === moment))
        : [...current, { workShiftId: shiftId, moment }],
    });
  }

  /** Nombre de la plantilla que hoy usa ese turno/momento, si no es esta (se reemplazará al guardar). */
  protected usedBy(shift: WorkShift, moment: 'inicio' | 'cierre'): string | null {
    const id = moment === 'inicio' ? shift.checklistTemplateStartId : shift.checklistTemplateEndId;
    if (!id || id === this.draft().id) return null;
    return this.templates().find((t) => t.id === id)?.name ?? null;
  }

  protected templateMeta(template: AdminTemplate): string {
    const parents = new Set(template.items.map((i) => i.parentItemId).filter(Boolean));
    const leaves = template.items.filter((i) => !parents.has(i.id)).length;
    const used = [...new Set(template.assignments.map((a) => this.shifts().find((s) => s.id === a.workShiftId)?.name).filter(Boolean))];
    return `${this.i18n.tf('adminChecklist.itemsCount', leaves)} · ${used.length ? used.join(', ') : this.i18n.t('adminChecklist.unassigned')}`;
  }

  protected roleLabel(role: AlertRole): string {
    return this.i18n.t(role === 'admin' ? 'adminChecklist.role.admin' : role === 'user' ? 'adminChecklist.role.user' : 'adminChecklist.role.auditor');
  }

  protected toggleAlert(): void {
    const on = !this.draft().alertNokEnabled;
    this.patch({ alertNokEnabled: on, alertNokRoleTarget: on ? (this.draft().alertNokRoleTarget ?? 'admin') : this.draft().alertNokRoleTarget });
  }

  protected async save(): Promise<void> {
    const draft = this.draft();
    if (this.problem() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const payload: SaveTemplate = {
      name: draft.name.trim(),
      isActive: draft.isActive,
      alertNokEnabled: draft.alertNokEnabled,
      alertNokRoleTarget: draft.alertNokEnabled ? draft.alertNokRoleTarget : null,
      items: draft.items.map((item) => ({ key: item.key, parentKey: item.parentKey ?? '', title: item.title.trim() })),
      assignments: draft.assignments,
    };
    try {
      const saved = draft.id ? await this.api.update(draft.id, payload) : await this.api.create(payload);
      // Otras plantillas pudieron perder un turno/momento: se recarga todo.
      const [templates, shifts] = await Promise.all([this.api.list(), this.shiftsApi.listWorkShifts()]);
      this.templates.set(templates);
      this.shifts.set(shifts);
      this.select(templates.find((t) => t.id === saved.id) ?? saved);
      this.notice.set(this.i18n.t('adminChecklist.saved'));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('adminChecklist.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected discard(): void {
    this.select(this.selected());
  }

  protected async deleteTemplate(): Promise<void> {
    const id = this.draft().id;
    if (!id || this.busy()) return;
    this.busy.set(true);
    try {
      await this.api.remove(id);
      const templates = await this.api.list();
      this.templates.set(templates);
      this.select(templates[0] ?? null);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('adminChecklist.deleteError')));
    } finally {
      this.busy.set(false);
      this.confirmDelete.set(false);
    }
  }

  protected async saveCooldown(): Promise<void> {
    const minutes = Math.round(Number(this.cooldown()));
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
      this.error.set(this.i18n.t('adminChecklist.cooldownRange'));
      return;
    }
    try {
      const saved = await this.api.setCooldown(minutes);
      this.cooldown.set(saved);
      this.cooldownSaved.set(saved);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('adminChecklist.saveError')));
    }
  }

  protected problemText(): string {
    switch (this.problem()) {
      case 'name': return this.i18n.t('adminChecklist.problem.name');
      case 'items': return this.i18n.t('adminChecklist.problem.items');
      case 'emptyTitle': return this.i18n.t('adminChecklist.problem.emptyTitle');
      case 'duplicate': return this.i18n.t('adminChecklist.problem.duplicate');
      default: return '';
    }
  }
}
