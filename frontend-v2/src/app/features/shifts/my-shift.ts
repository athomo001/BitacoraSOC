import { ChangeDetectionStrategy, Component, DestroyRef, Injector, OnInit, computed, inject, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { PermissionsService } from '../../core/auth/permissions.service';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { ChecklistItem, ChecklistsService, ChecklistTemplate, Handover, ShiftCheck, ShiftClosure, ShiftStats } from '../../core/checklists/checklists.service';
import type { ShiftReportResult } from './shift-report-dialog';
import { ChecklistAnswers, CheckStatus, causeSuggestions, depth, emptyAnswers, groupIds, groupStatus, progress, toServices } from '../../core/checklists/checklist-form';
import { currentShift, nextMoment, redLeaves } from '../../core/checklists/shift-detect';
import { ShiftsService, WorkShift } from '../../core/shifts/shifts.service';
import { MarkdownComponent } from '../../shared/markdown/markdown';

type Moment = 'inicio' | 'cierre';

const GUIDE_KEY = 'bitacora.shiftGuideHidden';

function readGuideHidden(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * "Mi turno" según el artboard aprobado (spec/06 §6.6): arriba el relevo
 * del turno anterior en una sola llamada; al centro el checklist con turno y
 * momento detectados solos; a la derecha los últimos checklists; y, en el
 * checklist de cierre, el cierre formal del turno.
 */
@Component({
  selector: 'app-my-shift',
  standalone: true,
  imports: [FormsModule, DatePipe, MatIconModule, MarkdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './my-shift.html',
  styleUrls: ['./my-shift.css', './my-shift-panels.css'],
})
export class MyShiftComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ChecklistsService);
  private readonly checklists = this.api;
  private readonly shiftsApi = inject(ShiftsService);
  private readonly perms = inject(PermissionsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  readonly viewHistory = output<void>();

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly handover = signal<Handover | null>(null);
  protected readonly templates = signal<ChecklistTemplate[]>([]);
  protected readonly shifts = signal<WorkShift[]>([]);
  protected readonly recent = signal<ShiftCheck[]>([]);

  protected readonly shiftId = signal('');
  protected readonly moment = signal<Moment>('inicio');
  protected readonly templateId = signal('');
  protected readonly answers = signal<ChecklistAnswers>({});
  private readonly touched = signal(false);

  /** Último checklist guardado en esta pantalla (muestra el resumen en vez del formulario). */
  protected readonly saved = signal<ShiftCheck | null>(null);
  /** Check de cierre que falta cerrar formalmente (recién guardado o de antes de recargar). */
  protected readonly closureCheck = signal<ShiftCheck | null>(null);
  protected readonly closure = signal<ShiftClosure | null>(null);
  /** Si ya se escribió el inicio / cierre de este turno (botones de arriba). */
  protected readonly stats = signal<ShiftStats | null>(null);

  protected readonly guideHidden = signal(readGuideHidden());

  protected readonly shift = computed(() => this.shifts().find((s) => s.id === this.shiftId()) ?? null);
  protected readonly template = computed(() => this.templates().find((t) => t.id === this.templateId()) ?? null);
  private readonly items = computed<ChecklistItem[]>(() => this.template()?.items ?? []);
  private readonly groups = computed(() => groupIds(this.items()));
  protected readonly progress = computed(() => progress(this.items(), this.answers()));
  protected readonly suggestions = computed(() => causeSuggestions(this.items(), this.answers()));
  protected readonly dots = computed(() =>
    this.items()
      .filter((item) => !this.groups().has(item.id))
      .map((item) => this.answers()[item.id]?.status ?? null),
  );
  protected readonly recentFour = computed(() => this.recent().slice(0, 4));
  protected readonly redLeaves = redLeaves;

  async ngOnInit(): Promise<void> {
    this.destroyRef.onDestroy(() => {
      if (this.touched() && !this.saved()) void this.api.abandoned();
    });
    try {
      const [, handover, templates, shifts, recent] = await Promise.all([
        this.perms.load(),
        this.api.handover(),
        this.api.activeTemplates(),
        this.shiftsApi.listWorkShifts(true),
        this.api.list(),
      ]);
      this.handover.set(handover);
      this.templates.set(templates);
      this.shifts.set(shifts);
      this.recent.set(recent);
      const detected = currentShift(shifts, new Date());
      if (detected) this.selectShift(detected.id);
      this.resumePendingClosure();
      void this.refreshStats();
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('shift.loadError')));
    } finally {
      this.loading.set(false);
    }
  }

  /** Cambia de turno y vuelve a deducir momento y plantilla. */
  protected selectShift(id: string): void {
    this.shiftId.set(id);
    const latest = this.recent().find((check) => check.workShiftId === id);
    this.setMoment(nextMoment(latest));
  }

  protected setMoment(moment: Moment): void {
    this.moment.set(moment);
    const shift = this.shift();
    const preferred = moment === 'inicio' ? shift?.checklistTemplateStartId : shift?.checklistTemplateEndId;
    const templates = this.templates();
    const next = templates.find((t) => t.id === preferred) ?? templates.find((t) => t.id === this.templateId()) ?? templates[0];
    this.selectTemplate(next?.id ?? '');
  }

  protected selectTemplate(id: string): void {
    if (id === this.templateId() && Object.keys(this.answers()).length > 0) return;
    this.templateId.set(id);
    this.answers.set(emptyAnswers(this.template()?.items ?? []));
  }

  /**
   * Tras recargar la página: si el último check del turno es un cierre MÍO
   * que todavía no tiene cierre formal, el formulario de cierre sigue
   * disponible en vez de perderse.
   */
  private resumePendingClosure(): void {
    const latest = this.recent().find((check) => check.workShiftId === this.shiftId());
    const me = this.perms.user()?.id;
    if (!latest || latest.checkType !== 'cierre' || latest.userId !== me) return;
    if (this.handover()?.previousClosure?.closureCheckId === latest.id) return;
    if (Date.now() - new Date(latest.checkDate).getTime() > 12 * 3_600_000) return;
    this.closureCheck.set(latest);
  }

  protected isGroup(item: ChecklistItem): boolean {
    return this.groups().has(item.id);
  }

  protected depthOf(item: ChecklistItem): number {
    return depth(item, this.items());
  }

  protected groupState(item: ChecklistItem): CheckStatus | null {
    return groupStatus(item.id, this.items(), this.answers());
  }

  protected setAnswer(itemId: string, patch: Partial<{ status: CheckStatus; observation: string }>): void {
    this.answers.update((current) => ({ ...current, [itemId]: { ...current[itemId], ...patch } }));
    this.touched.set(true);
  }

  protected async acknowledge(): Promise<void> {
    const closure = this.handover()?.previousClosure;
    if (!closure || this.busy()) return;
    this.busy.set(true);
    try {
      const updated = await this.api.acknowledge(closure.id);
      this.handover.update((h) => (h ? { ...h, previousClosure: updated } : h));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('handover.ackError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async submit(): Promise<void> {
    const template = this.template();
    if (!template || !this.shiftId() || !this.progress().complete || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const check = await this.api.create({
        checklistTemplateId: template.id,
        workShiftId: this.shiftId(),
        checkType: this.moment(),
        services: toServices(template.items, this.answers()),
      });
      this.saved.set(check);
      this.touched.set(false);
      this.recent.update((list) => [check, ...list]);
      if (check.checkType === 'cierre') {
        this.closureCheck.set(check);
        this.closure.set(null);
      }
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('check.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  /** Después de guardar: el siguiente checklist del turno es el otro momento. */
  protected startAnother(): void {
    const saved = this.saved();
    this.saved.set(null);
    this.answers.set({});
    this.setMoment(nextMoment(saved ?? undefined));
  }

  private async refreshStats(): Promise<void> {
    const id = this.shiftId();
    if (!id) return;
    try {
      this.stats.set(await this.checklists.shiftStats(id));
    } catch {
      // Sin cifras los botones muestran "pendiente"; nada más.
    }
  }

  /**
   * Popup de Inicio / Cierre de turno (comentarios del dueño #6/#6.1). Carga
   * diferida: CDK Dialog y el popup no van en el bundle de la pantalla.
   */
  protected async openReport(mode: Moment): Promise<void> {
    const shift = this.shift();
    if (!shift) return;
    const [{ Dialog }, { ShiftReportDialogComponent }] = await Promise.all([import('@angular/cdk/dialog'), import('./shift-report-dialog')]);
    const ref = this.injector.get(Dialog).open<ShiftReportResult>(ShiftReportDialogComponent, {
      ariaLabel: this.i18n.t(mode === 'inicio' ? 'shiftReport.title.inicio' : 'shiftReport.title.cierre'),
      data: { mode, shift, handover: this.handover(), closureCheck: this.closureCheck() },
      maxWidth: '100vw',
    });
    ref.closed.subscribe((result) => {
      if (!result) return;
      if (result.relay) this.handover.update((h) => (h ? { ...h, previousClosure: result.relay! } : h));
      if (result.closure) {
        this.closure.set(result.closure);
        this.closureCheck.set(null);
      }
      if (result.goToChecklist) {
        this.saved.set(null);
        this.setMoment('cierre');
      }
      if (result.inicioSaved || result.cierreSaved || result.closure) void this.refreshStats();
    });
  }

  /** Estado de cada botón de arriba. */
  protected reportState(mode: Moment): 'pending' | 'done' | 'closed' {
    if (mode === 'cierre' && this.closure()) return 'closed';
    const s = this.stats();
    return (mode === 'inicio' ? s?.inicioWrittenAt : s?.cierreWrittenAt) ? 'done' : 'pending';
  }

  protected hideGuide(): void {
    this.guideHidden.set(true);
    try {
      localStorage.setItem(GUIDE_KEY, '1');
    } catch {
      // Sin almacenamiento la guía vuelve a aparecer la próxima vez; nada más.
    }
  }

  protected momentLabel(moment: Moment): string {
    return this.i18n.t(moment === 'inicio' ? 'check.moment.inicio' : 'check.moment.cierre');
  }
}
