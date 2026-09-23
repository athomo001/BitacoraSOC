/**
 * Login con los 6 temas históricos — PORTADO DEL LEGACY
 * (frontend/src/app/pages/login/login.component.{ts,html,scss} + los 5
 * login-*.scss), no rediseñado: template y estilos son los originales,
 * copiados y adaptados. Reemplaza al LoginShellComponent de la Fase 3, que
 * había reinventado los skins como simples paletas sobre un solo formulario.
 *
 * Adaptaciones respecto del legacy (lo demás es idéntico):
 *   - Auth contra la API Go (spec/04-contratos-api.md): login devuelve
 *     {token} o {tempToken, mfaPending}; errores RFC 7807.
 *   - Zoneless (Angular 22): tras cada cambio asíncrono se llama
 *     markForCheck() — en el legacy lo hacía zone.js solo.
 *   - Sin SSO Google/Microsoft (fuera de alcance del núcleo, spec 02) ni
 *     easter egg (el backend nuevo no emite la señal): sus bloques se
 *     quitaron del template.
 *   - Tema: preferencia guardada en localStorage (igual que el legacy); el
 *     default configurable por el admin (GET /api/config/logo → loginTheme)
 *     todavía no existe en la API nueva, se usa 'crt' como el legacy.
 *   - Título fijo 'Bitácora Ops' (el legacy lo leía de la config).
 *   - Sin enrolamiento MFA desde el login: la API nueva exige sesión para
 *     /api/auth/mfa/setup, así que needsMfaSetup queda siempre en false.
 */
