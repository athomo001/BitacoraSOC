/**
 * File Purpose: frontend/src/app/pages/login/login.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Componente de Login - Dual Theme (CRT Retro + Infoflow Matrix)
 *
 * Temas disponibles:
 *   - 'crt'      → Estilo retro terminal (default)
 *   - 'infoflow' → Estilo Matrix/cyberpunk con canvas animado
 *
 * El tema activo se carga desde GET /api/config/logo (loginTheme).
 * El admin puede cambiar el tema desde /main/admin/appearance.
 *
 * Funcionalidad:
 *   - Formulario de autenticación (username + password)
 *   - Validación reactive forms (min 3 chars user, min 4 chars pass)
 *   - Vista switcheable entre login y recovery
 *   - Loading state con animación
 *   - Matrix canvas animation (sólo tema infoflow)
 *   - Reloj digital en tiempo real para modal recovery
 */
import {
  Component, OnInit, OnDestroy, AfterViewInit,
  ViewEncapsulation, NgZone, ChangeDetectorRef
} from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { ConfigService } from '../../services/config.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { environment } from '../../../environments/environment';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { EasterEggSignal } from '../../models/user.model';
import { Title } from '@angular/platform-browser';

type ViewState = 'login' | 'recovery' | 'mfa';
type LoginTheme = 'crt' | 'infoflow';

@Component({
    selector: 'app-login',
    templateUrl: './login.component.html',
    styleUrl: './login.component.scss',
    encapsulation: ViewEncapsulation.None,
    imports: [
      CommonModule,
      RouterModule,
      ReactiveFormsModule
    ]
})
export class LoginComponent implements OnInit, AfterViewInit, OnDestroy {
  loginForm!: FormGroup;
  recoveryForm!: FormGroup;
  mfaForm!: FormGroup;
  loading = false;
  hidePassword = true;
  logoUrl: string = '';
  currentView: ViewState = 'login';
  bannerMessage: string = '';
  showBanner = false;
  bannerType: 'success' | 'error' | 'info' = 'info';
  showEasterEggOverlay = false;
  easterEggImageUrl = '/scripts/Bender.png';
  mfaToken = '';
  needsMfaSetup = false;
  mfaQrCode = '';
  mfaSecret = '';
  private easterEggTimer?: ReturnType<typeof setTimeout>;

  // Tema activo cargado desde config
  activeTheme: LoginTheme = 'crt';
  showPrivacyConsent = true;

  // Configuración SSO habilitada
  googleSsoEnabled = false;
  googleClientId = '';
  microsoftSsoEnabled = false;
  microsoftClientId = '';
  microsoftTenantId = 'common';

  // Reloj digital para modal recovery (tema infoflow)
  currentTime: string = '';
  private clockInterval?: ReturnType<typeof setInterval>;

  // Matrix canvas
  private matrixAnimFrame?: number;
  private matrixCtx?: CanvasRenderingContext2D | null;
  private matrixDrops: number[] = [];

  // No renderizar hasta que sepamos el tema
  themeLoaded = false;
  appTitle = '';
  typingTitle = ''; // Animación de tecleado para el subtítulo Matrix
  private fullSubtitle = 'SISTEMA DE OPERACIONES > AUTENTICACIÓN SEGURA';
  private typingTimer?: ReturnType<typeof setTimeout>;

