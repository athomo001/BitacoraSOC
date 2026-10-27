import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminLdapComponent } from './admin-ldap';
import { LdapConfig } from '../../core/ldap/ldap.service';

const settle = () => new Promise((resolve) => setTimeout(resolve));
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
const type = (el: HTMLElement, name: string, value: string) => {
  const input = el.querySelector(`[name="${name}"]`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
};

const EMPTY: LdapConfig = {
  url: '', startTls: false, verifyTls: true, caPem: '', bindDn: '', hasBindPassword: false, baseDn: '',
  userFilter: '(sAMAccountName={usuario})', usernameAttr: 'sAMAccountName', nameAttr: 'displayName', emailAttr: 'mail',
  groupDn: '', timeoutSeconds: 8, localAdmins: 1,
};

describe('Administración → LDAP (10k)', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminLdapComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render(config = EMPTY) {
    const fixture = TestBed.createComponent(AdminLdapComponent);
    fixture.detectChanges();
    http.expectOne('/api/ldap/config').flush({ data: config });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('pide la contraseña de servicio y la manda una sola vez; después no vuelve', async () => {
    const { fixture, el } = await render();
    type(el, 'ldapUrl', 'ldaps://dc01.empresa.local:636');
    fixture.detectChanges();
    expect(el.textContent).toContain('Falta la contraseña de la cuenta de servicio.');
    expect(button(el, 'Guardar conexión').disabled).toBe(true);
    // Con ldaps:// no se ofrece StartTLS.
    expect(el.querySelector('[name="ldapStartTls"]')).toBeNull();
    type(el, 'ldapBindDn', 'CN=svc,DC=empresa,DC=local');
    type(el, 'ldapBindPassword', 'clave-servicio');
    type(el, 'ldapBaseDn', 'DC=empresa,DC=local');
    fixture.detectChanges();
    button(el, 'Guardar conexión').click();
    const req = http.expectOne('/api/ldap/config');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      url: 'ldaps://dc01.empresa.local:636', startTls: false, verifyTls: true, caPem: '', bindDn: 'CN=svc,DC=empresa,DC=local',
      bindPassword: 'clave-servicio', baseDn: 'DC=empresa,DC=local', userFilter: '(sAMAccountName={usuario})',
      usernameAttr: 'sAMAccountName', nameAttr: 'displayName', emailAttr: 'mail', groupDn: '', timeoutSeconds: 8,
    });
    req.flush({ data: { ...EMPTY, url: 'ldaps://dc01.empresa.local:636', bindDn: 'CN=svc,DC=empresa,DC=local', baseDn: 'DC=empresa,DC=local', hasBindPassword: true } });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Conexión guardada.');
    expect(el.textContent).toContain('Guardada');
    expect(el.querySelector('[name="ldapBindPassword"]')).toBeNull();

    // Cambiar otra cosa no reenvía la contraseña: null conserva la guardada.
    type(el, 'ldapGroupDn', 'CN=Bitacora,OU=Grupos,DC=empresa,DC=local');
    fixture.detectChanges();
    button(el, 'Guardar conexión').click();
    const again = http.expectOne('/api/ldap/config');
    expect(again.request.body.bindPassword).toBeNull();
    expect(again.request.body.groupDn).toBe('CN=Bitacora,OU=Grupos,DC=empresa,DC=local');
  });

  it('«Probar» con un usuario muestra a quién encontró; sin admin local avisa', async () => {
    const { fixture, el } = await render({ ...EMPTY, url: 'ldaps://dc01', bindDn: 'CN=svc', baseDn: 'DC=empresa', hasBindPassword: true, localAdmins: 0 });
    expect(el.textContent).toContain('Ningún administrador activo es «Solo local»');
    type(el, 'ldapTestUser', 'aperez');
    fixture.detectChanges();
    button(el, 'Probar').click();
    const req = http.expectOne('/api/ldap/test');
    expect(req.request.body).toEqual({ username: 'aperez' });
    req.flush({ data: { at: '2026-10-26T21:00:00Z', ok: true, username: 'aperez',
      entry: { dn: 'CN=Ana Pérez,OU=SOC,DC=empresa,DC=local', username: 'aperez', name: 'Ana Pérez', email: 'ana@empresa.cl' } } });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Encontrado: Ana Pérez (ana@empresa.cl).');
    expect(el.textContent).toContain('CN=Ana Pérez,OU=SOC,DC=empresa,DC=local');
  });

  it('sin verificar el certificado lo advierte; con ldap:// ofrece StartTLS', async () => {
    const { fixture, el } = await render({ ...EMPTY, url: 'ldap://dc01.empresa.local' });
    expect(el.querySelector('[name="ldapStartTls"]')).not.toBeNull();
    (el.querySelector('[name="ldapVerifyTls"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('cualquiera en la red podría hacerse pasar por el directorio');
  });
});
