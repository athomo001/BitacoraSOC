import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { AgendaAssignee, AgendaHandover, AgendaOccurrence, AgendaService } from '../../core/agenda/agenda.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { problemDetail } from '../../core/http-error';
import { dueText, fmtDay } from './agenda-format';

type Choice = 'keep' | 'next' | 'level';

/**
 * Sección de la Agenda en el popup de Cierre de turno (spec/16 §4.3,
 * "Cierre de turno"): las tareas propias que siguen abiertas y vencen a más
 * tardar el siguiente día hábil, para quedárselas, pasarlas a quien entra o
 * devolverlas al nivel (decisión del dueño 2026-10-14). Sin tareas, no aparece.
 */
@Component({
  selector: 'app-agenda-handover',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (info(); as inf) {
      @if (inf.items.length) {
        <section class="ah" [attr.aria-label]="i18n.t('ag.ho.title')">
          <span class="ah__label">{{ i18n.t('ag.ho.title') }}</span>
          @for (o of inf.items; track o.id) {
            <div class="ah__item">
              <span class="ah__what"><b>{{ o.task.name }}</b><span class="ah__sub">{{ day(o.dueDate) }} · {{ due(o) }}</span></span>
              <span class="ah__chips">
                <button type="button" class="seg" [attr.aria-pressed]="choice(o.id) === 'keep'" (click)="set(o.id, 'keep')">{{ i18n.t('ag.ho.keep') }}</button>
                <button type="button" class="seg" [attr.aria-pressed]="choice(o.id) === 'next'" (click)="set(o.id, 'next')">{{ i18n.t('ag.ho.next') }}</button>
                @if (o.canRelease) {
                  <button type="button" class="seg" [attr.aria-pressed]="choice(o.id) === 'level'" (click)="set(o.id, 'level')">{{ i18n.t('ag.ho.level') }}</button>
                }
              </span>
              @if (choice(o.id) === 'next' && candidates(o).length !== 1) {
                <select class="adm-input ah__pick" [name]="'ho-' + o.id" [attr.aria-label]="i18n.t('ag.ho.pick')" (change)="pick(o.id, $any($event.target).value)">
                  <option value="">{{ i18n.t('ag.ho.pick') }}</option>
                  @for (p of candidates(o); track p.id) { <option [value]="p.id" [selected]="picked()[o.id] === p.id">{{ p.name }}</option> }
                </select>
              }
            </div>
          }
          <span class="ah__foot">
            <span class="ah__sub">{{ inf.entering.length ? i18n.tf('ag.ho.entering', enteringText()) : i18n.t('ag.ho.noEntering') }}</span>
            @if (error(); as e) { <span class="adm-error" role="alert">{{ e }}</span> }
            @if (applied()) { <span class="pill tone-ok" role="status">{{ i18n.t('ag.ho.applied') }}</span> }
            <button type="button" class="adm-btn" [disabled]="busy() || !pendingChanges()" (click)="apply()"><mat-icon>swap_horiz</mat-icon>{{ i18n.t('ag.ho.apply') }}</button>
          </span>
        </section>
      }
    }
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .ah { display: flex; flex-direction: column; gap: 6px; }
    .ah__label { font-size: 11.5px; font-weight: 600; color: var(--text-secondary); }
    .ah__item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 8px; align-items: center; padding: 8px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); }
    .ah__what { display: flex; flex-direction: column; min-width: 0; }
    .ah__sub { color: var(--text-muted); font-size: 11.5px; }
    .ah__chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .ah__pick { grid-column: 1 / -1; }
    .ah__foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
    .ah__foot .ah__sub { margin-right: auto; }
  `,
})
export class AgendaHandoverComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);
  private readonly api = inject(AgendaService);

  protected readonly info = signal<AgendaHandover | null>(null);
  private readonly choices = signal<Record<string, Choice>>({});
  protected readonly picked = signal<Record<string, string>>({});
  /** Gente de cada área (si no hay turno siguiente configurado). */
  private readonly areaPeople = signal<Record<string, AgendaAssignee[]>>({});
  private me = '';
  private dayEnd = '20:00';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly applied = signal(false);

  protected readonly enteringText = computed(() => (this.info()?.entering ?? []).map((p) => (p.shift ? `${p.name} (${p.shift})` : p.name)).join(', '));
  protected readonly pendingChanges = computed(() => {
    const c = this.choices();
    return Object.entries(c).some(([id, ch]) => ch === 'level' || (ch === 'next' && !!this.target(id)));
  });

  async ngOnInit(): Promise<void> {
    try {
      this.info.set(await this.api.handoverInfo());
      if (this.info()!.items.length) {
        const m = await this.api.meta();
        this.me = m.me;
        this.dayEnd = m.dayEnd;
        this.areaPeople.set(Object.fromEntries(m.areas.map((a) => [a.id, a.people])));
      }
    } catch {
      this.info.set(null); // la sección es un extra del cierre: si falla, no estorba
    }
  }

  protected day(iso: string): string {
    return fmtDay(iso, this.prefs.language());
  }

  protected due(o: AgendaOccurrence): string {
    return dueText(o, this.i18n, this.dayEnd);
  }

  protected choice(id: string): Choice {
    return this.choices()[id] ?? 'keep';
  }

  protected set(id: string, c: Choice): void {
    this.choices.update((x) => ({ ...x, [id]: c }));
    this.applied.set(false);
  }

  protected pick(id: string, userId: string): void {
    this.picked.update((x) => ({ ...x, [id]: userId }));
  }

  /** Quienes entran; si no hay turno siguiente, la gente del área de la tarea. */
  protected candidates(o: AgendaOccurrence): { id: string; name: string }[] {
    const entering = this.info()?.entering ?? [];
    if (entering.length) return entering;
    return (this.areaPeople()[o.task.areaId] ?? []).filter((p) => p.id !== this.me);
  }

  private target(id: string): string | undefined {
    const o = this.info()?.items.find((x) => x.id === id);
    if (!o) return undefined;
    const c = this.candidates(o);
    return c.length === 1 ? c[0].id : this.picked()[id] || undefined;
  }

  protected async apply(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      for (const [id, ch] of Object.entries(this.choices())) {
        if (ch === 'level') await this.api.release(id);
        const to = ch === 'next' ? this.target(id) : undefined;
        if (to) await this.api.handover(id, to);
      }
      this.choices.set({});
      this.picked.set({});
      this.info.set(await this.api.handoverInfo());
      this.applied.set(true);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ag.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
