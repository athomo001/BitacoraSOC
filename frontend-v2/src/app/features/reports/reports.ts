import { ChangeDetectionStrategy, Component, DestroyRef, Injector, OnInit, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { PermissionsService } from '../../core/auth/permissions.service';
import { ModuleAccessService } from '../../core/auth/module-access.service';
import { problemDetail } from '../../core/http-error';
import { LogSource, Organization, OrganizationsService } from '../../core/organizations/organizations.service';
import { EscalationService, SocService } from '../../core/escalation/escalation.service';
import { DirectoryContact, DirectoryService } from '../../core/directory/directory.service';
import {
  AlertContext,
  BulletinFields,
  IncidentFields,
  OperationType,
  ReportHistoryItem,
  ReportImage,
  ReportKind,
  ReportRequest,
  ReportsService,
} from '../../core/reports/reports.service';
import { ClientAlertDialogComponent, ClientAlertDialogData } from './client-alert-dialog';

const DRAFT_KEY = 'bitacora.reports.draft';
const PREVIEW_WIDTH_KEY = 'bitacora.reports.previewWidth';
const PREVIEW_DEFAULT = 460;
const PREVIEW_MIN = 320;
/** Lo mínimo que se le deja al formulario al agrandar la vista previa. */
const FORM_MIN = 420;
const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export const CRITICALITIES = ['baja', 'media', 'alta', 'critica'] as const;
export const REPUTATIONS = ['Interna', 'Externa', 'Desconocida', 'Maliciosa'] as const;

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const emptyIncident = (): IncidentFields => ({
  codigoTicket: '',
  ofensa: '',
  tipoOperacion: '',
  nombreEvento: '',
  fecha: today(),
  criticidad: 'media',
  motivoEvento: '',
  observaciones: '',
  recomendacion: '',
  informacionAdicional: '',
  origenConexion: '',
  destino: '',
  reputacionOrigen: 'Interna',
  evidenciaTexto: '',
  logSource: '',
});

export const emptyBulletin = (): BulletinFields => ({
  tituloBoletin: '',
  marcaFabricante: '',
  cveIdentificadores: '',
  criticidad: 'media',
  productosAfectados: '',
  impacto: '',
  recomendacion: '',
  referencias: '',
});

/**
 * Defang de IoCs (canvas v18): http→hxxp y el punto de IPs y dominios como
 * [.], para que nadie haga clic por error en el correo del cliente. Lo ya
 * defangeado no cambia.
 */
export function defang(text: string): string {
  return text
    .replace(/\bhttp(s?):\/\//gi, (_m, s: string) => `hxxp${s}://`)
    .replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, '$1[.]$2[.]$3[.]$4')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi, (m) => m.replace(/\./g, '[.]'));
}

