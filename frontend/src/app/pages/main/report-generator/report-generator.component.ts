import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import anime from 'animejs';

import { CatalogService } from '../../../services/catalog.service';
import { CatalogEvent, CatalogLogSource, CatalogOperationType } from '../../../models/catalog.model';
import { EscalationService } from '../../../services/escalation.service';
import { ClientAlertContext, ClientAlertEvaluation } from '../../../models/escalation.model';
import { ConfigService } from '../../../services/config.service';
import { AuthService } from '../../../services/auth.service';

import { EntityAutocompleteComponent } from '../../../components/entity-autocomplete/entity-autocomplete.component';
import { NgIf, NgFor } from '@angular/common';
import { MatFormField, MatLabel, MatError, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatDatepickerInput, MatDatepickerToggle, MatDatepicker } from '@angular/material/datepicker';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatButtonToggleGroup, MatButtonToggle } from '@angular/material/button-toggle';
import { MatIcon } from '@angular/material/icon';
import { ClientAlertDialogComponent } from './client-alert-dialog.component';
import { environment } from '@env/environment';

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
    MatButton, MatIconButton,
    MatButtonToggleGroup, MatButtonToggle,
    MatIcon
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
      'hint-nl-titulo':        'Indica un título claro y conciso para la amenaza o el parche. Es la primera impresión.',
      'hint-nl-marca':         'El proveedor o empresa responsable (ej: Microsoft, Cisco, VMware).',
      'hint-nl-criticidad':    'Gravedad de la vulnerabilidad según el estándar CVSS.',
      'hint-nl-cve':           'Incluye los códigos estándar (ej: CVE-2024-XXXXX). Campo opcional.',
      'hint-nl-productos':     'Software o hardware específicos y sus versiones vulnerables.',
      'hint-nl-impacto':       'Qué puede ocurrir si se explota la vulnerabilidad (ej: Control total, robo de datos).',
      'hint-nl-recomendacion': 'Pasos concretos a seguir o mitigaciones de seguridad.',
      'hint-nl-referencias':   'Links oficiales al parche o análisis. Campo opcional.',
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
  generatedHtml = '';
  showPreview = false;
  reportTableHeaderColor = '#4CAF50';

  // ─── Branding ────────────────────────────────────────────────────────────
  logoBase64: string | null = null;

  // ─── Newsletter email dispatch ────────────────────────────────────────────
  newsletterRecipients = '';
  isSendingNewsletter = false;

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
    private dialog: MatDialog,
    private authService: AuthService
  ) {
    this.reportForm = this.fb.group({
      tipoOperacion: ['', Validators.required],
      codigoInterno: [''],
      nombreEvento: ['', Validators.required],
      motivoEvento: ['', Validators.required],
      fecha: [new Date(), Validators.required],
      criticidad: ['media', Validators.required],
      origenConexion: [''],
      logSource: ['', Validators.required],
      destino: [''],
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

  // ─── Generate ────────────────────────────────────────────────────────────
  async generateTable(): Promise<void> {
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

  // ─── Newsletter: send by email (1:1) ─────────────────────────────────────
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

    const recipients = this.newsletterRecipients
      .split(',')
      .map(e => e.trim())
      .filter(e => e.includes('@'));

    if (recipients.length === 0) {
      this.snackBar.open('Ingresa al menos un correo electrónico válido', 'Cerrar', { duration: 3000 });
      return;
    }

    this.isSendingNewsletter = true;
    const subject = this.newsletterForm.value.tituloBoletin || 'Boletín de Seguridad';

    this.http.post(`${this.backendBaseUrl}/api/reports/newsletter/send`, {
      recipients,
      subject,
      html: this.generatedHtml
    }).subscribe({
      next: (res: any) => {
        this.isSendingNewsletter = false;
        const msg = res.failCount > 0
          ? `Enviado a ${res.successCount} destinatarios (${res.failCount} fallidos)`
          : `Boletín enviado a ${res.successCount} destinatario(s)`;
        this.snackBar.open(msg, 'Cerrar', { duration: 5000 });
        if (res.successCount > 0) this.newsletterRecipients = '';
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

    let text = input;
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

  // ─── Clear form ───────────────────────────────────────────────────────────
  clearForm(): void {
    this.selectedEvent = null;
    this.selectedLogSource = null;
    this.selectedOperationType = null;
    this.reportForm.reset({ fecha: new Date(), criticidad: 'media', reputacionOrigen: 'Interna' });
    this.newsletterForm.reset({ criticidad: 'media' });
    this.uploadedImages = [];
    this.generatedHtml = '';
    this.showPreview = false;
    this.activeClientAlert = null;
    this.newsletterRecipients = '';
  }

  // ─── HTML Builders ────────────────────────────────────────────────────────
  private async buildReportHtml(): Promise<void> {
    const canContinue = await this.ensureClientAlertAcknowledged('report');
    if (!canContinue) return;

    const form = this.reportForm.value;
    const headerColor = this.reportTableHeaderColor;
    const labelColor = this.getSecondaryColor(headerColor);
    const reportWidthPx = 980;
    const evidenceImageWidthPx = 420;
    const firstColPx = 185;
    const secondColPx = reportWidthPx - firstColPx;

    const cellLabel = `background-color: ${labelColor}; font-weight: bold; border: 1px solid #2b2b2b; word-break: break-word; overflow-wrap: anywhere; vertical-align: top; width: ${firstColPx}px;`;
    const cellDetail = `border: 1px solid #2b2b2b; word-break: break-word; overflow-wrap: anywhere; vertical-align: top; width: ${secondColPx}px;`;

    const e = (v: unknown) => this.escapeHtml(v);

    let html = `<table cellpadding="6" cellspacing="0" width="${reportWidthPx}" style="border-collapse: collapse; width: ${reportWidthPx}px; max-width: 100%; font-family: Arial, sans-serif; border: 1px solid #2b2b2b; table-layout: fixed; margin: 0; mso-table-lspace: 0pt; mso-table-rspace: 0pt; clear: both;">
  <colgroup>
    <col width="${firstColPx}" style="width: ${firstColPx}px;">
    <col width="${secondColPx}" style="width: ${secondColPx}px;">
  </colgroup>
  <tr>
    <th colspan="2" style="background-color: ${headerColor}; color: white; text-align: center; font-size: 18px; border: 1px solid #2b2b2b;">Reporte de Detección</th>
  </tr>
  <tr>
    <th width="${firstColPx}" style="background-color: ${labelColor}; color: white; width: ${firstColPx}px; border: 1px solid #2b2b2b; word-break: break-word; overflow-wrap: anywhere;">Campo</th>
    <th width="${secondColPx}" style="background-color: ${labelColor}; color: white; width: ${secondColPx}px; border: 1px solid #2b2b2b; word-break: break-word; overflow-wrap: anywhere;">Detalle</th>
  </tr>
  <tr><td style="${cellLabel}">Tipo de operación</td><td style="${cellDetail}">${e(form.tipoOperacion)}</td></tr>
  <tr><td style="${cellLabel}">Ofensa/Código interno</td><td style="${cellDetail}">${e(form.codigoInterno || '-')}</td></tr>
  <tr><td style="${cellLabel}">Nombre de Ofensa/Evento</td><td style="${cellDetail}">${e(form.nombreEvento)}</td></tr>
  <tr><td style="${cellLabel}">Motivo de la Ofensa/Evento</td><td style="${cellDetail}">${this.formatMultilineText(form.motivoEvento)}</td></tr>
  <tr><td style="${cellLabel}">Fecha</td><td style="${cellDetail}">${e(new Date(form.fecha).toLocaleDateString('es-CL'))}</td></tr>
  <tr><td style="${cellLabel}">MRSC (Criticidad)</td><td style="${cellDetail}">${e(form.criticidad)}</td></tr>
  <tr><td style="${cellLabel}">Origen de conexión</td><td style="${cellDetail}">${e(form.origenConexion || '-')}</td></tr>
  <tr><td style="${cellLabel}">Fuente / Log Source</td><td style="${cellDetail}">${e(form.logSource)}</td></tr>
  <tr><td style="${cellLabel}">Destino</td><td style="${cellDetail}">${e(form.destino || '-')}</td></tr>
  <tr><td style="${cellLabel}">Reputación de origen</td><td style="${cellDetail}">${e(form.reputacionOrigen)}</td></tr>
  <tr><td style="${cellLabel}">Observaciones</td><td style="white-space: pre-wrap; ${cellDetail}">${this.formatMultilineText(form.observaciones)}</td></tr>`;

    const hasImages = this.uploadedImages.length > 0;
    const hasTextEvidence = (form.evidenciaTexto || '').trim().length > 0;

    if (hasImages || hasTextEvidence) {
      html += `\n  <tr>\n    <td style="${cellLabel}">Evidencia</td>\n    <td style="${cellDetail}">`;
      if (hasTextEvidence) {
        html += `<div style="white-space: pre-wrap; margin-bottom: ${hasImages ? '10px' : '0'};">${this.formatMultilineText(form.evidenciaTexto)}</div>`;
      }
      if (hasImages) {
        this.uploadedImages.forEach(img => {
          const renderWidth = img.width > 0 ? Math.min(evidenceImageWidthPx, img.width) : evidenceImageWidthPx;
          const renderHeight = img.width > 0 && img.height > 0
            ? Math.max(1, Math.round((img.height * renderWidth) / img.width))
            : 0;
          const heightAttr = renderHeight > 0 ? ` height="${renderHeight}"` : '';
          html += `<a href="${img.dataUrl}" style="display: block; text-align: center; text-decoration: none;"><img src="${img.dataUrl}" width="${renderWidth}"${heightAttr} style="width: ${renderWidth}px; max-width: 100%; height: auto; object-fit: contain; margin: 4px auto; display: block; border: 1px solid #ddd;" alt="${e(img.name || 'Evidencia')}"></a><br>`;
        });
      }
      html += `</td>\n  </tr>`;
    } else {
      html += `\n  <tr><td style="${cellLabel}">Evidencia</td><td style="${cellDetail}">Se adjunta en el correo</td></tr>`;
    }

    html += `
  <tr><td style="${cellLabel}">Recomendación</td><td style="white-space: pre-wrap; ${cellDetail}">${this.formatMultilineText(form.recomendacion || '-')}</td></tr>
  <tr><td style="${cellLabel}">Información adicional</td><td style="white-space: pre-wrap; ${cellDetail}">${this.formatMultilineText(form.informacionAdicional || '-')}</td></tr>
</table>`;

    this.generatedHtml = html;
    this.showPreview = true;
  }

  private buildNewsletterHtml(): void {
    const form = this.newsletterForm.value;
    const headerColor = this.reportTableHeaderColor;
    const width = 800;
    const e = (v: unknown) => this.escapeHtml(v);

    const criticidadLower = e(form.criticidad).toLowerCase();
    let badgeColor = '#FFA500';
    let badgeText = 'MEDIO (CVSS 4.0 - 6.9)';
    if (criticidadLower === 'baja') { badgeColor = '#4CAF50'; badgeText = 'BAJO (CVSS 0.1 - 3.9)'; }
    else if (criticidadLower === 'alta') { badgeColor = '#f44336'; badgeText = 'ALTO (CVSS 7.0 - 8.9)'; }
    else if (criticidadLower === 'crítica' || criticidadLower === 'critica') { badgeColor = '#b71c1c'; badgeText = 'CRÍTICO (CVSS 9.0 - 10.0)'; }

    const sectionTitle = `color: #111111 !important; margin-top: 20px; font-size: 16px; font-weight: bold; border-bottom: 2px solid ${headerColor}; padding-bottom: 5px;`;
    const paragraph = `color: #111111 !important; font-size: 14px; line-height: 1.6;`;

    const currentUser = this.authService.getCurrentUser();
    const autor = e(currentUser?.fullName?.trim() || currentUser?.username || 'Bitácora SOC');

    let html = `<table cellpadding="0" cellspacing="0" width="${width}" style="border-collapse: collapse; width: ${width}px; max-width: 100%; font-family: Arial, sans-serif; border: 1px solid #ddd; background-color: #fcfcfc; margin: 0; mso-table-lspace: 0pt; mso-table-rspace: 0pt;">
  <tr>
    <td style="padding: 20px; background-color: ${headerColor}; color: white; border-bottom: 3px solid #2b2b2b;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td width="30%" valign="middle" align="left">
            ${this.logoBase64 ? `<img src="${this.logoBase64}" height="48" style="height: 48px; max-height: 48px; width: auto; display: block;" alt="Logo">` : ''}
          </td>
          <td width="40%" valign="middle" align="center">
            <h2 style="margin: 0; font-size: 24px; white-space: nowrap; color: #111111;">Boletín de Seguridad</h2>
            <p style="margin: 5px 0 0 0; font-size: 14px; white-space: nowrap; color: #111111;">Aviso importante preventivo</p>
          </td>
          <td width="30%"></td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding: 30px; color: #111111;">
      <div style="margin-bottom: 25px;">
        <h3 style="margin: 0 0 10px 0; font-size: 20px; color: #111111;">${e(form.tituloBoletin)}</h3>
        <div style="margin-bottom: 10px;">
          <span style="display: inline-block; padding: 4px 10px; background-color: ${badgeColor}; color: white; border-radius: 4px; font-size: 12px; font-weight: bold; margin-right: 8px;">CRITICIDAD: ${badgeText}</span>
          <span style="display: inline-block; padding: 4px 10px; background-color: #eee; color: #333; border-radius: 4px; font-size: 12px; font-weight: bold;">MARCA: ${e(form.marcaFabricante)}</span>
        </div>
        ${form.cveIdentificadores?.trim() ? `<div style="font-size: 12px; color: #666; margin-top: 8px;"><strong>CVE/IDs:</strong><br>${this.formatCveList(form.cveIdentificadores)}</div>` : ''}
      </div>

      <h4 style="${sectionTitle}">Producto(s) Afectado(s)</h4>
      <div style="${paragraph}">${this.formatNewsletterText(form.productosAfectados)}</div>

      <h4 style="${sectionTitle}">Impacto</h4>
      <div style="${paragraph}">${this.formatNewsletterText(form.impacto)}</div>

      <h4 style="${sectionTitle}">Acciones Recomendadas / Mitigación</h4>
      <div style="${paragraph}">${this.formatNewsletterText(form.recomendacion)}</div>`;

    if (form.referencias?.trim()) {
      html += `
      <h4 style="${sectionTitle}">Referencias</h4>
      <div style="${paragraph}">${this.formatNewsletterText(form.referencias)}</div>`;
    }

    html += `
    </td>
  </tr>
  <tr>
    <td style="padding: 15px; text-align: center; background-color: #f1f1f1; color: #111111; font-size: 12px; border-top: 1px solid #ddd;">
      Generado por <strong>${autor}</strong>
    </td>
  </tr>
</table>`;

    this.generatedHtml = html;
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
        const color = this.normalizeHexColor(config.emailReportConfig?.reportTableColor);
        this.reportTableHeaderColor = color || '#4CAF50';
      },
      error: () => { this.reportTableHeaderColor = '#4CAF50'; }
    });
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
