import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { SetupWizardComponent } from './setup-wizard';

describe('SetupWizardComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SetupWizardComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  function render() {
    const fixture = TestBed.createComponent(SetupWizardComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function continueButton(el: HTMLElement): HTMLButtonElement {
    return el.querySelector('app-button button') as HTMLButtonElement;
  }

  function check(el: HTMLElement, name: 'soc' | 'noc'): void {
    const box = el.querySelector(`input[name="${name}"]`) as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
  }

  it('no deja continuar con ambos módulos en false (HU-0)', () => {
    const { el } = render();
    expect(continueButton(el).disabled).toBe(true);
    expect(el.textContent).toContain('Elegí al menos un módulo');
  });

  it('con NOC elegido son 3 pasos y tras crear el admin pasa a territorio', async () => {
    const { fixture, el } = render();
    check(el, 'noc');
    fixture.detectChanges();
    expect(el.textContent).toContain('Paso 1 de 3');
    continueButton(el).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Cuenta de administrador');

    const component = fixture.componentInstance as unknown as Record<string, { set(v: string): void }>;
    component['adminUsername'].set('admin');
    component['adminEmail'].set('a@x.cl');
    component['adminPassword'].set('una-clave-larga-1');
    component['adminPasswordConfirm'].set('una-clave-larga-1');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));

    const req = httpMock.expectOne('/api/setup/bootstrap');
    expect(req.request.body).toMatchObject({ socEnabled: false, nocEnabled: true });
    req.flush({ data: { user: { id: '1', username: 'admin' }, token: 'jwt' } });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.textContent).toContain('Territorio (módulo NOC)');
    // El formulario de etiquetas pide las actuales al entrar al paso.
    httpMock.expectOne('/api/config/territorial-labels').flush({
      data: { country: 'País', region: 'Región', zone: 'Zona', site: 'Sitio' },
    });
  });

  it('solo SOC: son 2 pasos y no hay paso de territorio', async () => {
    const { fixture, el } = render();
    check(el, 'soc');
    fixture.detectChanges();
    expect(el.textContent).toContain('Paso 1 de 2');
  });

  it('valida el largo mínimo de la contraseña antes de llamar al backend', () => {
    const { fixture, el } = render();
    check(el, 'soc');
    fixture.detectChanges();
    continueButton(el).click();
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as Record<string, { set(v: string): void }>;
    component['adminUsername'].set('admin');
    component['adminEmail'].set('a@x.cl');
    component['adminPassword'].set('corta');
    component['adminPasswordConfirm'].set('corta');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    httpMock.expectNone('/api/setup/bootstrap');
    expect(el.textContent).toContain('al menos 12 caracteres');
  });
});
