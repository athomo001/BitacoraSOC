import { Component, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { CatalogService } from '../../../services/catalog.service';
import { CatalogEvent, CatalogLogSource, CatalogOperationType } from '../../../models/catalog.model';
import {
  ClientAlertRule,
  ClientAlertRuleFormData,
  ClientAlertContext,
  ClientAlertWindowMode,
  ClientAlertChannel,
  ClientAlertRuleType
} from '../../../models/escalation.model';
import { EscalationService } from '../../../services/escalation.service';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { MatTabGroup, MatTab } from '@angular/material/tabs';
import { MatFormField, MatHint, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { NgFor, NgIf } from '@angular/common';
import { MatTooltip } from '@angular/material/tooltip';
import { MatSelect, MatOption } from '@angular/material/select';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { FormControl } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ConfigService } from '../../../services/config.service';
import { EmailReportConfig } from '../../../models/config.model';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, MAT_DATE_LOCALE } from '@angular/material/core';

@Component({
  selector: 'app-catalog-admin',
  templateUrl: './catalog-admin.component.html',
  styleUrls: ['./catalog-admin.component.scss'],
  imports: [MatTabGroup, MatTab, ReactiveFormsModule, FormsModule, MatFormField, MatHint, MatLabel, MatSuffix, MatInput, MatCheckbox, MatButton, MatIcon, NgIf, NgFor, MatIconButton, MatTooltip, MatSelect, MatOption, MatPaginator, MatDatepickerModule, MatNativeDateModule],
  providers: [{ provide: MAT_DATE_LOCALE, useValue: 'es-CL' }]
})
export class CatalogAdminComponent implements OnInit {
  private static readonly DEFAULT_REPORT_COLOR = '#4CAF50';
  private static readonly REPORT_COLOR_TYPES = ['incident', 'bulletin'] as const;

  reportColorSelection: Record<'incident' | 'bulletin', boolean> = {
    incident: true,
    bulletin: true
  };

  activeTabIndex = 0;

  // Listas
  events: CatalogEvent[] = [];
  logSources: CatalogLogSource[] = [];
  operationTypes: CatalogOperationType[] = [];
  clientAlertRules: ClientAlertRule[] = [];

  get activeLogSources(): CatalogLogSource[] {
    return this.logSources.filter(s => s.enabled);
  }

  get inactiveLogSources(): CatalogLogSource[] {
    return this.logSources.filter(s => !s.enabled);
  }

  // Estados
  isLoading = false;
  editingEventId: string | null = null;
  editingLogSourceId: string | null = null;
  editingOperationTypeId: string | null = null;
  editingClientAlertRuleId: string | null = null;

  // Paginación y Búsqueda Eventos
  eventPage = 1;
  eventPageSize = 50;
  eventTotal = 0;
  eventSearchControl = new FormControl('');

  reportColorMode: 'green' | 'sky' | 'light-red' | 'custom' = 'green';
  selectedCustomReportColor = CatalogAdminComponent.DEFAULT_REPORT_COLOR;
  customReportColorInput = CatalogAdminComponent.DEFAULT_REPORT_COLOR;
  isSavingReportColor = false;
  readonly customColorPalette: string[] = [
    '#4CAF50', '#2E7D32', '#8BC34A', '#2196F3', '#29B6F6', '#03A9F4',
    '#26A69A', '#009688', '#00BCD4', '#FF9800', '#FFC107', '#FFEB3B',
    '#F06292', '#E57373', '#EF5350', '#BA68C8', '#9C27B0', '#7E57C2',
    '#607D8B', '#78909C', '#795548', '#9E9E9E', '#546E7A', '#3F51B5'
  ];

  private currentEmailReportConfig: EmailReportConfig = {
    enabled: false,
    recipients: [],
    includeChecklist: true,
    includeEntries: true,
    subjectTemplate: 'Reporte SOC [fecha] [turno]',
    reportTableColor: CatalogAdminComponent.DEFAULT_REPORT_COLOR,
    reportTableColorByDocumentType: {
      incident: CatalogAdminComponent.DEFAULT_REPORT_COLOR,
      bulletin: CatalogAdminComponent.DEFAULT_REPORT_COLOR
    }
  };

