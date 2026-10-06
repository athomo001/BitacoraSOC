import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminBirthdaysComponent } from './admin-birthdays';

describe('AdminBirthdaysComponent (correos de cumpleaños, #21)', () => {
  let http: HttpTestingController;
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminBirthdaysComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render() {
    const fixture = TestBed.createComponent(AdminBirthdaysComponent);
    fixture.detectChanges();
    http.expectOne('/api/config/birthday-emails').flush({ data: { enabled: false, time: '09:00', cc: '' } });
    await settle();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('encender, cambiar la hora y el CC guarda todo junto', async () => {
    const { fixture, el } = await render();
    const save = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Guardar')) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    (el.querySelector('input[role="switch"]') as HTMLInputElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const time = el.querySelector('input[name="bdTime"]') as HTMLInputElement;
    time.value = '08:30';
    time.dispatchEvent(new Event('input'));
    const cc = el.querySelector('input[name="bdCc"]') as HTMLInputElement;
    cc.value = ' soc@empresa.cl ';
    cc.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(save.disabled).toBe(false);
    save.click();
    const req = http.expectOne({ method: 'PUT', url: '/api/config/birthday-emails' });
    expect(req.request.body).toEqual({ enabled: true, time: '08:30', cc: 'soc@empresa.cl' });
    req.flush({ data: { enabled: true, time: '08:30', cc: 'soc@empresa.cl' } });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Guardado');
  });

  it('la prueba se envía al propio admin', async () => {
    const { fixture, el } = await render();
    ([...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Enviarme una prueba')) as HTMLButtonElement).click();
    http.expectOne({ method: 'POST', url: '/api/config/birthday-emails/test' }).flush({ data: { to: 'yo@empresa.cl' } });
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Prueba enviada a yo@empresa.cl.');
  });
});
