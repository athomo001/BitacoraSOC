import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ReminderFrequency, ShiftReminder, ShiftReminderDraft, ShiftsService, WorkShift } from '../../core/shifts/shifts.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { problemDetail } from '../../core/http-error';

const HOUR_CHOICES = [1, 2, 3, 4, 6, 8, 12];

function emptyDraft(): ShiftReminderDraft {
  return { label: '', reminderText: '', frequencyType: 'hours', intervalHours: 4, fixedTimes: [], targetShiftIds: [], enabled: true };
}

/**
 * Administración → Turnos → Recordatorios (spec/12-pendientes.md §2.3b),
 * según el artboard aprobado. Vuelven del checklist-admin del legacy: un
 * texto que llega por correo a los turnos en curso, cada N horas o a horas
 * fijas. Van a los destinatarios de cada turno (los del reporte de cierre),
 * así que el editor avisa si un turno elegido no tiene ninguno.
 */
@Component({
  selector: 'app-admin-shift-reminders',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-shift-reminders.html',
  styleUrl: './admin-shift-reminders.css',
})
export class AdminShiftRemindersComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ShiftsService);

  protected readonly hourChoices = HOUR_CHOICES;
  protected readonly reminders = signal<ShiftReminder[]>([]);
  protected readonly shifts = signal<WorkShift[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** null = ninguno elegido; 'new' = uno nuevo sin guardar. */
  protected readonly selectedId = signal<string | 'new' | null>(null);
  protected readonly draft = signal<ShiftReminderDraft>(emptyDraft());
  protected readonly dirty = signal(false);
  protected readonly status = signal<'saved' | 'tested' | null>(null);
  protected readonly testedTo = signal('');
  protected readonly newTime = signal('09:00');
  protected readonly confirmDelete = signal(false);

  protected readonly activeShifts = computed(() => this.shifts().filter((s) => s.active));

  /** Turnos a los que llegaría: los marcados, o todos los activos si no hay ninguno. */
  protected readonly targets = computed(() => {
    const ids = this.draft().targetShiftIds;
    return ids.length ? this.activeShifts().filter((s) => ids.includes(s.id)) : this.activeShifts();
  });
  protected readonly withoutRecipients = computed(() => this.targets().filter((s) => s.emailRecipients.length === 0));
  protected readonly missingNames = computed(() => this.withoutRecipients().map((s) => s.name).join(', '));

  protected readonly blocksHint = computed(() => {
    const every = this.draft().intervalHours;
    const blocks: string[] = [];
    for (let h = 0; h < 24; h += every) blocks.push(`${String(h).padStart(2, '0')}:00`);
    return blocks.slice(0, 4).join(', ') + (blocks.length > 4 ? '…' : '');
  });

  protected readonly canSave = computed(() => {
    const d = this.draft();
    return !!d.label.trim() && !!d.reminderText.trim() && (d.frequencyType === 'hours' || d.fixedTimes.length > 0);
  });

  async ngOnInit(): Promise<void> {
    try {
      const [reminders, shifts] = await Promise.all([this.api.listReminders(), this.api.listWorkShifts()]);
      this.reminders.set(reminders);
      this.shifts.set(shifts);
      if (reminders.length) this.select(reminders[0]);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('rem.loadError')));
    } finally {
      this.loading.set(false);
    }
  }

  protected select(r: ShiftReminder): void {
    this.selectedId.set(r.id);
    this.draft.set({
      label: r.label, reminderText: r.reminderText, frequencyType: r.frequencyType, intervalHours: r.intervalHours,
      fixedTimes: [...r.fixedTimes], targetShiftIds: [...r.targetShiftIds], enabled: r.enabled,
    });
    this.resetState();
  }

  protected startNew(): void {
    this.selectedId.set('new');
    this.draft.set(emptyDraft());
    this.resetState();
  }

  private resetState(): void {
    this.dirty.set(false);
    this.status.set(null);
    this.confirmDelete.set(false);
    this.error.set(null);
  }

  protected edit(patch: Partial<ShiftReminderDraft>): void {
    this.draft.update((d) => ({ ...d, ...patch }));
    this.dirty.set(true);
    this.status.set(null);
  }

  protected setFrequency(f: ReminderFrequency): void {
    const d = this.draft();
    this.edit({ frequencyType: f, fixedTimes: f === 'fixed' && !d.fixedTimes.length ? ['09:00'] : d.fixedTimes });
  }

  protected addTime(): void {
    const t = this.newTime();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t) || this.draft().fixedTimes.includes(t)) return;
    this.edit({ fixedTimes: [...this.draft().fixedTimes, t].sort() });
  }

  protected removeTime(t: string): void {
    this.edit({ fixedTimes: this.draft().fixedTimes.filter((x) => x !== t) });
  }

  protected toggleShift(id: string): void {
    const ids = this.draft().targetShiftIds;
    this.edit({ targetShiftIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
  }

  protected isTarget(id: string): boolean {
    return this.draft().targetShiftIds.includes(id);
  }

  /** Cuándo, para la tabla: "cada 4 h" o "07:30 · 19:30". */
  protected when(r: ShiftReminder): string {
    return r.frequencyType === 'hours' ? this.i18n.tf('rem.everyH', r.intervalHours) : r.fixedTimes.join(' · ');
  }

  protected shiftNames(ids: string[]): string {
    if (!ids.length) return this.i18n.t('rem.allShifts');
    return ids.map((id) => this.shifts().find((s) => s.id === id)?.name ?? '—').join(', ');
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) return;
    const id = this.selectedId();
    const draft = { ...this.draft(), label: this.draft().label.trim(), reminderText: this.draft().reminderText.trim() };
    await this.run(async () => {
      const saved = id && id !== 'new' ? await this.api.patchReminder(id, draft) : await this.api.createReminder(draft);
      this.reminders.set(await this.api.listReminders());
      this.select(this.reminders().find((r) => r.id === saved.id) ?? saved);
      this.status.set('saved');
    });
  }

  protected discard(): void {
    const current = this.reminders().find((r) => r.id === this.selectedId());
    if (current) this.select(current);
    else if (this.reminders().length) this.select(this.reminders()[0]);
    else this.selectedId.set(null);
  }

  protected async toggleEnabled(r: ShiftReminder): Promise<void> {
    await this.run(async () => {
      await this.api.patchReminder(r.id, { enabled: !r.enabled });
      this.reminders.set(await this.api.listReminders());
      if (this.selectedId() === r.id && !this.dirty()) this.draft.update((d) => ({ ...d, enabled: !r.enabled }));
    });
  }

  protected async test(): Promise<void> {
    const id = this.selectedId();
    if (!id || id === 'new' || this.dirty()) return;
    await this.run(async () => {
      this.testedTo.set(await this.api.testReminder(id));
      this.status.set('tested');
    });
  }

  protected async remove(): Promise<void> {
    const id = this.selectedId();
    if (!id || id === 'new') return;
    await this.run(async () => {
      await this.api.deleteReminder(id);
      const list = await this.api.listReminders();
      this.reminders.set(list);
      if (list.length) this.select(list[0]);
      else this.selectedId.set(null);
    });
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('rem.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
