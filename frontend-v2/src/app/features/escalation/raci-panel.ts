import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { I18nService } from '../../core/i18n/i18n.service';
import { problemDetail } from '../../core/http-error';
import { RaciActivity, RaciService } from '../../core/raci/raci.service';
import { RaciTableComponent } from '../../shared/raci/raci-table';

import '../../core/i18n/packs/raci';

/**
 * Escalamiento → RACI (paridad con la pestaña «Matriz RACI» del legacy): se
 * elige el cliente y se ve quién es responsable, quién aprueba, a quién se
 * consulta y a quién se informa en cada actividad, con las notas. Parte con
 * el cliente del servicio que se está mirando.
 */
@Component({
  selector: 'app-raci-panel',
  standalone: true,
  imports: [FormsModule, MatIconModule, RaciTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="adm-card">
      <header class="adm-card__head">
        <h2 class="adm-card__title"><mat-icon>assignment_ind</mat-icon>{{ i18n.t('raci.title') }}</h2>
        @if (clients().length) {
          <label class="adm-push raci__pick">
            <span class="adm-label">{{ i18n.t('raci.client') }}</span>
            <select class="adm-input" name="raciClient" [ngModel]="clientId()" (ngModelChange)="clientId.set($event)">
              @for (c of clients(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
            </select>
          </label>
        }
      </header>
      <div class="adm-card__body">
        @if (error(); as e) {
          <p class="adm-error" role="alert">{{ e }}</p>
        } @else if (loading()) {
          <p class="adm-muted" role="status">…</p>
        } @else if (!clients().length) {
          <p class="adm-empty">{{ i18n.t('raci.noClients') }}</p>
        } @else if (!shown().length) {
          <p class="adm-empty">{{ i18n.t('raci.empty') }}</p>
        } @else {
          <app-raci-table [activities]="shown()" />
        }
      </div>
    </section>
  `,
  styles: `
    .raci__pick { display: flex; align-items: center; gap: 8px; }
    .raci__pick select { min-width: 200px; }
  `,
})
export class RaciPanelComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(RaciService);

  /** El cliente del servicio elegido en Escalamiento, si tiene RACI. */
  readonly presetClientId = input<string | null>(null);

  private readonly all = signal<RaciActivity[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly clientId = signal('');

  protected readonly clients = computed(() => {
    const seen = new Map<string, string>();
    for (const a of this.all()) seen.set(a.clientId, a.clientName);
    return [...seen].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name));
  });
  protected readonly shown = computed(() => this.all().filter((a) => a.clientId === this.clientId()));

  constructor() {
    effect(() => {
      const preset = this.presetClientId();
      if (preset && this.clients().some((c) => c.id === preset)) this.clientId.set(preset);
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      this.all.set(await this.api.list());
      if (!this.clientId()) {
        const preset = this.presetClientId();
        const first = this.clients()[0]?.id ?? '';
        this.clientId.set(preset && this.clients().some((c) => c.id === preset) ? preset : first);
      }
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('raci.error')));
    } finally {
      this.loading.set(false);
    }
  }
}
