import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminSmtpComponent } from './admin-smtp';
import { presetFor } from './smtp-presets';
import { SmtpConfig } from '../../core/escalation/escalation.service';

const SAVED: SmtpConfig = {
  host: 'smtp.office365.com', port: 587, username: 'noc@empresa.cl', fromAddress: 'noc@empresa.cl', fromName: 'Bitácora Ops',
  requireTls: true, hasPassword: true, lastTest: null,
};

/** Deja correr las promesas pendientes (la app no usa zone.js). */
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('presetFor', () => {
  it('reconoce el proveedor por el servidor guardado', () => {
    expect(presetFor('smtp.office365.com').id).toBe('office365');
    expect(presetFor('email-smtp.sa-east-1.amazonaws.com').id).toBe('aws-ses');
    expect(presetFor('smtp.gmail.com', 'ana@gmail.com').id).toBe('google-mail');
    expect(presetFor('smtp.gmail.com', 'ana@empresa.cl').id).toBe('google-workspace');
    expect(presetFor('relay.interno.local').id).toBe('custom');
  });
});

describe('AdminSmtpComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminSmtpComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function render(saved: SmtpConfig | null) {
    const fixture = TestBed.createComponent(AdminSmtpComponent);
    fixture.detectChanges();
    const req = http.expectOne('/api/config/smtp');
    if (saved) req.flush({ data: saved });
    else req.flush({ detail: 'no configurado' }, { status: 404, statusText: 'Not Found' });
    await settle();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = (name: string) => el.querySelector(`input[name="${name}"]`) as HTMLInputElement;
    const type = async (name: string, value: string) => {
      input(name).value = value;
      input(name).dispatchEvent(new Event('input'));
      await settle();
      fixture.detectChanges();
    };
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
    return { fixture, el, input, type, button };
  }

  it('sin configurar: elegir Office 365 rellena servidor y puerto, y no deja guardar sin remitente válido', async () => {
    const { fixture, el, input, type, button } = await render(null);
    expect(el.textContent).toContain('Sin configurar');
    button('Office 365').click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    expect(input('host').value).toBe('smtp.office365.com');
    expect(input('port').value).toBe('587');
    expect(button('Guardar').disabled).toBe(true);
    expect(el.textContent).toContain('El correo del remitente no es válido.');

    await type('fromAddress', 'noc@empresa.cl');
    expect(el.textContent).toContain('Bitácora Ops <noc@empresa.cl>');
    button('Guardar').click();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/config/smtp');
    expect(put.request.body).toMatchObject({ host: 'smtp.office365.com', port: 587, fromAddress: 'noc@empresa.cl', fromName: 'Bitácora Ops', requireTls: true });
    expect(put.request.body.password).toBeUndefined();
    put.flush({ data: SAVED });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Guardado ✓');
    expect(el.textContent).toContain('Configurado · sin probar');
  });

  it('con cambios sin guardar no deja probar; guardado, la prueba fallida muestra el error del servidor', async () => {
    const { fixture, el, type, button } = await render(SAVED);
    expect(el.querySelector('.seg[aria-pressed="true"]')?.textContent).toContain('Office 365');
    expect(el.textContent).toContain('Sin cambios');

    await type('fromName', 'NOC Sala');
    expect(el.textContent).toContain('Cambios sin guardar');
    expect(button('Enviar prueba').disabled).toBe(true);
    expect(el.textContent).toContain('Guarda los cambios antes de probar');

    button('Descartar').click();
    await settle();
    fixture.detectChanges();
    await type('testTo', 'ana@empresa.cl');
    expect(button('Enviar prueba').disabled).toBe(false);
    button('Enviar prueba').click();
    const test = http.expectOne('/api/config/smtp/test-send');
    expect(test.request.body).toEqual({ to: 'ana@empresa.cl' });
    test.flush({ data: { sent: false, error: '535 5.7.3 Authentication unsuccessful' } }, { status: 502, statusText: 'Bad Gateway' });
    await settle();
    http.expectOne('/api/config/smtp').flush({
      data: { ...SAVED, lastTest: { at: new Date().toISOString(), ok: false, error: '535 5.7.3 Authentication unsuccessful' } },
    });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Falló la última prueba');
    expect(el.querySelector('.sm__error-box')?.textContent).toContain('535 5.7.3 Authentication unsuccessful');
  });
});
