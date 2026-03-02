import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { NoteService } from '../../services/note.service';
import { ChecklistService } from '../../services/checklist.service';
import { ConfigService } from '../../services/config.service';
import { ThemeService } from '../../services/theme.service';
import { AdminNote, PersonalNote } from '../../models/note.model';
import { ChecklistTemplate, ChecklistItem, ShiftCheck } from '../../models/checklist.model';
import { Theme } from '../../models/user.model';
import { environment } from '../../../environments/environment';
import { MatSidenavContainer, MatSidenav, MatSidenavContent } from '@angular/material/sidenav';
import { MatToolbar } from '@angular/material/toolbar';
import { NgIf, NgFor } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatNavList, MatListItem, MatListItemIcon, MatListItemTitle } from '@angular/material/list';
import { RouterLinkActive, RouterLink, RouterOutlet } from '@angular/router';
import { MatAccordion, MatExpansionPanel, MatExpansionPanelHeader, MatExpansionPanelTitle } from '@angular/material/expansion';
import { MatDivider } from '@angular/material/divider';
import { MatFormField, MatLabel, MatHint } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatMenuTrigger, MatMenu, MatMenuItem } from '@angular/material/menu';

type MenuItem = {
  icon: string;
  label: string;
  route: string;
  fragment?: string;
  roles: string[];
};

