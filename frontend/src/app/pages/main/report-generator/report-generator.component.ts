/**
 * File Purpose: frontend/src/app/pages/main/report-generator/report-generator.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import anime from 'animejs';

import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CatalogService } from '../../../services/catalog.service';
import { CatalogEvent, CatalogLogSource, CatalogOperationType } from '../../../models/catalog.model';
import { EscalationService } from '../../../services/escalation.service';
import { ClientAlertContext, ClientAlertEvaluation } from '../../../models/escalation.model';
import { DirectoryService, DirectoryContact } from '../../../services/directory.service';
import { ConfigService } from '../../../services/config.service';
import { AuthService } from '../../../services/auth.service';

import { EntityAutocompleteComponent } from '../../../components/entity-autocomplete/entity-autocomplete.component';
import { NgIf, NgFor } from '@angular/common';
import { MatFormField, MatLabel, MatError, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatDatepickerInput, MatDatepickerToggle, MatDatepicker } from '@angular/material/datepicker';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatButtonToggleGroup, MatButtonToggle } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { ClientAlertDialogComponent } from './client-alert-dialog.component';
import { environment } from '@env/environment';

/*
 * QA — generador de informes / newsletter:
 * - Dos modos (`report` | `newsletter`): validar toggles, catálogos y payload enviado al backend por modo.
 * - HTML en vista previa: pasa por DomSanitizer donde aplique; probar XSS en campos libres y referencias URL.
 * - Client alert: flujo con EscalationService + diálogo; comprobar contexto `report` vs `copy-report` y ACK.
 * - Regresión visual: animaciones (anime.js) no deben bloquear submit; probar con CPU throttling.
 */

@Component({
  selector: 'app-report-generator',
  templateUrl: './report-generator.component.html',
  styleUrls: ['./report-generator.component.scss'],
  imports: [
    ReactiveFormsModule, FormsModule,
    EntityAutocompleteComponent,
    NgIf, NgFor,
    MatFormField, MatLabel, MatInput, MatError, MatSuffix,
    MatDatepickerInput, MatDatepickerToggle, MatDatepicker,
    MatSelect, MatOption,
    MatCheckboxModule,
    MatButton, MatIconButton,
    MatButtonToggleGroup, MatButtonToggle,
    MatIcon,
    MatTooltip
  ]
})
export class ReportGeneratorComponent implements OnInit {
  // ─── Mode ───────────────────────────────────────────────────────────────
  currentMode: 'report' | 'newsletter' = 'report';

  // ─── Contextual help guide ────────────────────────────────────────────────
  guideActive = false;
  hintActiveId: string | null = null;

  /** Mapa de ayuda contextual por modo y campo. Solo transform+opacity en animaciones (skill performance). */
  private readonly helpTips: Record<'report' | 'newsletter', Record<string, string>> = {
    report: {
      'hint-tipo-operacion':   'Categoría del incidente para clasificación y métricas SOC.',
      'hint-codigo-interno':   'Identificador único del incidente en el sistema de ticketing o SIEM.',
      'hint-nombre-evento':    'Nombre del evento o alerta que originó el incidente detectado.',
      'hint-motivo-evento':    'Descripción del comportamiento que activó la alerta. Se autocompleta al elegir un evento.',
      'hint-fecha':            'Fecha del incidente (por defecto hoy). Ajusta manualmente si el evento fue previo.',
      'hint-criticidad':       'Nivel de severidad del incidente para la organización.',
      'hint-origen':           'IP o hostname de origen del ataque/actividad sospechosa.',
      'hint-logsource':        'Origen del evento: cliente, sistema o fuente de log afectada.',
      'hint-destino':          'IP o hostname de destino de la actividad detectada.',
      'hint-observaciones':    'Cronología, hechos clave y análisis técnico del incidente.',
      'hint-recomendacion':    'Pasos tomados o a tomar para contención y erradicación.',
      'hint-info-adicional':   'Contexto adicional del tipo de operación. Se autocompleta.',
    },
    newsletter: {
      'hint-nl-titulo':        'Indica un título claro y conciso para la amenaza o el parche. Si el boletín todavía puede cambiar, aún no envíes el correo.',
      'hint-nl-marca':         'El proveedor o empresa responsable (ej: Microsoft, Cisco, VMware).',
      'hint-nl-criticidad':    'Gravedad de la vulnerabilidad según el estándar CVSS. Úsala cuando el contenido ya esté confirmado.',
      'hint-nl-cve':           'Incluye los códigos estándar (ej: CVE-2024-XXXXX). Campo opcional.',
      'hint-nl-productos':     'Software o hardware específicos y sus versiones vulnerables.',
      'hint-nl-impacto':       'Qué puede ocurrir si se explota la vulnerabilidad (ej: Control total, robo de datos). Esto ayuda a decidir cuándo cerrar el envío.',
      'hint-nl-recomendacion': 'Pasos concretos a seguir o mitigaciones de seguridad. Cuando esto esté completo, el boletín ya puede enviarse.',
      'hint-nl-referencias':   'Links oficiales al parche o análisis. Campo opcional. Revíselos antes de enviar el correo.',
      'hint-nl-send-para':     'Aquí van los destinatarios finales. Úsalo cuando el boletín ya esté revisado y listo para salir.',
      'hint-nl-send-cc':       'Aquí agrega copias internas de control o seguimiento. No reemplaza el campo Para.',
      'hint-nl-saved-contacts':'En este panel agregas destinatarios rápido: + Para envía el boletín al contacto y + CC lo agrega como copia interna. Usa Buscar/Empresa y + Todos al Para para armar la lista.',
      'hint-nl-send-action':   'Envía solo cuando contenido y destinatarios estén confirmados: el sistema despacha 1 correo por cada destinatario del Para.',
    },
  };

  // ─── Forms ──────────────────────────────────────────────────────────────
  reportForm: FormGroup;
  newsletterForm: FormGroup;

  // ─── Catalog selections ──────────────────────────────────────────────────
  selectedEvent: CatalogEvent | null = null;
  selectedLogSource: CatalogLogSource | null = null;
  selectedOperationType: CatalogOperationType | null = null;

  // ─── Report state ────────────────────────────────────────────────────────
  uploadedImages: { name: string; dataUrl: string; width: number; height: number }[] = [];
  newsletterUploadedImages: { name: string; dataUrl: string; width: number; height: number }[] = [];
  generatedHtml = '';
  safeGeneratedHtml: SafeHtml | null = null;
  showPreview = false;
  reportTableHeaderColor = '#4CAF50';
  reportTableColorsByType: Record<'incident' | 'bulletin', string> = {
    incident: '#4CAF50',
    bulletin: '#4CAF50'
  };

  // ─── Branding ────────────────────────────────────────────────────────────
  logoBase64: string | null = null;
  appTitle = '';

  // ─── Newsletter email dispatch ────────────────────────────────────────────
  newsletterRecipients = '';
  newsletterCcRecipients = '';
  isSendingNewsletter = false;
  newsletterContacts: DirectoryContact[] = [];
  newsletterContactSearch = '';
  newsletterCompanyFilter = '';
  newsletterFavoritesOnly = false;

  // ─── Incident email dispatch ──────────────────────────────────────────────
  incidentRecipientsTo = '';
  incidentRecipientsCc = '';
  incidentSubject = '';
  isSendingIncident = false;
  
  incidentContactSearch = '';
  incidentCompanyFilter = '';
  incidentFavoritesOnly = false;
  
  // Modos de selección de destinatarios para incidentes ('to' o 'cc')
  activeIncidentSelectorMode: 'to' | 'cc' = 'to';
  
  private readonly selectedIncidentContactIdsTo = new Set<string>();
  incidentSelectedMailingListsTo = new Set<string>();

  private readonly selectedIncidentContactIdsCc = new Set<string>();
  incidentSelectedMailingListsCc = new Set<string>();

  // ─── Client alert ────────────────────────────────────────────────────────
  activeClientAlert: ClientAlertEvaluation | null = null;
  isEvaluatingClientAlert = false;
  private readonly acknowledgedRuleIds = new Set<string>();

