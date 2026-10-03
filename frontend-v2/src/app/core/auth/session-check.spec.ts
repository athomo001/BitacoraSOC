import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { tokenInterceptor } from './token.interceptor';

// Hallazgo del dueño: con un token inválido guardado se veía la app completa
// (vacía). Tener token no basta; el servidor tiene que aceptarlo.
describe('sesión validada con el servidor', () => {
  let httpMock: HttpTestingController;

  const problem = (slug: string) => ({ type: `https://bitacorasoc.local/errors/${slug}`, status: 401 });

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('bitacorasoc.token', 'token-guardado');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([tokenInterceptor])),
        provideHttpClientTesting(),
        provideRouter([{ path: 'login', component: class {} }]),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  const runGuard = () =>
    TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)) as Promise<
      boolean | UrlTree
    >;

  it('token que el servidor rechaza: no entra al shell y se borra la sesión', async () => {
    const result = runGuard();
    httpMock.expectOne('/api/users/me').flush(problem('invalid-token'), { status: 401, statusText: 'Unauthorized' });
    const outcome = await result;
    expect(outcome instanceof UrlTree && outcome.toString()).toBe('/login');
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
    expect(localStorage.getItem('bitacorasoc.token')).toBeNull();
  });

  it('token válido: entra y deja cargado el usuario', async () => {
    const result = runGuard();
    httpMock.expectOne('/api/users/me').flush({ data: { id: 'u1', username: 'admin' } });
    expect(await result).toBe(true);
    expect(TestBed.inject(AuthService).user()?.username).toBe('admin');
  });

  it('sesión revocada en cualquier request: vuelve al login', async () => {
    const http = TestBed.inject(HttpClient);
    const call = firstValueFrom(http.get('/api/entries')).catch(() => 'error');
    httpMock.expectOne('/api/entries').flush(problem('revoked-token'), { status: 401, statusText: 'Unauthorized' });
    expect(await call).toBe('error');
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
  });

  it('contraseña mal escrita (401 invalid-credentials) no cierra la sesión', async () => {
    const http = TestBed.inject(HttpClient);
    const call = firstValueFrom(http.post('/api/auth/mfa/disable', {})).catch(() => 'error');
    httpMock.expectOne('/api/auth/mfa/disable').flush(problem('invalid-credentials'), { status: 401, statusText: 'Unauthorized' });
    expect(await call).toBe('error');
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
  });
});
