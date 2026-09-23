import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      // jsdom sin storage habilitado en algún entorno de CI — no crítico para este test.
    }
    TestBed.configureTestingModule({
      // Ruta /login real (aunque sea un componente vacío) — logout() navega
      // ahí, y un router sin ninguna ruta registrada rechaza esa navegación.
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'login', component: class {} }]),
      ],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('arranca sin sesión', () => {
    expect(service.isAuthenticated()).toBe(false);
  });

  it('login exitoso guarda el token y queda autenticado', async () => {
    const loginPromise = service.login('admin', 'clave-correcta');

    const req = httpMock.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'admin', password: 'clave-correcta' });
    req.flush({ data: { token: 'jwt-de-prueba', mustChangePassword: false } });

    await loginPromise;

    expect(service.isAuthenticated()).toBe(true);
    expect(service.token()).toBe('jwt-de-prueba');
  });

  it('login con MFA pendiente NO autentica todavía (falta el segundo factor)', async () => {
    const loginPromise = service.login('admin', 'clave-correcta');

    const req = httpMock.expectOne('/api/auth/login');
    req.flush({ data: { tempToken: 'temp-jwt', mfaPending: true } });

    const result = await loginPromise;

    expect('mfaPending' in result).toBe(true);
    expect(service.isAuthenticated()).toBe(false);
  });

  it('mfaAuthenticate con el tempToken completa el login', async () => {
    const mfaPromise = service.mfaAuthenticate('temp-jwt', '123456');

    const req = httpMock.expectOne('/api/auth/mfa/authenticate');
    expect(req.request.body).toEqual({ tempToken: 'temp-jwt', code: '123456' });
    req.flush({ data: { token: 'jwt-final' } });

    await mfaPromise;

    expect(service.isAuthenticated()).toBe(true);
    expect(service.token()).toBe('jwt-final');
  });

  it('logout limpia la sesión aunque el backend falle', async () => {
    const loginPromise = service.login('admin', 'clave-correcta');
    httpMock.expectOne('/api/auth/login').flush({ data: { token: 'jwt-de-prueba', mustChangePassword: false } });
    await loginPromise;
    expect(service.isAuthenticated()).toBe(true);

    const logoutPromise = service.logout();
    httpMock.expectOne('/api/auth/logout').flush(null, { status: 500, statusText: 'Error' });
    await logoutPromise;

    expect(service.isAuthenticated()).toBe(false);
  });
});
