import { Component, OnInit } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ChecklistService } from '../../../services/checklist.service';
import { ConfigService } from '../../../services/config.service';
import { WorkShiftService } from '../../../services/work-shift.service';
import { ChecklistTemplate, ChecklistItem } from '../../../models/checklist.model';
import { WorkShift } from '../../../models/work-shift.model';
import { MatCard, MatCardTitle, MatCardContent } from '@angular/material/card';
import { NgIf, NgFor } from '@angular/common';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatNavList, MatListItem } from '@angular/material/list';
import { MatChipSet, MatChip } from '@angular/material/chips';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { MatAccordion, MatExpansionPanel, MatExpansionPanelHeader, MatExpansionPanelTitle } from '@angular/material/expansion';

@Component({
  selector: 'app-checklist-admin',
  templateUrl: './checklist-admin.component.html',
  styleUrls: ['./checklist-admin.component.scss'],
  imports: [MatCard, MatCardTitle, NgIf, MatProgressBar, MatNavList, NgFor, MatListItem, MatChipSet, MatChip, MatButton, MatCardContent, ReactiveFormsModule, MatFormField, MatLabel, MatInput, MatCheckbox, MatIconButton, MatIcon, MatAccordion, MatExpansionPanel, MatExpansionPanelHeader, MatExpansionPanelTitle]
})
export class ChecklistAdminComponent implements OnInit {
  templates: ChecklistTemplate[] = [];
  selectedTemplate: ChecklistTemplate | null = null;
  activeShifts: WorkShift[] = [];
  isLoading = false;
  savingConfig = false;
  form: FormGroup;
  configForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    private checklistService: ChecklistService,
    private configService: ConfigService,
    private workShiftService: WorkShiftService,
    private snackBar: MatSnackBar
  ) {
    this.form = this.fb.group({
      name: ['', Validators.required],
      assignedTo: this.fb.array([]),
      items: this.fb.array([])
    });

    this.configForm = this.fb.group({
      checklistCooldownHours: [240, [Validators.required, Validators.min(1)]], // minutos (default 4 horas)
      checklistCloseEmailEnabled: [false]
    });
  }

  ngOnInit(): void {
    this.loadConfig();
    this.loadTemplates();
    this.loadActiveShifts();
    this.addItem();
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
          checklistCloseEmailEnabled: config.checklistCloseEmailEnabled ?? false
        });
      },
      error: (err) => {
        console.error('Error cargando config checklist:', err);
        this.snackBar.open('Error cargando configuración de checklist', 'Cerrar', { duration: 3000 });
      }
    });
  }

  saveConfig(): void {
    if (this.configForm.invalid) return;
    this.savingConfig = true;
    const payload = {
      shiftCheckCooldownHours: this.configForm.value.checklistCooldownHours,
      checklistCloseEmailEnabled: this.configForm.value.checklistCloseEmailEnabled
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
