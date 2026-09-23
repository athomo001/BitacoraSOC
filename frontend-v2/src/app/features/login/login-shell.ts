import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { isMfaPending } from '../../core/auth/auth.models';

export type LoginSkin = 'modern' | 'cyber' | 'crt' | 'win311' | 'unix89' | 'surrealism';

interface SkinOption {
  id: LoginSkin;
  label: string;
}

const SKINS: readonly SkinOption[] = [
  { id: 'modern', label: 'Industrial Modern' },
  { id: 'cyber', label: 'Cyber/Matrix (Infoflow)' },
  { id: 'crt', label: 'Fósforo CRT' },
  { id: 'win311', label: 'Windows 3.11' },
  { id: 'unix89', label: 'Unix 1989' },
  { id: 'surrealism', label: 'Surrealismo' },
];

/**
 * Componente único de login con los 6 skins históricos (spec/06-frontend-
 * arquitectura-y-ui.md sección 8) — un solo formulario/lógica, la identidad
 * visual conmuta por completo vía CSS puro sobre `[data-skin]`. Fase 4: ya
 * conectado a POST /api/auth/login de verdad, incluido el flujo de MFA de
 * 2 pasos (spec/04-contratos-api.md).
 */
@Component({
  selector: 'app-login-shell',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login-shell.html',
  styleUrl: './login-shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginShellComponent {
  protected readonly skins = SKINS;
  protected readonly currentSkin = signal<LoginSkin>('modern');

  protected username = '';
  protected password = '';
  protected mfaCode = '';

  protected readonly mfaPending = signal(false);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  private mfaTempToken = '';

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected setSkin(skin: LoginSkin): void {
    this.currentSkin.set(skin);
  }

  protected async onSubmit(): Promise<void> {
    this.errorMessage.set(null);
    this.loading.set(true);
    try {
      const result = await this.auth.login(this.username, this.password);
      if (isMfaPending(result)) {
        this.mfaTempToken = result.tempToken;
        this.mfaPending.set(true);
        return;
      }
      await this.router.navigateByUrl('/');
    } catch {
      this.errorMessage.set('Usuario o contraseña incorrectos.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async onMfaSubmit(): Promise<void> {
    this.errorMessage.set(null);
    this.loading.set(true);
    try {
      await this.auth.mfaAuthenticate(this.mfaTempToken, this.mfaCode);
      await this.router.navigateByUrl('/');
    } catch {
      this.errorMessage.set('Código incorrecto o vencido.');
    } finally {
      this.loading.set(false);
    }
  }
}
