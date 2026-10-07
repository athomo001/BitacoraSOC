import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { AuthService } from '../core/auth/auth.service';
import { ProfileDialogComponent } from './profile-dialog';

const ME = {
  id: 'u1', username: 'arojas', email: 'arojas@empresa.cl', fullName: 'Ana Rojas', role: 'admin', cargoLabel: 'Analista N2',
  mfaEnabled: false, mustChangePassword: false, active: true, createdAt: '2026-01-01T00:00:00Z', lastLoginAt: '2026-10-07T12:12:00Z',
};

describe('ProfileDialogComponent (diseño aprobado 2026-10-07)', () => {
  let httpMock: HttpTestingController;
  const tick = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ProfileDialogComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  async function render(me: object = ME) {
    const auth = TestBed.inject(AuthService);
    const loaded = auth.loadMe();
    httpMock.expectOne('/api/users/me').flush({ data: me });
    await loaded;
    const fixture = TestBed.createComponent(ProfileDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  async function settle(fixture: { detectChanges: () => void; whenStable: () => Promise<unknown> }) {
    await tick();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const button = (root: ParentNode, text: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(text)) as HTMLButtonElement;

  function type(el: HTMLElement, name: string, value: string) {
    const input = el.querySelector(`input[name="${name}"]`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('muestra la identidad: usuario, cargo, rol y último ingreso', async () => {
    const { el } = await render();
    const text = el.textContent ?? '';
    expect(text).toContain('Ana Rojas');
    expect(text).toContain('@arojas');
    expect(text).toContain('Analista N2');
    expect(text).toContain('Admin');
    expect(text).toMatch(/07-10-2026 \d\d:\d\d/);
  });

  it('el correo no se edita desde el perfil', async () => {
    const { el } = await render();
    expect(el.querySelector('input[name="email"]')).toBeNull();
    expect(el.textContent).toContain('Lo cambia un administrador.');
  });

  it('cambiar contraseña exige que la nueva y la repetida coincidan', async () => {
    const { fixture, el } = await render();
    button(el, 'Seguridad').click();
    await settle(fixture);
    type(el, 'currentPassword', 'vieja-123');
    type(el, 'newPassword', 'NuevaClave-2026');
    type(el, 'repeatPassword', 'NuevaClave-2025');
    await settle(fixture);
    expect(button(el, 'Cambiar contraseña').disabled).toBe(true);

    type(el, 'repeatPassword', 'NuevaClave-2026');
    await settle(fixture);
    expect(el.textContent).toContain('Fuerte');
    button(el, 'Cambiar contraseña').click();
    const req = httpMock.expectOne('/api/users/me/password');
    expect(req.request.body).toEqual({ currentPassword: 'vieja-123', newPassword: 'NuevaClave-2026' });
    req.flush({ data: { user: ME } });
    await settle(fixture);
    expect(el.textContent).toContain('Contraseña actualizada.');
  });

  it('el mínimo de la contraseña lo fija el admin (servidor)', async () => {
    const { fixture, el } = await render();
    httpMock.expectOne('/api/auth/password-policy').flush({ data: { minLength: 10 } });
    button(el, 'Seguridad').click();
    await settle(fixture);
    type(el, 'currentPassword', 'vieja');
    type(el, 'newPassword', 'corta-123');
    type(el, 'repeatPassword', 'corta-123');
    await settle(fixture);
    expect(el.textContent).toContain('Mínimo 10 caracteres');
    expect(button(el, 'Cambiar contraseña').disabled).toBe(true);
    type(el, 'newPassword', 'larga-12345');
    type(el, 'repeatPassword', 'larga-12345');
    await settle(fixture);
    expect(button(el, 'Cambiar contraseña').disabled).toBe(false);
  });

  it('activar la verificación en dos pasos: QR, código y queda activa', async () => {
    const { fixture, el } = await render();
    button(el, 'Seguridad').click();
    await settle(fixture);
    expect(el.textContent).toContain('Inactiva');

    button(el, 'Activar').click();
    httpMock.expectOne('/api/auth/mfa/setup').flush({ data: { qrCodeDataUrl: 'data:image/png;base64,AAAA', secret: 'JBSWY3DPEHPK3PXP' } });
    await settle(fixture);
    expect(el.querySelector('img.pf__qr')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(el.textContent).toContain('JBSW Y3DP EHPK 3PXP');

    type(el, 'mfaCode', '12345');
    await settle(fixture);
    expect(button(el, 'Confirmar').disabled).toBe(true);
    type(el, 'mfaCode', '482913');
    await settle(fixture);
    button(el, 'Confirmar').click();
    const verify = httpMock.expectOne('/api/auth/mfa/verify');
    expect(verify.request.body).toEqual({ code: '482913' });
    verify.flush(null);
    await tick();
    httpMock.expectOne('/api/users/me').flush({ data: { ...ME, mfaEnabled: true } });
    await settle(fixture);
    expect(el.textContent).toContain('Verificación en dos pasos activada.');
    expect(el.querySelector('.pf__mfa-head .pill')?.textContent?.trim()).toBe('Activa');
  });

  it('desactivarla pide la contraseña y avisa si no es correcta', async () => {
    const { fixture, el } = await render({ ...ME, mfaEnabled: true });
    button(el, 'Seguridad').click();
    await settle(fixture);
    button(el, 'Desactivar').click();
    await settle(fixture);
    type(el, 'mfaPassword', 'mala');
    await settle(fixture);
    button(el.querySelector('.pf__mfa') as HTMLElement, 'Desactivar').click();
    const req = httpMock.expectOne('/api/auth/mfa/disable');
    expect(req.request.body).toEqual({ password: 'mala' });
    req.flush({ type: 'invalid-credentials' }, { status: 401, statusText: 'Unauthorized' });
    await settle(fixture);
    expect(el.textContent).toContain('La contraseña no es correcta.');
    expect(TestBed.inject(AuthService).isAuthenticated).toBeDefined();
  });

  it('las preferencias aplican al instante (tema, letra para dislexia, login)', async () => {
    const { fixture, el } = await render();
    button(el, 'Preferencias').click();
    await settle(fixture);
    button(el, 'Claro').click();
    await settle(fixture);
    expect(document.documentElement.dataset['theme']).toBe('light');
    (el.querySelector('[role="switch"]') as HTMLButtonElement).click();
    await settle(fixture);
    expect(document.documentElement.dataset['font']).toBe('dyslexic');
    button(el, 'Unix 89').click();
    await settle(fixture);
    expect(localStorage.getItem('preferredLoginTheme')).toBe('unix89');
    (el.querySelector('[role="switch"]') as HTMLButtonElement).click();
    button(el, 'Oscuro').click();
    await settle(fixture);
  });
});
