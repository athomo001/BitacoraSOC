import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { CatalogService } from '../../../services/catalog.service';
import { CatalogEvent, CatalogLogSource, CatalogOperationType } from '../../../models/catalog.model';
import { EscalationService } from '../../../services/escalation.service';
import { ClientAlertContext, ClientAlertEvaluation } from '../../../models/escalation.model';
import { ConfigService } from '../../../services/config.service';
import { AuthService } from '../../../services/auth.service';
import { MatCard, MatCardHeader, MatCardTitle, MatCardSubtitle, MatCardContent } from '@angular/material/card';
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

@Component({
  selector: 'app-report-generator',
  templateUrl: './report-generator.component.html',
  styleUrls: ['./report-generator.component.scss'],
  imports: [MatCard, MatCardHeader, MatCardTitle, MatCardSubtitle, MatCardContent, ReactiveFormsModule, FormsModule, EntityAutocompleteComponent, NgIf, MatFormField, MatLabel, MatInput, MatError, MatDatepickerInput, MatDatepickerToggle, MatSuffix, MatDatepicker, MatSelect, MatOption, MatButton, MatButtonToggleGroup, MatButtonToggle, MatIcon, NgFor, MatIconButton]
})
export class ReportGeneratorComponent implements OnInit {
  currentMode: 'report' | 'newsletter' = 'report';
  reportForm: FormGroup;
  newsletterForm: FormGroup;

  selectedEvent: CatalogEvent | null = null;
  selectedLogSource: CatalogLogSource | null = null;
  selectedOperationType: CatalogOperationType | null = null;

  uploadedImages: { name: string, dataUrl: string, width: number, height: number }[] = [];
  generatedHtml = '';
  showPreview = false;
  activeClientAlert: ClientAlertEvaluation | null = null;
  isEvaluatingClientAlert = false;
  reportTableHeaderColor = '#4CAF50';
  private readonly acknowledgedRuleIds = new Set<string>();

