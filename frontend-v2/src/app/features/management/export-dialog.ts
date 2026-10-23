import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { ModalComponent } from '../../shared/ui/modal/modal';
import { ButtonComponent } from '../../shared/ui/button/button';
import { ClientSummary, ManagementService, MgmtPeriod } from '../../core/management/management.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { GOAL_TONE, PERIODS, day, durationText, goalStateKey, pct } from './mgmt-format';

import '../../core/i18n/packs/management';

export interface ExportDialogData {
  clientId: string;
  period: MgmtPeriod;
  /** Desde Indicadores: se elige el cliente. */
  clients?: { id: string; name: string }[];
}

/**
 * Exportar resumen (spec/16 §4.4.4): SLA del período, tiempos medios,
 * incidentes resueltos por área y prioridad, y metas (sin la Ticketera, solo
 * las metas). «Descargar PDF» usa la
 * impresión del navegador (como el Resumen mensual) y «Enviar por correo», la
 * plantilla de lista del legacy a los dominios válidos de Reportes.
 */
@Component({
  selector: 'app-mgmt-export-dialog',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [wide]="true">
      <span app-modal-title><mat-icon class="ex__ic">ios_share</mat-icon>{{ i18n.t('mg.exp.title') }}</span>
      <div class="ex">
        <div class="ex__bar no-print">
          @if (data.clients; as list) {
            <select class="adm-input ex__client" name="expClient" [attr.aria-label]="i18n.t('mg.act.client')" (change)="setClient(val($event))">
              @for (c of list; track c.id) { <option [value]="c.id" [selected]="c.id === clientId()">{{ c.name }}</option> }
            </select>
          }
          @for (p of periods; track p) {
            <button type="button" class="seg" [attr.aria-pressed]="period() === p" (click)="setPeriod(p)">{{ i18n.t(periodKey(p)) }}</button>
          }
        </div>
        @if (summary(); as s) {
          <article class="ex__doc" id="mgmt-summary">
            <header class="ex__doch"><b>{{ i18n.tf('mg.exp.doc', s.clientName) }}</b><span class="adm-hint">{{ range(s) }}</span></header>
            @if (s.tickets) {
              <div class="ex__kpis">
                <div><span class="adm-label">{{ i18n.t('mg.exp.sla') }}</span><b [class.text-warn]="s.slaPct >= 0 && s.slaPct < s.slaTarget" [class.text-ok]="s.slaPct >= s.slaTarget">{{ pct(s.slaPct) }}</b><span class="adm-hint">{{ i18n.tf('mg.f.target', s.slaTarget) }}</span></div>
                <div><span class="adm-label">{{ i18n.t('mg.f.response') }}</span><b>{{ dur(s.avgResponseSecs) }}</b><span class="adm-hint">{{ i18n.t('mg.exp.avg') }}</span></div>
                <div><span class="adm-label">{{ i18n.t('mg.f.resolution') }}</span><b>{{ dur(s.avgResolutionSecs) }}</b><span class="adm-hint">{{ i18n.t('mg.exp.avg') }}</span></div>
              </div>
              <div class="ex__sec"><span class="adm-label">{{ i18n.t('mg.exp.incidents') }}</span><span class="pill tone-neutral mono">{{ total() }}</span></div>
              @if (s.incidents.length) {
                <div class="adm-table-wrap">
                  <table class="adm-table">
                    <thead><tr><th>{{ i18n.t('mg.exp.area') }}</th><th class="adm-num">P1</th><th class="adm-num">P2</th><th class="adm-num">P3</th><th class="adm-num">P4</th><th class="adm-num">{{ i18n.t('mg.exp.total') }}</th></tr></thead>
                    <tbody>
                      @for (x of s.incidents; track x.area) {
                        <tr><td>{{ x.area }}</td><td class="adm-num mono">{{ x.p1 }}</td><td class="adm-num mono">{{ x.p2 }}</td><td class="adm-num mono">{{ x.p3 }}</td><td class="adm-num mono">{{ x.p4 }}</td><td class="adm-num mono"><b>{{ x.p1 + x.p2 + x.p3 + x.p4 }}</b></td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else {
                <p class="ex__none">{{ i18n.t('mg.exp.noIncidents') }}</p>
            }
            }
            <div class="ex__sec"><span class="adm-label">{{ i18n.t('mg.exp.goals') }}</span></div>
            @for (g of s.goals; track g.id) {
              <div class="ex__goal"><span>{{ g.name }}<span class="adm-hint ex__block">{{ g.milestones ? i18n.tf('mg.g.progress', g.milestonesDone + ' ' + i18n.t('mg.g.of') + ' ' + g.milestones) : i18n.t('mg.g.noSteps') }}</span></span>
                <span class="pill tone-{{ goalTone[g.state] }}">{{ i18n.t(goalStateKey(g.state)) }}</span></div>
            } @empty {
              <p class="ex__none">{{ i18n.t('mg.exp.noGoals') }}</p>
            }
          </article>
        } @else if (!error()) {
          <p class="adm-hint">…</p>
        }
        @if (sending()) {
          <form class="ex__send no-print" (submit)="$event.preventDefault(); send()">
            <label class="field"><span>{{ i18n.t('mg.exp.to') }}</span>
              <input name="expTo" type="text" autocomplete="off" [value]="to()" (input)="to.set(val($event))" /></label>
            <span class="adm-hint">{{ i18n.t('mg.exp.toHint') }}</span>
          </form>
        }
        @if (sent(); as n) { <p class="pill tone-ok no-print" role="status"><mat-icon>mark_email_read</mat-icon>{{ i18n.tf('mg.exp.sent', n) }}</p> }
        @if (error(); as e) { <p class="msg msg--error no-print" role="alert">{{ e }}</p> }
      </div>
      <ng-container app-modal-actions>
        @if (sending()) {
          <app-button (pressed)="sending.set(false)">{{ i18n.t('mg.cancel') }}</app-button>
          <app-button variant="primary" [disabled]="!to().trim() || busy()" (pressed)="send()">{{ i18n.t('mg.exp.send') }}</app-button>
        } @else {
          <app-button [disabled]="!summary()" (pressed)="sending.set(true)"><mat-icon>mail</mat-icon>{{ i18n.t('mg.exp.mail') }}</app-button>
          <app-button variant="primary" [disabled]="!summary()" (pressed)="print()"><mat-icon>picture_as_pdf</mat-icon>{{ i18n.t('mg.exp.pdf') }}</app-button>
        }
      </ng-container>
    </app-modal>
  `,
  styles: `
    .ex { display: flex; flex-direction: column; gap: 12px; width: min(680px, calc(100vw - 64px)); }
    .ex__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .ex__client { width: auto; }
    .ex__doc { overflow: hidden; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
    .ex__doch { display: flex; flex-direction: column; gap: 2px; padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-app); font-size: 14px; }
    .ex__kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); }
    .ex__kpis > div { display: flex; flex-direction: column; gap: 2px; }
    .ex__kpis b { font-size: 19px; font-variant-numeric: tabular-nums; }
    .ex__sec { display: flex; align-items: center; gap: 8px; padding: 10px 16px 4px; }
    .ex__none { margin: 0; padding: 4px 16px 10px; color: var(--text-muted); font-size: 12.5px; }
    .ex__goal { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 7px 16px; border-top: 1px solid var(--border-subtle); font-size: 12.5px; }
    .ex__block { display: block; }
    .ex__send { display: flex; flex-direction: column; gap: 4px; }
    .ex__ic { width: 18px; height: 18px; margin-right: 6px; font-size: 18px; vertical-align: -3px; }
    @media (width <= 700px) { .ex__kpis { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class ExportDialogComponent implements OnInit, OnDestroy {
  protected readonly i18n = inject(I18nService);
  protected readonly data = inject<ExportDialogData>(DIALOG_DATA);
  protected readonly ref = inject(DialogRef);
  private readonly api = inject(ManagementService);
  private readonly prefs = inject(PreferencesService);

  protected readonly periods = PERIODS;
  protected readonly goalTone = GOAL_TONE;
  protected readonly goalStateKey = goalStateKey;
  protected readonly pct = pct;
  protected readonly clientId = signal(this.data.clientId);
  protected readonly period = signal<MgmtPeriod>(this.data.period);
  protected readonly summary = signal<ClientSummary | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly sending = signal(false);
  protected readonly to = signal('');
  protected readonly sent = signal<number | null>(null);
  protected readonly busy = signal(false);
  protected readonly total = computed(() => (this.summary()?.incidents ?? []).reduce((n, x) => n + x.p1 + x.p2 + x.p3 + x.p4, 0));

  ngOnInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    document.body.classList.remove('print-dialog');
  }

  private async load(): Promise<void> {
    this.summary.set(null);
    this.error.set(null);
    try {
      this.summary.set(await this.api.summary(this.clientId(), this.period()));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.loadError')));
    }
  }

  protected setPeriod(p: MgmtPeriod): void {
    this.period.set(p);
    void this.load();
  }

  protected setClient(id: string): void {
    this.clientId.set(id);
    void this.load();
  }

  protected periodKey(p: MgmtPeriod): MessageKey {
    return `mg.p.${p}` as MessageKey;
  }

  protected dur(secs: number): string {
    return durationText(secs, this.prefs.language());
  }

  protected range(s: ClientSummary): string {
    const lang = this.prefs.language();
    return `${day(s.from, lang, true)} – ${day(s.to, lang, true)}`;
  }

  /** El PDF sale de la impresión del navegador: solo se imprime el resumen (styles.css, .print-dialog). */
  protected print(): void {
    document.body.classList.add('print-dialog');
    window.print();
    document.body.classList.remove('print-dialog');
  }

  protected async send(): Promise<void> {
    const to = this.to().split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!to.length || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await this.api.sendSummary(this.clientId(), this.period(), to);
      this.sent.set(r.sent);
      this.sending.set(false);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.exp.error')));
    } finally {
      this.busy.set(false);
    }
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
