import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth/auth.service';
import { I18nService } from '../core/i18n/i18n.service';
import { MessageKey } from '../core/i18n/messages';
import { ModalComponent } from '../shared/ui/modal/modal';
import { ButtonComponent } from '../shared/ui/button/button';
import { UserAvatarComponent } from './user-avatar';
import { LOGIN_THEMES, LOGIN_THEME_LABELS, LOGIN_THEME_STORAGE_KEY, LoginTheme } from '../features/login/login-themes';

interface Feedback {
  ok: boolean;
  key: MessageKey;
}

/**
 * "Mi perfil" — se abre desde la fila de usuario al pie de la barra lateral
 * (CDK Dialog + app-modal: foco atrapado, Esc cierra). Reemplaza al
 * formulario que estaba metido en una barra superior que el diseño aprobado
 * no tiene.
 */
@Component({
  selector: 'app-profile-dialog',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, UserAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal>
      <span app-modal-title>{{ i18n.t('profile.title') }}</span>

      <div class="profile">
        <div class="profile__identity">
          <app-user-avatar [name]="fullName || user()?.username || ''" [src]="avatarUrl" size="large" />
          <div class="profile__who">
            <strong>{{ fullName || user()?.username }}</strong>
            <span class="mono">{{ user()?.email }}</span>
          </div>
        </div>

        <section class="profile__section">
          <div class="field-grid">
            <label class="field">
              <span>{{ i18n.t('profile.fullName') }}</span>
              <input type="text" name="fullName" [(ngModel)]="fullName" />
            </label>
            <label class="field">
              <span>{{ i18n.t('profile.phone') }}</span>
              <input type="tel" name="phone" [(ngModel)]="phone" />
            </label>
            <label class="field">
              <span>{{ i18n.t('profile.birthday') }}</span>
              <input type="date" name="birthday" [(ngModel)]="birthday" />
            </label>
            <label class="field">
              <span>{{ i18n.t('profile.loginTheme') }}</span>
              <select name="loginTheme" [ngModel]="loginTheme()" (ngModelChange)="setLoginTheme($event)">
                @for (theme of loginThemes; track theme) {
                  <option [value]="theme">{{ loginThemeLabels[theme] }}</option>
                }
              </select>
            </label>
          </div>
          <label class="profile__file">
            <span class="material-icons" aria-hidden="true">image</span>
            {{ i18n.t('profile.avatarPick') }}
            <input type="file" accept="image/png,image/jpeg,image/webp" (change)="onAvatarSelected($event)" />
          </label>
          <div class="profile__actions">
            @if (profileFeedback(); as fb) {
              <span class="msg" [class.msg--ok]="fb.ok" [class.msg--error]="!fb.ok">{{ i18n.t(fb.key) }}</span>
            }
            <app-button variant="primary" [disabled]="saving()" (pressed)="saveProfile()">{{ i18n.t('profile.save') }}</app-button>
          </div>
        </section>

        <section class="profile__section">
          <h3 class="profile__heading">{{ i18n.t('profile.security') }}</h3>
          <div class="field-grid">
            <label class="field">
              <span>{{ i18n.t('profile.currentPassword') }}</span>
              <input type="password" name="currentPassword" autocomplete="current-password" [(ngModel)]="currentPassword" />
            </label>
            <label class="field">
              <span>{{ i18n.t('profile.newPassword') }}</span>
              <input type="password" name="newPassword" autocomplete="new-password" [(ngModel)]="newPassword" />
            </label>
          </div>
          <div class="profile__actions">
            @if (passwordFeedback(); as fb) {
              <span class="msg" [class.msg--ok]="fb.ok" [class.msg--error]="!fb.ok">{{ i18n.t(fb.key) }}</span>
            }
            <app-button [disabled]="saving() || !currentPassword || !newPassword" (pressed)="savePassword()">
              {{ i18n.t('profile.changePassword') }}
            </app-button>
          </div>
        </section>
      </div>
    </app-modal>
  `,
  styles: `
    .profile {
      display: flex;
      flex-direction: column;
      gap: 20px;
      width: min(520px, calc(100vw - 64px));
    }

    .profile__identity {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .profile__who {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .profile__who span {
      overflow: hidden;
      color: var(--text-secondary);
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .profile__section {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-top: 16px;
      border-top: 1px solid var(--border-subtle);
    }

    .profile__heading {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
    }

    .profile__file {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      width: max-content;
      min-height: var(--row-height);
      padding: 0 12px;
      border: 1px dashed var(--border-subtle);
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      font-size: 12px;
      cursor: pointer;
    }

    .profile__file:hover {
      border-color: var(--accent);
      color: var(--text-primary);
    }

    .profile__file .material-icons {
      font-size: 17px;
    }

    .profile__file input {
      display: none;
    }

    .profile__actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
    }

    .profile__actions .msg {
      margin: 0;
    }
  `,
})
export class ProfileDialogComponent {
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  protected readonly user = this.auth.user;

  protected readonly loginThemes = LOGIN_THEMES;
  protected readonly loginThemeLabels = LOGIN_THEME_LABELS;
  protected readonly loginTheme = signal<LoginTheme>(readLoginTheme());
  protected readonly saving = signal(false);
  protected readonly profileFeedback = signal<Feedback | null>(null);
  protected readonly passwordFeedback = signal<Feedback | null>(null);

  protected fullName = this.user()?.fullName ?? '';
  protected phone = this.user()?.phone ?? '';
  protected birthday = this.user()?.birthday ?? '';
  protected avatarUrl = this.user()?.avatarUrl ?? '';
  protected currentPassword = '';
  protected newPassword = '';

  protected setLoginTheme(theme: LoginTheme): void {
    this.loginTheme.set(theme);
    try {
      localStorage.setItem(LOGIN_THEME_STORAGE_KEY, theme);
    } catch {
      // Sin almacenamiento, el login usa su tema por defecto.
    }
  }

  protected onAvatarSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') this.avatarUrl = reader.result;
    });
    reader.readAsDataURL(file);
  }

  protected async saveProfile(): Promise<void> {
    this.saving.set(true);
    this.profileFeedback.set(null);
    try {
      await this.auth.updateProfile({ fullName: this.fullName, phone: this.phone, birthday: this.birthday, avatarUrl: this.avatarUrl });
      this.profileFeedback.set({ ok: true, key: 'profile.saved' });
    } catch {
      this.profileFeedback.set({ ok: false, key: 'profile.saveError' });
    } finally {
      this.saving.set(false);
    }
  }

  protected async savePassword(): Promise<void> {
    this.saving.set(true);
    this.passwordFeedback.set(null);
    try {
      await this.auth.changePassword(this.currentPassword, this.newPassword);
      this.currentPassword = '';
      this.newPassword = '';
      this.passwordFeedback.set({ ok: true, key: 'profile.passwordChanged' });
    } catch {
      this.passwordFeedback.set({ ok: false, key: 'profile.passwordError' });
    } finally {
      this.saving.set(false);
    }
  }
}

function readLoginTheme(): LoginTheme {
  try {
    const stored = localStorage.getItem(LOGIN_THEME_STORAGE_KEY) as LoginTheme | null;
    return stored && LOGIN_THEMES.includes(stored) ? stored : 'crt';
  } catch {
    return 'crt';
  }
}