import {
  ChangeDetectorRef,
  Component,
  NgZone,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import anime from 'animejs';
import { AuthService } from '../../core/auth/auth.service';
import { isMfaPending } from '../../core/auth/auth.models';

type ViewState = 'login' | 'recovery' | 'mfa';
export type LoginTheme = 'crt' | 'infoflow' | 'modern' | 'surrealism' | 'win311' | 'unix89';

export const LOGIN_THEMES: readonly LoginTheme[] = ['crt', 'infoflow', 'modern', 'surrealism', 'win311', 'unix89'];
const THEME_STORAGE_KEY = 'preferredLoginTheme';
const PRIVACY_STORAGE_KEY = 'privacyConsentAccepted';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit, OnDestroy {
  loginForm!: FormGroup;
  recoveryForm!: FormGroup;
  mfaForm!: FormGroup;
  loading = false;
  hidePassword = true;
  logoUrl = '';
  currentView: ViewState = 'login';
  bannerMessage = '';
  showBanner = false;
  bannerType: 'success' | 'error' | 'info' = 'info';
  mfaToken = '';
  needsMfaSetup = false;
  mfaQrCode = '';
  mfaSecret = '';
  private glitchTimer?: ReturnType<typeof setTimeout>;

  activeTheme: LoginTheme = 'crt';
  showThemeMenu = false;
  showPrivacyConsent = true;
  unix89Time = '';

  currentTime = '';
  private clockInterval?: ReturnType<typeof setInterval>;

  private matrixAnimFrame?: number;
  private matrixCtx?: CanvasRenderingContext2D | null;
  private matrixDrops: number[] = [];
  private matrixResize?: () => void;

  themeLoaded = false;
  appTitle = 'Bitácora Ops';
  appVersion = 'dev';
  typingTitle = '';
  private readonly fullSubtitle = 'SISTEMA DE OPERACIONES > AUTENTICACIÓN SEGURA';
  private typingTimer?: ReturnType<typeof setTimeout>;

  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly ngZone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly titleService = inject(Title);

  getAssetUrl(url: string): string {
    return url;
  }

  ngOnInit(): void {
    if (this.authService.isAuthenticated()) {
      void this.router.navigate(['/']);
    }

    const hasAccepted = readStorage(PRIVACY_STORAGE_KEY) === 'true';
    this.showPrivacyConsent = !hasAccepted;

    this.loginForm = this.fb.group({
      username: ['', [Validators.required, Validators.minLength(3)]],
      password: ['', [Validators.required]],
      privacyConsent: [hasAccepted, [Validators.requiredTrue]], // QA-COMPLIANCE-PRIVACY-NOTICE (legacy)
    });
    this.recoveryForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
    });
    this.mfaForm = this.fb.group({
      code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
    });

    const localTheme = readStorage(THEME_STORAGE_KEY);
    this.activeTheme = LOGIN_THEMES.includes(localTheme as LoginTheme) ? (localTheme as LoginTheme) : 'crt';
    this.titleService.setTitle(this.appTitle);
    this.themeLoaded = true;
    this.initializeThemeSpecifics();
  }

  // ── Gestión de Temas en Caliente ──────────────────────────
  toggleThemeMenu(): void {
    this.showThemeMenu = !this.showThemeMenu;
  }

  clearLoginForm(): void {
    this.loginForm.get('username')?.setValue('');
    this.loginForm.get('password')?.setValue('');
    this.loginForm.get('username')?.markAsUntouched();
    this.loginForm.get('password')?.markAsUntouched();
  }

  getMaskedPassword(): string {
    const pass = this.loginForm.get('password')?.value || '';
    return '*'.repeat(pass.length);
  }

  selectLoginTheme(theme: LoginTheme): void {
    this.stopThemeSpecifics();
    this.activeTheme = theme;
    writeStorage(THEME_STORAGE_KEY, theme);
    this.showThemeMenu = false;
    this.initializeThemeSpecifics();
    this.render();
  }

  private initializeThemeSpecifics(): void {
    if (this.activeTheme === 'infoflow' || this.activeTheme === 'modern' || this.activeTheme === 'surrealism' || this.activeTheme === 'unix89') {
      this.startClock();
      if (this.activeTheme === 'infoflow') {
        this.startTyping();
      }
      if (this.activeTheme === 'infoflow' || this.activeTheme === 'modern') {
        setTimeout(() => this.initMatrixCanvas(), 100);
      }
    }
    if (this.activeTheme === 'crt' || this.activeTheme === 'unix89') {
      this.startRandomGlitches();
      setTimeout(() => this.triggerScreenTurnOn(), 100);
    }
  }

  private stopThemeSpecifics(): void {
    this.stopClock();
    this.stopMatrixCanvas();
    this.stopRandomGlitches();
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = undefined;
    }
    this.typingTitle = '';
  }

  ngOnDestroy(): void {
    this.stopMatrixCanvas();
    this.stopClock();
    this.stopRandomGlitches();
    if (this.typingTimer) clearTimeout(this.typingTimer);
  }

  // ── Reloj digital ──────────────────────────────────────────
  private startClock(): void {
    const tick = () => {
      const now = new Date();
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      const s = now.getSeconds().toString().padStart(2, '0');
      this.currentTime = `${h}:${m}:${s}`;
      this.unix89Time = this.getUnix89Time();
      this.render();
    };
    tick();
    this.clockInterval = setInterval(tick, 1000);
  }

  getUnix89Time(): string {
    const year1989Date = new Date();
    year1989Date.setFullYear(1989);
    const parts = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    }).formatToParts(year1989Date);
    const part = (type: string, fallback = '') => parts.find((p) => p.type === type)?.value || fallback;
    return `${part('weekday')} ${part('month')} ${part('day')} ${part('hour', '00')}:${part('minute', '00')}:${part('second', '00')} UTC 1989`;
  }

  private stopClock(): void {
    if (this.clockInterval) {
      clearInterval(this.clockInterval);
      this.clockInterval = undefined;
    }
  }

  // ── Efecto Typing ──────────────────────────────────────────
  private startTyping(): void {
    this.typingTitle = '';
    let i = 0;
    const type = () => {
      if (i < this.fullSubtitle.length) {
        this.typingTitle += this.fullSubtitle.charAt(i);
        i++;
        this.typingTimer = setTimeout(type, 50);
        this.render();
      }
    };
    type();
  }

  // ── Matrix Canvas ──────────────────────────────────────────
  private initMatrixCanvas(): void {
    const canvas = document.getElementById('matrix-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.matrixCtx = ctx;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      this.matrixDrops = Array(Math.floor(canvas.width / 16)).fill(1);
    };
    resize();
    this.matrixResize = resize;
    window.addEventListener('resize', resize);

    const chars = 'アカサタナハマヤラワABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*()';
    const draw = () => {
      if (!this.matrixCtx || !canvas.isConnected) return;
      this.matrixCtx.fillStyle = 'rgba(4, 10, 4, 0.05)';
      this.matrixCtx.fillRect(0, 0, canvas.width, canvas.height);
      this.matrixCtx.font = '14px "Courier New", monospace';
      for (let i = 0; i < this.matrixDrops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const brightness = Math.random();
        this.matrixCtx.fillStyle = brightness > 0.96 ? '#ffffff' : brightness > 0.8 ? '#00ff41' : '#00aa22';
        this.matrixCtx.fillText(char, i * 16, this.matrixDrops[i] * 16);
        if (this.matrixDrops[i] * 16 > canvas.height && Math.random() > 0.975) {
          this.matrixDrops[i] = 0;
        }
        this.matrixDrops[i]++;
      }
      this.matrixAnimFrame = requestAnimationFrame(draw);
    };
    this.ngZone.runOutsideAngular(() => {
      this.matrixAnimFrame = requestAnimationFrame(draw);
    });
  }

  private stopMatrixCanvas(): void {
    if (this.matrixAnimFrame) {
      cancelAnimationFrame(this.matrixAnimFrame);
      this.matrixAnimFrame = undefined;
    }
    if (this.matrixResize) {
      // El legacy nunca quitaba este listener — se acumulaba uno por cada
      // cambio de tema a Matrix/Moderno.
      window.removeEventListener('resize', this.matrixResize);
      this.matrixResize = undefined;
    }
  }

  // ── Formularios ────────────────────────────────────────────
  async onLoginSubmit(): Promise<void> {
    if (this.loginForm.invalid) {
      if (this.activeTheme === 'crt') this.triggerGlitch();
      return;
    }
    this.loading = true;
    const { username, password } = this.loginForm.value;
    try {
      const result = await this.authService.login(username, password);
      this.loading = false;
      writeStorage(PRIVACY_STORAGE_KEY, 'true');
      if (isMfaPending(result)) {
        this.currentView = 'mfa';
        this.mfaToken = result.tempToken;
        this.needsMfaSetup = false;
        return;
      }
      this.showSuccessBanner(`ACCESO CONCEDIDO - BIENVENIDO ${String(username).toUpperCase()}`);
      setTimeout(() => void this.router.navigate(['/']), 1500);
    } catch (error) {
      if (this.activeTheme === 'crt') this.triggerGlitch();
      this.loading = false;
      this.showErrorBanner(this.buildLoginErrorGuidance(error));
    } finally {
      this.render();
    }
  }

  /** Mismos textos guía del legacy, decididos por status HTTP (RFC 7807) en vez de adivinar por el mensaje. */
  private buildLoginErrorGuidance(error: unknown): string {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    const detail = error instanceof HttpErrorResponse ? error.error?.detail : undefined;
    switch (status) {
      case 429:
        return 'Acceso bloqueado temporalmente por límite de intentos. Espera unos minutos y vuelve a intentar.';
      case 401:
        return 'Credenciales incorrectas. Verifica usuario/clave o solicita recuperación de contraseña.';
      case 423:
        return 'Cuenta bloqueada temporalmente por intentos fallidos. Espera unos minutos o contacta a un administrador.';
      case 426:
        return 'La sesión requiere HTTPS. Recarga la página con https:// y vuelve a iniciar sesión.';
      case 0:
        return 'Sin conexión con el servidor. Siguiente paso: verifica conectividad y reintenta.';
    }
    return `${detail || 'ACCESO DENEGADO'}. Siguiente paso: verifica conectividad y reintenta.`;
  }

  async onRecoverySubmit(): Promise<void> {
    if (this.recoveryForm.invalid) return;
    this.loading = true;
    try {
      await this.authService.forgotPassword(this.recoveryForm.get('email')?.value);
    } catch {
      // Protección contra enumeración de cuentas: siempre el mismo mensaje (legacy).
    }
    this.loading = false;
    this.showSuccessBanner('SOLICITUD RECIBIDA');
    this.render();
    setTimeout(() => {
      this.showBanner = false;
      this.recoveryForm.reset();
      this.render();
    }, 2500);
  }

  switchToRecovery(): void {
    this.currentView = 'recovery';
    this.showBanner = false;
    this.loginForm.get('username')?.setValue('');
    this.loginForm.get('username')?.markAsUntouched();
    this.loginForm.get('password')?.setValue('');
    this.loginForm.get('password')?.markAsUntouched();
  }

  switchToLogin(): void {
    this.currentView = 'login';
    this.showBanner = false;
    this.recoveryForm.reset();
    this.loginForm.get('privacyConsent')?.setValue(readStorage(PRIVACY_STORAGE_KEY) === 'true');
  }

  private showSuccessBanner(message: string): void {
    this.bannerMessage = message;
    this.bannerType = 'success';
    this.showBanner = true;
  }

  private showErrorBanner(message: string): void {
    this.bannerMessage = message;
    this.bannerType = 'error';
    this.showBanner = true;
  }

  async onMfaSubmit(): Promise<void> {
    if (this.mfaForm.invalid) return;
    this.loading = true;
    try {
      await this.authService.mfaAuthenticate(this.mfaToken, this.mfaForm.value.code);
      this.loading = false;
      this.showSuccessBanner('CÓDIGO CORRECTO - BIENVENIDO');
      setTimeout(() => void this.router.navigate(['/']), 1500);
    } catch (error) {
      this.loading = false;
      const detail = error instanceof HttpErrorResponse ? error.error?.detail : undefined;
      this.showErrorBanner(detail || 'Código TOTP inválido o expirado');
    } finally {
      this.render();
    }
  }

  cancelMfa(): void {
    this.currentView = 'login';
    this.mfaToken = '';
    this.needsMfaSetup = false;
    this.mfaQrCode = '';
    this.mfaSecret = '';
    this.mfaForm.reset();
    this.showBanner = false;
  }

  // ── Animaciones CRT con Anime.js ──────────────────────────────
  triggerScreenTurnOn(): void {
    const screen = document.querySelector('.crt-screen');
    if (!screen) return;
    this.ngZone.runOutsideAngular(() => {
      anime
        .timeline({ easing: 'easeOutExpo' })
        .add({ targets: screen, scaleX: [0, 1.05], scaleY: [0.002, 0.002], filter: 'brightness(30) contrast(4)', opacity: [0, 1], duration: 300 })
        .add({ targets: screen, scaleY: [0.002, 1], scaleX: [1.05, 1], filter: ['brightness(15) contrast(2)', 'brightness(1) contrast(1)'], duration: 400 });
    });
  }

  animateScreenTransition(action: () => void): void {
    const screen = document.querySelector('.crt-screen');
    if (!screen) {
      action();
      return;
    }
    this.loading = true;
    this.render();
    this.ngZone.runOutsideAngular(() => {
      anime
        .timeline({ easing: 'easeOutExpo' })
        .add({ targets: screen, scaleY: 0.002, scaleX: 1.05, filter: 'brightness(15) contrast(3)', duration: 250 })
        .add({
          targets: screen,
          scaleX: 0,
          filter: 'brightness(50) contrast(5)',
          duration: 180,
          complete: () => {
            action();
            this.render();
          },
        })
        .add({ targets: screen, scaleX: [0, 1.05], scaleY: [0.002, 0.002], filter: 'brightness(20) contrast(4)', duration: 180 })
        .add({
          targets: screen,
          scaleY: [0.002, 1],
          scaleX: [1.05, 1],
          filter: ['brightness(10) contrast(2)', 'brightness(1) contrast(1)'],
          duration: 300,
          complete: () => {
            this.loading = false;
            this.render();
          },
        });
    });
  }

  triggerGlitch(): void {
    const screen = document.querySelector('.crt-screen');
    if (!screen) return;
    const randomSkew = () => (Math.random() - 0.5) * 12;
    const randomTranslate = () => (Math.random() - 0.5) * 18;
    this.ngZone.runOutsideAngular(() => {
      anime({
        targets: screen,
        translateX: [
          { value: randomTranslate(), duration: 60 },
          { value: randomTranslate(), duration: 60 },
          { value: 0, duration: 60 },
        ],
        skewX: [
          { value: randomSkew(), duration: 60 },
          { value: randomSkew(), duration: 60 },
          { value: 0, duration: 60 },
        ],
        filter: [
          { value: 'brightness(1.6) contrast(1.3) hue-rotate(50deg)', duration: 70 },
          { value: 'brightness(0.7) contrast(1.6) hue-rotate(-40deg)', duration: 70 },
          { value: 'brightness(1) contrast(1) hue-rotate(0deg)', duration: 90 },
        ],
        easing: 'linear',
      });
    });
  }

  private startRandomGlitches(): void {
    this.stopRandomGlitches();
    const scheduleNext = () => {
      this.glitchTimer = setTimeout(() => {
        this.triggerGlitch();
        scheduleNext();
      }, Math.random() * 8000 + 7000);
    };
    scheduleNext();
  }

  private stopRandomGlitches(): void {
    if (this.glitchTimer) {
      clearTimeout(this.glitchTimer);
      this.glitchTimer = undefined;
    }
  }

  animateToRecovery(): void {
    this.animateScreenTransition(() => this.switchToRecovery());
  }

  animateToLogin(): void {
    this.animateScreenTransition(() => this.switchToLogin());
  }

  animateCancelMfa(): void {
    this.animateScreenTransition(() => this.cancelMfa());
  }

  /** Zoneless: cambios hechos fuera de un evento del template no redibujan solos. */
  private render(): void {
    this.cdr.markForCheck();
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage bloqueado: la preferencia vale solo para esta carga.
  }
}
