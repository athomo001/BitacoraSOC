/**
 * File Purpose: frontend/src/app/pages/escalation/escalation-admin-simple/escalation-admin-simple.component.ts
 * Responsibilities: Orchestrate sub-modules (Shifts, Contacts, Flow, Directory, RACI).
 */

import { Component, OnInit, ChangeDetectorRef, Injectable } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DateAdapter, NativeDateAdapter, MAT_DATE_LOCALE } from '@angular/material/core';
import { Router } from '@angular/router';

import { EscalationService } from '../../../services/escalation.service';
import { CatalogService } from '../../../services/catalog.service';
import { DirectoryService, DirectoryContact } from '../../../services/directory.service';
import { AuthService } from '../../../services/auth.service';

import { EscalationRaciTabComponent } from './escalation-raci-tab.component';
import { EscalationContactsTabComponent } from './escalation-contacts-tab.component';
import { EscalationFlowTabComponent } from './escalation-flow-tab.component';
import { EscalationDirectoryTabComponent } from './escalation-directory-tab.component';

@Injectable()
class MondayFirstNativeDateAdapter extends NativeDateAdapter {
  override getFirstDayOfWeek(): number {
    return 1;
  }
}

@Component({
  selector: 'app-escalation-admin-simple',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTabsModule,
    MatTooltipModule,
    EscalationRaciTabComponent,
    EscalationContactsTabComponent,
    EscalationFlowTabComponent,
    EscalationDirectoryTabComponent
  ],
  providers: [
    { provide: MAT_DATE_LOCALE, useValue: 'es-CL' },
    { provide: DateAdapter, useClass: MondayFirstNativeDateAdapter }
  ],
  templateUrl: './escalation-admin-simple.component.html',
  styleUrls: ['./escalation-admin-simple.component.scss']
})
export class EscalationAdminSimpleComponent implements OnInit {
  clients: any[] = [];
  directoryContacts: DirectoryContact[] = [];
  
  loadingClients = false;
  loadingDirectoryContacts = false;
  
  isAdminUser = false;
  canDirectoryWrite = false;
  canDirectoryDelete = false;
  directoryOnlyAccess = false;

  constructor(
    private catalogService: CatalogService,
    private directoryService: DirectoryService,
    private authService: AuthService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.checkPermissions();
    this.loadAllData();
  }

  private checkPermissions(): void {
    const user = this.authService.getCurrentUser();
    this.isAdminUser = this.authService.hasRole('admin');
    
    const normalizedCargo = this.normalizeCargoLabel(user?.cargoLabel || '');
    const fullAccessCargos = new Set(['n2', 'n3', 'jefe area', 'gerente area', 'arquitecto siem']);
    // Habilita la capacidad de crear y modificar contactos en el directorio central para analistas N1.
    this.canDirectoryWrite = this.isAdminUser || !!normalizedCargo;
    this.canDirectoryDelete = this.isAdminUser || fullAccessCargos.has(normalizedCargo);
    this.directoryOnlyAccess = this.router.url.includes('/main/escalation/directory');
  }

  private normalizeCargoLabel(value: string): string {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  loadAllData(): void {
    this.loadClients();
    this.loadDirectoryContacts();
  }

  loadClients(): void {
    this.loadingClients = true;
    this.catalogService.getAllLogSources().subscribe({
      next: (response) => {
        const items = response?.items || response || [];
        this.clients = [...items].filter((client: any) => client.enabled !== false);
        this.loadingClients = false;
        this.cdr.detectChanges();
      },
      error: () => this.loadingClients = false
    });
  }

  loadDirectoryContacts(): void {
    this.loadingDirectoryContacts = true;
    this.directoryService.getAll().subscribe({
      next: (contacts) => {
        this.directoryContacts = contacts || [];
        this.loadingDirectoryContacts = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.directoryContacts = [];
        this.loadingDirectoryContacts = false;
      }
    });
  }

  get pageHeaderTitle(): string {
    return this.directoryOnlyAccess ? 'Directorio Global de Contactos' : 'Administración de Escalamientos';
  }

  get pageHeaderSubtitle(): string {
    return this.directoryOnlyAccess
      ? 'Fuente única de contactos para todos los módulos operativos'
      : 'Configura flujos de llamadas, correos y RACI';
  }

  showError(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 4000 });
  }

  showSuccess(message: string): void {
    this.snackBar.open(message, 'Cerrar', { duration: 3000 });
  }
}