  private backendBaseUrl = environment.backendBaseUrl;
  appVersion = environment.appVersion === '__APP_VERSION__' ? 'dev' : environment.appVersion;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private configService: ConfigService,
    private router: Router,
    private snackBar: MatSnackBar,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef,
    private titleService: Title
  ) {}

  getAssetUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `${this.backendBaseUrl}${url}`;
  }

  ngOnInit(): void {
    // Si ya está autenticado, redirigir
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/']);
    }

    // Cargar logo y tema de login
    this.configService.getLogo().subscribe({
      next: (response: any) => {
        this.logoUrl = response.logoUrl;
        this.activeTheme = response.loginTheme === 'infoflow' ? 'infoflow' : 'crt';
        this.appTitle = (response.appTitle || '').trim();
        this.titleService.setTitle(this.appTitle);
        
        // Configuración de Single Sign-On
        this.googleSsoEnabled = response.googleSsoEnabled || false;
        this.googleClientId = response.googleClientId || '';
        this.microsoftSsoEnabled = response.microsoftSsoEnabled || false;
        this.microsoftClientId = response.microsoftClientId || '';
        this.microsoftTenantId = response.microsoftTenantId || 'common';

        console.log('[Login] Tema cargado:', this.activeTheme, '| Título:', this.appTitle);
        this.themeLoaded = true;
        this.cdr.detectChanges();
        if (this.activeTheme === 'infoflow') {
          this.startClock();
          this.startTyping();
          setTimeout(() => this.initMatrixCanvas(), 100);
        }

        // Cargar Google GSI dinámicamente si está habilitado
        if (this.googleSsoEnabled && this.googleClientId) {
          this.initGoogleSSO();
        }

        // Revisar si venimos redireccionados desde Microsoft SSO
        if (this.microsoftSsoEnabled && this.microsoftClientId) {
          this.checkMicrosoftRedirect();
        }
      },
      error: () => {
        this.logoUrl = '';
        this.activeTheme = 'crt';
        this.titleService.setTitle('');
        this.themeLoaded = true;
        this.cdr.detectChanges();
      }
    });

    const hasAccepted = localStorage.getItem('privacyConsentAccepted') === 'true';
    this.showPrivacyConsent = !hasAccepted;

    this.loginForm = this.fb.group({
      username: ['', [Validators.required, Validators.minLength(3)]],
      password: ['', [Validators.required]],
      privacyConsent: [hasAccepted, [Validators.requiredTrue]] // Requerido para compliance (QA-COMPLIANCE-PRIVACY-NOTICE)
    });

    this.recoveryForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });

    this.mfaForm = this.fb.group({
      code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]]
    });
  }

  ngAfterViewInit(): void {
    // Si el tema ya era infoflow al init (raro, pero seguro)
    if (this.activeTheme === 'infoflow') {
      setTimeout(() => this.initMatrixCanvas(), 100);
    }
  }

  ngOnDestroy(): void {
    this.stopMatrixCanvas();
    this.stopClock();
    if (this.typingTimer) clearTimeout(this.typingTimer);
    if (this.easterEggTimer) clearTimeout(this.easterEggTimer);
  }

  // ── Reloj digital ──────────────────────────────────────────
  private startClock(): void {
    const tick = () => {
      const now = new Date();
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      const s = now.getSeconds().toString().padStart(2, '0');
      this.currentTime = `${h}:${m}:${s}`;
    };
    tick();
    this.clockInterval = setInterval(tick, 1000);
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
        this.cdr.detectChanges();
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
      const cols = Math.floor(canvas.width / 16);
      this.matrixDrops = Array(cols).fill(1);
    };

    resize();
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
        if (brightness > 0.96) {
          this.matrixCtx.fillStyle = '#ffffff';
        } else if (brightness > 0.8) {
          this.matrixCtx.fillStyle = '#00ff41';
        } else {
          this.matrixCtx.fillStyle = '#00aa22';
        }
        this.matrixCtx.fillText(char, i * 16, this.matrixDrops[i] * 16);

        if (this.matrixDrops[i] * 16 > canvas.height && Math.random() > 0.975) {
          this.matrixDrops[i] = 0;
        }
        this.matrixDrops[i]++;
      }

      this.matrixAnimFrame = requestAnimationFrame(draw);
    };

    // Ejecutar fuera de Angular para no triggear change detection
    this.ngZone.runOutsideAngular(() => {
      this.matrixAnimFrame = requestAnimationFrame(draw);
    });
  }

  private stopMatrixCanvas(): void {
    if (this.matrixAnimFrame) {
      cancelAnimationFrame(this.matrixAnimFrame);
      this.matrixAnimFrame = undefined;
    }
  }

  // ── Formularios ────────────────────────────────────────────
  onLoginSubmit(): void {
    if (this.loginForm.invalid) return;
    this.loading = true;

    this.authService.login(this.loginForm.value).subscribe({
      next: (response) => {
        if (response.requireMFA) {
          this.loading = false;
          localStorage.setItem('privacyConsentAccepted', 'true');
          this.currentView = 'mfa';
          this.mfaToken = response.mfaToken || '';
          this.needsMfaSetup = !!response.needsSetup;
          if (this.needsMfaSetup) {
            this.startMfaSetupForLogin();
          }
          return;
        }

        this.loading = false;
        localStorage.setItem('privacyConsentAccepted', 'true');
        this.showSuccessBanner(`ACCESO CONCEDIDO - BIENVENIDO ${response.user?.fullName?.toUpperCase()}`);
        setTimeout(() => {
          this.router.navigate(['/main/checklist']);
        }, 1500);
      },
      error: (error) => {
        this.triggerEasterEgg(error?.error?.easterEgg);
        this.loading = false;
        const backendMessage = typeof error?.error === 'string'
          ? error.error
          : error?.error?.message;
        const errorMsg = this.buildLoginErrorGuidance(backendMessage || 'ACCESO DENEGADO');
        this.showErrorBanner(errorMsg);
      }
    });
  }

  private buildLoginErrorGuidance(message: string): string {
    const raw = String(message || 'Acceso denegado');
    const lowered = raw.toLowerCase();

    if (lowered.includes('demasiadas peticiones') || lowered.includes('429')) {
      return 'Acceso bloqueado temporalmente por límite de intentos. Espera unos minutos y vuelve a intentar.';
    }
    if (lowered.includes('invalid') || lowered.includes('credencial') || lowered.includes('usuario') || lowered.includes('password')) {
      return 'Credenciales incorrectas. Verifica usuario/clave o solicita recuperación de contraseña.';
    }
    if (lowered.includes('https requerido') || lowered.includes('426')) {
      return 'La sesión requiere HTTPS. Recarga la página con https:// y vuelve a iniciar sesión.';
    }

    return `${raw}. Siguiente paso: verifica conectividad y reintenta.`;
  }

  onRecoverySubmit(): void {
    if (this.recoveryForm.invalid) return;
    this.loading = true;
    const email = this.recoveryForm.get('email')?.value;

    this.authService.forgotPassword(email).subscribe({
      next: () => {
        this.loading = false;
        this.showSuccessBanner('SOLICITUD RECIBIDA');
        setTimeout(() => {
          this.showBanner = false;
          this.recoveryForm.reset();
        }, 2500);
      },
      error: () => {
        this.loading = false;
        // Proteger contra enumeración de cuentas - siempre mostrar el mismo mensaje
        this.showSuccessBanner('SOLICITUD RECIBIDA');
        setTimeout(() => {
          this.showBanner = false;
          this.recoveryForm.reset();
        }, 2500);
      }
    });
  }

  switchToRecovery(): void {
    this.currentView = 'recovery';
    this.showBanner = false;
    this.loginForm.reset();
  }

  switchToLogin(): void {
    this.currentView = 'login';
    this.showBanner = false;
    this.recoveryForm.reset();
  }

  closeRecoveryOnBackdrop(event: MouseEvent): void {
    // Solo cierra si se hizo clic en el backdrop (no en el modal)
    const modal = document.getElementById('if-recovery-modal');
    if (modal && !modal.contains(event.target as Node)) {
      this.switchToLogin();
    }
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

  closeEasterEggOverlay(): void {
    this.showEasterEggOverlay = false;
    if (this.easterEggTimer) {
      clearTimeout(this.easterEggTimer);
      this.easterEggTimer = undefined;
    }
  }

  private triggerEasterEgg(easterEgg?: EasterEggSignal): void {
    if (!easterEgg || easterEgg.scope !== 'login') return;

    const imageUrl = easterEgg.payload?.imageUrl || '/scripts/Bender.png';
    const durationMs = Number(easterEgg.payload?.durationMs) > 0
      ? Number(easterEgg.payload?.durationMs)
      : 3000;

    this.easterEggImageUrl = imageUrl;
    this.showEasterEggOverlay = true;

    if (this.easterEggTimer) clearTimeout(this.easterEggTimer);
    this.easterEggTimer = setTimeout(() => {
      this.showEasterEggOverlay = false;
      this.easterEggTimer = undefined;
    }, durationMs);
  }

  /**
   * Procesa el código TOTP para enrolamiento de primer uso o autenticación estándar.
   */
  onMfaSubmit(): void {
    if (this.mfaForm.invalid) return;
    this.loading = true;
    const code = this.mfaForm.value.code;

    if (this.needsMfaSetup) {
      // Flujo de enrolamiento inicial
      this.authService.mfaVerify(code, this.mfaToken).subscribe({
        next: (response) => {
          this.loading = false;
          this.showSuccessBanner('MFA ENROLADO Y ACCESO CONCEDIDO');
          setTimeout(() => {
            this.router.navigate(['/main/checklist']);
          }, 1500);
        },
        error: (error) => {
          this.loading = false;
          this.showErrorBanner(error?.error?.message || 'Código de verificación incorrecto');
        }
      });
    } else {
      // Flujo de autenticación recurrente
      this.authService.mfaAuthenticate(code, this.mfaToken).subscribe({
        next: (response) => {
          this.loading = false;
          this.showSuccessBanner('CÓDIGO CORRECTO - BIENVENIDO');
          setTimeout(() => {
            this.router.navigate(['/main/checklist']);
          }, 1500);
        },
        error: (error) => {
          this.loading = false;
          this.showErrorBanner(error?.error?.message || 'Código TOTP inválido o expirado');
        }
      });
    }
  }

  /**
   * Obtiene del backend la imagen QR y el secreto en texto plano para enrolamiento en el login.
   */
  startMfaSetupForLogin(): void {
    this.loading = true;
    this.authService.mfaSetup(this.mfaToken).subscribe({
      next: (res) => {
        this.mfaQrCode = res.qrCode;
        this.mfaSecret = res.secret;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error al iniciar setup de MFA en login:', err);
        this.showErrorBanner('No se pudo generar el código QR de configuración');
        this.loading = false;
      }
    });
  }

  /**
   * Cancela la pantalla de MFA y retorna al formulario de inicio de sesión básico.
   */
  /**
   * Cancela la pantalla de MFA y retorna al formulario de inicio de sesión básico.
   */
  cancelMfa(): void {
    this.currentView = 'login';
    this.mfaToken = '';
    this.needsMfaSetup = false;
    this.mfaQrCode = '';
    this.mfaSecret = '';
    this.mfaForm.reset();
    this.showBanner = false;
  }

  // ── Métodos de soporte para Single Sign-On (SSO) ─────────────────────────────

  /**
   * Carga el script oficial de Google Identity Services dinámicamente si no está en memoria.
   */
  initGoogleSSO(): void {
    const win = window as any;
    if (win.google && win.google.accounts) {
      this.setupGoogleButton();
    } else {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => this.setupGoogleButton();
      document.head.appendChild(script);
    }
  }

  /**
   * Inicializa y renderiza el botón nativo de Google SSO.
   */
  setupGoogleButton(): void {
    const win = window as any;
    if (win.google && win.google.accounts) {
      win.google.accounts.id.initialize({
        client_id: this.googleClientId,
        callback: (response: any) => {
          this.ngZone.run(() => {
            this.handleGoogleSSOLogin(response.credential);
          });
        }
      });
      // Renderizar en el contenedor del DOM si está presente
      const btnContainer = document.getElementById('google-btn-container');
      if (btnContainer) {
        win.google.accounts.id.renderButton(btnContainer, {
          theme: 'outline',
          size: 'large',
          width: 250
        });
      }
    }
  }

  /**
   * Envía el token de Google SSO al backend para autenticación definitiva.
   */
  handleGoogleSSOLogin(idToken: string): void {
    this.loading = true;
    this.authService.loginGoogle(idToken).subscribe({
      next: (response) => {
        this.loading = false;
        this.showSuccessBanner(`ACCESO CONCEDIDO (GOOGLE) - BIENVENIDO ${response.user?.fullName?.toUpperCase()}`);
        setTimeout(() => {
          this.router.navigate(['/main/checklist']);
        }, 1500);
      },
      error: (error) => {
        this.loading = false;
        this.showErrorBanner(error?.error?.message || 'Error al iniciar sesión con Google');
      }
    });
  }

  /**
   * Redirige al usuario al portal de autenticación de Microsoft.
   */
  loginWithMicrosoft(): void {
    const redirectUri = window.location.origin + '/login';
    const authUrl = `https://login.microsoftonline.com/${this.microsoftTenantId}/oauth2/v2.0/authorize` +
      `?client_id=${this.microsoftClientId}` +
      `&response_type=token` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=openid%20profile%20User.Read` +
      `&state=microsoft`;
    window.location.href = authUrl;
  }

  /**
   * Analiza el hash del redireccionamiento para capturar el token de Microsoft.
   */
  checkMicrosoftRedirect(): void {
    const hash = window.location.hash;
    if (!hash) return;

    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get('access_token');
    const state = params.get('state');

    if (accessToken && state === 'microsoft') {
      // Remover los tokens de la barra del navegador por motivos de seguridad
      history.replaceState('', document.title, window.location.pathname + window.location.search);
      
      this.loading = true;
      this.authService.loginMicrosoft(accessToken).subscribe({
        next: (response) => {
          this.loading = false;
          this.showSuccessBanner(`ACCESO CONCEDIDO (MICROSOFT) - BIENVENIDO ${response.user?.fullName?.toUpperCase()}`);
          setTimeout(() => {
            this.router.navigate(['/main/checklist']);
          }, 1500);
        },
        error: (error) => {
          this.loading = false;
          this.showErrorBanner(error?.error?.message || 'Error al iniciar sesión con Microsoft');
        }
      });
    }
  }
}
