/**
 * File Purpose: frontend/src/app/pages/main/checklist/checklist.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatExpansionModule, MatAccordion, MatExpansionPanel, MatExpansionPanelHeader, MatExpansionPanelTitle, MatExpansionPanelDescription } from '@angular/material/expansion';
import { ChecklistService } from '../../../services/checklist.service';
import { ChecklistTemplate, ChecklistItem } from '../../../models/checklist.model';
import { AuthService } from '../../../services/auth.service';
import { OnboardingService } from '../../../services/onboarding.service';
import { NgIf, NgFor, NgTemplateOutlet } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatFormField, MatLabel, MatHint } from '@angular/material/form-field';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatRadioGroup, MatRadioButton } from '@angular/material/radio';
import { MatInput } from '@angular/material/input';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { EntriesComponent } from '../entries/entries.component';

type ChecklistNode = {
  serviceId: string;
  serviceTitle: string;
  description?: string;
  parentId?: string;
  parent?: ChecklistNode;
  status: 'verde' | 'rojo' | null;
  observation: string;
  children?: ChecklistNode[];
};

@Component({
  selector: 'app-checklist',
  templateUrl: './checklist.component.html',
  styleUrls: ['./checklist.component.scss'],
  imports: [NgIf, MatIcon, MatAccordion, MatExpansionPanel, MatExpansionPanelHeader, MatExpansionPanelTitle, ReactiveFormsModule, FormsModule, MatFormField, MatLabel, MatSelect, MatOption, NgFor, MatExpansionPanelDescription, MatRadioGroup, MatRadioButton, MatInput, MatHint, MatButton, MatProgressSpinner, EntriesComponent, NgTemplateOutlet]
})
export class ChecklistComponent implements OnInit {
  @ViewChild('checklistGuideCard') checklistGuideCard?: ElementRef<HTMLElement>;
  activeChecklist: ChecklistTemplate | null = null;
  checkType: 'inicio' | 'cierre' = 'inicio';
  isSubmitting = false;
  isLoading = false;
  checklistTree: ChecklistNode[] = [];
  checklistGuideVisible = false;
  
  // Inicia cerrado por defecto y solo cambia si el usuario lo abre/cierra.
  mainPanelExpanded = false;

  constructor(
    private checklistService: ChecklistService,
    private snackBar: MatSnackBar,
    private authService: AuthService,
    private onboardingService: OnboardingService,
    private expansionModule: MatExpansionModule
  ) { }

  ngOnInit(): void {
    const username = this.authService.getCurrentUser()?.username;
    this.checklistGuideVisible = this.onboardingService.shouldShow('checklist', username);
    this.loadActiveChecklist();
  }

  closeChecklistGuide(dontShowAgain = false): void {
    const username = this.authService.getCurrentUser()?.username;
    if (dontShowAgain) {
      this.onboardingService.hide('checklist', username);
    }
    this.checklistGuideVisible = false;
  }

  openChecklistGuide(): void {
    this.checklistGuideVisible = true;
    setTimeout(() => {
      const card = this.checklistGuideCard?.nativeElement;
      card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  private buildNodes(items: ChecklistItem[], parent?: ChecklistNode): ChecklistNode[] {
    return (items || []).map(item => {
      if (!item._id) {
        console.error('[CHECKLIST] Item sin _id encontrado:', item);
      }
      const node: ChecklistNode = {
        serviceId: item._id,
        serviceTitle: item.title,
        description: item.description,
        parentId: parent?.serviceId,
        parent,
        status: null,
        observation: '',
        children: []
      };
      node.children = this.buildNodes(item.children || [], node);
      if (node.children.length > 0) {
        node.status = this.getAggregateStatus(node);
      }
      return node;
    });
  }

  private flattenNodes(nodes: ChecklistNode[]): ChecklistNode[] {
    return nodes.reduce<ChecklistNode[]>((acc, node) => {
      acc.push(node);
      if (node.children?.length) {
        acc.push(...this.flattenNodes(node.children));
      }
      return acc;
    }, []);
  }

  onStatusChange(node: ChecklistNode, status: 'verde' | 'rojo'): void {
    if (!this.isLeafNode(node)) {
      this.syncAncestors(node);
      return;
    }

    node.status = status;
    if (status !== 'rojo') {
      node.observation = '';
    }
    this.syncAncestors(node);
  }

  private syncAncestors(node: ChecklistNode): void {
    let current: ChecklistNode | undefined = node;
    while (current) {
      if (!this.isLeafNode(current)) {
        current.status = this.getAggregateStatus(current);
        current.observation = '';
      }
      current = current.parent;
    }
  }

  isLeafNode(node: ChecklistNode): boolean {
    return !node.children || node.children.length === 0;
  }

  getAggregateStatus(node: ChecklistNode): 'verde' | 'rojo' | null {
    if (this.isLeafNode(node)) {
      return node.status;
    }

    const childStatuses = (node.children || []).map(child => this.getAggregateStatus(child));

    if (childStatuses.some(status => status === null)) {
      return null;
    }

    if (childStatuses.some(status => status === 'rojo')) {
      return 'rojo';
    }

    return childStatuses.length > 0 ? 'verde' : null;
  }

  getStatusLabel(node: ChecklistNode): string {
    const status = this.isLeafNode(node) ? node.status : this.getAggregateStatus(node);
    if (status === 'verde') {
      return 'Operativo';
    }
    if (status === 'rojo') {
      return 'Con problema';
    }
    return 'Pendiente';
  }

  requiresObservation(node: ChecklistNode): boolean {
    return this.isLeafNode(node) && node.status === 'rojo';
  }

  private recalculateTreeStatuses(): void {
    this.checklistTree.forEach(node => this.syncAncestors(node));
  }

  onCheckTypeChange(): void {
    this.loadActiveChecklist();
  }

  loadActiveChecklist(): void {
    this.isLoading = true;
    this.checklistService.getActiveChecklist(this.checkType).subscribe({
      next: (template) => {
        console.log('[CHECKLIST] Template recibido del backend:', template);
        console.log('[CHECKLIST] Items del template:', template?.items);
        this.activeChecklist = template;
        this.checklistTree = this.buildNodes(template?.items || []);
        console.log('[CHECKLIST] ChecklistTree construido:', this.checklistTree);
        const flatNodes = this.flattenNodes(this.checklistTree);
        console.log('[CHECKLIST] Nodos aplanados:', flatNodes);
        console.log('[CHECKLIST] IDs de servicios:', flatNodes.map(n => ({ title: n.serviceTitle, id: n.serviceId })));
        this.logAction('checklist.template.load', 'ok', { count: flatNodes.length });
        this.isLoading = false;
      },
      error: (err) => {
        this.logAction('checklist.template.load', 'error', { message: err?.message });
        this.snackBar.open('Error cargando checklist activo', 'Cerrar', { duration: 3000 });
        this.isLoading = false;
      }
    });
  }

  onSubmit(): void {
    if (this.isSubmitting) {
      return;
    }

    this.recalculateTreeStatuses();

    const flat = this.flattenNodes(this.checklistTree);
    const leafNodes = flat.filter(node => this.isLeafNode(node));
    const allHaveStatus = leafNodes.every(node => node.status !== null);
    if (!allHaveStatus) {
      this.snackBar.open('Todos los sub-items deben tener estado antes de enviar el checklist', 'Cerrar', { duration: 3000 });
      return;
    }

    const invalidRed = leafNodes.find(node =>
      node.status === 'rojo' &&
      (!node.observation || node.observation.trim() === '')
    );
    if (invalidRed) {
      this.snackBar.open(`El servicio "${invalidRed.serviceTitle}" esta en rojo y requiere observacion`, 'Cerrar', { duration: 4000 });
      return;
    }

    this.isSubmitting = true;

    // Validar que todos los servicios tengan IDs válidos
    const invalidServices = flat.filter(s => !s.serviceId || s.serviceId === 'undefined');
    if (invalidServices.length > 0) {
      console.error('[CHECKLIST] Servicios con IDs inválidos:');
      invalidServices.forEach((svc, idx) => {
        console.error(`  ${idx + 1}. Título: "${svc.serviceTitle}", ID: "${svc.serviceId}", Parent: "${svc.parentId}"`);
      });
      console.error('[CHECKLIST] Todos los servicios flat:', flat);
      console.error('[CHECKLIST] Checklist tree:', this.checklistTree);
      this.snackBar.open('Error: Algunos servicios no tienen ID válido. Recarga la página.', 'Cerrar', { duration: 5000 });
      this.isSubmitting = false;
      return;
    }

    const payload = {
      checklistId: this.activeChecklist?._id || undefined,
      type: this.checkType,
      services: flat.map(s => ({
        serviceId: s.serviceId,
        parentServiceId: s.parentId || null,
        serviceTitle: s.serviceTitle,
        status: (this.isLeafNode(s) ? s.status : this.getAggregateStatus(s))!,
        observation: this.isLeafNode(s) ? s.observation : ''
      }))
    };

    console.log('[CHECKLIST] Enviando payload:', payload);

    this.checklistService.createCheck(payload).subscribe({
      next: () => {
        this.snackBar.open('Checklist enviado exitosamente', 'Cerrar', { duration: 3000 });
        this.resetForm();
        this.logAction('checklist.submit', 'ok', { services: payload.services.length });
        this.isSubmitting = false;
      },
      error: (err: any) => {
        const msg = err.error?.message || 'Error enviando checklist';
        this.snackBar.open(msg, 'Cerrar', { duration: 4000 });
        this.logAction('checklist.submit', 'error', { message: msg });
        this.isSubmitting = false;
      }
    });
  }

  private logAction(action: string, result: 'ok' | 'error', data: Record<string, unknown> = {}): void {
    const user = this.authService.getCurrentUser();
    const payload = {
      ts: new Date().toISOString(),
      user: user?.username || 'anon',
      action,
      result,
      ...data
    };
    if (result === 'ok') {
      console.log('[CHECKLIST]', payload);
    } else {
      console.error('[CHECKLIST]', payload);
    }
  }

  resetForm(): void {
    this.checklistTree.forEach(node => this.resetNode(node));
  }

  private resetNode(node: ChecklistNode): void {
    node.status = null;
    node.observation = '';
    node.children?.forEach(child => this.resetNode(child));
    if (!this.isLeafNode(node)) {
      node.status = this.getAggregateStatus(node);
    }
  }
}
