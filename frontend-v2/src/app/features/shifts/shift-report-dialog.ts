import { ChangeDetectionStrategy, Component, Injector, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ChecklistsService, Handover, ShiftCheck, ShiftClosure, ShiftStats } from '../../core/checklists/checklists.service';
import { EntriesService } from '../../core/entries/entries.service';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { SHIFT_REPORT_TAG, ShiftReportMode, buildShiftReport, parsePending, sanitizeMetric } from '../../core/shifts/shift-report';
import { WorkShift } from '../../core/shifts/shifts.service';
import { MarkdownComponent } from '../../shared/markdown/markdown';
import { appendSnippet, openMarkdownHelp } from '../../shared/markdown/markdown-help-dialog';

import '../../core/i18n/packs/shifts';
export interface ShiftReportData {
  mode: ShiftReportMode;
  shift: WorkShift;
  handover: Handover | null;
  /** Checklist de cierre enviado y todavía sin cierre formal: habilita "Cerrar turno". */
  closureCheck: ShiftCheck | null;
}

/** Lo que pasó en el popup; Mi turno actualiza su estado con esto. */
export interface ShiftReportResult {
  inicioSaved?: boolean;
  cierreSaved?: boolean;
  closure?: ShiftClosure;
  relay?: ShiftClosure;
  /** "Completar ahora": llevar al checklist de cierre. */
  goToChecklist?: boolean;
}

interface Draft {
  metric: string;
  tickets: string;
  notes: string;
  pending: string;
  carried: { text: string; done: boolean }[];
}

/**
 * Popup de Inicio y Cierre de turno (comentarios del dueño #6/#6.1, artboard
 * "Turnos: popup de Inicio y Cierre de turno", aprobado 2026-10-03). Arma la
 * entrada #iniciodeturno / #cierredeturno como el diálogo del legacy, con
 * vista previa. El texto se guarda cuando sea; "Cerrar turno" (registro y
 * reporte) sigue pidiendo el checklist de cierre. Lo escrito queda como
 * borrador local para "Seguir después".
 */
