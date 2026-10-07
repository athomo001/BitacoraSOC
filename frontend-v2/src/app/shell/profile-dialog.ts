import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth/auth.service';
import { MfaEnrollment } from '../core/auth/auth.models';
import { I18nService } from '../core/i18n/i18n.service';
import { MessageKey } from '../core/i18n/messages';
import { PreferencesService, Theme } from '../core/preferences/preferences.service';
import { ModalComponent } from '../shared/ui/modal/modal';
import { ButtonComponent } from '../shared/ui/button/button';
import { UserAvatarComponent } from './user-avatar';
import { LOGIN_THEMES, LOGIN_THEME_LABELS, LOGIN_THEME_STORAGE_KEY, LoginTheme } from '../features/login/login-themes';

interface Feedback {
  ok: boolean;
  key: MessageKey;
}

type Tab = 'data' | 'security' | 'prefs';

const ROLE_KEYS: Record<string, MessageKey> = {
  admin: 'access.role.admin',
  user: 'access.role.user',
  auditor: 'access.role.auditor',
};

const STRENGTH: readonly { label: MessageKey; color: string }[] = [
  { label: 'profile.pwWeak', color: 'var(--status-critical)' },
  { label: 'profile.pwWeak', color: 'var(--status-critical)' },
  { label: 'profile.pwFair', color: 'var(--status-warning)' },
  { label: 'profile.pwGood', color: 'var(--status-ok)' },
  { label: 'profile.pwStrong', color: 'var(--status-ok)' },
];

/**
 * "Mi perfil" — se abre desde la fila de usuario al pie de la barra lateral
 * (CDK Dialog + app-modal: foco atrapado, Esc cierra). Diseño aprobado en el
 * canvas "BitacoraSOC UI Base" (artboard Mi perfil, 2026-10-07): identidad
 * arriba y tres pestañas — datos personales, seguridad (contraseña y
 * verificación en dos pasos, como el perfil del legacy) y preferencias.
 */
