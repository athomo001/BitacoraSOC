import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { setupCompletedGuard, setupPendingGuard } from './setup.guard';
import { SetupService } from './setup.service';

describe('setup guards', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function run(guard: typeof setupCompletedGuard): Promise<boolean | UrlTree> {
    return TestBed.runInInjectionContext(
      () => guard({} as never, {} as never) as Promise<boolean | UrlTree>,
    );
  }

  function flushStatus(setupCompleted: boolean): void {
    httpMock
      .expectOne('/api/setup/status')
      .flush({ data: { setupCompleted, socEnabled: false, nocEnabled: setupCompleted } });
  }

  it('sin setup, cualquier ruta redirige a /setup (HU-0)', async () => {
    const result = run(setupCompletedGuard);
    flushStatus(false);
    const tree = (await result) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(tree)).toBe('/setup');
  });

  it('con setup completo, deja pasar', async () => {
    const result = run(setupCompletedGuard);
    flushStatus(true);
    expect(await result).toBe(true);
  });

  it('/setup con setup ya completo redirige a /login', async () => {
    const result = run(setupPendingGuard);
    flushStatus(true);
    const tree = (await result) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(tree)).toBe('/login');
  });

  it('el status se pide una sola vez y se cachea entre navegaciones', async () => {
    const first = run(setupCompletedGuard);
    flushStatus(true);
    await first;
    expect(await run(setupCompletedGuard)).toBe(true);
    httpMock.expectNone('/api/setup/status');
  });

  it('tras bootstrap, el caché ya dice setupCompleted sin volver a preguntar', async () => {
    const setup = TestBed.inject(SetupService);
    const done = setup.bootstrap({
      adminUsername: 'admin',
      adminEmail: 'a@x.cl',
      adminPassword: 'x',
      socEnabled: false,
      nocEnabled: true,
    });
    httpMock
      .expectOne('/api/setup/bootstrap')
      .flush({ data: { user: { id: '1', username: 'admin' }, token: 'jwt' } });
    await done;
    expect(await run(setupPendingGuard)).not.toBe(true);
    httpMock.expectNone('/api/setup/status');
  });
});
