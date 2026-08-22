/**
 * File Purpose: frontend/src/app/pages/main/checklist-admin/checklist-admin.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ChecklistService } from '../../../services/checklist.service';
import { ConfigService } from '../../../services/config.service';
import { WorkShiftService } from '../../../services/work-shift.service';
import { UserService } from '../../../services/user.service';
import { ChecklistTemplate, ChecklistItem } from '../../../models/checklist.model';
import { WorkShift } from '../../../models/work-shift.model';
import { ShiftReminder } from '../../../models/config.model';
import { NgIf, NgFor } from '@angular/common';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatNavList, MatListItem } from '@angular/material/list';
import { MatChipSet, MatChip, MatChipsModule } from '@angular/material/chips';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatFormField, MatLabel, MatHint } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { MatAccordion, MatExpansionPanel, MatExpansionPanelHeader, MatExpansionPanelTitle } from '@angular/material/expansion';
import { MatSelect, MatOption } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-checklist-admin',
  templateUrl: './checklist-admin.component.html',
  styleUrls: ['./checklist-admin.component.scss'],
  imports: [NgIf, MatProgressBar, MatNavList, NgFor, MatListItem, MatChipSet, MatChip, MatChipsModule, MatButton, ReactiveFormsModule, MatFormField, MatLabel, MatHint, MatInput, MatCheckbox, MatIconButton, MatIcon, MatAccordion, MatExpansionPanel, MatExpansionPanelHeader, MatExpansionPanelTitle, MatSelect, MatOption, MatRadioModule, MatProgressSpinnerModule]
})
export class ChecklistAdminComponent implements OnInit {
  templates: ChecklistTemplate[] = [];
  selectedTemplate: ChecklistTemplate | null = null;
  activeShifts: WorkShift[] = [];
  isLoading = false;
  savingConfig = false;
  cargoLabelOptions: string[] = ['N2'];
  form: FormGroup;
  configForm: FormGroup;

  // ─── MAIL-REM-043: CRUD de recordatorios ───────────────────────────────
  shiftReminders: ShiftReminder[] = [];
  loadingReminders = false;
  reminderFormOpen = false;
  editingReminder: ShiftReminder | null = null;
  savingReminder = false;
  reminderForm: FormGroup;

  reminderFixedTimes: string[] = [];
  fixedTimesError = false;

  constructor(
    private fb: FormBuilder,
    private checklistService: ChecklistService,
    private configService: ConfigService,
    private workShiftService: WorkShiftService,
    private userService: UserService,
    private snackBar: MatSnackBar
  ) {
    this.form = this.fb.group({
      name: ['', Validators.required],
      assignedTo: this.fb.array([]),
      items: this.fb.array([])
    });

    this.configForm = this.fb.group({
      checklistCooldownHours: [240, [Validators.required, Validators.min(1)]],
      checklistCloseEmailEnabled: [false],
      alertNokEnabled: [false],
      alertNokRoleTarget: [['N2']],
      checklistAlertEnabled: [true],
      checklistAlertTime: ['09:30', [Validators.required]]
    });

    this.reminderForm = this.fb.group({
      label: ['', [Validators.required, Validators.maxLength(150)]],
      reminderText: ['', [Validators.required, Validators.maxLength(5000)]],
      frequencyType: ['hours'],
      intervalHours: [4, [Validators.min(1), Validators.max(24)]],
      targetShiftIds: [[]],
      enabled: [true]
    });
  }

  ngOnInit(): void {
    this.loadCargoLabelOptions();
    this.loadConfig();
    this.loadTemplates();
    this.loadActiveShifts();
    this.loadShiftReminders();
    this.addItem();
  }

  /** Asistente por pasos (UI-CHK-044): scroll a sección sin recargar. */
  scrollToChecklistStep(elementId: string): void {
    document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  loadCargoLabelOptions(): void {
    this.userService.getUsersList().subscribe({
      next: (users) => {
        const labels = Array.from(new Set(
          (users || [])
            .map((user: any) => String(user?.cargoLabel || '').trim())
            .filter((label: string) => label.length > 0)
        )).sort((a, b) => a.localeCompare(b));

        this.cargoLabelOptions = labels.length > 0 ? labels : ['N2'];
        this.ensureNokRoleSelection();
      },
      error: (err) => {
        console.error('Error cargando cargos para alerta NOK', err);
        this.cargoLabelOptions = ['N2'];
        this.ensureNokRoleSelection();
      }
    });
  }

  private ensureNokRoleSelection(): void {
    const current = this.configForm.get('alertNokRoleTarget')?.value;
    const normalized = Array.isArray(current)
      ? current.map((value: string) => String(value || '').trim()).filter((value: string) => value.length > 0)
      : [];

    if (normalized.length === 0) {
      const fallback = this.cargoLabelOptions.includes('N2') ? ['N2'] : [this.cargoLabelOptions[0]];
      this.configForm.patchValue({ alertNokRoleTarget: fallback.filter(Boolean) }, { emitEvent: false });
    }
  }

  loadActiveShifts(): void {
    this.workShiftService.getShifts().subscribe({
      next: (shifts) => {
        this.activeShifts = shifts.filter((s: WorkShift) => s.active);
        this.initializeAssignments(this.selectedTemplate);
      },
      error: (err) => console.error('Error cargando turnos', err)
    });
  }

  loadConfig(): void {
    this.configService.getConfig().subscribe({
      next: (config) => {
        this.configForm.patchValue({
          checklistCooldownHours: config.shiftCheckCooldownHours,
          checklistCloseEmailEnabled: config.checklistCloseEmailEnabled ?? false,
          alertNokEnabled: config.alertNokEnabled ?? false,
          alertNokRoleTarget: Array.isArray(config.alertNokRoleTarget) && config.alertNokRoleTarget.length > 0
            ? config.alertNokRoleTarget
            : ['N2'],
          checklistAlertEnabled: config.checklistAlertEnabled ?? true,
          checklistAlertTime: config.checklistAlertTime || '09:30'
        });

        this.ensureNokRoleSelection();
      },
      error: (err) => {
        console.error('Error cargando config checklist:', err);
        this.snackBar.open('Error cargando configuración de checklist', 'Cerrar', { duration: 3000 });
      }
    });
  }

  saveConfig(): void {
    if (this.configForm.invalid) return;

    const alertNokEnabled = Boolean(this.configForm.value.alertNokEnabled);
    const selectedRoles = Array.isArray(this.configForm.value.alertNokRoleTarget)
      ? this.configForm.value.alertNokRoleTarget.filter((label: string) => String(label || '').trim().length > 0)
      : [];

    if (alertNokEnabled && selectedRoles.length === 0) {
      this.snackBar.open('Debes seleccionar al menos un cargo para alerta NOK', 'Cerrar', { duration: 3000 });
      return;
    }

    this.savingConfig = true;
    const payload: any = {
      shiftCheckCooldownHours: this.configForm.value.checklistCooldownHours,
      checklistCloseEmailEnabled: this.configForm.value.checklistCloseEmailEnabled,
      alertNokEnabled,
      alertNokRoleTarget: selectedRoles,
      checklistAlertEnabled: this.configForm.value.checklistAlertEnabled,
      checklistAlertTime: this.configForm.value.checklistAlertTime
    };
    this.configService.updateConfig(payload).subscribe({
      next: () => {
        this.snackBar.open('Configuración de checklist actualizada', 'Cerrar', { duration: 2000 });
      },
      error: () => {
        this.snackBar.open('Error guardando configuración de checklist', 'Cerrar', { duration: 3000 });
      },
      complete: () => {
        this.savingConfig = false;
      }
    });
  }

  // ─── MAIL-REM-043: Gestión de recordatorios ────────────────────────────

  loadShiftReminders(): void {
    this.loadingReminders = true;
    this.configService.getShiftReminders().subscribe({
      next: (reminders) => {
        this.shiftReminders = reminders;
        this.loadingReminders = false;
      },
      error: () => {
        this.loadingReminders = false;
        this.snackBar.open('Error cargando recordatorios', 'Cerrar', { duration: 3000 });
      }
    });
  }

  openReminderForm(reminder?: ShiftReminder): void {
    this.editingReminder = reminder ?? null;
    this.reminderFixedTimes = reminder ? [...(reminder.fixedTimes ?? [])] : [];
    this.reminderForm.reset({
      label: reminder?.label ?? '',
      reminderText: reminder?.reminderText ?? '',
      frequencyType: reminder?.frequencyType ?? 'hours',
      intervalHours: reminder?.intervalHours ?? 4,
      targetShiftIds: reminder?.targetShiftIds ?? [],
      enabled: reminder?.enabled !== false
    });
    this.reminderFormOpen = true;
  }

  cancelReminderForm(): void {
    this.reminderFormOpen = false;
    this.editingReminder = null;
    this.reminderFixedTimes = [];
    this.fixedTimesError = false;
    this.savingReminder = false;
  }

  saveReminder(): void {
    if (this.reminderForm.invalid) return;
    const v = this.reminderForm.value;
    if (v.frequencyType === 'fixed' && this.reminderFixedTimes.length === 0) {
      this.fixedTimesError = true;
      return;
    }
    this.fixedTimesError = false;
    this.savingReminder = true;

    const payload: Partial<ShiftReminder> = {
      label: v.label.trim(),
      reminderText: v.reminderText.trim(),
      frequencyType: v.frequencyType,
      intervalHours: Number(v.intervalHours) || 4,
      fixedTimes: v.frequencyType === 'fixed' ? [...this.reminderFixedTimes] : [],
      targetShiftIds: Array.isArray(v.targetShiftIds) ? v.targetShiftIds : [],
      enabled: Boolean(v.enabled)
    };

    const op = this.editingReminder
      ? this.configService.updateShiftReminder(this.editingReminder._id!, payload)
      : this.configService.createShiftReminder(payload);

    op.subscribe({
      next: () => {
        this.snackBar.open(this.editingReminder ? 'Recordatorio actualizado' : 'Recordatorio creado', 'Cerrar', { duration: 2000 });
        this.cancelReminderForm();
        this.loadShiftReminders();
      },
      error: (err) => {
        this.savingReminder = false;
        const detail = err?.error?.errors?.[0]?.msg || err?.error?.message || 'Error guardando recordatorio';
        this.snackBar.open(detail, 'Cerrar', { duration: 4000 });
      },
      complete: () => {
        this.savingReminder = false;
      }
    });
  }

  deleteReminder(reminder: ShiftReminder): void {
    if (!confirm(`¿Eliminar el recordatorio "${reminder.label}"?`)) return;
    this.configService.deleteShiftReminder(reminder._id!).subscribe({
      next: () => {
        this.snackBar.open('Recordatorio eliminado', 'Cerrar', { duration: 2000 });
        this.loadShiftReminders();
      },
      error: () => this.snackBar.open('Error al eliminar', 'Cerrar', { duration: 3000 })
    });
  }

  addFixedTimeFromPicker(input: HTMLInputElement): void {
    const value = (input.value || '').trim();
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value) && !this.reminderFixedTimes.includes(value)) {
      this.reminderFixedTimes = [...this.reminderFixedTimes, value].sort();
      this.fixedTimesError = false;
    }
    input.value = '';
  }

  removeFixedTime(time: string): void {
    this.reminderFixedTimes = this.reminderFixedTimes.filter(t => t !== time);
  }

  shiftNameById(id: string): string {
    // Si el turno ya no está activo (desactivado/eliminado), no mostrar el ObjectId crudo.
    return this.activeShifts.find(s => s._id === id)?.name ?? 'Turno inactivo';
  }

  get items(): FormArray {
    return this.form.get('items') as FormArray;
  }

  get assignedToControls() {
    return (this.form.get('assignedTo') as FormArray).controls;
  }

  initializeAssignments(template: ChecklistTemplate | null = null): void {
    const assignedArr = this.form.get('assignedTo') as FormArray;
    assignedArr.clear();

    const assignedMap = new Map<string, Set<string>>();
    if (template && template.assignedTo) {
      template.assignedTo.forEach(a => {
        if (!assignedMap.has(a.shiftId)) assignedMap.set(a.shiftId, new Set());
        assignedMap.get(a.shiftId)?.add(a.type);
      });
    }

    this.activeShifts.forEach(shift => {
      const types = assignedMap.get(shift._id!) || new Set();
      assignedArr.push(this.fb.group({
        shiftId: [shift._id],
        shiftName: [shift.name],
        inicio: [types.has('inicio')],
        cierre: [types.has('cierre')]
      }));
    });
  }

  private createItemGroup(item?: Partial<ChecklistItem>): FormGroup {
    return this.fb.group({
      _id: [item?._id || null],
      title: [item?.title || '', Validators.required],
      order: [item?.order ?? this.items.length],
      isActive: [item?.isActive !== false],
      children: this.fb.array(
        (item?.children || []).map((child, idx) => this.createChildGroup(child, idx))
      )
    });
  }

  private createChildGroup(child?: Partial<ChecklistItem>, idx = 0): FormGroup {
    return this.fb.group({
      _id: [child?._id || null],
      title: [child?.title || '', Validators.required],
      order: [child?.order ?? idx],
      isActive: [child?.isActive !== false]
    });
  }

  addItem(item?: Partial<ChecklistItem>): void {
    this.items.push(this.createItemGroup(item));
  }

  removeItem(index: number): void {
    if (this.items.length === 1) {
      this.snackBar.open('Debe existir al menos un item en la plantilla', 'Cerrar', { duration: 3000 });
      return;
    }
    this.items.removeAt(index);
  }

  getChildrenArray(itemIndex: number): FormArray {
    return this.items.at(itemIndex).get('children') as FormArray;
  }

  addChild(itemIndex: number, child?: Partial<ChecklistItem>): void {
    this.getChildrenArray(itemIndex).push(this.createChildGroup(child, this.getChildrenArray(itemIndex).length));
  }

  removeChild(itemIndex: number, childIndex: number): void {
    this.getChildrenArray(itemIndex).removeAt(childIndex);
  }

  loadTemplates(): void {
    this.isLoading = true;
    this.checklistService.getTemplates().subscribe({
      next: (templates) => {
        this.templates = templates;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Error cargando plantillas', err);
        this.snackBar.open('Error cargando plantillas', 'Cerrar', { duration: 3000 });
        this.isLoading = false;
      }
    });
  }

  selectTemplate(template: ChecklistTemplate): void {
    this.selectedTemplate = template;
    this.form.patchValue({
      name: template.name
    });
    this.initializeAssignments(template);
    this.items.clear();
    (template.items || []).forEach(item => this.addItem(item));
  }

  resetForm(): void {
    this.selectedTemplate = null;
    this.form.reset({ name: '' });
    this.initializeAssignments(null);
    this.items.clear();
    this.addItem();
  }

  saveTemplate(): void {
    if (this.form.invalid) {
      this.snackBar.open('Completa el nombre y los items del checklist', 'Cerrar', { duration: 3000 });
      return;
    }

    const rawAssigned = this.form.value.assignedTo || [];
    const assignedToParsed: { shiftId: string, type: string }[] = [];

    rawAssigned.forEach((assign: any) => {
      if (assign.inicio) assignedToParsed.push({ shiftId: assign.shiftId, type: 'inicio' });
      if (assign.cierre) assignedToParsed.push({ shiftId: assign.shiftId, type: 'cierre' });
    });

    const payload = {
      name: this.form.value.name,
      assignedTo: assignedToParsed,
      items: this.items.value.map((item: any, idx: number) => ({
        _id: item._id,
        title: item.title,
        order: typeof item.order === 'number' ? item.order : idx,
        isActive: item.isActive !== false,
        children: (item.children || []).map((child: any, cIdx: number) => ({
          _id: child._id,
          title: child.title,
          order: typeof child.order === 'number' ? child.order : cIdx,
          isActive: child.isActive !== false
        }))
      }))
    } as Partial<ChecklistTemplate>;

    const request$ = this.selectedTemplate
      ? this.checklistService.updateTemplate(this.selectedTemplate._id as string, payload)
      : this.checklistService.createTemplate(payload);

    request$.subscribe({
      next: () => {
        this.snackBar.open('Plantilla guardada', 'Cerrar', { duration: 3000 });
        this.resetForm();
        this.loadTemplates();
      },
      error: (err) => {
        console.error('Error guardando plantilla', err);
        this.snackBar.open(err.error?.message || 'Error guardando plantilla', 'Cerrar', { duration: 3000 });
      }
    });
  }

  activateTemplate(template: ChecklistTemplate): void {
    if (!template._id) return;
    this.checklistService.activateTemplate(template._id).subscribe({
      next: () => {
        this.snackBar.open('Checklist activado', 'Cerrar', { duration: 3000 });
        this.loadTemplates();
      },
      error: (err) => {
        console.error('Error activando plantilla', err);
        this.snackBar.open(err.error?.message || 'Error activando plantilla', 'Cerrar', { duration: 3000 });
      }
    });
  }

  deactivateTemplate(template: ChecklistTemplate): void {
    if (!template._id) return;
    this.checklistService.deactivateTemplate(template._id).subscribe({
      next: () => {
        this.snackBar.open('Checklist desactivado', 'Cerrar', { duration: 3000 });
        this.loadTemplates();
      },
      error: (err) => {
        console.error('Error desactivando plantilla', err);
        this.snackBar.open(err.error?.message || 'Error desactivando plantilla', 'Cerrar', { duration: 3000 });
      }
    });
  }

  deleteTemplate(template: ChecklistTemplate): void {
    if (!template._id) return;
    if (!confirm(`Eliminar la plantilla "${template.name}"?`)) return;

    this.checklistService.deleteTemplate(template._id).subscribe({
      next: () => {
        this.snackBar.open('Plantilla eliminada', 'Cerrar', { duration: 3000 });
        this.loadTemplates();
        if (this.selectedTemplate?._id === template._id) {
          this.resetForm();
        }
      },
      error: (err) => {
        console.error('Error eliminando plantilla', err);
        this.snackBar.open(err.error?.message || 'Error eliminando plantilla', 'Cerrar', { duration: 3000 });
      }
    });
  }
}
