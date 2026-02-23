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
  ClientAlertChannel
} from '../../../models/escalation.model';
import { EscalationService } from '../../../services/escalation.service';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatTabGroup, MatTab } from '@angular/material/tabs';
import { MatCard, MatCardHeader, MatCardTitle, MatCardContent } from '@angular/material/card';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { NgFor, NgIf } from '@angular/common';
import { MatTable, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCellDef, MatCell, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow } from '@angular/material/table';
import { MatTooltip } from '@angular/material/tooltip';
import { MatSelect, MatOption } from '@angular/material/select';

@Component({
    selector: 'app-catalog-admin',
    templateUrl: './catalog-admin.component.html',
    styleUrls: ['./catalog-admin.component.scss'],
    imports: [MatTabGroup, MatTab, MatCard, MatCardHeader, MatCardTitle, MatCardContent, ReactiveFormsModule, MatFormField, MatLabel, MatInput, MatCheckbox, MatButton, MatIcon, NgIf, NgFor, MatTable, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCellDef, MatCell, MatIconButton, MatTooltip, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, MatSelect, MatOption]
})
export class CatalogAdminComponent implements OnInit {
  activeTabIndex = 0;

  // Listas
  events: CatalogEvent[] = [];
  logSources: CatalogLogSource[] = [];
  operationTypes: CatalogOperationType[] = [];
  clientAlertRules: ClientAlertRule[] = [];

  // Estados
  isLoading = false;
  editingEventId: string | null = null;
  editingLogSourceId: string | null = null;
  editingOperationTypeId: string | null = null;
  editingClientAlertRuleId: string | null = null;

  // Formularios
  eventForm: FormGroup;
  logSourceForm: FormGroup;
  operationTypeForm: FormGroup;
  clientAlertRuleForm: FormGroup;

  readonly clientAlertModes: Array<{ value: ClientAlertWindowMode; label: string }> = [
    { value: 'always', label: 'Siempre' },
    { value: 'outside_business_hours', label: 'Fuera de horario hábil' },
    { value: 'between_hours', label: 'Entre horarios' },
    { value: 'after_hour', label: 'Después de hora' },
    { value: 'before_hour', label: 'Antes de hora' },
    { value: 'weekend_only', label: 'Solo fin de semana' },
    { value: 'weekdays_only', label: 'Solo días hábiles' }
  ];

  constructor(
    private catalogService: CatalogService,
    private escalationService: EscalationService,
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
      clientId: ['', Validators.required],
      name: [''],
      enabled: [true],
      contexts: [['report', 'copy-report'], Validators.required],
      timezone: ['America/Santiago', Validators.required],
      priority: [100, [Validators.required, Validators.min(1), Validators.max(10000)]],
      mode: ['outside_business_hours', Validators.required],
      startTime: ['09:00', [Validators.required, Validators.pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)]],
      endTime: ['17:00', [Validators.required, Validators.pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)]],
      daysOfWeekCsv: ['1,2,3,4,5'],
      holidayOnly: [false],
      holidayDatesCsv: [''],
      channelsText: [''],
      alertMessage: ['', [Validators.required, Validators.maxLength(4000)]],
      acknowledgementRequired: [true],
      validFrom: [''],
      validTo: ['']
    });
  }

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.loadEvents();
    this.loadLogSources();
    this.loadOperationTypes();
    this.loadClientAlertRules();
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // EVENTOS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  loadEvents(): void {
    this.isLoading = true;
    this.catalogService.getAllEvents().subscribe({
      next: (response: any) => {
        this.events = response.items || response;
        this.isLoading = false;
      },
      error: () => {
        this.snackBar.open('Error cargando eventos', 'Cerrar', { duration: 3000 });
        this.isLoading = false;
      }
    });
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
      clientId,
      name: rule.name || '',
      enabled: rule.enabled,
      contexts,
      timezone: rule.timezone || 'America/Santiago',
      priority: rule.priority ?? 100,
      mode: window?.mode || 'outside_business_hours',
      startTime: window?.startTime || '09:00',
      endTime: window?.endTime || '17:00',
      daysOfWeekCsv: (window?.daysOfWeek || []).join(','),
      holidayOnly: window?.holidayOnly === true,
      holidayDatesCsv: (rule.holidayDates || []).join(','),
      channelsText: this.formatChannels(rule.channels || []),
      alertMessage: rule.alertMessage || '',
      acknowledgementRequired: rule.acknowledgementRequired !== false,
      validFrom: this.toDateTimeLocal(rule.validFrom),
      validTo: this.toDateTimeLocal(rule.validTo)
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
      validFrom: '',
      validTo: ''
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

  private buildClientAlertRulePayload(): ClientAlertRuleFormData {
    const value = this.clientAlertRuleForm.getRawValue();
    const contexts = this.normalizeContexts(value.contexts);
    const daysOfWeek = this.parseDaysOfWeek(value.daysOfWeekCsv || '');
    const holidayDates = this.parseHolidayDates(value.holidayDatesCsv || '');
    const channels = this.parseChannels(value.channelsText || '');
    const validFrom = this.toIsoOrNull(value.validFrom);
    const validTo = this.toIsoOrNull(value.validTo);

    return {
      clientId: value.clientId,
      name: (value.name || '').trim(),
      enabled: value.enabled !== false,
      contexts,
      timezone: (value.timezone || 'America/Santiago').trim(),
      priority: Number(value.priority) || 100,
      validFrom,
      validTo,
      holidayDates,
      timeWindows: [{
        mode: value.mode,
        startTime: value.startTime,
        endTime: value.endTime,
        daysOfWeek,
        holidayOnly: value.holidayOnly === true
      }],
      channels,
      alertMessage: (value.alertMessage || '').trim(),
      acknowledgementRequired: value.acknowledgementRequired !== false
    };
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
    if (!confirm('¿Deshabilitar este tipo de operación?')) return;

    this.catalogService.deleteOperationType(id).subscribe({
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