  constructor(
    private fb: FormBuilder,
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
      criticidad: ['media', Validators.required],
      resumenEjecutivo: ['', Validators.required],
      impacto: ['', Validators.required],
      recomendacion: ['', Validators.required],
      referencias: ['']
    });
  }

  ngOnInit(): void {
    this.loadReportTableColorConfig();
  }

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
    this.reportForm.patchValue({
      nombreEvento: '',
      motivoEvento: ''
    });
  }

  onLogSourceSelected(source: any): void {
    this.selectedLogSource = source as CatalogLogSource;
    if (source) {
      this.reportForm.patchValue({
        logSource: source.name
      });
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
    this.reportForm.patchValue({
      tipoOperacion: '',
      informacionAdicional: ''
    });
  }

  onImageUpload(event: any): void {
    const files = event.target.files;
    if (!files) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const dataUrl = String(e?.target?.result || '');
        if (!dataUrl) {
          return;
        }

        const imageProbe = new Image();
        imageProbe.onload = () => {
          this.uploadedImages.push({
            name: file.name,
            dataUrl,
            width: imageProbe.naturalWidth || 0,
            height: imageProbe.naturalHeight || 0
          });
        };
        imageProbe.onerror = () => {
          this.uploadedImages.push({
            name: file.name,
            dataUrl,
            width: 0,
            height: 0
          });
        };
        imageProbe.src = dataUrl;
      };
      reader.readAsDataURL(file);
    }
  }

  removeImage(index: number): void {
    this.uploadedImages.splice(index, 1);
  }

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

  private async buildReportHtml(): Promise<void> {
    const canContinue = await this.ensureClientAlertAcknowledged('report');
    if (!canContinue) {
      return;
    }

    const form = this.reportForm.value;
    const fechaFormateada = this.escapeHtml(new Date(form.fecha).toLocaleDateString('es-CL'));
    const reportWidthPx = 980;
    const evidenceImageWidthPx = 420;
    const headerColor = this.reportTableHeaderColor;
    const labelColor = this.getSecondaryColor(headerColor);

    const tipoOperacion = this.escapeHtml(form.tipoOperacion);
    const codigoInterno = this.escapeHtml(form.codigoInterno || '-');
    const nombreEvento = this.escapeHtml(form.nombreEvento);
    const motivoEvento = this.escapeHtml(form.motivoEvento);
    const criticidad = this.escapeHtml(form.criticidad);
    const origenConexion = this.escapeHtml(form.origenConexion || '-');
    const logSource = this.escapeHtml(form.logSource);
    const destino = this.escapeHtml(form.destino || '-');
    const reputacionOrigen = this.escapeHtml(form.reputacionOrigen);
    const observaciones = this.escapeHtml(form.observaciones);
    const recomendacion = this.escapeHtml(form.recomendacion || '-');
    const informacionAdicional = this.escapeHtml(form.informacionAdicional || '-');

    const firstColumnWidthPx = 185;
    const secondColumnWidthPx = reportWidthPx - firstColumnWidthPx;
    const cellDetailStyle = `border: 1px solid #2b2b2b; word-break: break-word; overflow-wrap: anywhere; vertical-align: top; width: ${secondColumnWidthPx}px;`;
    const cellLabelStyle = `background-color: ${labelColor}; font-weight: bold; border: 1px solid #2b2b2b; word-break: break-word; overflow-wrap: anywhere; vertical-align: top; width: ${firstColumnWidthPx}px;`;

    let html = `<table cellpadding="6" cellspacing="0" width="${reportWidthPx}" style="border-collapse: collapse; width: ${reportWidthPx}px; max-width: 100%; font-family: Arial, sans-serif; border: 1px solid #2b2b2b; table-layout: fixed; margin: 0; mso-table-lspace: 0pt; mso-table-rspace: 0pt; clear: both;">
  <colgroup>
    <col width="${firstColumnWidthPx}" style="width: ${firstColumnWidthPx}px;">
    <col width="${secondColumnWidthPx}" style="width: ${secondColumnWidthPx}px;">
  </colgroup>
  <tr>
    <th colspan="2" style="background-color: ${headerColor}; color: white; text-align: center; font-size: 18px; border: 1px solid #2b2b2b;">Reporte de Detección</th>
  </tr>
  <tr>
    <th width="${firstColumnWidthPx}" style="background-color: ${labelColor}; color: white; width: ${firstColumnWidthPx}px; border: 1px solid #2b2b2b; word-break: break-word; overflow-wrap: anywhere;">Campo</th>
    <th width="${secondColumnWidthPx}" style="background-color: ${labelColor}; color: white; width: ${secondColumnWidthPx}px; border: 1px solid #2b2b2b; word-break: break-word; overflow-wrap: anywhere;">Detalle</th>
  </tr>
  <tr>
    <td width="${firstColumnWidthPx}" style="${cellLabelStyle}">Tipo de operación</td>
    <td width="${secondColumnWidthPx}" style="${cellDetailStyle}">${tipoOperacion}</td>
  </tr>
  <tr>
    <td width="${firstColumnWidthPx}" style="${cellLabelStyle}">Ofensa/Código interno</td>
    <td width="${secondColumnWidthPx}" style="${cellDetailStyle}">${codigoInterno}</td>
  </tr>
  <tr>
    <td width="${firstColumnWidthPx}" style="${cellLabelStyle}">Nombre de Ofensa/Evento</td>
    <td width="${secondColumnWidthPx}" style="${cellDetailStyle}">${nombreEvento}</td>
  </tr>
  <tr>
    <td width="${firstColumnWidthPx}" style="${cellLabelStyle}">Motivo de la Ofensa/Evento</td>
    <td width="${secondColumnWidthPx}" style="${cellDetailStyle}">${motivoEvento}</td>
  </tr>
  <tr>
    <td width="${firstColumnWidthPx}" style="${cellLabelStyle}">Fecha</td>
    <td width="${secondColumnWidthPx}" style="${cellDetailStyle}">${fechaFormateada}</td>
  </tr>
  <tr>
    <td width="${firstColumnWidthPx}" style="${cellLabelStyle}">MRSC (Criticidad)</td>
    <td width="${secondColumnWidthPx}" style="${cellDetailStyle}">${criticidad}</td>
  </tr>
  <tr>
    <td width="${firstColumnWidthPx}" style="${cellLabelStyle}">Origen de conexión</td>
    <td width="${secondColumnWidthPx}" style="${cellDetailStyle}">${origenConexion}</td>
  </tr>
  <tr>
    <td width="${firstColumnWidthPx}" style="${cellLabelStyle}">Fuente / Log Source</td>
    <td width="${secondColumnWidthPx}" style="${cellDetailStyle}">${logSource}</td>
  </tr>
  <tr>
    <td width="${firstColumnWidthPx}" style="${cellLabelStyle}">Destino</td>
    <td width="${secondColumnWidthPx}" style="${cellDetailStyle}">${destino}</td>
  </tr>
  <tr>
    <td width="${firstColumnWidthPx}" style="${cellLabelStyle}">Reputación de origen</td>
    <td width="${secondColumnWidthPx}" style="${cellDetailStyle}">${reputacionOrigen}</td>
  </tr>
  <tr>
    <td width="${firstColumnWidthPx}" style="${cellLabelStyle}">Observaciones</td>
    <td width="${secondColumnWidthPx}" style="white-space: pre-wrap; ${cellDetailStyle}">${observaciones}</td>
  </tr>`;

    const evidenciaTexto = this.escapeHtml((form.evidenciaTexto || '').trim());
    const hasImages = this.uploadedImages.length > 0;
    const hasTextEvidence = evidenciaTexto.length > 0;

    if (hasImages || hasTextEvidence) {
      html += `\n  <tr>\n    <td width="${firstColumnWidthPx}" style="${cellLabelStyle}">Evidencia</td>\n    <td width="${secondColumnWidthPx}" style="${cellDetailStyle}">`;
      if (hasTextEvidence) {
        html += `<div style="white-space: pre-wrap; margin-bottom: ${hasImages ? '10px' : '0'};">${evidenciaTexto}</div>`;
      }
      if (hasImages) {
        this.uploadedImages.forEach(img => {
          const renderWidth = img.width > 0 ? Math.min(evidenceImageWidthPx, img.width) : evidenceImageWidthPx;
          const renderHeight = img.width > 0 && img.height > 0
            ? Math.max(1, Math.round((img.height * renderWidth) / img.width))
            : 0;
          const heightAttribute = renderHeight > 0 ? ` height="${renderHeight}"` : '';

          html += `<a href="${img.dataUrl}" style="display: block; text-align: center; text-decoration: none;"><img src="${img.dataUrl}" width="${renderWidth}"${heightAttribute} style="width: ${renderWidth}px; max-width: 100%; height: auto; object-fit: contain; margin: 4px auto; display: block; border: 1px solid #ddd; image-rendering: auto;" alt="${this.escapeHtml(img.name || 'Evidencia')}"></a><br>`;
        });
      }
      html += `</td>\n  </tr>`;
    } else {
      html += `\n  <tr>\n    <td width="${firstColumnWidthPx}" style="${cellLabelStyle}">Evidencia</td>\n    <td width="${secondColumnWidthPx}" style="${cellDetailStyle}">Se adjunta en el correo</td>\n  </tr>`;
    }

    html += `
  <tr>
    <td width="${firstColumnWidthPx}" style="${cellLabelStyle}">Recomendación</td>
    <td width="${secondColumnWidthPx}" style="white-space: pre-wrap; ${cellDetailStyle}">${recomendacion}</td>
  </tr>
  <tr>
    <td width="${firstColumnWidthPx}" style="${cellLabelStyle}">Información adicional</td>
    <td width="${secondColumnWidthPx}" style="white-space: pre-wrap; ${cellDetailStyle}">${informacionAdicional}</td>
  </tr>
</table>`;

    this.generatedHtml = html;
    this.showPreview = true;
  }

  private buildNewsletterHtml(): void {
    const form = this.newsletterForm.value;
    const headerColor = this.reportTableHeaderColor;
    const labelColor = this.getSecondaryColor(headerColor);
    
    // Ancho un poco mas estrecho y amigable para emails
    const newsletterWidthPx = 800;
    
    const titulo = this.escapeHtml(form.tituloBoletin);
    const criticidad = this.escapeHtml(form.criticidad).toUpperCase();
    const resumen = this.escapeHtml(form.resumenEjecutivo);
    const impacto = this.escapeHtml(form.impacto);
    const recomendacion = this.escapeHtml(form.recomendacion);
    const referencias = this.escapeHtml(form.referencias || '-');

    let badgeColor = '#FFA500'; // Media
    let criticidadBadgeText = `MEDIO (CVSS 4.0 - 6.9)`;
    
    if (criticidad.toLowerCase() === 'baja') {
      badgeColor = '#4CAF50';
      criticidadBadgeText = `BAJO (CVSS 0.1 - 3.9)`;
    } else if (criticidad.toLowerCase() === 'alta') {
      badgeColor = '#f44336';
      criticidadBadgeText = `ALTO (CVSS 7.0 - 8.9)`;
    } else if (criticidad.toLowerCase() === 'crítica' || criticidad.toLowerCase() === 'critica') {
      badgeColor = '#b71c1c';
      criticidadBadgeText = `CRÍTICO (CVSS 9.0 - 10.0)`;
    }

    const sectionTitleStyle = `color: ${headerColor}; margin-top: 20px; font-size: 16px; font-weight: bold; border-bottom: 2px solid ${labelColor}; padding-bottom: 5px;`;
    const paragraphStyle = `color: #333; font-size: 14px; line-height: 1.6; white-space: pre-wrap;`;

    let html = `<table cellpadding="0" cellspacing="0" width="${newsletterWidthPx}" style="border-collapse: collapse; width: ${newsletterWidthPx}px; max-width: 100%; font-family: Arial, sans-serif; border: 1px solid #ddd; background-color: #fcfcfc; margin: 0; mso-table-lspace: 0pt; mso-table-rspace: 0pt;">
  <tr>
    <td style="padding: 20px; background-color: ${headerColor}; color: white; text-align: center; border-bottom: 3px solid #2b2b2b;">
      <h2 style="margin: 0; font-size: 24px;">Boletín de Seguridad</h2>
      <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Aviso importante preventivo</p>
    </td>
  </tr>
  <tr>
    <td style="padding: 30px;">
      <div style="margin-bottom: 25px;">
        <h3 style="margin: 0 0 10px 0; font-size: 20px; color: #111;">${titulo}</h3>
        <span style="display: inline-block; padding: 4px 10px; background-color: ${badgeColor}; color: white; border-radius: 4px; font-size: 12px; font-weight: bold;">CRITICIDAD: ${criticidadBadgeText}</span>
      </div>

      <h4 style="${sectionTitleStyle}">Resumen Ejecutivo</h4>
      <div style="${paragraphStyle}">${resumen}</div>

      <h4 style="${sectionTitleStyle}">Impacto</h4>
      <div style="${paragraphStyle}">${impacto}</div>

      <h4 style="${sectionTitleStyle}">Acciones Recomendadas / Mitigación</h4>
      <div style="${paragraphStyle}">${recomendacion}</div>`;
      
    if (form.referencias && form.referencias.trim() !== '') {
      html += `
      <h4 style="${sectionTitleStyle}">Referencias</h4>
      <div style="${paragraphStyle}">${referencias}</div>`;
    }

    const currentUser = this.authService.getCurrentUser();
    const autor = this.escapeHtml(
      currentUser?.fullName?.trim() || currentUser?.username || 'Bitácora SOC'
    );

    html += `
    </td>
  </tr>
  <tr>
    <td style="padding: 15px; text-align: center; background-color: #f1f1f1; color: #666; font-size: 12px; border-top: 1px solid #ddd;">
      Generado por <strong>${autor}</strong>
    </td>
  </tr>
</table>`;

    this.generatedHtml = html;
    this.showPreview = true;
  }

  async copyToClipboard(): Promise<void> {
    if (!this.generatedHtml) {
      this.snackBar.open('Primero genera la tabla', 'Cerrar', { duration: 3000 });
      return;
    }

    const canContinue = await this.ensureClientAlertAcknowledged('copy-report');
    if (!canContinue) {
      return;
    }

    const html = this.generatedHtml;
    const plainText = this.getPlainTextFromHtml(html);
    const clipboardItem = (window as any).ClipboardItem;

    if (navigator?.clipboard && clipboardItem && navigator.clipboard.write) {
      const htmlBlob = new Blob([html], { type: 'text/html' });
      const textBlob = new Blob([plainText], { type: 'text/plain' });
      const item = new clipboardItem({
        'text/html': htmlBlob,
        'text/plain': textBlob
      });

      try {
        await navigator.clipboard.write([item]);
        this.snackBar.open('✅ Tabla copiada con formato', 'Cerrar', { duration: 2000 });
        return;
      } catch {
        // Fallback a execCommand o texto plano
      }
    }

    if (this.copyHtmlWithExecCommand(html)) {
      this.snackBar.open('Tabla copiada con formato', 'Cerrar', { duration: 2000 });
      return;
    }

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(plainText).then(() => {
        this.snackBar.open('Tabla copiada como texto', 'Cerrar', { duration: 2000 });
      }).catch(() => {
        this.snackBar.open('Error al copiar. Selecciona y copia manualmente.', 'Cerrar', { duration: 3000 });
      });
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
    if (!canContinue) {
      return;
    }

    const markdown = this.getMarkdownFromHtml(this.generatedHtml);
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(markdown).then(() => {
        this.snackBar.open('✅ Markdown copiado', 'Cerrar', { duration: 2000 });
      }).catch(() => {
        this.snackBar.open('Error al copiar Markdown.', 'Cerrar', { duration: 3000 });
      });
      return;
    }

    if (this.copyTextWithExecCommand(markdown)) {
      this.snackBar.open('Markdown copiado', 'Cerrar', { duration: 2000 });
      return;
    }

    this.snackBar.open('Error al copiar Markdown.', 'Cerrar', { duration: 3000 });
  }

  private copyHtmlWithExecCommand(html: string): boolean {
    const container = document.createElement('div');
    container.innerHTML = html;
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.opacity = '0';
    container.setAttribute('aria-hidden', 'true');
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection();
    if (!selection) {
      document.body.removeChild(container);
      return false;
    }

    selection.removeAllRanges();
    selection.addRange(range);

    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }

    selection.removeAllRanges();
    document.body.removeChild(container);
    return copied;
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private copyTextWithExecCommand(text: string): boolean {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);

    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }

    document.body.removeChild(textarea);
    return copied;
  }
  private getPlainTextFromHtml(html: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return doc.body.textContent?.trim() || '';
  }

  private getMarkdownFromHtml(html: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const rows = Array.from(doc.querySelectorAll('tr'));
    const dataRows: Array<[string, string]> = [];

    rows.forEach((row, index) => {
      const cells = Array.from(row.querySelectorAll('th, td')).map(cell => {
        const text = cell.textContent?.replace(/\s+/g, ' ').trim() || '';
        return text.replace(/\|/g, '\\|');
      });
      if (index === 0 || cells.length < 2) return;
      if (cells.length >= 2) {
        dataRows.push([cells[0] || '-', cells[1] || '-']);
      }
    });

    const header = ['Campo', 'Detalle'];
    const sep = ['---', '---'];
    const lines = [
      `| ${header[0]} | ${header[1]} |`,
      `| ${sep[0]} | ${sep[1]} |`,
      ...dataRows.map(row => `| ${row[0]} | ${row[1]} |`)
    ];
    return lines.join('\n');
  }

  get hasPendingClientAlert(): boolean {
    const ruleId = this.activeClientAlert?.rule?._id;
    return !!(ruleId && !this.acknowledgedRuleIds.has(ruleId));
  }

  async acknowledgeCurrentAlert(): Promise<void> {
    if (!this.activeClientAlert?.hasAlert || !this.activeClientAlert.rule) {
      return;
    }
    await this.promptClientAlert(true);
  }

  private async refreshClientAlert(context: ClientAlertContext, showDialog: boolean): Promise<void> {
    if (!this.selectedLogSource?._id) {
      this.activeClientAlert = null;
      return;
    }

    this.isEvaluatingClientAlert = true;
    try {
      const evaluation = await firstValueFrom(
        this.escalationService.evaluateClientAlert(this.selectedLogSource._id, context)
      );
      this.activeClientAlert = evaluation;

      if (showDialog && evaluation.hasAlert && this.hasPendingClientAlert) {
        await this.promptClientAlert(false);
      }
    } catch (error) {
      console.error('Error evaluando alerta especial por cliente:', error);
      this.activeClientAlert = null;
    } finally {
      this.isEvaluatingClientAlert = false;
    }
  }

  private async ensureClientAlertAcknowledged(context: ClientAlertContext): Promise<boolean> {
    await this.refreshClientAlert(context, false);

    if (!this.activeClientAlert?.hasAlert || !this.activeClientAlert.rule) {
      return true;
    }

    if (!this.activeClientAlert.rule.acknowledgementRequired) {
      return true;
    }

    if (!this.hasPendingClientAlert) {
      return true;
    }

    const confirmed = await this.promptClientAlert(true);
    if (!confirmed) {
      this.snackBar.open('Debes confirmar lectura de la alerta antes de continuar', 'Cerrar', { duration: 4000 });
    }

    return confirmed;
  }

  private async promptClientAlert(requireAckForContinue: boolean): Promise<boolean> {
    if (!this.activeClientAlert?.hasAlert || !this.activeClientAlert.rule) {
      return true;
    }

    const evaluation = this.activeClientAlert;
    const rule = evaluation.rule;
    if (!rule) {
      return true;
    }

    const dialogRef = this.dialog.open(ClientAlertDialogComponent, {
      width: '680px',
      maxWidth: '95vw',
      disableClose: false,
      data: {
        clientName: evaluation.client.name,
        contextLabel: this.getContextLabel(evaluation.context),
        message: rule.alertMessage,
        channels: rule.channels || [],
        timezone: evaluation.evaluation.timezone,
        localDate: evaluation.evaluation.localDate,
        localTime: evaluation.evaluation.localTime
      }
    });

    const acknowledged = await firstValueFrom(dialogRef.afterClosed());
    if (!acknowledged) {
      return !requireAckForContinue;
    }

    try {
      await firstValueFrom(this.escalationService.acknowledgeClientAlert({
        ruleId: rule._id,
        clientId: evaluation.client._id,
        context: evaluation.context,
        acknowledgedAt: new Date().toISOString()
      }));

      this.acknowledgedRuleIds.add(rule._id);
      this.snackBar.open('Alerta confirmada', 'Cerrar', { duration: 2000 });
      return true;
    } catch (error) {
      console.error('Error registrando confirmación de alerta:', error);
      this.snackBar.open('No se pudo registrar la confirmación de alerta', 'Cerrar', { duration: 4000 });
      return false;
    }
  }

  private getContextLabel(context: ClientAlertContext): string {
    return context === 'copy-report' ? 'Copiar reporte' : 'Generación de reporte';
  }

  private loadReportTableColorConfig(): void {
    this.configService.getConfig().subscribe({
      next: (config) => {
        const color = this.normalizeHexColor(config.emailReportConfig?.reportTableColor);
        this.reportTableHeaderColor = color || '#4CAF50';
      },
      error: () => {
        this.reportTableHeaderColor = '#4CAF50';
      }
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

    const mixWithWhite = (channel: number) => Math.round(channel + (255 - channel) * 0.35);
    const toHex = (channel: number) => channel.toString(16).padStart(2, '0').toUpperCase();

    return `#${toHex(mixWithWhite(r))}${toHex(mixWithWhite(g))}${toHex(mixWithWhite(b))}`;
  }

  clearForm(): void {
    this.selectedEvent = null;
    this.selectedLogSource = null;
    this.selectedOperationType = null;
    this.reportForm.reset({
      fecha: new Date(),
      criticidad: 'media',
      reputacionOrigen: 'Interna'
    });
    this.newsletterForm.reset({
      criticidad: 'media'
    });
    this.uploadedImages = [];
    this.generatedHtml = '';
    this.showPreview = false;
    this.activeClientAlert = null;
  }
}
