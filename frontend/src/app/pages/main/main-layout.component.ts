/**
 * File Purpose: frontend/src/app/pages/main/main-layout.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit, OnDestroy } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Subject, takeUntil, debounceTime, distinctUntilChanged } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { NoteService } from '../../services/note.service';
import { ChecklistService } from '../../services/checklist.service';
import { ConfigService } from '../../services/config.service';
import { ThemeService } from '../../services/theme.service';
import { ComplementService } from '../../services/complement.service';
import { ComplementBridgeService } from '../../services/complement-bridge.service';
import { WorkShiftService } from '../../services/work-shift.service';
import { SystemHealthService, HealthServiceState } from '../../services/system-health.service';
import { AdminNote, PersonalNote } from '../../models/note.model';
import { ChecklistTemplate, ChecklistItem, ShiftCheck } from '../../models/checklist.model';
import { Theme } from '../../models/user.model';
import { Complement } from '../../models/complement.model';
import { environment } from '../../../environments/environment';
import { MatSidenavContainer, MatSidenav, MatSidenavContent } from '@angular/material/sidenav';
import { MatToolbar } from '@angular/material/toolbar';
import { NgIf, NgFor, NgClass, AsyncPipe } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatNavList, MatListItem, MatListItemIcon, MatListItemTitle } from '@angular/material/list';
import { RouterLinkActive, RouterLink, RouterOutlet } from '@angular/router';
import { MatAccordion, MatExpansionPanel, MatExpansionPanelHeader, MatExpansionPanelTitle, MatExpansionPanelDescription } from '@angular/material/expansion';
import { MatDivider } from '@angular/material/divider';
import { MatFormField, MatLabel, MatHint } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatMenuTrigger, MatMenu, MatMenuItem } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { Title } from '@angular/platform-browser';
import { BatEasterEggService } from '../../services/bat-easter-egg.service';
import { UserService } from '../../services/user.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

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
  imports: [MatSidenavContainer, MatSidenav, MatToolbar, NgIf, MatIcon, MatNavList, NgFor, MatListItem, RouterLinkActive, RouterLink, MatListItemIcon, MatListItemTitle, MatAccordion, MatExpansionPanel, MatExpansionPanelHeader, MatExpansionPanelTitle, MatExpansionPanelDescription, MatDivider, MatFormField, MatLabel, MatInput, ReactiveFormsModule, FormsModule, MatHint, MatSidenavContent, MatIconButton, MatMenuTrigger, MatMenu, MatMenuItem, RouterOutlet, MatTooltip, NgClass, MatProgressSpinner]
})
export class MainLayoutComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private adminNoteChange$ = new Subject<string>();
  private personalNoteChange$ = new Subject<string>();
  private checklistRefreshIntervalId: ReturnType<typeof setInterval> | null = null;
  private shiftRefreshIntervalId: ReturnType<typeof setInterval> | null = null;
  private healthRefreshIntervalId: ReturnType<typeof setInterval> | null = null;

  currentUser: any = null;
  isAdmin = false;
  isUser = false;
  isGuest = false;

  // Propiedades para el setup obligatorio inicial
  forceSetupForm!: FormGroup;
  isSavingForceSetup = false;
  isUploadingForceAvatar = false;

  // Sidebar states
  // Arranca en el estado correcto según el ancho real de la ventana (no siempre
  // abierto): en pantallas angostas el drawer fijo de 280px dejaba casi sin
  // espacio al contenido y el texto se veía "cortado" en vez de envolver.
  private readonly mobileBreakpoint = '(max-width: 960px)';
  isMobileView = typeof window !== 'undefined' && window.matchMedia(this.mobileBreakpoint).matches;
  sidenavMode: 'side' | 'over' = this.isMobileView ? 'over' : 'side';
  leftSidebarOpened = !this.isMobileView;
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
    { icon: 'edit', label: 'Escribir', route: '/main/checklist', roles: ['admin', 'user', 'guest', 'auditor'] },
    { icon: 'playlist_add_check', label: 'Historial Checklists', route: '/main/checklist-history', roles: ['admin', 'user', 'guest', 'auditor'] },
    { icon: 'contact_phone', label: 'Escalación', route: '/main/escalation/view', roles: ['admin', 'user', 'guest', 'auditor'] },
    { icon: 'description', label: 'Reportes', route: '/main/reports', roles: ['admin', 'user', 'guest', 'auditor'] },
    { icon: 'contacts', label: 'Directorio de Contactos', route: '/main/escalation/directory', roles: ['admin', 'user', 'guest', 'auditor'] },
    { icon: 'public', label: 'Ver entradas', route: '/main/all-entries', roles: ['admin', 'user', 'guest', 'auditor'] },
    { icon: 'person', label: 'Mi Perfil', route: '/main/profile', roles: ['admin', 'user', 'guest', 'auditor'] },
    { icon: 'assessment', label: 'Estadísticas', route: '/main/statistics', roles: ['admin', 'user', 'guest', 'auditor'] }
  ];


  configItems: MenuItem[] = [
    { icon: 'admin_panel_settings', label: 'Consola Admin', route: '/main/admin', roles: ['admin', 'auditor'] },
    { icon: 'image', label: 'Branding', route: '/main/logo', roles: ['admin', 'auditor'] },
    { icon: 'history', label: 'Logs de Auditoría', route: '/main/audit-logs', roles: ['admin', 'auditor'] },
    { icon: 'backup', label: 'Backup', route: '/main/backup', roles: ['admin', 'auditor'] }
  ];

  visiblePrimaryMenu: MenuItem[] = [];
  visiblePrimaryMenuMain: MenuItem[] = [];
  visiblePrimaryMenuHistory: MenuItem[] = [];
  visibleConfigItems: MenuItem[] = [];
  visibleComplementItems: MenuItem[] = [];
  hasConfigAccess = false;
  logoUrl: string = '';
  appTitle: string = '';
  // Fuente tipográfica del título de la aplicación recuperada del backend
  appTitleFont: string = 'Monarchia Momentum';
  healthCheckedAt: string | null = null;
  healthServices: { key: 'smtp' | 'mongo' | 'internalApi' | 'integrations'; label: string; state: HealthServiceState }[] = [];
  activeComplements: Complement[] = [];
  private backendBaseUrl = environment.backendBaseUrl;
  private readonly historyMenuRoutes = new Set(['/main/checklist-history', '/main/all-entries']);

  constructor(
    private authService: AuthService,
    private noteService: NoteService,
    private checklistService: ChecklistService,
    private configService: ConfigService,
    private themeService: ThemeService,
    private complementService: ComplementService,
    private complementBridgeService: ComplementBridgeService,
    private workShiftService: WorkShiftService,
    private systemHealthService: SystemHealthService,
    private titleService: Title,
    private userService: UserService,
    private snackBar: MatSnackBar,
    private fb: FormBuilder,
    private breakpointObserver: BreakpointObserver,
    // Servicio global del Easter Egg #bat — el HUD se suscribe a su estado aquí
    readonly batService: BatEasterEggService
  ) { }

  getAssetUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `${this.backendBaseUrl}${url}`;
  }

  ngOnInit(): void {
    // Colapsa el drawer izquierdo a modo overlay en pantallas angostas (celular/tablet
    // chico): con mode="side" fijo, el panel de 280px le dejaba al contenido tan poco
    // espacio que el texto se veía cortado en vez de envolver.
    this.breakpointObserver.observe([this.mobileBreakpoint])
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        this.isMobileView = state.matches;
        this.sidenavMode = state.matches ? 'over' : 'side';
        this.leftSidebarOpened = !state.matches;
      });

    this.loadUserData();
    this.loadNotes();
    this.loadChecklist();
    this.loadLogo();
    this.loadBrandingTitle();
    this.loadActiveComplements();
    this.loadCurrentShiftContext();
    if (this.canViewHealthSummary()) {
      this.loadHealthSummary();
    } else {
      this.healthCheckedAt = null;
      this.healthServices = [];
    }
    
    // Register shift context refresh interval here so it only sets once
    this.shiftRefreshIntervalId = setInterval(() => {
      this.loadCurrentShiftContext();
    }, 60000);
    if (this.canViewHealthSummary()) {
      this.healthRefreshIntervalId = setInterval(() => {
        this.loadHealthSummary();
      }, 60000);
    }

    this.setupAutosave();
    this.complementService.complementsChanged$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.loadActiveComplements();
      });
    this.complementBridgeService.updateContext({
      theme: this.themeService.getCurrentTheme()
    });
  }

  ngOnDestroy(): void {
    if (this.checklistRefreshIntervalId) {
      clearInterval(this.checklistRefreshIntervalId);
      this.checklistRefreshIntervalId = null;
    }
    if (this.shiftRefreshIntervalId) {
      clearInterval(this.shiftRefreshIntervalId);
      this.shiftRefreshIntervalId = null;
    }
    if (this.healthRefreshIntervalId) {
      clearInterval(this.healthRefreshIntervalId);
      this.healthRefreshIntervalId = null;
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadUserData(): void {
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser = user;
        if (user) {
          this.isAdmin = user.role === 'admin';
          this.isUser = user.role === 'user';
          this.isGuest = user.role === 'guest';

          // Inicializar el formulario si el usuario está obligado a completar su perfil
          if (user.mustChangePassword && !this.forceSetupForm) {
            this.initForceSetupForm();
          }
        } else {
          this.isAdmin = false;
          this.isUser = false;
          this.isGuest = false;
        }

        this.complementBridgeService.updateContext({
          user: user ? {
            username: user.username,
            role: user.role,
            fullName: user.fullName
          } : null
        });

        this.updateVisibleMenus();
      });
  }

  loadActiveComplements(): void {
    this.complementService.getActiveComplements()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (complements) => {
          this.activeComplements = complements;
          this.visibleComplementItems = complements.map((item) => ({
            icon: item.circuit.state === 'OPEN' ? 'build' : 'extension',
            label: item.name,
            route: `/main/complements/${item.slug}`,
            roles: ['admin', 'user', 'guest', 'auditor']
          }));
          this.updateVisibleMenus();
        },
        error: () => {
          this.activeComplements = [];
          this.visibleComplementItems = [];
        }
      });
  }

  loadCurrentShiftContext(): void {
    this.workShiftService.getCurrentShift()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          const shift = response?.shift;
          const assignedUsers = (shift?.assignedUserIds || [])
            .map((user: any) => typeof user === 'string'
              ? null
              : ({
                id: user._id,
                fullName: user.fullName || ''
              }))
            .filter(Boolean);
          this.complementBridgeService.updateContext({
            shift: shift ? {
              shiftId: shift._id,
              shiftName: shift.name,
              timezone: response.timezone,
              assignedUsers
            } : null
          });
        }
      });
  }

  loadHealthSummary(): void {
    if (!this.canViewHealthSummary()) {
      this.healthCheckedAt = null;
      this.healthServices = [];
      return;
    }

    this.systemHealthService.getHealthSummary()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.healthCheckedAt = response.checkedAt;
          this.healthServices = [
            { key: 'smtp', label: 'SMTP', state: response.services.smtp },
            { key: 'mongo', label: 'Mongo', state: response.services.mongo },
            { key: 'internalApi', label: 'API interna', state: response.services.internalApi },
            { key: 'integrations', label: 'Integraciones', state: response.services.integrations }
          ];
        },
        error: () => {
          this.healthCheckedAt = null;
          this.healthServices = [];
        }
      });
  }

  private canViewHealthSummary(): boolean {
    return this.isAdmin;
  }

  getHealthStatusClass(status: string): string {
    if (status === 'ok') return 'chip-ok';
    if (status === 'down') return 'chip-down';
    return 'chip-warn';
  }

  getHealthTooltip(service: { label: string; state: HealthServiceState }): string {
    const detail = service.state?.detail || 'Sin detalle';
    const lastCheck = service.state?.lastCheckAt
      ? ` | Última prueba: ${new Date(service.state.lastCheckAt).toLocaleString('es-CL')}`
      : '';
    return `${service.label}: ${detail}${lastCheck}`;
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

  loadBrandingTitle(): void {
    this.configService.getConfig()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (config: any) => {
          this.appTitle = (config?.appTitle || '').trim();
          // Carga la fuente tipográfica configurada desde el backend (con fallback a la fuente predeterminada)
          this.appTitleFont = config?.titleFont || 'Monarchia Momentum';
          this.titleService.setTitle(this.appTitle);
          // Cargar e inyectar las fuentes personalizadas en el DOM
          this.loadAndInjectCustomFonts();
        },
        error: () => {
          this.appTitle = '';
          this.appTitleFont = 'Monarchia Momentum';
          this.titleService.setTitle('');
          this.loadAndInjectCustomFonts();
        }
      });
  }

  // Método para cargar las fuentes tipográficas personalizadas del backend y agregarlas al head mediante @font-face
  loadAndInjectCustomFonts(): void {
    this.configService.getCustomFonts()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (fonts) => {
          // Remover el elemento anterior si existía para evitar duplicados
          const oldStyle = document.getElementById('dynamic-custom-fonts');
          if (oldStyle) {
            oldStyle.remove();
          }

          if (fonts && fonts.length > 0) {
            const style = document.createElement('style');
            style.id = 'dynamic-custom-fonts';
            style.innerHTML = fonts.map(f => `
              @font-face {
                font-family: '${f.name}';
                src: url('${this.getAssetUrl(f.url)}') format('${f.format}');
                font-weight: normal;
                font-style: normal;
                font-display: swap;
              }
            `).join('\n');
            document.head.appendChild(style);
          }
        },
        error: (err) => {
          console.error('Error al inyectar fuentes tipográficas:', err);
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

    this.checklistRefreshIntervalId = setInterval(() => {
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
        error: (err) => {
          if (err.status !== 404) {
            console.error('Error refrescando checklist:', err);
          }
        }
      });
  }

  private updateVisibleMenus(): void {
    const role = this.currentUser?.role || '';
    this.visiblePrimaryMenu = this.primaryMenuItems.filter(item => item.roles.includes(role));
    this.visiblePrimaryMenuHistory = this.visiblePrimaryMenu.filter((item) => this.historyMenuRoutes.has(item.route));
    this.visiblePrimaryMenuMain = this.visiblePrimaryMenu.filter((item) => !this.historyMenuRoutes.has(item.route));
    this.visibleConfigItems = this.configItems.filter(item => item.roles.includes(role));
    this.hasConfigAccess = this.visibleConfigItems.length > 0;
  }

  trackByMenu = (_: number, item: MenuItem) => item.route + (item.fragment || '');

  toggleLeftSidebar(): void {
    this.leftSidebarOpened = !this.leftSidebarOpened;
  }

  // Cierra el drawer al navegar en vista móvil (overlay); en desktop (mode="side") no aplica.
  onNavLinkClicked(): void {
    if (this.isMobileView) {
      this.leftSidebarOpened = false;
    }
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
          this.complementBridgeService.updateContext({
            checklist: {
              type: this.lastCheck?.type,
              hasRedServices: this.lastCheck?.hasRedServices
            }
          });
          this.complementBridgeService.publish('CHECKLIST_SUBMITTED', {
            type: this.lastCheck?.type || 'inicio',
            hasRedServices: this.lastCheck?.hasRedServices || false
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
    this.complementBridgeService.updateContext({ theme: theme as Theme });
    this.complementBridgeService.publish('THEME_CHANGE', { theme });
  }

  // Inicializa el formulario reactivo de setup obligatorio
  initForceSetupForm(): void {
    let birthdayVal = '';
    // Si el usuario ya cuenta con su fecha de cumpleaños registrada en su perfil,
    // se formatea como YYYY-MM-DD para inicializar correctamente el formulario reactivo.
    if (this.currentUser?.birthday) {
      const dateObj = new Date(this.currentUser.birthday);
      if (!isNaN(dateObj.getTime())) {
        birthdayVal = dateObj.toISOString().split('T')[0];
      }
    }

    this.forceSetupForm = this.fb.group({
      newPassword: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required],
      birthday: [birthdayVal, Validators.required]
    });
  }

  // Carga la foto de perfil en el formulario inicial de forma asíncrona
  triggerForceAvatarUpload(input: HTMLInputElement): void {
    input.click();
  }

  // Maneja la subida del avatar temporal durante el flujo de force-setup
  onForceAvatarSelected(event: any): void {
    const file = event.target?.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      this.snackBar.open('Formato no permitido. Solo se aceptan imágenes JPG, JPEG, PNG y WEBP.', 'Cerrar', { duration: 3000 });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      this.snackBar.open('El archivo es demasiado grande. Máximo 2MB.', 'Cerrar', { duration: 3000 });
      return;
    }

    this.isUploadingForceAvatar = true;
    this.userService.uploadAvatar(file).subscribe({
      next: (res) => {
        this.currentUser = res.user;
        this.authService.updateCurrentUser(res.user);
        this.snackBar.open('Avatar actualizado con éxito', 'Cerrar', { duration: 3000 });
        this.isUploadingForceAvatar = false;
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Error al subir la imagen', 'Cerrar', { duration: 3000 });
        this.isUploadingForceAvatar = false;
      }
    });
  }

  // Envía el formulario para configurar la contraseña y la fecha de cumpleaños obligatoria
  submitForceSetup(): void {
    if (this.forceSetupForm.invalid) return;

    const { newPassword, confirmPassword, birthday } = this.forceSetupForm.value;

    if (newPassword !== confirmPassword) {
      this.snackBar.open('Las contraseñas nuevas no coinciden', 'Cerrar', { duration: 3000 });
      return;
    }

    this.isSavingForceSetup = true;

    // Convertir la fecha a formato ISO String
    const formattedBirthday = new Date(birthday).toISOString();

    this.userService.forceSetup({ newPassword, birthday: formattedBirthday }).subscribe({
      next: (res) => {
        this.snackBar.open('Configuración inicial guardada con éxito', 'Cerrar', { duration: 3000 });
        this.currentUser = res.user;
        this.authService.updateCurrentUser(res.user);
        this.isSavingForceSetup = false;
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Error al guardar la configuración obligatoria', 'Cerrar', { duration: 4000 });
        this.isSavingForceSetup = false;
      }
    });
  }

  logout(): void {
    this.authService.logout();
  }
}