  // Formularios
  eventForm: FormGroup;
  logSourceForm: FormGroup;
  operationTypeForm: FormGroup;
  clientAlertRuleForm: FormGroup;

  readonly clientAlertModes: Array<{ value: ClientAlertWindowMode; label: string }> = [
    { value: 'always', label: 'Siempre' },
    { value: 'outside_business_hours', label: 'Fuera de horario hábil' },
    { value: 'weekdays_only', label: 'Solo días hábiles' }
  ];

  constructor(
    private catalogService: CatalogService,
    private escalationService: EscalationService,
    private configService: ConfigService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private fb: FormBuilder
  ) {
    this.eventForm = this.fb.group({
      name: ['', Validators.required],
      parent: [''],
      description: [''],
      motivoDefault: [''],
      enabled: [true]
    });

    this.logSourceForm = this.fb.group({
      name: ['', Validators.required],
      description: [''],
      enabled: [true]
    });

    this.operationTypeForm = this.fb.group({
      name: ['', Validators.required],
      description: [''],
      infoAdicionalDefault: [''],
      enabled: [true]
    });

    this.clientAlertRuleForm = this.fb.group({
      ruleType: ['special_alert', Validators.required],
      clientId: ['', Validators.required],
      name: [''],
      enabled: [true],
      contexts: [['report', 'copy-report']],
      timezone: ['America/Santiago'],
      priority: [100, [Validators.min(1), Validators.max(10000)]],
      mode: ['outside_business_hours'],
      startTime: ['09:00', [Validators.pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)]],
      endTime: ['17:00', [Validators.pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)]],
      daysOfWeekCsv: ['1,2,3,4,5'],
      holidayOnly: [false],
      holidayDatesCsv: [''],
      channelsText: [''],
      alertMessage: ['', [Validators.required, Validators.maxLength(4000)]],
      acknowledgementRequired: [true],
      validFromDate: [null as Date | null],
      validFromTime: ['00:00', [Validators.pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)]],
      validToDate: [null as Date | null],
      validToTime: ['23:59', [Validators.pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)]],
      blocking: [false],
      maintenanceTitle: ['']
    });

    this.clientAlertRuleForm.get('ruleType')!.valueChanges.subscribe(type => {
      this.updateClientAlertRuleValidators(type);
    });
  }

  private updateClientAlertRuleValidators(ruleType: string): void {
    const isMaint = ruleType === 'scheduled_maintenance';
    const f = this.clientAlertRuleForm;

    // Campos exclusivos de special_alert
    const specialOnlyFields = ['mode', 'contexts'];
    specialOnlyFields.forEach(field => {
      const ctrl = f.get(field);
      if (!ctrl) return;
      if (isMaint) {
        ctrl.clearValidators();
      } else {
        if (field === 'mode') ctrl.setValidators(Validators.required);
        if (field === 'contexts') ctrl.setValidators(Validators.required);
      }
      ctrl.updateValueAndValidity({ emitEvent: false });
    });

    // maintenanceTitle obligatorio solo para mantenimiento
    const titleCtrl = f.get('maintenanceTitle')!;
    titleCtrl.setValidators(isMaint ? [Validators.required, Validators.maxLength(200)] : []);
    titleCtrl.updateValueAndValidity({ emitEvent: false });

    // validFromDate/Time y validToDate/Time obligatorios solo para mantenimiento
    ['validFromDate', 'validToDate'].forEach(field => {
      const ctrl = f.get(field)!;
      ctrl.setValidators(isMaint ? Validators.required : []);
      ctrl.updateValueAndValidity({ emitEvent: false });
    });
    ['validFromTime', 'validToTime'].forEach(field => {
      const ctrl = f.get(field)!;
      ctrl.setValidators(isMaint
        ? [Validators.required, Validators.pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)]
        : [Validators.pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)]);
      ctrl.updateValueAndValidity({ emitEvent: false });
    });
  }

  ngOnInit(): void {
    this.eventSearchControl.valueChanges.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(() => {
      this.eventPage = 1;
      this.loadEvents();
    });

    this.loadAll();
  }

  loadAll(): void {
    this.loadEvents();
    this.loadLogSources();
    this.loadOperationTypes();
    this.loadClientAlertRules();
    this.loadReportTableColorConfig();
  }

  loadReportTableColorConfig(): void {
    this.configService.getConfig().subscribe({
      next: (config) => {
        this.currentEmailReportConfig = {
          ...this.currentEmailReportConfig,
          ...(config.emailReportConfig || {})
        };

        const incidentColor = this.normalizeHexColor(
          this.currentEmailReportConfig.reportTableColorByDocumentType?.incident
        );
        const legacyColor = this.normalizeHexColor(this.currentEmailReportConfig.reportTableColor);
        const reportColor = incidentColor || legacyColor
          || CatalogAdminComponent.DEFAULT_REPORT_COLOR;
        this.selectedCustomReportColor = reportColor;
        this.customReportColorInput = reportColor;
        this.reportColorMode = this.resolveReportColorMode(reportColor);
      },
      error: () => {
        this.reportColorMode = 'green';
        this.selectedCustomReportColor = CatalogAdminComponent.DEFAULT_REPORT_COLOR;
        this.customReportColorInput = CatalogAdminComponent.DEFAULT_REPORT_COLOR;
      }
    });
  }

  isReportColorTypeSelected(type: 'incident' | 'bulletin'): boolean {
    return !!this.reportColorSelection[type];
  }

  onReportColorModeChange(): void {
    if (this.reportColorMode === 'custom') {
      return;
    }
    this.selectedCustomReportColor = this.getColorForMode(this.reportColorMode);
  }

  selectCustomReportColor(color: string): void {
    const normalized = this.normalizeHexColor(color);
    if (!normalized) return;
    this.selectedCustomReportColor = normalized;
    this.customReportColorInput = normalized;
    this.reportColorMode = 'custom';
  }

  onCustomColorInputChange(input: string): void {
    this.customReportColorInput = (input || '').toUpperCase();
    const normalized = this.normalizeHexColor(input);
    if (!normalized) return;
    this.selectedCustomReportColor = normalized;
    this.reportColorMode = 'custom';
  }

  getCurrentReportColor(): string {
    if (this.reportColorMode === 'custom') {
      return this.normalizeHexColor(this.selectedCustomReportColor) || CatalogAdminComponent.DEFAULT_REPORT_COLOR;
    }
    return this.getColorForMode(this.reportColorMode);
  }

  getColorOptionLabel(mode: 'green' | 'sky' | 'light-red' | 'custom'): string {
    const labels: Record<'green' | 'sky' | 'light-red' | 'custom', string> = {
      green: 'Verde',
      sky: 'Celeste',
      'light-red': 'Rojo claro',
      custom: 'Custom'
    };
    return labels[mode];
  }

  isReportColorModeActive(mode: 'green' | 'sky' | 'light-red' | 'custom'): boolean {
    if (mode === 'custom') {
      return this.reportColorMode === 'custom';
    }
    return this.getCurrentReportColor() === this.getColorForMode(mode);
  }

  getModeOptionLabel(mode: 'green' | 'sky' | 'light-red' | 'custom'): string {
    const label = this.getColorOptionLabel(mode);
    return this.isReportColorModeActive(mode) ? `${label} (actual)` : label;
  }

  saveReportTableColorConfig(): void {
    const selectedTypes = CatalogAdminComponent.REPORT_COLOR_TYPES
      .filter((type) => this.reportColorSelection[type]);

    if (selectedTypes.length === 0) {
      this.snackBar.open('Selecciona al menos un tipo de documento', 'Cerrar', { duration: 3000 });
      return;
    }

    const resolvedColor = this.reportColorMode === 'custom'
      ? (this.normalizeHexColor(this.selectedCustomReportColor) || CatalogAdminComponent.DEFAULT_REPORT_COLOR)
      : this.getColorForMode(this.reportColorMode);

    const colorByType = {
      incident: this.normalizeHexColor(this.currentEmailReportConfig.reportTableColorByDocumentType?.incident)
        || this.normalizeHexColor(this.currentEmailReportConfig.reportTableColor)
        || CatalogAdminComponent.DEFAULT_REPORT_COLOR,
      bulletin: this.normalizeHexColor(this.currentEmailReportConfig.reportTableColorByDocumentType?.bulletin)
        || this.normalizeHexColor(this.currentEmailReportConfig.reportTableColor)
        || CatalogAdminComponent.DEFAULT_REPORT_COLOR
    };

    selectedTypes.forEach((type) => {
      colorByType[type] = resolvedColor;
    });

    const emailReportConfig: EmailReportConfig = {
      ...this.currentEmailReportConfig,
      // Compatibilidad hacia atrás para módulos que aún usan el campo legacy.
      reportTableColor: colorByType.incident,
      reportTableColorByDocumentType: colorByType
    };

    const selectedTypeLabels: Record<'incident' | 'bulletin', string> = {
      incident: 'Reporte de Incidente',
      bulletin: 'Boletín de Seguridad'
    };
    const targetsLabel = selectedTypes.map((type) => selectedTypeLabels[type]).join(', ');

    this.isSavingReportColor = true;
    this.configService.updateConfig({ emailReportConfig }).subscribe({
      next: () => {
        this.currentEmailReportConfig = emailReportConfig;
        this.selectedCustomReportColor = resolvedColor;
        this.customReportColorInput = resolvedColor;
        this.snackBar.open(`✅ Color guardado para: ${targetsLabel}`, 'Cerrar', { duration: 3000 });
        this.isSavingReportColor = false;
      },
      error: () => {
        this.snackBar.open('Error guardando color del reporte', 'Cerrar', { duration: 3000 });
        this.isSavingReportColor = false;
      }
    });
  }

  private resolveReportColorMode(color: string): 'green' | 'sky' | 'light-red' | 'custom' {
    const normalized = this.normalizeHexColor(color);
    if (!normalized) return 'green';
    if (normalized === this.getColorForMode('green')) return 'green';
    if (normalized === this.getColorForMode('sky')) return 'sky';
    if (normalized === this.getColorForMode('light-red')) return 'light-red';
    return 'custom';
  }

  private getColorForMode(mode: 'green' | 'sky' | 'light-red' | 'custom'): string {
    if (mode === 'sky') return '#29B6F6';
    if (mode === 'light-red') return '#E57373';
    return CatalogAdminComponent.DEFAULT_REPORT_COLOR;
  }

  private normalizeHexColor(color: string | undefined | null): string | null {
    if (!color) return null;
    const normalized = color.trim().toUpperCase();
    return /^#([A-F0-9]{6})$/.test(normalized) ? normalized : null;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // EVENTOS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  loadEvents(): void {
    this.isLoading = true;
    const search = this.eventSearchControl.value || '';
    this.catalogService.getAllEvents(this.eventPage, this.eventPageSize, search).subscribe({
      next: (response: any) => {
        this.events = response.items || response;
        this.eventTotal = response.total || (response.items ? response.items.length : response.length);
        this.isLoading = false;
      },
      error: () => {
        this.snackBar.open('Error cargando eventos', 'Cerrar', { duration: 3000 });
        this.isLoading = false;
      }
    });
  }

  onEventPageChange(event: PageEvent): void {
    this.eventPage = event.pageIndex + 1;
    this.eventPageSize = event.pageSize;
    this.loadEvents();
  }

  saveEvent(): void {
    if (this.eventForm.invalid) {
      this.snackBar.open('Completa los campos requeridos', 'Cerrar', { duration: 3000 });
      return;
    }

    const data = this.eventForm.value;

    if (this.editingEventId) {
      this.catalogService.updateEvent(this.editingEventId, data).subscribe({
        next: () => {
          this.snackBar.open('✅ Evento actualizado', 'Cerrar', { duration: 2000 });
          this.loadEvents();
          this.cancelEventEdit();
        },
        error: () => this.snackBar.open('Error actualizando', 'Cerrar', { duration: 3000 })
      });
    } else {
      this.catalogService.createEvent(data).subscribe({
        next: () => {
          this.snackBar.open('✅ Evento creado', 'Cerrar', { duration: 2000 });
          this.loadEvents();
          this.eventForm.reset({ enabled: true });
        },
        error: () => this.snackBar.open('Error creando', 'Cerrar', { duration: 3000 })
      });
    }
  }

  editEvent(event: CatalogEvent): void {
    this.editingEventId = event._id;
    this.eventForm.patchValue(event);
  }

  deleteEvent(id: string): void {
    if (!confirm('¿Deshabilitar este evento?')) return;

    this.catalogService.deleteEvent(id).subscribe({
      next: () => {
        this.snackBar.open('✅ Evento deshabilitado', 'Cerrar', { duration: 2000 });
        this.loadEvents();
      },
      error: () => this.snackBar.open('Error deshabilitando', 'Cerrar', { duration: 3000 })
    });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // LOG SOURCES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  loadLogSources(): void {
    this.catalogService.getAllLogSources().subscribe({
      next: (response: any) => {
        this.logSources = response.items || response;
      },
      error: () => this.snackBar.open('Error cargando log sources', 'Cerrar', { duration: 3000 })
    });
  }

  saveLogSource(): void {
    if (this.logSourceForm.invalid) return;

    const data = this.logSourceForm.value;

    if (this.editingLogSourceId) {
      this.catalogService.updateLogSource(this.editingLogSourceId, data).subscribe({
        next: () => {
          this.snackBar.open('✅ Log Source actualizado', 'Cerrar', { duration: 2000 });
          this.loadLogSources();
          this.cancelLogSourceEdit();
        },
        error: () => this.snackBar.open('Error actualizando', 'Cerrar', { duration: 3000 })
      });
    } else {
      this.catalogService.createLogSource(data).subscribe({
        next: () => {
          this.snackBar.open('✅ Log Source creado', 'Cerrar', { duration: 2000 });
          this.loadLogSources();
          this.logSourceForm.reset({ enabled: true });
        },
        error: () => this.snackBar.open('Error creando', 'Cerrar', { duration: 3000 })
      });
    }
  }

  editLogSource(source: CatalogLogSource): void {
    this.editingLogSourceId = source._id;
    this.logSourceForm.patchValue(source);
  }

  deleteLogSource(id: string): void {
    if (!confirm('⚠️ ¿ELIMINAR PERMANENTEMENTE este log source? Esta acción no se puede deshacer.')) return;

    this.catalogService.deleteLogSource(id).subscribe({
      next: () => {
        this.snackBar.open('✅ Log Source eliminado', 'Cerrar', { duration: 2000 });
        this.loadLogSources();
      },
      error: () => this.snackBar.open('Error eliminando', 'Cerrar', { duration: 3000 })
    });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // OPERATION TYPES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  loadClientAlertRules(): void {
    this.escalationService.getClientAlertRules().subscribe({
      next: (rules) => {
        this.clientAlertRules = rules;
      },
      error: () => this.snackBar.open('Error cargando reglas especiales', 'Cerrar', { duration: 3000 })
    });
  }

  saveClientAlertRule(): void {
    if (this.clientAlertRuleForm.invalid) {
      this.snackBar.open('Completa los campos requeridos de la regla', 'Cerrar', { duration: 3000 });
      return;
    }

    const payload = this.buildClientAlertRulePayload();

    if (this.editingClientAlertRuleId) {
      this.escalationService.updateClientAlertRule(this.editingClientAlertRuleId, payload).subscribe({
        next: () => {
          this.snackBar.open('Regla especial actualizada', 'Cerrar', { duration: 2000 });
          this.loadClientAlertRules();
          this.cancelClientAlertRuleEdit();
        },
        error: () => this.snackBar.open('Error actualizando regla especial', 'Cerrar', { duration: 3000 })
      });
      return;
    }

    this.escalationService.createClientAlertRule(payload).subscribe({
      next: () => {
        this.snackBar.open('Regla especial creada', 'Cerrar', { duration: 2000 });
        this.loadClientAlertRules();
        this.cancelClientAlertRuleEdit();
      },
      error: () => this.snackBar.open('Error creando regla especial', 'Cerrar', { duration: 3000 })
    });
  }

  editClientAlertRule(rule: ClientAlertRule): void {
    this.editingClientAlertRuleId = rule._id;
    const window = rule.timeWindows?.[0];
    const contexts = Array.isArray(rule.contexts) && rule.contexts.length > 0
      ? rule.contexts
      : ['report'];
    const clientId = this.extractClientId(rule.clientId);

    this.clientAlertRuleForm.patchValue({
      ruleType: rule.ruleType || 'special_alert',
      clientId,
      name: rule.name || '',
      enabled: rule.enabled,
      contexts,
      timezone: rule.timezone || 'America/Santiago',
      priority: rule.priority ?? 100,
      mode: this.getSpecialAlertModeFromRule(rule),
      startTime: window?.startTime || '09:00',
      endTime: window?.endTime || '17:00',
      daysOfWeekCsv: (window?.daysOfWeek || []).join(','),
      holidayOnly: window?.holidayOnly === true,
      holidayDatesCsv: (rule.holidayDates || []).join(','),
      channelsText: this.formatChannels(rule.channels || []),
      alertMessage: rule.alertMessage || '',
      acknowledgementRequired: rule.acknowledgementRequired !== false,
      validFromDate: this.toDateFromIso(rule.validFrom),
      validFromTime: this.toTimeFromIso(rule.validFrom),
      validToDate: this.toDateFromIso(rule.validTo),
      validToTime: this.toTimeFromIso(rule.validTo),
      blocking: rule.blocking === true,
      maintenanceTitle: rule.maintenanceTitle || ''
    });
  }

  deleteClientAlertRule(id: string): void {
    if (!confirm('¿Eliminar esta regla especial de escalamiento?')) return;

    this.escalationService.deleteClientAlertRule(id).subscribe({
      next: () => {
        this.snackBar.open('Regla especial eliminada', 'Cerrar', { duration: 2000 });
        this.loadClientAlertRules();
      },
      error: () => this.snackBar.open('Error eliminando regla especial', 'Cerrar', { duration: 3000 })
    });
  }

  cancelClientAlertRuleEdit(): void {
    this.editingClientAlertRuleId = null;
    this.clientAlertRuleForm.reset({
      ruleType: 'special_alert',
      clientId: '',
      name: '',
      enabled: true,
      contexts: ['report', 'copy-report'],
      timezone: 'America/Santiago',
      priority: 100,
      mode: 'outside_business_hours',
      startTime: '09:00',
      endTime: '17:00',
      daysOfWeekCsv: '1,2,3,4,5',
      holidayOnly: false,
      holidayDatesCsv: '',
      channelsText: '',
      alertMessage: '',
      acknowledgementRequired: true,
      validFromDate: null,
      validFromTime: '00:00',
      validToDate: null,
      validToTime: '23:59',
      blocking: false,
      maintenanceTitle: ''
    });
  }

  getClientNameForRule(rule: ClientAlertRule): string {
    const clientId = this.extractClientId(rule.clientId);
    const source = this.logSources.find((item) => item._id === clientId);
    return source?.name || 'Cliente no encontrado';
  }

  getModeLabel(mode: ClientAlertWindowMode | string | undefined): string {
    const found = this.clientAlertModes.find((item) => item.value === mode);
    return found?.label || (mode || 'N/A');
  }

  getRuleModeLabel(rule: ClientAlertRule): string {
    if (rule.ruleType === 'scheduled_maintenance') {
      return 'Ventana programada';
    }
    return this.getModeLabel(this.getSpecialAlertModeFromRule(rule));
  }

  getRuleTypeLabel(ruleType?: string): string {
    return ruleType === 'scheduled_maintenance' ? 'Mantenimiento' : 'Alerta Especial';
  }

  isMaintenance(ruleType?: string): boolean {
    return ruleType === 'scheduled_maintenance';
  }

  private buildClientAlertRulePayload(): ClientAlertRuleFormData {
    const value = this.clientAlertRuleForm.getRawValue();
    const validFrom = this.combineDateAndTime(value.validFromDate, value.validFromTime);
    const validTo = this.combineDateAndTime(value.validToDate, value.validToTime);

    const ruleType: ClientAlertRuleType = value.ruleType === 'scheduled_maintenance'
      ? 'scheduled_maintenance'
      : 'special_alert';
    const isMaintenance = ruleType === 'scheduled_maintenance';

    if (isMaintenance) {
      return {
        ruleType,
        clientId: value.clientId,
        name: (value.maintenanceTitle || '').trim(),
        enabled: value.enabled !== false,
        contexts: ['report', 'copy-report'],
        timezone: 'America/Santiago',
        priority: 100,
        validFrom,
        validTo,
        holidayDates: [],
        timeWindows: [],
        channels: [],
        alertMessage: (value.alertMessage || '').trim(),
        acknowledgementRequired: value.acknowledgementRequired !== false,
        blocking: value.blocking === true,
        maintenanceTitle: (value.maintenanceTitle || '').trim()
      };
    }

    const contexts = this.normalizeContexts(value.contexts);
    const mode = (value.mode || 'outside_business_hours') as ClientAlertWindowMode;
    const timeWindows = this.buildSpecialAlertWindows(mode);

    return {
      ruleType,
      clientId: value.clientId,
      name: this.getSpecialAlertName(mode),
      enabled: value.enabled !== false,
      contexts,
      timezone: 'America/Santiago',
      priority: 100,
      validFrom: null,
      validTo: null,
      holidayDates: [],
      timeWindows,
      channels: [],
      alertMessage: (value.alertMessage || '').trim(),
      acknowledgementRequired: value.acknowledgementRequired !== false,
      blocking: false,
      maintenanceTitle: ''
    };
  }

  private getSpecialAlertModeFromRule(rule: ClientAlertRule): ClientAlertWindowMode {
    const windows = rule.timeWindows || [];
    if (windows.some((w) => w.mode === 'always')) return 'always';

    const hasBusinessHours = windows.some((w) =>
      w.mode === 'between_hours'
      && w.startTime === '09:00'
      && w.endTime === '18:00'
      && Array.isArray(w.daysOfWeek)
      && w.daysOfWeek.join(',') === '1,2,3,4,5'
    );
    if (hasBusinessHours || windows.some((w) => w.mode === 'weekdays_only')) {
      return 'weekdays_only';
    }

    return 'outside_business_hours';
  }

  private buildSpecialAlertWindows(mode: ClientAlertWindowMode): Array<{
    mode: ClientAlertWindowMode;
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
    holidayOnly: boolean;
  }> {
    if (mode === 'always') {
      return [{
        mode: 'always',
        startTime: '09:00',
        endTime: '18:00',
        daysOfWeek: [],
        holidayOnly: false
      }];
    }

    if (mode === 'weekdays_only') {
      return [{
        mode: 'between_hours',
        startTime: '09:00',
        endTime: '18:00',
        daysOfWeek: [1, 2, 3, 4, 5],
        holidayOnly: false
      }];
    }

    // Fuera de horario hábil = L-V fuera de 09:00-18:00 + fin de semana completo.
    return [
      {
        mode: 'outside_business_hours',
        startTime: '09:00',
        endTime: '18:00',
        daysOfWeek: [1, 2, 3, 4, 5],
        holidayOnly: false
      },
      {
        mode: 'weekend_only',
        startTime: '09:00',
        endTime: '18:00',
        daysOfWeek: [],
        holidayOnly: false
      }
    ];
  }

  private getSpecialAlertName(mode: ClientAlertWindowMode): string {
    if (mode === 'always') return 'Alerta especial - Siempre';
    if (mode === 'weekdays_only') return 'Alerta especial - Solo días hábiles';
    return 'Alerta especial - Fuera de horario hábil';
  }

  private normalizeContexts(contexts: unknown): ClientAlertContext[] {
    const source = Array.isArray(contexts) ? contexts : [];
    const valid = source.filter((context): context is ClientAlertContext => (
      context === 'report' || context === 'copy-report'
    ));
    return valid.length > 0 ? valid : ['report'];
  }

  private parseDaysOfWeek(value: string): number[] {
    if (!value.trim()) return [];

    const parsed = value
      .split(',')
      .map((token) => Number(token.trim()))
      .filter((num) => Number.isInteger(num) && num >= 0 && num <= 6);

    return [...new Set(parsed)];
  }

  private parseHolidayDates(value: string): string[] {
    if (!value.trim()) return [];
    return value
      .split(',')
      .map((token) => token.trim())
      .filter((token) => /^\d{4}-\d{2}-\d{2}$/.test(token));
  }

  private parseChannels(value: string): ClientAlertChannel[] {
    if (!value.trim()) return [];

    return value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line): ClientAlertChannel => {
        const [rawType, rawTarget] = line.split(':', 2).map((part) => (part || '').trim());
        const type = rawType.toLowerCase();
        if (type === 'email' || type === 'whatsapp' || type === 'telefono' || type === 'otro') {
          return { type, target: rawTarget || '' };
        }
        return { type: 'otro', target: line };
      });
  }

  private formatChannels(channels: ClientAlertChannel[]): string {
    return channels
      .map((channel) => `${channel.type}:${channel.target}`)
      .join('\n');
  }

  private toIsoOrNull(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private toDateTimeLocal(value?: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 16);
  }

  private toDateFromIso(value?: string | null): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private toTimeFromIso(value?: string | null): string {
    if (!value) return '00:00';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '00:00';
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  private combineDateAndTime(date: Date | null, time: string): string | null {
    if (!date) return null;
    const [h, m] = (time || '00:00').split(':').map(Number);
    const d = new Date(date);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  }

  private extractClientId(clientRef: unknown): string {
    if (typeof clientRef === 'string') return clientRef;
    if (clientRef && typeof clientRef === 'object' && '_id' in clientRef) {
      const ref = clientRef as { _id?: string };
      return ref._id || '';
    }
    return '';
  }

  loadOperationTypes(): void {
    this.catalogService.getAllOperationTypes().subscribe({
      next: (response: any) => {
        this.operationTypes = response.items || response;
      },
      error: () => this.snackBar.open('Error cargando tipos de operación', 'Cerrar', { duration: 3000 })
    });
  }

  saveOperationType(): void {
    if (this.operationTypeForm.invalid) return;

    const data = this.operationTypeForm.value;

    if (this.editingOperationTypeId) {
      this.catalogService.updateOperationType(this.editingOperationTypeId, data).subscribe({
        next: () => {
          this.snackBar.open('✅ Tipo de operación actualizado', 'Cerrar', { duration: 2000 });
          this.loadOperationTypes();
          this.cancelOperationTypeEdit();
        },
        error: () => this.snackBar.open('Error actualizando', 'Cerrar', { duration: 3000 })
      });
    } else {
      this.catalogService.createOperationType(data).subscribe({
        next: () => {
          this.snackBar.open('✅ Tipo de operación creado', 'Cerrar', { duration: 2000 });
          this.loadOperationTypes();
          this.operationTypeForm.reset({ enabled: true });
        },
        error: () => this.snackBar.open('Error creando', 'Cerrar', { duration: 3000 })
      });
    }
  }

  editOperationType(type: CatalogOperationType): void {
    this.editingOperationTypeId = type._id;
    this.operationTypeForm.reset({ enabled: true });
    this.operationTypeForm.patchValue(type);
  }

  deleteOperationType(id: string): void {
    if (!confirm('⚠️ ¿ELIMINAR PERMANENTEMENTE este tipo de operación? Esta acción no se puede deshacer.')) return;

    this.catalogService.deleteOperationType(id).subscribe({
      next: () => {
        this.snackBar.open('✅ Tipo de operación eliminado', 'Cerrar', { duration: 2000 });
        this.loadOperationTypes();
      },
      error: () => this.snackBar.open('Error eliminando', 'Cerrar', { duration: 3000 })
    });
  }

  disableOperationType(type: CatalogOperationType): void {
    if (!confirm('¿Deshabilitar este tipo de operación?')) return;

    this.catalogService.updateOperationType(type._id, { ...type, enabled: false }).subscribe({
      next: () => {
        this.snackBar.open('✅ Tipo de operación deshabilitado', 'Cerrar', { duration: 2000 });
        this.loadOperationTypes();
      },
      error: () => this.snackBar.open('Error deshabilitando', 'Cerrar', { duration: 3000 })
    });
  }

  cancelEventEdit(): void {
    this.editingEventId = null;
    this.eventForm.reset({ enabled: true });
  }

  cancelLogSourceEdit(): void {
    this.editingLogSourceId = null;
    this.logSourceForm.reset({ enabled: true });
  }

  cancelOperationTypeEdit(): void {
    this.editingOperationTypeId = null;
    this.operationTypeForm.reset({ enabled: true });
  }
}