/** Saludo según la hora (va en español: los correos salen en el formato del área). */
export function salutation(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

interface Draft {
  mode: ReportKind;
  incident: IncidentFields;
  bulletin: BulletinFields;
  organizationId: string;
  serviceId: string;
  to: string[];
  cc: string[];
  subject: string | null;
  greeting: string | null;
}

type PreviewImage = ReportImage & { url: string };

/**
 * Reportes (comentario del dueño #10, canvas v18–v20): informe de incidente
 * ("Reporte de Detección") y boletín de seguridad que salen por correo al
 * cliente, en el formato del área (el HTML lo arma el servidor, igual que el
 * legacy). Portado de pages/main/report-generator del legacy: mismos campos,
 * tipos de operación con su "Información adicional", evidencias con Ctrl+V y
 * aviso del cliente antes de enviar. Nuevo: borrador automático, vista previa
 * en vivo, Para/CC propuestos desde el escalamiento y desde el Directorio,
 * saludo propuesto, defang de IoCs y el historial con "Usar como base".
 */
@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [FormsModule, DatePipe, MatIconModule],
  templateUrl: './reports.html',
  styleUrl: './reports.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportsComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly perms = inject(PermissionsService);
  private readonly reports = inject(ReportsService);
  private readonly organizationsApi = inject(OrganizationsService);
  private readonly escalation = inject(EscalationService);
  private readonly directory = inject(DirectoryService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly injector = inject(Injector);
  private readonly modules = inject(ModuleAccessService);

  protected readonly criticalities = CRITICALITIES;
  protected readonly reputations = REPUTATIONS;

  protected readonly tab = signal<'new' | 'history'>('new');
  protected readonly mode = signal<ReportKind>('incident');

  // Catálogos
  protected readonly organizations = signal<Organization[]>([]);
  private readonly allServices = signal<SocService[]>([]);
  protected readonly logSources = signal<LogSource[]>([]);
  protected readonly operationTypes = signal<OperationType[]>([]);
  protected readonly hasServices = computed(() => this.allServices().length > 0);
  protected readonly services = computed(() => this.allServices().filter((s) => s.active && s.organizationId === this.organizationId()));

  // Formulario
  protected readonly incident = signal<IncidentFields>(emptyIncident());
  protected readonly bulletin = signal<BulletinFields>(emptyBulletin());
  protected readonly organizationId = signal('');
  protected readonly serviceId = signal('');
  protected readonly images = signal<PreviewImage[]>([]);
  protected readonly to = signal<string[]>([]);
  protected readonly cc = signal<string[]>([]);
  protected readonly toInput = signal('');
  protected readonly ccInput = signal('');
  protected readonly groupByDomain = signal(true);
  /** null = se usa la propuesta (aún no lo tocó el operador). */
  private readonly subjectOverride = signal<string | null>(null);
  private readonly greetingOverride = signal<string | null>(null);
  /** Nombres de quienes se agregaron desde el Directorio (para el saludo). */
  private readonly knownNames = signal<Record<string, string>>({});
  protected readonly dragging = signal(false);

  // Directorio
  protected readonly pickerFor = signal<'to' | 'cc' | null>(null);
  protected readonly pickerQuery = signal('');
  protected readonly pickerResults = signal<DirectoryContact[]>([]);

  // Vista previa, borrador y envío
  protected readonly previewHtml = signal<SafeHtml | null>(null);
  private previewRaw = '';
  protected readonly previewing = signal(false);
  protected readonly previewError = signal('');
  protected readonly draftSavedAt = signal<Date | null>(null);
  protected readonly busy = signal(false);
  protected readonly notice = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Ancho de la vista previa: se arrastra el divisor (o flechas con el foco en él).
  protected readonly previewWidth = signal(readPreviewWidth());
  protected readonly resizing = signal(false);
  protected readonly splitColumns = computed(() => `minmax(0, 1fr) 6px ${this.previewWidth()}px`);

  // Historial
  protected readonly history = signal<ReportHistoryItem[]>([]);
  protected readonly historyTotal = signal(0);
  protected readonly historyPage = signal(1);
  protected readonly historyKind = signal<ReportKind | ''>('');
  protected readonly historyLoading = signal(false);
  protected readonly selected = signal<ReportHistoryItem | null>(null);
  protected readonly selectedHtml = signal<SafeHtml | null>(null);
  protected readonly confirmDelete = signal(false);

  protected readonly canSend = computed(() => this.perms.user()?.role !== 'auditor');
  protected readonly clientName = computed(() => this.organizations().find((o) => o.id === this.organizationId())?.name ?? '');

  protected readonly proposedSubject = computed(() => {
    if (this.mode() === 'bulletin') {
      const title = this.bulletin().tituloBoletin.trim();
      return title ? `Boletín de Seguridad: ${title}` : 'Boletín de Seguridad';
    }
    const f = this.incident();
    const org = this.organizations().find((o) => o.id === this.organizationId());
    const what = f.nombreEvento.trim() || f.ofensa.trim() || 'Reporte de Incidente de Seguridad';
    const prefix = org ? `[${org.code || org.name}] ` : '';
    const ticket = f.codigoTicket.trim() ? ` (${f.codigoTicket.trim()})` : '';
    return `${prefix}${what}${ticket}`;
  });
  protected readonly subject = computed(() => this.subjectOverride() ?? this.proposedSubject());

  protected readonly proposedGreeting = computed(() => {
    const first = this.to()[0];
    const name = first ? this.knownNames()[first.toLowerCase()]?.split(' ')[0] : '';
    const hello = `${salutation(new Date().getHours())}${name ? ' ' + name : ''},`;
    const body =
      this.mode() === 'bulletin'
        ? 'Compartimos el siguiente boletín de seguridad.'
        : 'Se informa el siguiente evento de seguridad detectado por nuestros sistemas de monitoreo.';
    return `${hello}\n\n${body}`;
  });
  protected readonly greeting = computed(() => this.greetingOverride() ?? this.proposedGreeting());

  /** Lo que se manda al backend (vista previa y envío). */
  protected readonly request = computed<ReportRequest>(() => ({
    organizationId: this.organizationId() || undefined,
    serviceId: this.serviceId() || undefined,
    incident: this.mode() === 'incident' ? this.incident() : undefined,
    bulletin: this.mode() === 'bulletin' ? this.bulletin() : undefined,
    images: this.images().map(({ name, contentType, base64, width, height }) => ({ name, contentType, base64, width, height })),
    to: this.to(),
    cc: this.cc(),
    subject: this.subject(),
    greeting: this.greeting(),
    groupByDomain: this.mode() === 'bulletin' ? this.groupByDomain() : undefined,
  }));

  protected readonly missing = computed<MessageKey | null>(() => {
    if (this.mode() === 'incident') {
      const f = this.incident();
      if (!this.organizationId()) return 'rpt.missing.client';
      if (!f.codigoTicket.trim() || !f.ofensa.trim() || !f.tipoOperacion.trim() || !f.nombreEvento.trim() || !f.observaciones.trim()) {
        return 'rpt.missing.fields';
      }
    } else {
      const f = this.bulletin();
      if (!f.tituloBoletin.trim() || !f.marcaFabricante.trim() || !f.productosAfectados.trim() || !f.impacto.trim() || !f.recomendacion.trim()) {
        return 'rpt.missing.fields';
      }
    }
    if (!this.to().length) return 'rpt.missing.to';
    return null;
  });

  constructor() {
    this.restoreDraft();
    // Vista previa en vivo: el servidor arma el mismo HTML que se envía.
    let previewTimer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const kind = this.mode();
      const req = this.request();
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => void this.refreshPreview(kind, req), 600);
    });
    // Borrador automático (sin evidencias: pesan).
    let draftTimer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const draft: Draft = {
        mode: this.mode(),
        incident: this.incident(),
        bulletin: this.bulletin(),
        organizationId: this.organizationId(),
        serviceId: this.serviceId(),
        to: this.to(),
        cc: this.cc(),
        subject: this.subjectOverride(),
        greeting: this.greetingOverride(),
      };
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        try {
          localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
          this.draftSavedAt.set(new Date());
        } catch {
          // Sin almacenamiento (ventana privada): no hay borrador, nada más.
        }
      }, 800);
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(previewTimer);
      clearTimeout(draftTimer);
    });
  }

  async ngOnInit(): Promise<void> {
    // Los servicios son del módulo SOC; con solo NOC el reporte va sin servicio.
    await this.modules.load().catch(() => undefined);
    const [orgs, services, sources, types] = await Promise.allSettled([
      this.organizationsApi.list({ clients: true, active: true }),
      this.modules.has('soc') ? this.escalation.listServices() : Promise.resolve([]),
      this.organizationsApi.listLogSources(),
      this.reports.operationTypes(),
    ]);
    if (orgs.status === 'fulfilled') this.organizations.set(orgs.value);
    if (services.status === 'fulfilled') this.allServices.set(services.value);
    if (sources.status === 'fulfilled') this.logSources.set(sources.value.filter((s) => s.active));
    if (types.status === 'fulfilled') this.operationTypes.set(types.value.filter((t) => t.enabled));
    void this.loadHistory();
  }

  // ─── Formulario ───────────────────────────────────────────────────────

  protected setMode(mode: ReportKind): void {
    this.mode.set(mode);
    this.notice.set(null);
  }

  protected setIncident<K extends keyof IncidentFields>(key: K, value: IncidentFields[K]): void {
    this.incident.update((f) => ({ ...f, [key]: value }));
  }

  protected setBulletin<K extends keyof BulletinFields>(key: K, value: BulletinFields[K]): void {
    this.bulletin.update((f) => ({ ...f, [key]: value }));
  }

  /** Como el legacy: elegir el tipo rellena "Información adicional". */
  protected pickOperationType(name: string): void {
    const type = this.operationTypes().find((t) => t.name === name);
    this.incident.update((f) => ({ ...f, tipoOperacion: name, informacionAdicional: type ? type.infoDefault : f.informacionAdicional }));
  }

  protected setSubject(value: string): void {
    this.subjectOverride.set(value);
  }

  protected setGreeting(value: string): void {
    this.greetingOverride.set(value);
  }

  protected resetSubject(): void {
    this.subjectOverride.set(null);
  }

  protected resetGreeting(): void {
    this.greetingOverride.set(null);
  }

  protected async pickOrganization(id: string): Promise<void> {
    this.organizationId.set(id);
    this.serviceId.set('');
    await this.proposeRecipients();
  }

  protected async pickService(id: string): Promise<void> {
    this.serviceId.set(id);
    await this.proposeRecipients();
  }

  /** Para/CC del escalamiento del cliente, solo si el operador no puso otros. */
  private async proposeRecipients(): Promise<void> {
    const org = this.organizationId();
    if (!org || this.to().length || this.cc().length) return;
    try {
      const proposal = await this.reports.recipients(org, this.serviceId() || undefined);
      if (!this.to().length && !this.cc().length && this.organizationId() === org) {
        this.to.set(proposal.to);
        this.cc.set(proposal.cc.filter((e) => !proposal.to.includes(e)));
      }
    } catch {
      // Sin propuesta: el operador los escribe.
    }
  }

  protected defangIocs(): void {
    if (this.mode() === 'incident') {
      this.incident.update((f) => ({
        ...f,
        origenConexion: defang(f.origenConexion),
        destino: defang(f.destino),
        evidenciaTexto: defang(f.evidenciaTexto),
      }));
    } else {
      this.bulletin.update((f) => ({ ...f, referencias: defang(f.referencias) }));
    }
  }

  protected clearForm(): void {
    this.incident.set(emptyIncident());
    this.bulletin.set(emptyBulletin());
    this.organizationId.set('');
    this.serviceId.set('');
    this.images.set([]);
    this.to.set([]);
    this.cc.set([]);
    this.subjectOverride.set(null);
    this.greetingOverride.set(null);
    this.notice.set(null);
  }

  private restoreDraft(): void {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<Draft>;
      if (d.mode === 'incident' || d.mode === 'bulletin') this.mode.set(d.mode);
      if (d.incident) this.incident.set({ ...emptyIncident(), ...d.incident });
      if (d.bulletin) this.bulletin.set({ ...emptyBulletin(), ...d.bulletin });
      this.organizationId.set(d.organizationId ?? '');
      this.serviceId.set(d.serviceId ?? '');
      this.to.set(Array.isArray(d.to) ? d.to : []);
      this.cc.set(Array.isArray(d.cc) ? d.cc : []);
      this.subjectOverride.set(d.subject ?? null);
      this.greetingOverride.set(d.greeting ?? null);
    } catch {
      // Borrador ilegible: se parte de cero.
    }
  }

  private clearDraft(): void {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // nada que limpiar
    }
  }

  // ─── Destinatarios ────────────────────────────────────────────────────

  protected recipients(kind: 'to' | 'cc') {
    return kind === 'to' ? this.to : this.cc;
  }

  /** Enter, coma o punto y coma agregan; también al pegar una lista. */
  protected addTyped(kind: 'to' | 'cc', raw: string): void {
    const parts = raw.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
    const bad = parts.filter((p) => !EMAIL.test(p));
    for (const email of parts.filter((p) => EMAIL.test(p))) {
      this.addRecipient(kind, email);
    }
    (kind === 'to' ? this.toInput : this.ccInput).set(bad.join(' '));
  }

  protected onRecipientKey(kind: 'to' | 'cc', event: KeyboardEvent): void {
    const input = event.target as HTMLInputElement;
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      event.preventDefault();
      this.addTyped(kind, input.value);
    } else if (event.key === 'Backspace' && !input.value) {
      this.recipients(kind).update((l) => l.slice(0, -1));
    }
  }

  private addRecipient(kind: 'to' | 'cc', email: string): void {
    const lower = email.toLowerCase();
    const other = kind === 'to' ? this.cc : this.to;
    other.update((l) => l.filter((e) => e.toLowerCase() !== lower));
    this.recipients(kind).update((l) => (l.some((e) => e.toLowerCase() === lower) ? l : [...l, email]));
  }

  protected removeRecipient(kind: 'to' | 'cc', email: string): void {
    this.recipients(kind).update((l) => l.filter((e) => e !== email));
  }

  protected openPicker(kind: 'to' | 'cc'): void {
    this.pickerFor.set(this.pickerFor() === kind ? null : kind);
    this.pickerQuery.set('');
    this.pickerResults.set([]);
  }

  protected async searchDirectory(q: string): Promise<void> {
    this.pickerQuery.set(q);
    if (q.trim().length < 2) {
      this.pickerResults.set([]);
      return;
    }
    try {
      const found = await this.directory.search(q.trim());
      if (this.pickerQuery() === q) this.pickerResults.set(found.filter((c) => !!c.email));
    } catch {
      this.pickerResults.set([]);
    }
  }

  protected pickContact(contact: DirectoryContact): void {
    const kind = this.pickerFor();
    if (!kind || !contact.email) return;
    this.addRecipient(kind, contact.email);
    this.knownNames.update((m) => ({ ...m, [contact.email.toLowerCase()]: contact.name }));
    this.pickerFor.set(null);
  }

  // ─── Evidencias ───────────────────────────────────────────────────────

  protected onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    void this.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  protected onPaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      void this.addFiles(files);
    }
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    void this.addFiles(Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/')));
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  private async addFiles(files: File[]): Promise<void> {
    for (const file of files) {
      if (this.images().length >= MAX_IMAGES) {
        this.notice.set({ kind: 'error', text: this.i18n.t('rpt.images.max') });
        return;
      }
      if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size > MAX_IMAGE_BYTES) {
        this.notice.set({ kind: 'error', text: this.i18n.t('rpt.images.invalid') });
        continue;
      }
      const url = await readAsDataUrl(file);
      const { width, height } = await imageSize(url);
      const name = file.name && file.name !== 'image.png' ? file.name : `evidencia-${this.images().length + 1}.png`;
      this.images.update((l) => [...l, { name, contentType: file.type, base64: url.slice(url.indexOf(',') + 1), width, height, url }]);
    }
  }

  protected removeImage(index: number): void {
    this.images.update((l) => l.filter((_, i) => i !== index));
  }

  // ─── Vista previa, copiar y enviar ────────────────────────────────────

  private async refreshPreview(kind: ReportKind, req: ReportRequest): Promise<void> {
    this.previewing.set(true);
    try {
      const res = await this.reports.preview(kind, req);
      this.previewRaw = res.html;
      this.previewHtml.set(this.sanitizer.bypassSecurityTrustHtml(res.html));
      this.previewError.set('');
    } catch (err) {
      this.previewError.set(problemDetail(err, this.i18n.t('rpt.previewFailed')));
    } finally {
      this.previewing.set(false);
    }
  }

  /** Muestra los avisos vigentes del cliente; false si el operador vuelve atrás. */
  private async passClientAlerts(context: AlertContext): Promise<boolean> {
    const org = this.organizationId();
    if (!org) return true;
    let alerts;
    try {
      alerts = await this.reports.activeAlerts(org, context);
    } catch {
      return true; // el servidor vuelve a revisar al enviar
    }
    if (!alerts.length) return true;
    const ref = this.injector.get(Dialog).open<boolean, ClientAlertDialogData>(ClientAlertDialogComponent, {
      data: { clientName: this.clientName(), context, alerts },
      ariaLabel: this.i18n.tf('rpt.alert.title', this.clientName()),
    });
    return (await firstValueFrom(ref.closed)) === true;
  }

  protected async copy(format: 'html' | 'markdown'): Promise<void> {
    if (!(await this.passClientAlerts('copy-report'))) return;
    try {
      if (format === 'html') {
        const text = this.previewText();
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([this.previewRaw], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(this.markdown());
      }
      this.notice.set({ kind: 'ok', text: this.i18n.t('rpt.copied') });
    } catch {
      this.notice.set({ kind: 'error', text: this.i18n.t('rpt.copyFailed') });
    }
  }

  private previewText(): string {
    const doc = new DOMParser().parseFromString(this.previewRaw, 'text/html');
    return doc.body.innerText || doc.body.textContent || '';
  }

  /** El reporte en Markdown, para tickets y chats (los nombres del legacy). */
  protected markdown(): string {
    const row = (k: string, v: string) => (v.trim() ? `| ${k} | ${v.trim().replace(/\|/g, '\\|').replace(/\n/g, '<br>')} |\n` : '');
    if (this.mode() === 'bulletin') {
      const f = this.bulletin();
      return (
        `# Boletín de Seguridad: ${f.tituloBoletin}\n\n| Campo | Valor |\n|---|---|\n` +
        row('Fabricante', f.marcaFabricante) +
        row('CVE', f.cveIdentificadores) +
        row('Criticidad', f.criticidad.toUpperCase()) +
        row('Productos afectados', f.productosAfectados) +
        row('Impacto', f.impacto) +
        row('Recomendación', f.recomendacion) +
        row('Referencias', f.referencias)
      );
    }
    const f = this.incident();
    return (
      `# Reporte de Detección: ${f.nombreEvento}\n\n| Campo | Valor |\n|---|---|\n` +
      row('Cliente', this.clientName()) +
      row('Ticket', f.codigoTicket) +
      row('Ofensa', f.ofensa) +
      row('Tipo de operación', f.tipoOperacion) +
      row('Fecha', f.fecha) +
      row('MRSC (Criticidad)', f.criticidad.toUpperCase()) +
      row('Motivo', f.motivoEvento) +
      row('Origen', f.origenConexion) +
      row('Destino', f.destino) +
      row('Reputación del origen', f.reputacionOrigen) +
      row('Log source', f.logSource) +
      row('Observaciones', f.observaciones) +
      row('Evidencia', f.evidenciaTexto) +
      row('Recomendación', f.recomendacion) +
      row('Información adicional', f.informacionAdicional)
    );
  }

  protected async send(retry = true): Promise<void> {
    const missing = this.missing();
    if (missing) {
      this.notice.set({ kind: 'error', text: this.i18n.t(missing) });
      return;
    }
    if (!(await this.passClientAlerts('report'))) return;
    this.busy.set(true);
    this.notice.set(null);
    try {
      const res = await this.reports.send(this.mode(), this.request());
      const partial = res.status === 'partial';
      this.clearForm();
      this.clearDraft();
      this.notice.set({
        kind: partial ? 'error' : 'ok',
        text: partial ? `${this.i18n.t('rpt.sentPartial')} ${res.failures.join(' · ')}` : this.i18n.t('rpt.sent'),
      });
      void this.loadHistory();
    } catch (err) {
      if (retry && err instanceof HttpErrorResponse && err.status === 409) {
        this.busy.set(false);
        await this.send(false);
        return;
      }
      this.notice.set({ kind: 'error', text: problemDetail(err, this.i18n.t('rpt.sendFailed')) });
    } finally {
      this.busy.set(false);
    }
  }

  // ─── Ancho de la vista previa ─────────────────────────────────────────

  protected startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const container = handle.parentElement as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    this.resizing.set(true);
    const move = (e: PointerEvent) => {
      const right = container.getBoundingClientRect().right;
      this.setPreviewWidth(right - e.clientX, container.clientWidth);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      this.resizing.set(false);
      this.savePreviewWidth();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  protected resizeByKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 80 : 20;
    const delta = event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0;
    if (!delta) return;
    event.preventDefault();
    const container = (event.currentTarget as HTMLElement).parentElement as HTMLElement;
    this.setPreviewWidth(this.previewWidth() + delta, container.clientWidth);
    this.savePreviewWidth();
  }

  protected resetPreviewWidth(): void {
    this.previewWidth.set(PREVIEW_DEFAULT);
    this.savePreviewWidth();
  }

  private setPreviewWidth(width: number, containerWidth: number): void {
    const max = Math.max(PREVIEW_MIN, containerWidth - FORM_MIN);
    this.previewWidth.set(Math.round(Math.min(max, Math.max(PREVIEW_MIN, width))));
  }

  private savePreviewWidth(): void {
    try {
      localStorage.setItem(PREVIEW_WIDTH_KEY, String(this.previewWidth()));
    } catch {
      // sin almacenamiento: vale solo para esta visita
    }
  }

  // ─── Historial ────────────────────────────────────────────────────────

  protected async loadHistory(): Promise<void> {
    this.historyLoading.set(true);
    try {
      const res = await this.reports.history(this.historyKind(), this.historyPage());
      this.history.set(res.items);
      this.historyTotal.set(res.meta?.total ?? res.items.length);
    } catch (err) {
      this.notice.set({ kind: 'error', text: problemDetail(err, this.i18n.t('rpt.historyFailed')) });
    } finally {
      this.historyLoading.set(false);
    }
  }

  protected setHistoryKind(kind: ReportKind | ''): void {
    this.historyKind.set(kind);
    this.historyPage.set(1);
    void this.loadHistory();
  }

  protected setHistoryPage(page: number): void {
    this.historyPage.set(page);
    void this.loadHistory();
  }

  protected readonly historyPages = computed(() => Math.max(1, Math.ceil(this.historyTotal() / 50)));

  protected async selectHistory(item: ReportHistoryItem): Promise<void> {
    this.confirmDelete.set(false);
    this.selected.set(item);
    this.selectedHtml.set(null);
    try {
      const full = await this.reports.historyItem(item.id);
      if (this.selected()?.id !== item.id) return;
      this.selected.set(full);
      this.selectedHtml.set(this.sanitizer.bypassSecurityTrustHtml(full.html ?? ''));
    } catch (err) {
      this.notice.set({ kind: 'error', text: problemDetail(err, this.i18n.t('rpt.historyFailed')) });
    }
  }

  /** "Usar como base" copia los campos; "Reenviar" además destinatarios y asunto. */
  protected reuse(item: ReportHistoryItem, withRecipients: boolean): void {
    const payload = item.payload ?? {};
    this.clearForm();
    this.mode.set(item.kind);
    if (payload.incident) this.incident.set({ ...emptyIncident(), ...payload.incident });
    if (payload.bulletin) this.bulletin.set({ ...emptyBulletin(), ...payload.bulletin });
    this.organizationId.set(item.organizationId ?? '');
    if (withRecipients) {
      this.to.set([...item.recipients]);
      this.cc.set([...item.cc]);
      if (item.subject) this.subjectOverride.set(item.subject);
    }
    this.tab.set('new');
  }

  protected async deleteSelected(): Promise<void> {
    const item = this.selected();
    if (!item) return;
    try {
      await this.reports.deleteHistory(item.id);
      this.selected.set(null);
      this.selectedHtml.set(null);
      this.confirmDelete.set(false);
      await this.loadHistory();
    } catch (err) {
      this.notice.set({ kind: 'error', text: problemDetail(err, this.i18n.t('rpt.historyFailed')) });
    }
  }

  protected statusTone(status: ReportHistoryItem['status']): string {
    return { sent: 'tone-ok', partial: 'tone-warn', failed: 'tone-bad', legacy: 'tone-neutral' }[status];
  }

  protected statusLabel(status: ReportHistoryItem['status']): MessageKey {
    return `rpt.status.${status}`;
  }

  protected critLabel(c: string): MessageKey {
    return `rpt.crit.${c}` as MessageKey;
  }
}

function readPreviewWidth(): number {
  try {
    const stored = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
    if (Number.isFinite(stored) && stored >= PREVIEW_MIN) return stored;
  } catch {
    // sin almacenamiento
  }
  return PREVIEW_DEFAULT;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function imageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}
