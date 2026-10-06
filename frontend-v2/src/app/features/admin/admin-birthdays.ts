import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../../core/auth/auth.models';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';

interface BirthdayConfig {
  enabled: boolean;
  time: string;
  cc: string;
  lastSentDate?: string;
}

/**
 * Correos de cumpleaños (comentario del dueño #21; en el legacy, en la
 * pantalla de Usuarios): encender, hora de envío y correo del área en copia.
 * El correo es el del legacy con la ilustración de los hámsters.
 */
@Component({
  selector: 'app-admin-birthdays',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="adm-card">
      <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>cake</mat-icon>{{ i18n.t('bday.title') }}</h3></div>
      <div class="adm-card__body bd">
        <img class="bd__art" src="/api/config/birthday-emails/image" alt="" aria-hidden="true" />
        <div class="bd__form">
          <label class="switch">
            <input class="switch__input" type="checkbox" role="switch" name="bdEnabled" [ngModel]="draft().enabled" (ngModelChange)="patch({ enabled: $event })" />
            <span class="switch__track" aria-hidden="true"></span>
            {{ i18n.t('bday.enabled') }}
          </label>
          <div class="adm-row">
            <label class="adm-field adm-field--narrow">
              <span class="adm-label">{{ i18n.t('bday.time') }}</span>
              <input class="adm-input mono" type="time" name="bdTime" [disabled]="!draft().enabled" [ngModel]="draft().time" (ngModelChange)="patch({ time: $event })" />
            </label>
            <label class="adm-field">
              <span class="adm-label">{{ i18n.t('bday.cc') }}</span>
              <input class="adm-input" type="email" name="bdCc" placeholder="area@empresa.cl" [disabled]="!draft().enabled" [ngModel]="draft().cc" (ngModelChange)="patch({ cc: $event })" />
            </label>
          </div>
          <span class="adm-hint">{{ i18n.t('bday.hint') }}</span>
        </div>
      </div>
      <footer class="adm-foot">
        <span class="adm-foot__status">
          @if (error(); as e) {
            <span class="adm-error" role="alert">{{ e }}</span>
          } @else if (notice(); as n) {
            <span class="pill tone-ok"><mat-icon>task_alt</mat-icon>{{ n }}</span>
          } @else {
            <span class="adm-muted">{{ i18n.t(dirty() ? 'admin.unsaved' : 'admin.noChanges') }}</span>
          }
        </span>
        <button type="button" class="adm-btn adm-push" [disabled]="busy()" (click)="sendTest()"><mat-icon>send</mat-icon>{{ i18n.t('bday.test') }}</button>
        <button type="button" class="adm-btn adm-btn--primary" [disabled]="!dirty() || busy()" (click)="save()"><mat-icon>save</mat-icon>{{ i18n.t('admin.save') }}</button>
      </footer>
    </section>
  `,
  styles: `
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .bd { display: flex; flex-direction: row; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
    .bd__art { width: 96px; height: 96px; border-radius: var(--radius-md); object-fit: cover; flex-shrink: 0; }
    .bd__form { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 10px; }
  `,
})
export class AdminBirthdaysComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly http = inject(HttpClient);

  private readonly saved = signal<BirthdayConfig>({ enabled: false, time: '09:00', cc: '' });
  protected readonly draft = signal<BirthdayConfig>({ enabled: false, time: '09:00', cc: '' });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly dirty = computed(() => {
    const a = this.draft();
    const b = this.saved();
    return a.enabled !== b.enabled || a.time !== b.time || a.cc.trim() !== b.cc;
  });

  async ngOnInit(): Promise<void> {
    try {
      this.apply((await firstValueFrom(this.http.get<ApiEnvelope<BirthdayConfig>>('/api/config/birthday-emails'))).data);
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('bday.loadError')));
    }
  }

  protected patch(p: Partial<BirthdayConfig>): void {
    this.draft.update((d) => ({ ...d, ...p }));
    this.notice.set(null);
    this.error.set(null);
  }

  protected async save(): Promise<void> {
    await this.run(async () => {
      const d = this.draft();
      const body = { enabled: d.enabled, time: d.time, cc: d.cc.trim() };
      this.apply((await firstValueFrom(this.http.put<ApiEnvelope<BirthdayConfig>>('/api/config/birthday-emails', body))).data);
      return this.i18n.t('admin.saved');
    });
  }

  protected async sendTest(): Promise<void> {
    await this.run(async () => {
      const res = await firstValueFrom(this.http.post<ApiEnvelope<{ to: string }>>('/api/config/birthday-emails/test', {}));
      return this.i18n.tf('bday.testSent', res.data.to);
    });
  }

  private async run(action: () => Promise<string>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      this.notice.set(await action());
    } catch (err) {
      this.error.set(problemDetail(err, this.i18n.t('bday.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  private apply(c: BirthdayConfig): void {
    const clean = { enabled: c.enabled, time: c.time || '09:00', cc: c.cc ?? '' };
    this.saved.set(clean);
    this.draft.set({ ...clean });
  }
}
