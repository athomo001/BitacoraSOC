import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { ChecklistsService, ShiftCheck } from '../../core/checklists/checklists.service';
import { redLeaves } from '../../core/checklists/shift-detect';
import { ShiftsService, WorkShift } from '../../core/shifts/shifts.service';
import { PermissionsService } from '../../core/auth/permissions.service';

import '../../core/i18n/packs/shifts';
const PAGE_SIZE = 50;

/**
 * Historial de checklists (legacy checklist-history): totales arriba, tabla
 * con el resultado de cada check y, al abrir una fila, los servicios en rojo
 * con su observación. "Exportar PDF" usa la impresión del navegador con una
 * hoja de estilos de impresión — el mismo PDF que daba el legacy, sin
 * generar archivos en el servidor.
 */
@Component({
  selector: 'app-shift-history',
  standalone: true,
  imports: [FormsModule, DatePipe, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shift-history.html',
  styleUrl: './shift-history.css',
})
export class ShiftHistoryComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ChecklistsService);
  private readonly shiftsApi = inject(ShiftsService);
  private readonly perms = inject(PermissionsService);
  /** Borrar un checklist: solo el admin, con motivo (paridad con el legacy). */
  protected readonly isAdmin = this.perms.isAdmin;
  protected readonly deleting = signal<string | null>(null);
  protected readonly reason = signal('');
  protected readonly busy = signal(false);

  protected readonly checks = signal<ShiftCheck[]>([]);
  protected readonly shifts = signal<WorkShift[]>([]);
  protected readonly shiftFilter = signal('');
  protected readonly page = signal(1);
  protected readonly hasMore = signal(false);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly expanded = signal<string | null>(null);

  protected readonly redLeaves = redLeaves;
  protected readonly totals = computed(() => {
    const checks = this.checks();
    const withRed = checks.filter((check) => redLeaves(check).length > 0).length;
    const redServices = checks.reduce((sum, check) => sum + redLeaves(check).length, 0);
    return { total: checks.length, withRed, redServices };
  });

  async ngOnInit(): Promise<void> {
    void this.perms.load();
    try {
      this.shifts.set(await this.shiftsApi.listWorkShifts());
    } catch {
      // Sin turnos igual se ve el historial; solo faltan los nombres.
    }
    await this.load(1);
  }

  protected shiftName(id: string): string {
    return this.shifts().find((shift) => shift.id === id)?.name ?? '—';
  }

  protected async setShiftFilter(id: string): Promise<void> {
    this.shiftFilter.set(id);
    await this.load(1);
  }

  protected async load(page: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const batch = await this.api.list({ workShiftId: this.shiftFilter() || undefined, page });
      this.checks.update((current) => (page === 1 ? batch : [...current, ...batch]));
      this.page.set(page);
      this.hasMore.set(batch.length === PAGE_SIZE);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('history.loadError')));
    } finally {
      this.loading.set(false);
    }
  }

  protected startDelete(id: string, event: Event): void {
    event.stopPropagation();
    this.deleting.set(id);
    this.reason.set('');
    this.error.set(null);
  }

  protected async remove(check: ShiftCheck): Promise<void> {
    const reason = this.reason().trim();
    if (!reason || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.remove(check.id, reason);
      this.checks.update((list) => list.filter((c) => c.id !== check.id));
      this.deleting.set(null);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('history.deleteError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected toggle(id: string): void {
    this.expanded.update((current) => (current === id ? null : id));
  }

  protected exportPdf(): void {
    window.print();
  }
}
