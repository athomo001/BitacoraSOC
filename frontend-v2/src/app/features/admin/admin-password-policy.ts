import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../../core/auth/auth.models';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';

import '../../core/i18n/packs/admin';
const MIN = 4;
const MAX = 64;

/**
 * Largo mínimo de contraseña (pedido del dueño 2026-10-07): lo fija el admin,
 * 6 por defecto como el legacy. El servidor lo exige al cambiar la propia,
 * al resetear por correo y al crear usuarios.
 */
@Component({
  selector: 'app-admin-password-policy',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="adm-card">
      <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>password</mat-icon>{{ i18n.t('pwPolicy.title') }}</h3></div>
      <div class="adm-card__body">
        <label class="adm-field adm-field--narrow">
          <span class="adm-label">{{ i18n.t('pwPolicy.minLength') }}</span>
          <input class="adm-input mono" type="number" name="pwMin" [min]="min" [max]="max" [ngModel]="draft()" (ngModelChange)="edit($event)" />
        </label>
        <span class="adm-hint">{{ i18n.tf('pwPolicy.hint', min + '–' + max) }}</span>
      </div>
      <footer class="adm-foot">
        <span class="adm-foot__status">
          @if (error(); as e) {
            <span class="adm-error" role="alert">{{ e }}</span>
          } @else if (notice()) {
            <span class="pill tone-ok"><mat-icon>task_alt</mat-icon>{{ i18n.t('admin.saved') }}</span>
          } @else {
            <span class="adm-muted">{{ i18n.t(draft() !== saved() ? 'admin.unsaved' : 'admin.noChanges') }}</span>
          }
        </span>
        <button type="button" class="adm-btn adm-btn--primary adm-push" [disabled]="draft() === saved() || !valid() || busy()" (click)="save()">
          <mat-icon>save</mat-icon>{{ i18n.t('admin.save') }}
        </button>
      </footer>
    </section>
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .adm-card__body { display: flex; flex-direction: column; gap: 8px; }
    .adm-field--narrow { max-width: 140px; }
  `,
})
export class AdminPasswordPolicyComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly http = inject(HttpClient);
  protected readonly min = MIN;
  protected readonly max = MAX;

  protected readonly saved = signal(6);
  protected readonly draft = signal(6);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const n = (await firstValueFrom(this.http.get<ApiEnvelope<{ minLength: number }>>('/api/auth/password-policy'))).data.minLength;
      this.saved.set(n);
      this.draft.set(n);
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('pwPolicy.loadError')));
    }
  }

  protected valid(): boolean {
    const n = this.draft();
    return Number.isInteger(n) && n >= MIN && n <= MAX;
  }

  protected edit(value: number | string): void {
    this.draft.set(Number(value));
    this.notice.set(false);
    this.error.set(null);
  }

  protected async save(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const body = { minLength: this.draft() };
      const n = (await firstValueFrom(this.http.put<ApiEnvelope<{ minLength: number }>>('/api/config/password-policy', body))).data.minLength;
      this.saved.set(n);
      this.draft.set(n);
      this.notice.set(true);
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('pwPolicy.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