@Component({
  selector: 'app-main-layout',
  templateUrl: './main-layout.component.html',
  styleUrls: ['./main-layout.component.scss'],
  imports: [MatSidenavContainer, MatSidenav, MatToolbar, NgIf, MatIcon, MatNavList, NgFor, MatListItem, RouterLinkActive, RouterLink, MatListItemIcon, MatListItemTitle, MatAccordion, MatExpansionPanel, MatExpansionPanelHeader, MatExpansionPanelTitle, MatDivider, MatFormField, MatLabel, MatInput, ReactiveFormsModule, FormsModule, MatHint, MatSidenavContent, MatIconButton, MatMenuTrigger, MatMenu, MatMenuItem, RouterOutlet]
})
export class MainLayoutComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private adminNoteChange$ = new Subject<string>();
  private personalNoteChange$ = new Subject<string>();

  currentUser: any = null;
  isAdmin = false;
  isUser = false;
  isGuest = false;

  // Sidebar states
  leftSidebarOpened = true;
  rightSidebarOpened = false;

  // Notas
  adminNote: Partial<AdminNote> = { content: '' };
  personalNote: Partial<PersonalNote> = { content: '' };

  // Checklist
  activeChecklist: ChecklistTemplate | null = null;
  activeServices: ChecklistItem[] = [];
  lastCheck: ShiftCheck | null = null;
  checkType: 'inicio' | 'cierre' = 'inicio';
  checklistServices: Array<{
    serviceId: string;
    serviceTitle: string;
    status: 'verde' | 'rojo' | null;
    observation: string;
    parentId?: string;
  }> = [];
  checklistHasErrors = false;
  checklistErrorMessage = '';

  primaryMenuItems: MenuItem[] = [
    { icon: 'edit', label: 'Escribir', route: '/main/checklist', roles: ['admin', 'user', 'guest'] },
    { icon: 'playlist_add_check', label: 'Historial Checklists', route: '/main/checklist-history', roles: ['admin', 'user', 'guest'] },
    { icon: 'contact_phone', label: 'Escalación', route: '/main/escalation/view', roles: ['admin', 'user', 'guest'] },
    { icon: 'table_chart', label: 'Generar Reporte', route: '/main/report-generator', roles: ['admin', 'user'] },
    { icon: 'history', label: 'Mis Entradas', route: '/main/my-entries', roles: ['admin', 'user'] },
    { icon: 'public', label: 'Ver todas', route: '/main/all-entries', roles: ['admin', 'user', 'guest'] },
    { icon: 'assessment', label: 'Reportes', route: '/main/reports', roles: ['admin', 'user'] },
    { icon: 'person', label: 'Mi Perfil', route: '/main/profile', roles: ['admin', 'user'] }
  ];


  configItems: MenuItem[] = [
    { icon: 'admin_panel_settings', label: 'Consola Admin', route: '/main/admin', roles: ['admin'] },
    { icon: 'image', label: 'Branding', route: '/main/logo', roles: ['admin'] },
    { icon: 'history', label: 'Logs de Auditoría', route: '/main/audit-logs', roles: ['admin', 'auditor'] },
    { icon: 'local_offer', label: 'Tags', route: '/main/tags', roles: ['admin'] },
    { icon: 'backup', label: 'Backup', route: '/main/backup', roles: ['admin'] }
  ];

  visiblePrimaryMenu: MenuItem[] = [];
  visibleConfigItems: MenuItem[] = [];
  hasConfigAccess = false;
  logoUrl: string = '';
  private backendBaseUrl = environment.backendBaseUrl;

  constructor(
    private authService: AuthService,
    private noteService: NoteService,
    private checklistService: ChecklistService,
    private configService: ConfigService,
    private themeService: ThemeService
  ) { }

  getAssetUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `${this.backendBaseUrl}${url}`;
  }

  ngOnInit(): void {
    this.loadUserData();
    this.loadNotes();
    this.loadChecklist();
    this.loadLogo();
    this.setupAutosave();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadUserData(): void {
    this.currentUser = this.authService.getCurrentUser();
    if (this.currentUser) {
      this.isAdmin = this.currentUser.role === 'admin';
      this.isUser = this.currentUser.role === 'user';
      this.isGuest = this.currentUser.role === 'guest';
    }

    this.updateVisibleMenus();
  }

  loadLogo(): void {
    this.configService.getLogo()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.logoUrl = response.logoUrl;
        },
        error: () => {
          this.logoUrl = '';
        }
      });
  }

  setupAutosave(): void {
    this.adminNoteChange$
      .pipe(debounceTime(3000), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(content => {
        if (this.isAdmin && content !== null) {
          this.noteService.updateAdminNote({ content })
            .subscribe({
              next: () => console.log('Nota admin guardada automaticamente'),
              error: (err) => console.error('Error en autosave nota admin:', err)
            });
        }
      });

    this.personalNoteChange$
      .pipe(debounceTime(3000), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(content => {
        if (content !== null) {
          this.noteService.updatePersonalNote({ content })
            .subscribe({
              next: () => console.log('Nota personal guardada automaticamente'),
              error: (err) => console.error('Error en autosave nota personal:', err)
            });
        }
      });
  }

  loadNotes(): void {
    if (!this.isGuest) {
      this.noteService.getAdminNote()
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (note) => this.adminNote = note || { content: '' },
          error: (err) => console.error('Error cargando nota admin:', err)
        });

      this.noteService.getPersonalNote()
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (note) => this.personalNote = note || { content: '' },
          error: (err) => console.error('Error cargando nota personal:', err)
        });
    }
  }

  loadChecklist(): void {
    this.checklistService.getActiveChecklist()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (template) => {
          this.activeChecklist = template;
          const services = template?.flatItems || this.flattenItems(template?.items || []);
          this.activeServices = services;
          this.checklistServices = services.map(s => ({
            serviceId: s._id,
            serviceTitle: s.title,
            status: null,
            observation: '',
            parentId: (s as any).parentId
          }));
        },
        error: (err) => {
          // Silenciar error 404 si el endpoint no está implementado
          if (err.status !== 404) {
            console.error('Error cargando checklist activo:', err);
          }
        }
      });

    this.checklistService.getLastCheck()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          this.lastCheck = response.check || response || null;
          if (this.lastCheck) {
            this.checkType = this.lastCheck.type === 'inicio' ? 'cierre' : 'inicio';
          }
        },
        error: (err) => console.error('Error cargando ultimo check:', err)
      });

    setInterval(() => {
      this.refreshChecklistServices();
    }, 120000);
  }

  refreshChecklistServices(): void {
    this.checklistService.getActiveChecklist()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (template) => {
          const services = template?.flatItems || this.flattenItems(template?.items || []);
          if (JSON.stringify(services) !== JSON.stringify(this.activeServices)) {
            console.log('Checklist actualizado por admin');
            this.activeChecklist = template;
            this.activeServices = services;
            this.checklistServices = services.map(s => ({
              serviceId: s._id,
              serviceTitle: s.title,
              status: null,
              observation: '',
              parentId: (s as any).parentId
            }));
          }
        },
        error: (err) => console.error('Error refrescando checklist:', err)
      });
  }

  private updateVisibleMenus(): void {
    const role = this.currentUser?.role || '';
    this.visiblePrimaryMenu = this.primaryMenuItems.filter(item => item.roles.includes(role));
    this.visibleConfigItems = this.configItems.filter(item => item.roles.includes(role));
    this.hasConfigAccess = role === 'admin';
  }

  trackByMenu = (_: number, item: MenuItem) => item.route + (item.fragment || '');

  toggleLeftSidebar(): void {
    this.leftSidebarOpened = !this.leftSidebarOpened;
  }

  toggleRightSidebar(): void {
    this.rightSidebarOpened = !this.rightSidebarOpened;
  }

  private flattenItems(items: ChecklistItem[], parentId?: string): ChecklistItem[] {
    const flat: ChecklistItem[] = [];
    (items || []).forEach(item => {
      flat.push({ ...item, parentId });
      if (item.children?.length) {
        flat.push(...this.flattenItems(item.children, item._id));
      }
    });
    return flat;
  }

  saveAdminNote(): void {
    if (this.adminNote && this.isAdmin) {
      this.noteService.updateAdminNote({ content: this.adminNote.content || '' })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => console.log('Nota admin guardada'),
          error: (err) => console.error('Error guardando nota admin:', err)
        });
    }
  }

  onAdminNoteChange(content: string): void {
    this.adminNoteChange$.next(content);
  }

  savePersonalNote(): void {
    if (this.personalNote) {
      this.noteService.updatePersonalNote({ content: this.personalNote.content || '' })
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => console.log('Nota personal guardada'),
          error: (err) => console.error('Error guardando nota personal:', err)
        });
    }
  }

  onPersonalNoteChange(content: string): void {
    this.personalNoteChange$.next(content);
  }

  onChecklistSubmit(): void {
    this.checklistHasErrors = false;
    this.checklistErrorMessage = '';

    const incompleteServices = this.checklistServices.filter(s => s.status === null);
    if (incompleteServices.length > 0) {
      this.checklistErrorMessage = `Debes evaluar todos los servicios. Faltan: ${incompleteServices.map(s => s.serviceTitle).join(', ')}`;
      this.checklistHasErrors = true;
      return;
    }

    const redWithoutObservation = this.checklistServices.filter(s => s.status === 'rojo' && (!s.observation || s.observation.trim() === ''));
    if (redWithoutObservation.length > 0) {
      this.checklistErrorMessage = `Los servicios en rojo requieren observacion: ${redWithoutObservation.map(s => s.serviceTitle).join(', ')}`;
      this.checklistHasErrors = true;
      return;
    }

    const payload = {
      checklistId: this.activeChecklist?._id || undefined,
      type: this.checkType,
      services: this.checklistServices.map(s => ({
        serviceId: s.serviceId,
        parentServiceId: s.parentId || null,
        serviceTitle: s.serviceTitle,
        status: s.status!,
        observation: s.observation
      }))
    };

    this.checklistService.createCheck(payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.lastCheck = response.check;
          this.checkType = this.checkType === 'inicio' ? 'cierre' : 'inicio';
          this.checklistServices.forEach(s => {
            s.status = null;
            s.observation = '';
          });
          console.log('Checklist enviado exitosamente');
        },
        error: (err) => {
          this.checklistErrorMessage = err.error?.message || 'Error enviando checklist';
          this.checklistHasErrors = true;
          console.error('Error enviando checklist:', err);
        }
      });
  }

  getChecklistIndicator(): 'ok' | 'warning' | 'none' {
    if (!this.lastCheck) return 'none';
    return this.lastCheck.hasRedServices ? 'warning' : 'ok';
  }

  getChecklistStatus(): 'ok' | 'warning' | 'none' {
    return this.getChecklistIndicator();
  }

  getChecklistStatusText(): string {
    const status = this.getChecklistStatus();
    switch (status) {
      case 'ok':
        return 'OK';
      case 'warning':
        return 'Problemas';
      case 'none':
        return 'Sin registro';
      default:
        return '';
    }
  }

  changeTheme(theme: string): void {
    this.themeService.setTheme(theme as Theme);
  }

  logout(): void {
    this.authService.logout();
  }
}