@Component({
  selector: 'app-profile-dialog',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, UserAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profile-dialog.html',
  styleUrl: './profile-dialog.css',
})
export class ProfileDialogComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly prefs = inject(PreferencesService);
  private readonly auth = inject(AuthService);
  protected readonly user = this.auth.user;

  protected readonly tabs: readonly { id: Tab; icon: string; label: MessageKey }[] = [
    { id: 'data', icon: 'badge', label: 'profile.tabData' },
    { id: 'security', icon: 'shield', label: 'profile.tabSecurity' },
    { id: 'prefs', icon: 'tune', label: 'profile.tabPrefs' },
  ];
  protected readonly themes: readonly { id: Theme; icon: string; label: MessageKey }[] = [
    { id: 'dark', icon: 'dark_mode', label: 'profile.themeDark' },
    { id: 'light', icon: 'light_mode', label: 'profile.themeLight' },
    { id: 'pink', icon: 'favorite', label: 'profile.themePink' },
  ];
  protected readonly loginThemes = LOGIN_THEMES;
  protected readonly loginThemeLabels = LOGIN_THEME_LABELS;
  protected readonly loginPreview: Record<LoginTheme, { bg: string; mark: string }> = {
    crt: { bg: '#0b3d0b', mark: '>_' },
    infoflow: { bg: 'linear-gradient(135deg, #0ea5e9, #6366f1)', mark: '≈' },
    modern: { bg: 'linear-gradient(135deg, #1f6feb, #0d1117)', mark: 'Aa' },
    surrealism: { bg: 'linear-gradient(135deg, #f59e0b, #be185d)', mark: '◐' },
    win311: { bg: '#008080', mark: '▣' },
    unix89: { bg: '#222', mark: '$' },
  };
  /** Lo fija el admin (6 por defecto, como el legacy); el servidor también lo exige. */
  protected readonly minPassword = signal(6);

  protected readonly tab = signal<Tab>('data');
  protected readonly loginTheme = signal<LoginTheme>(readLoginTheme());
  protected readonly saving = signal(false);
  protected readonly profileFeedback = signal<Feedback | null>(null);
  protected readonly passwordFeedback = signal<Feedback | null>(null);
  protected readonly mfaFeedback = signal<Feedback | null>(null);

  protected fullName = this.user()?.fullName ?? '';
  protected phone = this.user()?.phone ?? '';
  protected birthday = this.user()?.birthday ?? '';
  protected avatarUrl = this.user()?.avatarUrl ?? '';

  protected readonly currentPassword = signal('');
  protected readonly newPassword = signal('');
  protected readonly repeatPassword = signal('');
  protected readonly showPw = signal(false);

  protected readonly enrollment = signal<MfaEnrollment | null>(null);
  protected readonly mfaCode = signal('');
  protected readonly disabling = signal(false);
  protected readonly mfaPassword = signal('');

  protected readonly roleKey = computed(() => ROLE_KEYS[this.user()?.role ?? ''] ?? null);
  protected readonly lastLogin = computed(() => {
    const at = this.user()?.lastLoginAt;
    return at ? formatDateTime(new Date(at)) : null;
  });
  protected readonly passwordsMatch = computed(() => this.newPassword() === this.repeatPassword());
  protected readonly strength = computed(() => {
    const pw = this.newPassword();
    const min = this.minPassword();
    let score = 0;
    if (pw.length >= min) score++;
    if (pw.length >= 12) score++;
    if (/[a-zA-Z]/.test(pw) && /\d/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw) || (/[a-z]/.test(pw) && /[A-Z]/.test(pw))) score++;
    if (pw.length < min) score = Math.min(score, 1);
    return { score, ...STRENGTH[score] };
  });
  protected readonly canChangePassword = computed(
    () =>
      (this.user()?.mustChangePassword || !!this.currentPassword()) &&
      this.newPassword().length >= this.minPassword() &&
      this.passwordsMatch(),
  );
  protected readonly codeReady = computed(() => /^\d{6}$/.test(this.mfaCode().replace(/\s/g, '')));
  protected readonly groupedSecret = computed(() => (this.enrollment()?.secret ?? '').replace(/(.{4})(?=.)/g, '$1 '));

  async ngOnInit(): Promise<void> {
    try {
      this.minPassword.set(await this.auth.passwordMinLength());
    } catch {
      // Sin respuesta queda el de por defecto; el servidor igual valida.
    }
  }

  protected selectTab(tab: Tab): void {
    this.tab.set(tab);
    this.profileFeedback.set(null);
  }

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
    if (!this.canChangePassword()) return;
    this.saving.set(true);
    this.passwordFeedback.set(null);
    try {
      await this.auth.changePassword(this.currentPassword(), this.newPassword());
      this.currentPassword.set('');
      this.newPassword.set('');
      this.repeatPassword.set('');
      this.passwordFeedback.set({ ok: true, key: 'profile.passwordChanged' });
    } catch {
      this.passwordFeedback.set({ ok: false, key: 'profile.passwordError' });
    } finally {
      this.saving.set(false);
    }
  }

  protected async startMfa(): Promise<void> {
    this.saving.set(true);
    this.mfaFeedback.set(null);
    try {
      this.enrollment.set(await this.auth.mfaSetup());
      this.mfaCode.set('');
    } catch {
      this.mfaFeedback.set({ ok: false, key: 'profile.mfaSetupError' });
    } finally {
      this.saving.set(false);
    }
  }

  protected async confirmMfa(): Promise<void> {
    if (!this.codeReady() || this.saving()) return;
    this.saving.set(true);
    this.mfaFeedback.set(null);
    try {
      await this.auth.mfaVerify(this.mfaCode().replace(/\s/g, ''));
      this.enrollment.set(null);
      this.mfaFeedback.set({ ok: true, key: 'profile.mfaEnabled' });
    } catch {
      this.mfaFeedback.set({ ok: false, key: 'profile.mfaBadCode' });
    } finally {
      this.saving.set(false);
    }
  }

  protected async disableMfa(): Promise<void> {
    if (!this.mfaPassword() || this.saving()) return;
    this.saving.set(true);
    this.mfaFeedback.set(null);
    try {
      await this.auth.mfaDisable(this.mfaPassword());
      this.disabling.set(false);
      this.mfaPassword.set('');
      this.mfaFeedback.set({ ok: true, key: 'profile.mfaDisabled' });
    } catch {
      this.mfaFeedback.set({ ok: false, key: 'profile.mfaBadPassword' });
    } finally {
      this.saving.set(false);
    }
  }

  protected cancelMfa(): void {
    this.enrollment.set(null);
    this.mfaCode.set('');
    this.disabling.set(false);
    this.mfaPassword.set('');
    this.mfaFeedback.set(null);
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

function formatDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
