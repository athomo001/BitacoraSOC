import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { LOGIN_THEMES, LoginComponent, LoginTheme } from './login.component';

/** Clase raíz de cada tema en el template portado del legacy. */
const THEME_ROOT: Record<LoginTheme, string> = {
  crt: '.crt-container',
  infoflow: '.theme-cyber',
  modern: '.theme-modern',
  surrealism: '.theme-surrealism',
  win311: '.theme-win311',
  unix89: '.theme-unix89',
};

describe('LoginComponent (portado del legacy)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      // jsdom sin storage — no crítico.
    }
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function render() {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('arranca en el tema CRT por defecto, como el legacy', () => {
    const { el } = render();
    expect(el.querySelector('.crt-container')).not.toBeNull();
  });

  for (const theme of LOGIN_THEMES) {
    it(`el tema ${theme} renderiza su layout propio y ningún otro`, () => {
      const { fixture, component, el } = render();
      component.selectLoginTheme(theme);
      fixture.detectChanges();
      expect(el.querySelector(THEME_ROOT[theme])).not.toBeNull();
      const others = LOGIN_THEMES.filter((t) => t !== theme).map((t) => THEME_ROOT[t]);
      expect(others.every((selector) => el.querySelector(selector) === null)).toBe(true);
    });
  }

  it('recuerda el tema elegido entre cargas (localStorage, igual que el legacy)', () => {
    const first = render();
    first.component.selectLoginTheme('win311');
    const second = render();
    expect(second.el.querySelector('.theme-win311')).not.toBeNull();
  });

  it('login exige aceptar el aviso de privacidad antes de enviar', () => {
    const { component } = render();
    component.loginForm.patchValue({ username: 'admin', password: 'clave' });
    expect(component.loginForm.valid).toBe(false);
    component.loginForm.patchValue({ privacyConsent: true });
    expect(component.loginForm.valid).toBe(true);
  });

  it('login con MFA pendiente pasa a la vista MFA y autentica con el tempToken', async () => {
    const { component } = render();
    component.loginForm.patchValue({ username: 'admin', password: 'clave', privacyConsent: true });
    const pending = component.onLoginSubmit();
    httpMock.expectOne('/api/auth/login').flush({ data: { tempToken: 'temp-jwt', mfaPending: true } });
    await pending;
    expect(component.currentView).toBe('mfa');

    component.mfaForm.patchValue({ code: '123456' });
    const mfa = component.onMfaSubmit();
    const req = httpMock.expectOne('/api/auth/mfa/authenticate');
    expect(req.request.body).toEqual({ tempToken: 'temp-jwt', code: '123456' });
    req.flush({ data: { token: 'jwt' } });
    await mfa;
    expect(component.bannerType).toBe('success');
  });

  it('401 muestra la guía de credenciales incorrectas del legacy', async () => {
    const { component } = render();
    component.loginForm.patchValue({ username: 'admin', password: 'mala', privacyConsent: true });
    const done = component.onLoginSubmit();
    httpMock
      .expectOne('/api/auth/login')
      .flush({ type: 'x', status: 401, detail: 'credenciales inválidas' }, { status: 401, statusText: 'Unauthorized' });
    await done;
    expect(component.bannerType).toBe('error');
    expect(component.bannerMessage).toContain('Credenciales incorrectas');
  });

  it('recuperación siempre responde "SOLICITUD RECIBIDA" (anti-enumeración)', async () => {
    const { component } = render();
    component.recoveryForm.patchValue({ email: 'nadie@x.cl' });
    const done = component.onRecoverySubmit();
    httpMock.expectOne('/api/auth/forgot-password').flush({}, { status: 500, statusText: 'err' });
    await done;
    expect(component.bannerMessage).toBe('SOLICITUD RECIBIDA');
  });
});
