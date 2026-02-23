import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { CatalogService } from '../../../services/catalog.service';
import { CatalogEvent, CatalogLogSource, CatalogOperationType } from '../../../models/catalog.model';
import { EscalationService } from '../../../services/escalation.service';
import { ClientAlertContext, ClientAlertEvaluation } from '../../../models/escalation.model';
import { MatCard, MatCardHeader, MatCardTitle, MatCardSubtitle, MatCardContent } from '@angular/material/card';
import { EntityAutocompleteComponent } from '../../../components/entity-autocomplete/entity-autocomplete.component';
import { NgIf, NgFor } from '@angular/common';
import { MatFormField, MatLabel, MatError, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatDatepickerInput, MatDatepickerToggle, MatDatepicker } from '@angular/material/datepicker';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { ClientAlertDialogComponent } from './client-alert-dialog.component';

@Component({
    selector: 'app-report-generator',
    templateUrl: './report-generator.component.html',
    styleUrls: ['./report-generator.component.scss'],
    imports: [MatCard, MatCardHeader, MatCardTitle, MatCardSubtitle, MatCardContent, ReactiveFormsModule, EntityAutocompleteComponent, NgIf, MatFormField, MatLabel, MatInput, MatError, MatDatepickerInput, MatDatepickerToggle, MatSuffix, MatDatepicker, MatSelect, MatOption, MatButton, MatIcon, NgFor, MatIconButton]
})
export class ReportGeneratorComponent {
  reportForm: FormGroup;
  
  selectedEvent: CatalogEvent | null = null;
  selectedLogSource: CatalogLogSource | null = null;
  selectedOperationType: CatalogOperationType | null = null;

  uploadedImages: { name: string, dataUrl: string }[] = [];
  generatedHtml = '';
  showPreview = false;
  activeClientAlert: ClientAlertEvaluation | null = null;
  isEvaluatingClientAlert = false;
  private readonly acknowledgedRuleIds = new Set<string>();