  /** ESC-MAINT-042: true cuando la alerta activa es un mantenimiento bloqueante */
  get isMaintenanceBlocking(): boolean {
    const rule = this.activeClientAlert?.rule;
    return !!(rule && rule.ruleType === 'scheduled_maintenance' && rule.blocking);
  }

  // ─── Config ──────────────────────────────────────────────────────────────
  private readonly backendBaseUrl = environment.backendBaseUrl;

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    public catalogService: CatalogService,
    private configService: ConfigService,
    private snackBar: MatSnackBar,
    private escalationService: EscalationService,
    private directoryService: DirectoryService,
    private dialog: MatDialog,
    private authService: AuthService,
    private sanitizer: DomSanitizer
  ) {
    this.reportForm = this.fb.group({
      codigoTicket: ['', Validators.required],
      ofensa: ['', Validators.required],
      tipoOperacion: ['', Validators.required],
      nombreEvento: ['', Validators.required],
      motivoEvento: [''], // Ya no es obligatorio
      fecha: [new Date(), Validators.required],
      criticidad: ['media'], // Ya no es obligatorio
      origenConexion: [''],
      destino: [''],
      logSource: [''], // Ya no es obligatorio
      reputacionOrigen: ['Interna'],
      observaciones: ['', Validators.required],
      evidenciaTexto: [''],
      recomendacion: [''],
      informacionAdicional: ['']
    });

    this.newsletterForm = this.fb.group({
      tituloBoletin: ['', Validators.required],
      marcaFabricante: ['', Validators.required],
      criticidad: ['media', Validators.required],
      cveIdentificadores: [''],
      productosAfectados: ['', Validators.required],
      impacto: ['', Validators.required],
      recomendacion: ['', Validators.required],
      referencias: ['']
    });
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.loadReportTableColorConfig();
    this.loadLogo();
    this.loadNewsletterContacts();
  }

  // ─── Contextual guide toggle ──────────────────────────────────────────────
  /**
   * Toggle de globos de ayuda contextual. Usa anime.js animando SOLO transform+opacity
   * para garantizar hardware acceleration sin layout recalculations (skill: Frontend.md §5).
   */
  /**
   * Toggle de modo de guía. Si se desactiva, se limpia el hint activo.
   */
  toggleGuide(): void {
    this.guideActive = !this.guideActive;
    if (!this.guideActive) {
      this.hintActiveId = null;
    }
  }

  /**
   * Se dispara cuando un campo (input, select, autocomplete) recibe foco.
   */
  handleFieldFocus(id: string): void {
    if (!this.guideActive) return;
    this.hintActiveId = id;

    // Pequeño delay para asegurar que el DOM se renderizó vía *ngIf
    setTimeout(() => {
      this.animateHintEnter();
    }, 10);
  }

  /**
   * Se dispara cuando un campo pierde el foco.
   */
  handleFieldBlur(): void {
    this.hintActiveId = null;
  }

  /**
   * Animación premium (hardware accelerated) para el globo activo.
   * Utiliza solo transform y opacity para máximo performance.
   */
  private animateHintEnter(): void {
    const bubble = document.querySelector('.help-bubble');
    if (!bubble) return;

    anime({
      targets: bubble,
      opacity: [0, 1],
      translateY: [10, 0], // Sutil deslizamiento hacia arriba
      scale: [0.95, 1],
      duration: 400,
      easing: 'easeOutQuint'
    });
  }

  /** Devuelve el texto de ayuda para un campo dado el modo activo. */
  getHint(fieldId: string): string | null {
    return this.helpTips[this.currentMode]?.[fieldId] ?? null;
  }

  // ─── Branding: load logo ─────────────────────────────────────────────────
  private loadLogo(): void {
    this.configService.getLogo().subscribe({
      next: (res) => {
        if (res.logoUrl) {
          const url = this.getAssetUrl(res.logoUrl);
          this.convertImageUrlToBase64(url, 256)
            .then(base64 => { this.logoBase64 = base64; })
            .catch(() => { this.logoBase64 = url; });
        }
      },
      error: () => {}
    });
  }

  private getAssetUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${this.backendBaseUrl}${url}`;
  }

  private convertImageUrlToBase64(url: string, maxHeight = 120): Promise<string> {
    return fetch(url)
      .then(r => r.blob())
      .then(blob => new Promise<string>((resolve, reject) => {
        const img = new Image();
        const objUrl = URL.createObjectURL(blob);
        img.onload = () => {
          // Redimensionar proporcionalmente para mantener el peso del email razonable
          const scale = img.naturalHeight > maxHeight ? maxHeight / img.naturalHeight : 1;
          const w = Math.round(img.naturalWidth * scale);
          const h = Math.round(img.naturalHeight * scale);

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, w, h);

          URL.revokeObjectURL(objUrl);
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('No se pudo cargar el logo')); };
        img.src = objUrl;
      }));
  }

  // ─── Catalog autocomplete callbacks ──────────────────────────────────────
  onEventSelected(event: any): void {
    this.selectedEvent = event as CatalogEvent;
    if (event) {
      this.reportForm.patchValue({
        nombreEvento: event.name,
        motivoEvento: event.motivoDefault || ''
      });
    }
  }

  onEventTextChanged(text: string): void {
    if (!this.selectedEvent || this.selectedEvent.name !== text) {
      this.selectedEvent = null;
      this.reportForm.patchValue({ nombreEvento: text, motivoEvento: '' });
    }
  }

  onEventCleared(): void {
    this.selectedEvent = null;
    this.reportForm.patchValue({ nombreEvento: '', motivoEvento: '' });
  }

  onLogSourceSelected(source: any): void {
    this.selectedLogSource = source as CatalogLogSource;
    if (source) {
      this.reportForm.patchValue({ logSource: source.name });
      void this.refreshClientAlert('report', true);
    }
  }

  onLogSourceCleared(): void {
    this.selectedLogSource = null;
    this.reportForm.patchValue({ logSource: '' });
    this.activeClientAlert = null;
  }

  onOperationTypeSelected(type: any): void {
    this.selectedOperationType = type as CatalogOperationType;
    if (type) {
      this.reportForm.patchValue({
        tipoOperacion: type.name,
        informacionAdicional: type.infoAdicionalDefault || ''
      });
    }
  }

  onOperationTypeCleared(): void {
    this.selectedOperationType = null;
    this.reportForm.patchValue({ tipoOperacion: '', informacionAdicional: '' });
  }

  // ─── Image upload ─────────────────────────────────────────────────────────
  onImageUpload(event: any): void {
    const files = event.target.files;
    if (!files) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const dataUrl = String(e?.target?.result || '');
        if (!dataUrl) return;

        const img = new Image();
        img.onload = () => {
          this.uploadedImages.push({ name: file.name, dataUrl, width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
        };
        img.onerror = () => {
          this.uploadedImages.push({ name: file.name, dataUrl, width: 0, height: 0 });
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    }
  }

  removeImage(index: number): void {
    this.uploadedImages.splice(index, 1);
  }

  onNewsletterImageUpload(event: any): void {
    const files = Array.from(event.target.files || []) as File[];
    if (files.length === 0) return;
    
    files.forEach(file => {
      // Validar tipo de archivo
      if (!file.type.startsWith('image/')) {
        this.snackBar.open(`"${file.name}" no es una imagen válida`, 'Cerrar', { duration: 3000 });
        return;
      }
      
      // Validar tamaño (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        this.snackBar.open(`"${file.name}" supera el límite de 5MB`, 'Cerrar', { duration: 3000 });
        return;
      }
      
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const img = new Image();
        img.onload = () => {
          // Redimensionar para emails - detectar imágenes panorámicas (tablas, capturas anchas)
          let width = img.naturalWidth || img.width;
          let height = img.naturalHeight || img.height;
          const aspectRatio = width / height;
          
          // Para imágenes panorámicas (tablas, gráficos anchos), permitir mayor resolución
          let maxWidth: number;
          let maxHeight: number;
          if (aspectRatio > 1.4) {
            // Imagen panorámica - permitir hasta 2400px para preservar detalle horizontal
            maxWidth = 2400;
            maxHeight = 1600;
          } else {
            // Imagen cuadrada/vertical - límite estándar
            maxWidth = 1600;
            maxHeight = 1600;
          }
          
          // Calcular nuevas dimensiones manteniendo aspect ratio
          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }
          
          // Crear canvas y redimensionar
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            this.snackBar.open(`Error al procesar "${file.name}"`, 'Cerrar', { duration: 3000 });
            return;
          }
          
          // Dibujar imagen redimensionada
          ctx.drawImage(img, 0, 0, width, height);
          
          // Detectar formato original para preservar calidad
          // PNG es mejor para capturas con texto, JPEG para fotos
          let dataUrl: string;
          if (file.type === 'image/png') {
            // Mantener PNG para capturas de pantalla (mejor para texto)
            dataUrl = canvas.toDataURL('image/png');
          } else {
            // JPEG con alta calidad (95%) para otros formatos
            dataUrl = canvas.toDataURL('image/jpeg', 0.95);
          }
          
          this.newsletterUploadedImages.push({ 
            name: file.name, 
            dataUrl, 
            width, 
            height 
          });
        };
        img.onerror = () => {
          this.snackBar.open(`Error al cargar "${file.name}"`, 'Cerrar', { duration: 3000 });
        };
        img.src = e.target.result;
      };
      reader.onerror = () => {
        this.snackBar.open(`Error al leer "${file.name}"`, 'Cerrar', { duration: 3000 });
      };
      reader.readAsDataURL(file);
    });
    
    // Limpiar el input para permitir subir el mismo archivo nuevamente
    event.target.value = '';
  }

  removeNewsletterImage(index: number): void {
    this.newsletterUploadedImages.splice(index, 1);
  }

  // ─── Generate ────────────────────────────────────────────────────────────
  async generateTable(): Promise<void> {
    await this.refreshReportTableColorConfig();

    if (this.currentMode === 'report') {
      if (this.reportForm.invalid) {
        this.reportForm.markAllAsTouched();
        this.snackBar.open('Completa todos los campos obligatorios del reporte', 'Cerrar', { duration: 3000 });
        return;
      }
      await this.buildReportHtml();
    } else {
      if (this.newsletterForm.invalid) {
        this.newsletterForm.markAllAsTouched();
        this.snackBar.open('Completa todos los campos obligatorios del boletín', 'Cerrar', { duration: 3000 });
        return;
      }
      this.buildNewsletterHtml();
    }
  }

  // ─── Newsletter: saved recipients + send by email (1:1) ──────────────────
  get newsletterCompanyOptions(): string[] {
    const companies = new Set(
      this.newsletterContacts
        .map((contact) => String(contact.company || '').trim())
        .filter((value) => value.length > 0)
    );
    return Array.from(companies).sort((a, b) => a.localeCompare(b));
  }

  get filteredNewsletterContacts(): DirectoryContact[] {
    const term = this.newsletterContactSearch.trim().toLowerCase();
    return [...this.newsletterContacts]
      .filter((contact) => contact.type !== 'List')
      .filter((contact) => {
        const matchesTerm = !term || [contact.name, contact.email, contact.company]
          .some((value) => String(value || '').toLowerCase().includes(term));
        const matchesCompany = !this.newsletterCompanyFilter || contact.company === this.newsletterCompanyFilter;
        const matchesFavorite = !this.newsletterFavoritesOnly || !!contact.isFavorite;
        return matchesTerm && matchesCompany && matchesFavorite;
      })
      .sort((a, b) => Number(!!b.isFavorite) - Number(!!a.isFavorite) || String(a.company || '').localeCompare(String(b.company || '')) || String(a.name || '').localeCompare(String(b.name || '')));
  }

  get mailingListContacts(): DirectoryContact[] {
    return this.newsletterContacts.filter(contact => contact.type === 'List');
  }

  isEmailInField(email: string | null | undefined, field: 'to' | 'cc'): boolean {
    if (!email) return false;
    const lower = email.trim().toLowerCase();
    const list = field === 'to' ? this.parseManualNewsletterRecipients() : this.parseCcNewsletterRecipients();
    return list.some(e => e.toLowerCase() === lower);
  }

  private addEmailToField(email: string, field: 'to' | 'cc'): void {
    if (!email || !this.isValidNewsletterEmail(email)) return;
    if (this.isEmailInField(email, field)) return;
    const trimmed = email.trim();
    if (field === 'to') {
      this.newsletterRecipients = this.newsletterRecipients
        ? this.newsletterRecipients.trimEnd() + '\n' + trimmed
        : trimmed;
    } else {
      this.newsletterCcRecipients = this.newsletterCcRecipients
        ? this.newsletterCcRecipients.trimEnd() + '\n' + trimmed
        : trimmed;
    }
  }

  private removeEmailFromField(email: string, field: 'to' | 'cc'): void {
    if (!email) return;
    const lower = email.trim().toLowerCase();
    if (field === 'to') {
      this.newsletterRecipients = this.parseManualNewsletterRecipients()
        .filter(e => e.toLowerCase() !== lower).join('\n');
    } else {
      this.newsletterCcRecipients = this.parseCcNewsletterRecipients()
        .filter(e => e.toLowerCase() !== lower).join('\n');
    }
  }

  toggleEmailInField(email: string | null | undefined, field: 'to' | 'cc'): void {
    if (!email || !this.isValidNewsletterEmail(email)) return;
    if (this.isEmailInField(email, field)) {
      this.removeEmailFromField(email, field);
    } else {
      this.addEmailToField(email, field);
    }
  }

  get newsletterSelectedCount(): number {
    return this.newsletterRecipientSummary.validRecipients.length;
  }

  get newsletterRecipientSummary(): {
    validRecipients: string[];
    invalidRecipients: string[];
    duplicateRecipients: string[];
    blockedRecipients: string[];
  } {
    const validRecipients: string[] = [];
    const invalidRecipients: string[] = [];
    const duplicateRecipients: string[] = [];
    const seen = new Set<string>();

    this.parseManualNewsletterRecipients().forEach((entry) => {
      const email = String(entry || '').trim().toLowerCase();
      if (!this.isValidNewsletterEmail(email)) {
        invalidRecipients.push(entry);
        return;
      }
      if (seen.has(email)) {
        duplicateRecipients.push(email);
        return;
      }
      seen.add(email);
      validRecipients.push(email);
    });

    return {
      validRecipients,
      invalidRecipients: Array.from(new Set(invalidRecipients)),
      duplicateRecipients: Array.from(new Set(duplicateRecipients)),
      blockedRecipients: []
    };
  }

  private loadNewsletterContacts(): void {
    this.directoryService.getAll().subscribe({
      next: (contacts) => { this.newsletterContacts = [...contacts]; },
      error: () => { this.newsletterContacts = []; }
    });
  }

  selectAllNewsletterContacts(): void {
    this.filteredNewsletterContacts.forEach((contact) => {
      if (contact.email && this.isValidNewsletterEmail(contact.email)) {
        this.addEmailToField(contact.email, 'to');
      }
    });
  }

  selectAllMailingLists(): void {
    this.mailingListContacts.forEach((contact) => {
      if (contact.email && this.isValidNewsletterEmail(contact.email)) {
        this.addEmailToField(contact.email, 'to');
      }
    });
  }

  clearNewsletterSelection(): void {
    this.newsletterRecipients = '';
  }

  isValidNewsletterEmail(email?: string | null): boolean {
    const value = String(email || '').trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  }

  private parseManualNewsletterRecipients(): string[] {
    return String(this.newsletterRecipients || '')
      .split(/[;,\n]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  private parseCcNewsletterRecipients(): string[] {
    return String(this.newsletterCcRecipients || '')
      .split(/[;,\n]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  get newsletterCcSummary(): { valid: string[]; invalid: string[] } {
    const valid: string[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();
    this.parseCcNewsletterRecipients().forEach((entry) => {
      const email = entry.trim().toLowerCase();
      if (!this.isValidNewsletterEmail(email)) {
        invalid.push(entry);
      } else if (!seen.has(email)) {
        seen.add(email);
        valid.push(email);
      }
    });
    return { valid, invalid };
  }

  sendNewsletter(): void {
    if (!this.generatedHtml) {
      this.snackBar.open('Primero genera el boletín', 'Cerrar', { duration: 3000 });
      return;
    }

    const newsletterValidation = this.validateGeneratedNewsletterHtml(this.generatedHtml);
    if (!newsletterValidation.ok) {
      console.warn('[newsletter/send][precheck] validation_failed', newsletterValidation.issues);
      this.snackBar.open(
        `Boletín no válido para envío: ${newsletterValidation.issues[0] || 'revisa logo/colores.'}`,
        'Cerrar',
        { duration: 8000 }
      );
      return;
    }

    const recipientSummary = this.newsletterRecipientSummary;
    if (recipientSummary.validRecipients.length === 0) {
      this.snackBar.open('No hay destinatarios válidos para procesar', 'Cerrar', { duration: 4000 });
      return;
    }

    this.isSendingNewsletter = true;
    const subject = this.newsletterForm.value.tituloBoletin || 'Boletín de Seguridad';
    const ccValid = this.newsletterCcSummary.valid;

    this.http.post(`${this.backendBaseUrl}/api/reports/newsletter/send`, {
      recipients: recipientSummary.validRecipients,
      cc: ccValid,
      subject,
      html: this.generatedHtml,
      analytics: {
        criticality: this.newsletterForm.value.criticidad,
        title: this.newsletterForm.value.tituloBoletin,
        vendor: this.newsletterForm.value.marcaFabricante
      }
    }).subscribe({
      next: (res: any) => {
        this.isSendingNewsletter = false;
        const ccPart = res.ccCount > 0 ? ` + ${res.ccCount} en CC` : '';
        const msg = res.failCount > 0
          ? `Boletín enviado a ${res.successCount} destinatarios${ccPart} (${res.failCount} fallidos)`
          : `Boletín enviado a ${res.successCount} destinatario(s)${ccPart}`;
        this.snackBar.open(msg, 'Cerrar', { duration: 5000 });

        if (res.successCount > 0) {
          // Limpiar destinatarios
          this.newsletterRecipients = '';
          this.newsletterCcRecipients = '';
          this.clearNewsletterSelection();
          
          // Limpiar imágenes cargadas (liberan memoria base64)
          this.newsletterUploadedImages = [];
          
          // Limpiar preview y HTML generado para forzar regeneración
          this.generatedHtml = '';
          this.showPreview = false;
          
          this.loadNewsletterContacts();
        }
      },
      error: (err) => {
        this.isSendingNewsletter = false;
        const detail = err?.error?.detail || err?.error?.message || 'Revisa la configuración SMTP en Admin.';
        this.snackBar.open(`Error al enviar: ${detail}`, 'Cerrar', { duration: 8000 });
      }
    });
  }

  onNewsletterTextareaPaste(event: ClipboardEvent, controlName: 'productosAfectados' | 'impacto' | 'recomendacion' | 'referencias' | 'cveIdentificadores'): void {
    const clipboard = event.clipboardData;
    if (!clipboard) return;

    const html = clipboard.getData('text/html');
    const plain = clipboard.getData('text/plain');
    const normalized = this.normalizePastedNewsletterText(html, plain);
    if (!normalized) return;

    event.preventDefault();

    const control = this.newsletterForm.get(controlName);
    const target = event.target as HTMLTextAreaElement | null;
    if (!control || !target) return;

    const current = String(control.value || '');
    const start = target.selectionStart ?? current.length;
    const end = target.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${normalized}${current.slice(end)}`;

    control.setValue(next);
    control.markAsDirty();
    control.markAsTouched();
  }

  private normalizePastedNewsletterText(html: string, plain: string): string {
    const textFromHtml = this.extractTextFromClipboardHtml(html);
    const base = textFromHtml || String(plain || '');

    const normalizedBase = base
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();

    return this.applyNewsletterPasteHeuristics(normalizedBase);
  }

  private applyNewsletterPasteHeuristics(input: string): string {
    if (!input) return '';

    // Extraer URLs para protegerlas de las transformaciones
    const urlPattern = /(https?:\/\/[^\s]+)/gi;
    const urls: string[] = [];
    let text = input.replace(urlPattern, (match) => {
      const placeholder = `__URL_PLACEHOLDER_${urls.length}__`;
      urls.push(match);
      return placeholder;
    });

    // Reparar texto corrido: "VulnerabilidadID", "53770Severidad", "ProductoRango", etc.
    text = text
      .replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, '$1 $2')
      .replace(/([0-9])([A-Za-zÁÉÍÓÚÑáéíóúñ])/g, '$1 $2')
      .replace(/([A-Za-zÁÉÍÓÚÑáéíóúñ])([0-9])/g, '$1 $2');

    // Asegurar saltos antes de etiquetas semánticas (acepta variaciones de espacios).
    const semanticLabelRegexes = [
      /Resumen\s*de\s*Vulnerabilidad\s*:?/gi,
      /ID\s*:?\s*CVE-\d{4}-\d+/gi,
      /Severidad\s*\(CVSS\)\s*:?/gi,
      /Impacto\s*:?/gi,
      /Alcance\s*de\s*Versiones\s*:?/gi,
      /Producto\s*:?/gi,
      /Rango\s*de\s*Versiones\s*Vulnerables\s*:?/gi
    ];
    semanticLabelRegexes.forEach((labelRegex) => {
      text = text.replace(labelRegex, (match, offset, whole) => {
        const prev = offset > 0 ? whole[offset - 1] : '';
        return prev && prev !== '\n' ? `\n${match}` : match;
      });
    });

    // Encabezado de tabla "Producto | Rango ..."
    text = text.replace(
      /(Producto)\s*(Rango\s+de\s+Versiones\s+Vulnerables)/gi,
      '$1 | $2'
    );

    // Filas: "<producto> <version-inicio - version-fin>" -> "<producto> | <rango>"
    text = text.replace(
      /([A-Za-zÁÉÍÓÚÑáéíóúñ0-9][A-Za-zÁÉÍÓÚÑáéíóúñ0-9 .\-()]{2,}?)\s+(\d+\.\d+(?:\.\d+){1,4}\s*[—-]\s*\d+\.\d+(?:\.\d+){1,4})/g,
      '$1 | $2'
    );

    // Restaurar URLs preservadas
    text = text.replace(/__URL_PLACEHOLDER_(\d+)__/g, (match, index) => {
      return urls[parseInt(index, 10)] || match;
    });

    return text
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private concatPreservingWordBoundaries(current: string, next: string): string {
    if (!current) return next;
    if (!next) return current;

    const left = current[current.length - 1];
    const right = next[0];
    const needsSpace = /[A-Za-zÁÉÍÓÚÑáéíóúñ0-9)]/.test(left) && /[A-Za-zÁÉÍÓÚÑáéíóúñ0-9(]/.test(right);
    return needsSpace ? `${current} ${next}` : `${current}${next}`;
  }

  private extractTextFromClipboardHtml(html: string): string {
    const raw = String(html || '').trim();
    if (!raw) return '';

    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const blocked = doc.querySelectorAll('script,style,noscript');
    blocked.forEach(node => node.remove());

    const walk = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent || '';
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        return '';
      }

      const element = node as HTMLElement;
      const tag = element.tagName.toLowerCase();

      if (tag === 'br') return '\n';

      if (tag === 'tr') {
        const cells = Array.from(element.querySelectorAll(':scope > th, :scope > td'))
          .map(cell => walk(cell).replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        return cells.length ? `${cells.join(' | ')}\n` : '';
      }

      let content = '';
      element.childNodes.forEach(child => {
        content = this.concatPreservingWordBoundaries(content, walk(child));
      });

      if (tag === 'li') {
        const cleaned = content.replace(/\s+/g, ' ').trim();
        return cleaned ? `• ${cleaned}\n` : '';
      }

      if (['p', 'div', 'section', 'article', 'blockquote', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
        const cleaned = content.trim();
        return cleaned ? `${cleaned}\n\n` : '';
      }

      return content;
    };

    let output = '';
    doc.body.childNodes.forEach(node => { output += walk(node); });
    return output;
  }

  private validateGeneratedNewsletterHtml(html: string): { ok: boolean; issues: string[] } {
    const raw = String(html || '');
    const issues: string[] = [];

    // 1) Debe existir logo con src no vacío/no placeholder.
    const imgMatch = raw.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
    const src = imgMatch?.[1]?.trim() || '';
    if (!src) {
      issues.push('Logo ausente en encabezado.');
    } else {
      const invalidSrc = /^(x|about:blank|#)$/i.test(src);
      if (invalidSrc) issues.push('Logo inválido (src placeholder).');
      if (/^data:image\//i.test(src) && src.length < 200) {
        issues.push('Logo data URI demasiado corto, posible imagen corrupta.');
      }
    }

    // 2) Encabezado y secciones deben ir en negro (evita regresión visual).
    if (!/Bolet[íi]n de Seguridad/i.test(raw)) {
      issues.push('Título principal no detectado.');
    }
    if (!/color:\s*#111111/i.test(raw)) {
      issues.push('No se detecta color negro explícito (#111111) en el HTML.');
    }

    // Secciones de contenido obligatorio
    if (!/Producto\(s\) Afectado\(s\)/i.test(raw)) {
      issues.push('Sección "Productos Afectados" ausente.');
    }
    if (!/Impacto/i.test(raw)) {
      issues.push('Sección "Impacto" ausente.');
    }
    if (!/Acciones Recomendadas/i.test(raw)) {
      issues.push('Sección "Acciones Recomendadas" ausente.');
    }

    return { ok: issues.length === 0, issues };
  }

  // ─── Clipboard ───────────────────────────────────────────────────────────
  async copyToClipboard(): Promise<void> {
    if (!this.generatedHtml) {
      this.snackBar.open('Primero genera la tabla', 'Cerrar', { duration: 3000 });
      return;
    }

    const canContinue = await this.ensureClientAlertAcknowledged('copy-report');
    if (!canContinue) return;

    const html = this.generatedHtml;
    const plainText = this.getPlainTextFromHtml(html);
    const clipboardItem = (window as any).ClipboardItem;

    if (navigator?.clipboard && clipboardItem && navigator.clipboard.write) {
      const item = new clipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' })
      });
      try {
        await navigator.clipboard.write([item]);
        this.snackBar.open('✅ Tabla copiada con formato', 'Cerrar', { duration: 2000 });
        return;
      } catch { /* fallthrough */ }
    }

    if (this.copyHtmlWithExecCommand(html)) {
      this.snackBar.open('Tabla copiada con formato', 'Cerrar', { duration: 2000 });
      return;
    }

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(plainText)
        .then(() => this.snackBar.open('Tabla copiada como texto', 'Cerrar', { duration: 2000 }))
        .catch(() => this.snackBar.open('Error al copiar. Selecciona y copia manualmente.', 'Cerrar', { duration: 3000 }));
      return;
    }

    if (this.copyTextWithExecCommand(plainText)) {
      this.snackBar.open('Tabla copiada como texto', 'Cerrar', { duration: 2000 });
      return;
    }

    this.snackBar.open('Error al copiar. Selecciona y copia manualmente.', 'Cerrar', { duration: 3000 });
  }

  async copyMarkdown(): Promise<void> {
    if (!this.generatedHtml) {
      this.snackBar.open('Primero genera la tabla', 'Cerrar', { duration: 3000 });
      return;
    }

    const canContinue = await this.ensureClientAlertAcknowledged('copy-report');
    if (!canContinue) return;

    const markdown = this.getMarkdownFromHtml(this.generatedHtml);

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(markdown)
        .then(() => this.snackBar.open('✅ Markdown copiado', 'Cerrar', { duration: 2000 }))
        .catch(() => this.snackBar.open('Error al copiar Markdown.', 'Cerrar', { duration: 3000 }));
      return;
    }

    if (this.copyTextWithExecCommand(markdown)) {
      this.snackBar.open('Markdown copiado', 'Cerrar', { duration: 2000 });
      return;
    }

    this.snackBar.open('Error al copiar Markdown.', 'Cerrar', { duration: 3000 });
  }

  // ─── Formatting helpers ──────────────────────────────────────────────────
  private formatMultilineText(value: unknown): string {
    const escaped = this.escapeHtml(value);
    return escaped.replace(/\n/g, '<br>');
  }

  /** UI-NEWS-041: Renderiza CVE/IDs uno por línea, separando por comas, puntos y coma o saltos. */
  private formatCveList(value: unknown): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    return raw
      .split(/[,;\n\r]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(cve => `<span style="font-family:monospace;">${this.escapeHtml(cve)}</span>`)
      .join('<br>');
  }

  /**
   * UI-NEWS-042: Formatea texto multilinea para email-safe HTML.
   * Convierte saltos de línea, viñetas e indentación a divs con estilos inline
   * porque white-space:pre-wrap no es consistente en clientes de correo.
   */
  private formatNewsletterText(value: unknown): string {
    const lines = String(value ?? '').split('\n');
    return lines.map(line => {
      if (!line.trim()) {
        return '<br>';
      }
      // Línea con viñeta: espacios opcionales + (- * • ·) + espacio + contenido
      const bulletMatch = line.match(/^( {0,4})([-•*·])[ \t]+(.*)$/);
      if (bulletMatch) {
        const depth = bulletMatch[1].length;
        const paddingLeft = 16 + depth * 8;
        const content = this.escapeHtml(bulletMatch[3]);
        return `<div style="padding-left:${paddingLeft}px; text-indent:-12px; margin:1px 0;">&#8226;&nbsp;${content}</div>`;
      }
      // Línea con indentación (sin viñeta)
      const indentMatch = line.match(/^( {2,}|\t+)(.*)/);
      if (indentMatch) {
        const depth = Math.min(indentMatch[1].replace(/\t/g, '    ').length, 8);
        const paddingLeft = depth * 6;
        const content = this.escapeHtml(indentMatch[2]);
        return `<div style="padding-left:${paddingLeft}px; margin:1px 0;">${content}</div>`;
      }
      // Línea normal
      return `<div style="margin:1px 0;">${this.escapeHtml(line)}</div>`;
    }).join('');
  }

  private formatNewsletterReferences(value: unknown): string {
    const text = String(value ?? '').trim();
    if (!text) return '';
    
    // Unir todo el texto en una sola línea para evitar que URLs se rompan
    const singleLine = text.replace(/\s+/g, ' ');
    
    // Detectar URLs y convertirlas en links clicables
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const withLinks = singleLine.replace(urlRegex, (url) => {
      const cleanUrl = this.escapeHtml(url);
      return `<a href="${cleanUrl}" style="color: #1a73e8; text-decoration: underline; word-break: break-all;">${cleanUrl}</a>`;
    });
    
    // Separar por saltos de línea originales para mantener la estructura
    const lines = String(value ?? '').split('\n').filter(l => l.trim());
    return lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '<br>';
      
      // Convertir URLs en esta línea
      const withLineLinks = trimmed.replace(urlRegex, (url) => {
        const cleanUrl = this.escapeHtml(url);
        return `<a href="${cleanUrl}" style="color: #1a73e8; text-decoration: underline; word-break: break-all;">${cleanUrl}</a>`;
      });
      
      return `<div style="margin: 4px 0;">${withLineLinks}</div>`;
    }).join('');
  }

  // ─── Clear form ───────────────────────────────────────────────────────────
  clearForm(): void {
    this.selectedEvent = null;
    this.selectedLogSource = null;
    this.selectedOperationType = null;
    this.reportForm.reset({ fecha: new Date(), criticidad: 'media', reputacionOrigen: 'Interna' });
    this.newsletterForm.reset({ criticidad: 'media' });
    this.uploadedImages = [];
    this.newsletterUploadedImages = [];
    this.generatedHtml = '';
    this.safeGeneratedHtml = null;
    this.showPreview = false;
    this.activeClientAlert = null;
    
    this.newsletterRecipients = '';
    this.newsletterCcRecipients = '';
    this.newsletterContactSearch = '';
    this.newsletterCompanyFilter = '';
    this.newsletterFavoritesOnly = false;
    this.clearNewsletterSelection();

    this.incidentRecipientsTo = '';
    this.incidentRecipientsCc = '';
    this.incidentSubject = '';
    this.incidentContactSearch = '';
    this.incidentCompanyFilter = '';
    this.incidentFavoritesOnly = false;
    this.selectedIncidentContactIdsTo.clear();
    this.selectedIncidentContactIdsCc.clear();
  }

  onModeChange(): void {
    this.clearForm();
    this.syncReportHeaderColorByMode();
  }

  // ─── HTML Builders ────────────────────────────────────────────────────────
  private async buildReportHtml(): Promise<void> {
    const canContinue = await this.ensureClientAlertAcknowledged('report');
    if (!canContinue) return;

    const form = this.reportForm.value;
    
    const payload = {
      reportData: {
        codigoTicket: form.codigoTicket,
        ofensa: form.ofensa,
        tipoOperacion: form.tipoOperacion,
        nombreEvento: form.nombreEvento,
        motivoEvento: form.motivoEvento,
        fecha: form.fecha,
        criticidad: form.criticidad,
        origenConexion: form.origenConexion,
        destino: form.destino,
        logSource: form.logSource,
        reputacionOrigen: form.reputacionOrigen,
        observaciones: form.observaciones,
        evidenciaTexto: form.evidenciaTexto,
        recomendacion: form.recomendacion,
        informacionAdicional: form.informacionAdicional
      },
      images: this.uploadedImages.map(img => ({
        name: img.name,
        contentBase64: img.dataUrl.split(',')[1],
        contentType: img.dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
        width: img.width,
        height: img.height
      }))
    };

    // Auto-generar asunto para el reporte de incidente
    const clienteStr = form.logSource || 'Cliente';
    this.incidentSubject = `${clienteStr} - ${form.nombreEvento} - ${form.codigoTicket}`;

    this.http.post<{html: string}>(`${this.backendBaseUrl}/api/reports/incident/preview`, payload).subscribe({
      next: (res) => {
        this.generatedHtml = res.html || '';
        this.safeGeneratedHtml = this.sanitizer.bypassSecurityTrustHtml(this.generatedHtml);
        this.showPreview = true;
      },
      error: (err) => {
        console.error('Error al generar preview de reporte', err);
        this.snackBar.open('Error al generar preview del reporte', 'Cerrar', { duration: 3000 });
      }
    });
  }

  // ─── Incident email dispatch ──────────────────────────────────────────────
  get incidentCompanyOptionsTo(): string[] {
    const companies = new Set(
      this.newsletterContacts
        .map(c => String(c.company || '').trim())
        .filter(v => v.length > 0)
    );
    return Array.from(companies).sort((a, b) => a.localeCompare(b));
  }

  get incidentFilteredContactsTo(): DirectoryContact[] {
    let list = this.newsletterContacts.filter(c => c.type !== 'List');
    if (this.incidentFavoritesOnly) {
      list = list.filter(c => c.isFavorite);
    }
    if (this.incidentCompanyFilter) {
      list = list.filter(c => c.company === this.incidentCompanyFilter);
    }
    const search = this.incidentContactSearch.trim().toLowerCase();
    if (search) {
      list = list.filter(c =>
        c.name.toLowerCase().includes(search) ||
        (c.email || '').toLowerCase().includes(search)
      );
    }
    return list;
  }

  get incidentMailingListsTo(): DirectoryContact[] {
    let list = this.newsletterContacts.filter(c => c.type === 'List');
    if (this.incidentFavoritesOnly) {
      list = list.filter(c => c.isFavorite);
    }
    const search = this.incidentContactSearch.trim().toLowerCase();
    if (search) {
      list = list.filter(c =>
        c.name.toLowerCase().includes(search) ||
        (c.email || '').toLowerCase().includes(search)
      );
    }
    return list;
  }

  toggleIncidentContact(contactId: string, mode: 'to' | 'cc'): void {
    const set = mode === 'to' ? this.selectedIncidentContactIdsTo : this.selectedIncidentContactIdsCc;
    if (set.has(contactId)) {
      set.delete(contactId);
    } else {
      set.add(contactId);
    }
    this.syncIncidentRecipientsText(mode);
  }

  isIncidentContactSelected(contactId: string, mode: 'to' | 'cc'): boolean {
    const set = mode === 'to' ? this.selectedIncidentContactIdsTo : this.selectedIncidentContactIdsCc;
    return set.has(contactId);
  }

  private syncIncidentRecipientsText(mode: 'to' | 'cc'): void {
    const set = mode === 'to' ? this.selectedIncidentContactIdsTo : this.selectedIncidentContactIdsCc;
    const emails = Array.from(set)
      .map(id => this.newsletterContacts.find(c => c._id === id)?.email)
      .filter(e => !!e);
    
    if (mode === 'to') {
      this.incidentRecipientsTo = emails.join('\n');
    } else {
      this.incidentRecipientsCc = emails.join('\n');
    }
  }

  onIncidentRecipientsToChange(text: string): void {
    this.incidentRecipientsTo = text;
    this.updateIncidentSelectedFromText(text, 'to');
  }

  onIncidentRecipientsCcChange(text: string): void {
    this.incidentRecipientsCc = text;
    this.updateIncidentSelectedFromText(text, 'cc');
  }

  private updateIncidentSelectedFromText(text: string, mode: 'to' | 'cc'): void {
    const emails = text.split(/[\n,;]+/).map(e => e.trim().toLowerCase()).filter(e => e);
    const set = mode === 'to' ? this.selectedIncidentContactIdsTo : this.selectedIncidentContactIdsCc;
    set.clear();
    
    this.newsletterContacts.forEach(contact => {
      if (contact.email && emails.includes(contact.email.toLowerCase())) {
        set.add(contact._id || '');
      }
    });
  }

  async sendIncidentReport(): Promise<void> {
    if (!this.incidentRecipientsTo.trim()) {
      this.snackBar.open('Debes ingresar al menos un destinatario en Para', 'Cerrar', { duration: 3000 });
      return;
    }
    if (!this.incidentSubject.trim()) {
      this.snackBar.open('Debes ingresar un asunto para el correo', 'Cerrar', { duration: 3000 });
      return;
    }

    const logSourceValue = String(this.reportForm.get('logSource')?.value || '').trim();
    if (!logSourceValue) {
      this.snackBar.open('Debes seleccionar Cliente / Log Source para asociar el reporte', 'Cerrar', { duration: 3500 });
      return;
    }

    const canContinue = await this.ensureClientAlertAcknowledged('report');
    if (!canContinue) return;

    const form = this.reportForm.value;
    this.isSendingIncident = true;
    const payload = {
      to: this.incidentRecipientsTo.split(/[\n,;]+/).map(e => e.trim()).filter(e => e),
      cc: this.incidentRecipientsCc.split(/[\n,;]+/).map(e => e.trim()).filter(e => e),
      subject: this.incidentSubject,
      reportData: {
        codigoTicket: form.codigoTicket,
        ofensa: form.ofensa,
        tipoOperacion: form.tipoOperacion,
        nombreEvento: form.nombreEvento,
        motivoEvento: form.motivoEvento,
        fecha: form.fecha,
        criticidad: form.criticidad,
        origenConexion: form.origenConexion,
        destino: form.destino,
        logSource: logSourceValue,
        reputacionOrigen: form.reputacionOrigen,
        observaciones: form.observaciones,
        evidenciaTexto: form.evidenciaTexto,
        recomendacion: form.recomendacion,
        informacionAdicional: form.informacionAdicional
      },
      images: this.uploadedImages.map(img => ({
        name: img.name,
        contentBase64: img.dataUrl.split(',')[1],
        contentType: img.dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
        width: img.width,
        height: img.height
      }))
    };

    this.http.post(`${this.backendBaseUrl}/api/reports/incident/send`, payload).subscribe({
      next: (res: any) => {
        this.snackBar.open(`✅ Reporte enviado a ${res.toCount} destinatario(s) y ${res.ccCount} en copia`, 'Cerrar', { duration: 4000 });
        this.isSendingIncident = false;
        
        // Limpiar para permitir un nuevo reporte
        this.clearForm();
        this.loadNewsletterContacts();
      },
      error: (err) => {
        this.isSendingIncident = false;
        const msg = err.error?.detail || err.error?.message || 'Error al enviar reporte';
        this.snackBar.open(`Error: ${msg}`, 'Cerrar', { duration: 5000 });
      }
    });
  }

  private buildNewsletterHtml(): void {
    const form = this.newsletterForm.value;
    this.reportTableHeaderColor = this.reportTableColorsByType.bulletin;
    const headerColor = this.reportTableHeaderColor;
    const width = 800;
    const e = (v: unknown) => this.escapeHtml(v);

    const criticidadLower = e(form.criticidad).toLowerCase();
    let badgeColor = '#FFA500';
    let badgeText = 'MEDIO (CVSS 4.0 - 6.9)';
    if (criticidadLower === 'baja') { badgeColor = '#4CAF50'; badgeText = 'BAJO (CVSS 0.1 - 3.9)'; }
    else if (criticidadLower === 'alta') { badgeColor = '#f44336'; badgeText = 'ALTO (CVSS 7.0 - 8.9)'; }
    else if (criticidadLower === 'crítica' || criticidadLower === 'critica') { badgeColor = '#b71c1c'; badgeText = 'CRÍTICO (CVSS 9.0 - 10.0)'; }

    const currentUser = this.authService.getCurrentUser();
    const autor = e(currentUser?.fullName?.trim() || currentUser?.username || this.appTitle || '');

    // HTML usando SOLO tablas para máxima compatibilidad con Outlook/Gmail
    // NO usar divs, h1-h6, spans con display, ni border-radius
    let html = `<table cellpadding="0" cellspacing="0" width="${width}" border="0" style="border-collapse: collapse; width: ${width}px; max-width: 100%; font-family: Arial, Helvetica, sans-serif; border: 1px solid #dddddd; background-color: #ffffff; margin: 0 auto; mso-table-lspace: 0pt; mso-table-rspace: 0pt;">
  <tr>
    <td style="padding: 20px; background-color: ${headerColor}; border-bottom: 3px solid #2b2b2b;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
        <tr>
          <td width="120" valign="middle" align="left" style="padding: 0;">
            ${this.logoBase64 ? `<img src="${this.logoBase64}" height="48" width="auto" style="height: 48px; width: auto; border: 0;" alt="Logo" border="0">` : ''}
          </td>
          <td valign="middle" align="center" style="padding: 0;">
            <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
              <tr>
                <td style="padding: 0; margin: 0; font-size: 24px; font-weight: bold; color: #ffffff; font-family: Arial, Helvetica, sans-serif; text-align: center;">
                  Boletín de Seguridad
                </td>
              </tr>
              <tr>
                <td style="padding: 5px 0 0 0; font-size: 14px; color: #ffffff; font-family: Arial, Helvetica, sans-serif; text-align: center;">
                  Aviso importante preventivo
                </td>
              </tr>
            </table>
          </td>
          <td width="120" style="padding: 0;"></td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding: 30px 30px 20px 30px; background-color: #ffffff;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
        <tr>
          <td style="padding: 0 0 15px 0; font-size: 20px; font-weight: bold; color: #111111; font-family: Arial, Helvetica, sans-serif;">
            ${e(form.tituloBoletin)}
          </td>
        </tr>
        <tr>
          <td style="padding: 0 0 10px 0;">
            <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
              <tr>
                <td style="padding: 6px 12px; background-color: ${badgeColor}; color: #ffffff; font-size: 12px; font-weight: bold; font-family: Arial, Helvetica, sans-serif;">
                  CRITICIDAD: ${badgeText}
                </td>
                <td style="padding: 0 8px 0 0;"></td>
                <td style="padding: 6px 12px; background-color: #eeeeee; color: #333333; font-size: 12px; font-weight: bold; font-family: Arial, Helvetica, sans-serif;">
                  MARCA: ${e(form.marcaFabricante)}
                </td>
              </tr>
            </table>
          </td>
        </tr>`;

    if (form.cveIdentificadores?.trim()) {
      html += `
        <tr>
          <td style="padding: 8px 0 0 0; font-size: 12px; color: #666666; font-family: Arial, Helvetica, sans-serif;">
            <strong style="font-weight: bold;">CVE/IDs:</strong><br>
            ${this.formatCveList(form.cveIdentificadores)}
          </td>
        </tr>`;
    }

    html += `
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding: 20px 30px 10px 30px; background-color: #ffffff;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
        <tr>
          <td style="padding: 0 0 8px 0; font-size: 16px; font-weight: bold; color: #111111; font-family: Arial, Helvetica, sans-serif; border-bottom: 2px solid ${headerColor};">
            Producto(s) Afectado(s)
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-size: 14px; line-height: 1.6; color: #111111; font-family: Arial, Helvetica, sans-serif;">
            ${this.formatNewsletterText(form.productosAfectados)}
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding: 10px 30px; background-color: #ffffff;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
        <tr>
          <td style="padding: 0 0 8px 0; font-size: 16px; font-weight: bold; color: #111111; font-family: Arial, Helvetica, sans-serif; border-bottom: 2px solid ${headerColor};">
            Impacto
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-size: 14px; line-height: 1.6; color: #111111; font-family: Arial, Helvetica, sans-serif;">
            ${this.formatNewsletterText(form.impacto)}
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding: 10px 30px; background-color: #ffffff;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
        <tr>
          <td style="padding: 0 0 8px 0; font-size: 16px; font-weight: bold; color: #111111; font-family: Arial, Helvetica, sans-serif; border-bottom: 2px solid ${headerColor};">
            Acciones Recomendadas / Mitigación
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-size: 14px; line-height: 1.6; color: #111111; font-family: Arial, Helvetica, sans-serif;">
            ${this.formatNewsletterText(form.recomendacion)}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;

    if (form.referencias?.trim()) {
      html += `
  <tr>
    <td style="padding: 10px 30px; background-color: #ffffff;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
        <tr>
          <td style="padding: 0 0 8px 0; font-size: 16px; font-weight: bold; color: #111111; font-family: Arial, Helvetica, sans-serif; border-bottom: 2px solid ${headerColor};">
            Referencias
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 0; font-size: 14px; line-height: 1.6; color: #111111; font-family: Arial, Helvetica, sans-serif;">
            ${this.formatNewsletterReferences(form.referencias)}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
    }

    if (this.newsletterUploadedImages.length > 0) {
      html += `
  <tr>
    <td style="padding: 10px 30px 20px 30px; background-color: #ffffff;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse: collapse;">
        <tr>
          <td style="padding: 0 0 8px 0; font-size: 16px; font-weight: bold; color: #111111; font-family: Arial, Helvetica, sans-serif; border-bottom: 2px solid ${headerColor};">
            Evidencias
          </td>
        </tr>`;
      
      // Renderizar imágenes adaptando ancho según aspect ratio
      this.newsletterUploadedImages.forEach(img => {
        const aspectRatio = img.width / img.height;
        // Para imágenes panorámicas (tablas), usar más ancho del email (hasta 900px)
        // Para imágenes cuadradas/verticales, límite menor para no desperdiciar espacio
        let maxRenderWidth: number;
        if (aspectRatio > 1.4) {
          maxRenderWidth = 900; // Panorámica - aprovechar ancho disponible en email
        } else {
          maxRenderWidth = 700; // Cuadrada/vertical - ancho estándar
        }
        
        const renderWidth = Math.min(img.width, maxRenderWidth);
        const renderHeight = img.height > 0 ? Math.max(1, Math.round((img.height * renderWidth) / img.width)) : 0;
        const heightAttr = renderHeight > 0 ? ` height="${renderHeight}"` : '';
        html += `
        <tr>
          <td align="center" style="padding: 15px 0;">
            <img src="${img.dataUrl}" width="${renderWidth}"${heightAttr} style="width: ${renderWidth}px; max-width: 100%; height: auto; display: block; margin: 0 auto;" alt="${e(img.name || 'Evidencia')}" border="0">
          </td>
        </tr>`;
      });
      
      html += `
      </table>
    </td>
  </tr>`;
    }

    html += `
  <tr>
    <td style="padding: 15px; text-align: center; background-color: #f1f1f1; color: #111111; font-size: 12px; font-family: Arial, Helvetica, sans-serif; border-top: 1px solid #dddddd;">
      Generado por <strong style="font-weight: bold;">${autor}</strong>
    </td>
  </tr>
</table>`;

    this.generatedHtml = html;
    this.safeGeneratedHtml = this.sanitizer.bypassSecurityTrustHtml(html);
    this.showPreview = true;
  }

  // ─── Client alert helpers ─────────────────────────────────────────────────
  get hasPendingClientAlert(): boolean {
    const ruleId = this.activeClientAlert?.rule?._id;
    return !!(ruleId && !this.acknowledgedRuleIds.has(ruleId));
  }

  async acknowledgeCurrentAlert(): Promise<void> {
    if (!this.activeClientAlert?.hasAlert || !this.activeClientAlert.rule) return;
    await this.promptClientAlert(true);
  }

  private async refreshClientAlert(context: ClientAlertContext, showDialog: boolean): Promise<void> {
    if (!this.selectedLogSource?._id) { this.activeClientAlert = null; return; }

    this.isEvaluatingClientAlert = true;
    try {
      const evaluation = await firstValueFrom(
        this.escalationService.evaluateClientAlert(this.selectedLogSource._id, context)
      );
      this.activeClientAlert = evaluation;
      if (showDialog && evaluation.hasAlert && this.hasPendingClientAlert) {
        await this.promptClientAlert(false);
      }
    } catch {
      this.activeClientAlert = null;
    } finally {
      this.isEvaluatingClientAlert = false;
    }
  }

  private async ensureClientAlertAcknowledged(context: ClientAlertContext): Promise<boolean> {
    await this.refreshClientAlert(context, false);

    if (!this.activeClientAlert?.hasAlert || !this.activeClientAlert.rule) return true;
    if (!this.activeClientAlert.rule.acknowledgementRequired) return true;
    if (!this.hasPendingClientAlert) return true;

    const confirmed = await this.promptClientAlert(true);
    if (!confirmed) {
      this.snackBar.open('Debes confirmar lectura de la alerta antes de continuar', 'Cerrar', { duration: 4000 });
    }
    return confirmed;
  }

  private async promptClientAlert(requireAckForContinue: boolean): Promise<boolean> {
    if (!this.activeClientAlert?.hasAlert || !this.activeClientAlert.rule) return true;

    const evaluation = this.activeClientAlert;
    const rule = evaluation.rule;
    if (!rule) return true;

    const isBlocking = rule.ruleType === 'scheduled_maintenance' && rule.blocking === true;

    const dialogRef = this.dialog.open(ClientAlertDialogComponent, {
      width: '680px',
      maxWidth: '95vw',
      disableClose: isBlocking,
      data: {
        clientName: evaluation.client.name,
        contextLabel: evaluation.context === 'copy-report' ? 'Copiar reporte' : 'Generación de reporte',
        message: rule.alertMessage,
        channels: rule.channels || [],
        timezone: evaluation.evaluation.timezone,
        localDate: evaluation.evaluation.localDate,
        localTime: evaluation.evaluation.localTime,
        blocking: isBlocking,
        maintenanceTitle: rule.maintenanceTitle || ''
      }
    });

    const acknowledged = await firstValueFrom(dialogRef.afterClosed());
    if (!acknowledged) return !requireAckForContinue;

    try {
      await firstValueFrom(this.escalationService.acknowledgeClientAlert({
        ruleId: rule._id,
        clientId: evaluation.client._id,
        context: evaluation.context,
        acknowledgedAt: new Date().toISOString(),
        occurrenceKey: rule.occurrenceKey ?? undefined
      }));
      this.acknowledgedRuleIds.add(rule._id);
      this.snackBar.open('Alerta confirmada', 'Cerrar', { duration: 2000 });
      return true;
    } catch {
      this.snackBar.open('No se pudo registrar la confirmación de alerta', 'Cerrar', { duration: 4000 });
      return false;
    }
  }

  // ─── Config helpers ───────────────────────────────────────────────────────
  private loadReportTableColorConfig(): void {
    this.configService.getConfig().subscribe({
      next: (config) => {
        this.applyReportTableColorConfig(config);
      },
      error: () => {
        this.appTitle = '';
        this.reportTableColorsByType = {
          incident: '#4CAF50',
          bulletin: '#4CAF50'
        };
        this.reportTableHeaderColor = '#4CAF50';
      }
    });
  }

  private async refreshReportTableColorConfig(): Promise<void> {
    try {
      const config = await firstValueFrom(this.configService.getConfig());
      this.applyReportTableColorConfig(config);
    } catch {
      // Silencioso: conserva colores ya cargados si falla refresh.
    }
  }

  private applyReportTableColorConfig(config: any): void {
    const legacyColor = this.normalizeHexColor(config?.emailReportConfig?.reportTableColor) || '#4CAF50';
    const byType = config?.emailReportConfig?.reportTableColorByDocumentType;
    this.reportTableColorsByType = {
      incident: this.normalizeHexColor(byType?.incident) || legacyColor,
      bulletin: this.normalizeHexColor(byType?.bulletin) || legacyColor
    };
    this.appTitle = (config?.appTitle || '').trim();
    this.syncReportHeaderColorByMode();
  }

  private syncReportHeaderColorByMode(): void {
    this.reportTableHeaderColor = this.currentMode === 'newsletter'
      ? this.reportTableColorsByType.bulletin
      : this.reportTableColorsByType.incident;
  }

  private normalizeHexColor(value: string | undefined): string | null {
    if (!value) return null;
    const normalized = value.trim().toUpperCase();
    return /^#([A-F0-9]{6})$/.test(normalized) ? normalized : null;
  }

  private getSecondaryColor(baseHex: string): string {
    const hex = this.normalizeHexColor(baseHex) || '#4CAF50';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const mix = (c: number) => Math.round(c + (255 - c) * 0.35);
    const toHex = (c: number) => c.toString(16).padStart(2, '0').toUpperCase();
    return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
  }

  // ─── Clipboard helpers ────────────────────────────────────────────────────
  private copyHtmlWithExecCommand(html: string): boolean {
    const container = document.createElement('div');
    container.innerHTML = html;
    container.style.cssText = 'position: fixed; left: -9999px; top: 0; opacity: 0;';
    container.setAttribute('aria-hidden', 'true');
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection();
    if (!selection) { document.body.removeChild(container); return false; }

    selection.removeAllRanges();
    selection.addRange(range);
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    selection.removeAllRanges();
    document.body.removeChild(container);
    return copied;
  }

  private copyTextWithExecCommand(text: string): boolean {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position: fixed; left: -9999px; top: 0;';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    document.body.removeChild(textarea);
    return copied;
  }

  private getPlainTextFromHtml(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent?.trim() || '';
  }

  private getMarkdownFromHtml(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = Array.from(doc.querySelectorAll('tr'));
    const dataRows: [string, string][] = [];

    rows.forEach((row, index) => {
      const cells = Array.from(row.querySelectorAll('th, td')).map(c =>
        (c.textContent?.replace(/\s+/g, ' ').trim() || '').replace(/\|/g, '\\|')
      );
      if (index === 0 || cells.length < 2) return;
      dataRows.push([cells[0] || '-', cells[1] || '-']);
    });

    return [
      '| Campo | Detalle |',
      '| --- | --- |',
      ...dataRows.map(r => `| ${r[0]} | ${r[1]} |`)
    ].join('\n');
  }

  // ─── HTML escape ──────────────────────────────────────────────────────────
  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