@Component({
  selector: 'app-shift-report-dialog',
  standalone: true,
  imports: [FormsModule, DatePipe, MatIconModule, MarkdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shift-report-dialog.html',
  styleUrl: './shift-report-dialog.css',
})
export class ShiftReportDialogComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly data = inject<ShiftReportData>(DIALOG_DATA);
  private readonly ref = inject<DialogRef<ShiftReportResult>>(DialogRef);
  private readonly checklists = inject(ChecklistsService);
  private readonly entries = inject(EntriesService);
  private readonly injector = inject(Injector);

  protected readonly mode = signal<ShiftReportMode>(this.data.mode);
  protected readonly stats = signal<ShiftStats | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly notify = signal(true);
  protected readonly relay = signal<ShiftClosure | null>(this.data.handover?.previousClosure ?? null);
  private readonly result: ShiftReportResult = {};

  protected readonly drafts = signal<Record<ShiftReportMode, Draft>>({
    inicio: this.loadDraft('inicio') ?? { metric: '', tickets: '', notes: '', pending: '', carried: parsePending(this.data.handover?.previousClosure?.pendingForNextShift) },
    cierre: this.loadDraft('cierre') ?? { metric: '', tickets: '', notes: '', pending: '', carried: [] },
  });
  protected readonly draft = computed(() => this.drafts()[this.mode()]);
  protected readonly isInicio = computed(() => this.mode() === 'inicio');
  protected readonly canClose = computed(() => !!this.data.closureCheck);

  protected readonly content = computed(() => {
    const d = this.draft();
    const inicio = this.isInicio();
    return buildShiftReport({
      mode: this.mode(),
      metricLabel: this.i18n.t(inicio ? 'shiftReport.metric.inicio' : 'shiftReport.metric.cierre'),
      metricValue: d.metric,
      ticketsText: d.tickets,
      notesText: d.notes,
      carried: inicio ? d.carried : undefined,
      pendingText: inicio ? undefined : d.pending,
      headings: {
        tickets: this.i18n.t(inicio ? 'shiftReport.h.ticketsInicio' : 'shiftReport.h.ticketsCierre'),
        notes: this.i18n.t(inicio ? 'shiftReport.h.notesInicio' : 'shiftReport.h.notesCierre'),
        summary: this.i18n.t('shiftReport.h.summary'),
        carried: this.i18n.t('shiftReport.h.carried'),
        pending: this.i18n.t('shiftReport.h.pending'),
        noTickets: this.i18n.t(inicio ? 'shiftReport.none.incidents' : 'shiftReport.none.tickets'),
        noNotes: this.i18n.t(inicio ? 'shiftReport.none.news' : 'shiftReport.none.notes'),
      },
    });
  });

  async ngOnInit(): Promise<void> {
    try {
      this.stats.set(await this.checklists.shiftStats(this.data.shift.id));
    } catch {
      // Sin cifras el popup funciona igual; solo no se muestran.
    }
  }

  protected setMode(mode: ShiftReportMode): void {
    this.mode.set(mode);
    this.notice.set(null);
    this.error.set(null);
  }

  protected edit(patch: Partial<Draft>): void {
    if (patch.metric !== undefined) patch.metric = sanitizeMetric(patch.metric);
    this.drafts.update((all) => ({ ...all, [this.mode()]: { ...all[this.mode()], ...patch } }));
    this.saveDraft();
  }

  protected toggleCarried(index: number): void {
    this.edit({ carried: this.draft().carried.map((c, i) => (i === index ? { ...c, done: !c.done } : c)) });
  }

  protected async ackRelay(): Promise<void> {
    const prev = this.relay();
    if (!prev || prev.acknowledgedAt) return;
    await this.run(async () => {
      const updated = await this.checklists.acknowledge(prev.id);
      this.relay.set(updated);
      this.result.relay = updated;
    });
  }

  /** Guarda el texto como entrada de la bitácora (inicio o borrador de cierre). */
  protected async save(): Promise<void> {
    await this.run(async () => {
      await this.createEntry();
      if (this.isInicio()) {
        this.result.inicioSaved = true;
        this.done();
      } else {
        this.result.cierreSaved = true;
        this.notice.set(this.i18n.t('shiftReport.savedCierre'));
      }
    });
  }

  /** Cierre formal: entrada #cierredeturno + registro del cierre + reporte. */
  protected async closeShift(): Promise<void> {
    const check = this.data.closureCheck;
    if (!check) return;
    await this.run(async () => {
      if (!this.result.cierreSaved) await this.createEntry();
      this.result.cierreSaved = true;
      const d = this.draft();
      this.result.closure = await this.checklists.close({
        closureCheckId: check.id,
        observations: d.notes.trim(),
        pendingForNextShift: d.pending.trim(),
        notifyEmail: this.notify(),
        syncGlpi: false,
      });
      this.done();
    });
  }

  /** Guía de formato (comentario del dueño #9): se suma a las notas. */
  protected async openFormat(): Promise<void> {
    const snippet = await openMarkdownHelp(this.injector);
    if (snippet) this.edit({ notes: appendSnippet(this.draft().notes, snippet) });
  }

  protected goToChecklist(): void {
    this.result.goToChecklist = true;
    this.ref.close(this.result);
  }

  /** "Seguir después": el borrador queda guardado en este navegador. */
  protected later(): void {
    this.ref.close(this.result);
  }

  private async createEntry(): Promise<void> {
    await this.entries.create({ entryType: 'operativa', scope: 'general', content: this.content(), tags: [SHIFT_REPORT_TAG[this.mode()]] });
  }

  private done(): void {
    this.clearDraft(this.mode());
    this.ref.close(this.result);
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('shiftReport.error')));
    } finally {
      this.busy.set(false);
    }
  }

  private draftKey(mode: ShiftReportMode): string {
    // Un borrador por turno y día: el de ayer no aparece hoy.
    const day = new Date().toISOString().slice(0, 10);
    return `bitacora.shiftReport.${this.data.shift.id}.${mode}.${day}`;
  }

  private loadDraft(mode: ShiftReportMode): Draft | null {
    try {
      const raw = localStorage.getItem(this.draftKey(mode));
      return raw ? (JSON.parse(raw) as Draft) : null;
    } catch {
      return null;
    }
  }

  private saveDraft(): void {
    try {
      localStorage.setItem(this.draftKey(this.mode()), JSON.stringify(this.draft()));
    } catch {
      // Sin almacenamiento no hay borrador; el popup funciona igual.
    }
  }

  private clearDraft(mode: ShiftReportMode): void {
    try {
      localStorage.removeItem(this.draftKey(mode));
    } catch {
      // Nada que limpiar.
    }
  }
}