  constructor(
    private fb: FormBuilder,
    public catalogService: CatalogService,
    private snackBar: MatSnackBar,
    private escalationService: EscalationService,
    private dialog: MatDialog
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
        this.uploadedImages.push({
          name: file.name,
          dataUrl: e.target.result
        });
      };
      reader.readAsDataURL(file);
    }
  }

  removeImage(index: number): void {
    this.uploadedImages.splice(index, 1);
  }

  generateTable(): void {
    if (this.reportForm.invalid) {
      this.reportForm.markAllAsTouched();
      this.snackBar.open('Completa todos los campos obligatorios', 'Cerrar', { duration: 3000 });
      return;
    }

    const form = this.reportForm.value;
    const fechaFormateada = new Date(form.fecha).toLocaleDateString('es-CL');

    const cellDetailStyle = 'border: 1px solid #2b2b2b; word-break: break-word; overflow-wrap: anywhere; vertical-align: top;';
    const cellLabelStyle = 'background-color: #8BC34A; font-weight: bold; border: 1px solid #2b2b2b; word-break: break-word; overflow-wrap: anywhere; vertical-align: top; max-width: 200px;';

    let html = `<table cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; border: 1px solid #2b2b2b;">
  <tr>
    <th colspan="2" style="background-color: #4CAF50; color: white; text-align: center; font-size: 18px; border: 1px solid #2b2b2b;">Reporte de Detección</th>
  </tr>
  <tr>
    <th style="background-color: #8BC34A; color: white; width: 30%; border: 1px solid #2b2b2b; word-break: break-word; overflow-wrap: anywhere;">Campo</th>
    <th style="background-color: #8BC34A; color: white; border: 1px solid #2b2b2b; word-break: break-word; overflow-wrap: anywhere;">Detalle</th>
  </tr>
  <tr>
    <td style="${cellLabelStyle}">Tipo de operación</td>
    <td style="${cellDetailStyle}">${form.tipoOperacion}</td>
  </tr>
  <tr>
    <td style="${cellLabelStyle}">Ofensa/Código interno</td>
    <td style="${cellDetailStyle}">${form.codigoInterno || '-'}</td>
  </tr>
  <tr>
    <td style="${cellLabelStyle}">Nombre de Ofensa/Evento</td>
    <td style="${cellDetailStyle}">${form.nombreEvento}</td>
  </tr>
  <tr>
    <td style="${cellLabelStyle}">Motivo de la Ofensa/Evento</td>
    <td style="${cellDetailStyle}">${form.motivoEvento}</td>
  </tr>
  <tr>
    <td style="${cellLabelStyle}">Fecha</td>
    <td style="${cellDetailStyle}">${fechaFormateada}</td>
  </tr>
  <tr>
    <td style="${cellLabelStyle}">MRSC (Criticidad)</td>
    <td style="${cellDetailStyle}">${form.criticidad}</td>
  </tr>
  <tr>
    <td style="${cellLabelStyle}">Origen de conexión</td>
    <td style="${cellDetailStyle}">${form.origenConexion || '-'}</td>
  </tr>
  <tr>
    <td style="${cellLabelStyle}">Fuente / Log Source</td>
    <td style="${cellDetailStyle}">${form.logSource}</td>
  </tr>
  <tr>
    <td style="${cellLabelStyle}">Destino</td>
    <td style="${cellDetailStyle}">${form.destino || '-'}</td>
  </tr>
  <tr>
    <td style="${cellLabelStyle}">Reputación de origen</td>
    <td style="${cellDetailStyle}">${form.reputacionOrigen}</td>
  </tr>
  <tr>
    <td style="${cellLabelStyle}">Observaciones</td>
    <td style="white-space: pre-wrap; ${cellDetailStyle}">${form.observaciones}</td>
  </tr>`;

    const evidenciaTexto = (form.evidenciaTexto || '').trim();
    const hasImages = this.uploadedImages.length > 0;
    const hasTextEvidence = evidenciaTexto.length > 0;

    if (hasImages || hasTextEvidence) {
      html += `\n  <tr>\n    <td style="${cellLabelStyle}">Evidencia</td>\n    <td style="${cellDetailStyle}">`;
      if (hasTextEvidence) {
        html += `<div style="white-space: pre-wrap; margin-bottom: ${hasImages ? '10px' : '0'};">${evidenciaTexto}</div>`;
      }
      if (hasImages) {
        this.uploadedImages.forEach(img => {
          html += `<img src="${img.dataUrl}" style="max-width: 100%; height: auto; max-height: 420px; object-fit: contain; margin: 8px auto; display: block; border: 1px solid #ddd;"><br>`;
        });
      }
      html += `</td>\n  </tr>`;
    } else {
      html += `\n  <tr>\n    <td style="${cellLabelStyle}">Evidencia</td>\n    <td style="${cellDetailStyle}">Se adjunta en el correo</td>\n  </tr>`;
    }

    html += `
  <tr>
    <td style="${cellLabelStyle}">Recomendación</td>
    <td style="white-space: pre-wrap; ${cellDetailStyle}">${form.recomendacion || '-'}</td>
  </tr>
  <tr>
    <td style="${cellLabelStyle}">Información adicional</td>
    <td style="white-space: pre-wrap; ${cellDetailStyle}">${form.informacionAdicional || '-'}</td>
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

      navigator.clipboard.write([item]).then(() => {
        this.snackBar.open('✅ Tabla copiada con formato', 'Cerrar', { duration: 2000 });
      }).catch(() => {
        this.snackBar.open('Error al copiar con formato. Prueba copiar HTML.', 'Cerrar', { duration: 3000 });
      });
      return;
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

  clearForm(): void {
    this.selectedEvent = null;
    this.selectedLogSource = null;
    this.selectedOperationType = null;
    this.reportForm.reset({
      fecha: new Date(),
      criticidad: 'media',
      reputacionOrigen: 'Interna'
    });
    this.uploadedImages = [];
    this.generatedHtml = '';
    this.showPreview = false;
    this.activeClientAlert = null;
  }
}
