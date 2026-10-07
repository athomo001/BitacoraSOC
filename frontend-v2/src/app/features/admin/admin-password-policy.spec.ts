import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdminPasswordPolicyComponent } from './admin-password-policy';

describe('AdminPasswordPolicyComponent (mínimo configurable, 6 por defecto)', () => {
  let httpMock: HttpTestingController;
  const tick = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [AdminPasswordPolicyComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('muestra el mínimo vigente y guarda el nuevo', async () => {
    const fixture = TestBed.createComponent(AdminPasswordPolicyComponent);
    fixture.detectChanges();
    httpMock.expectOne('/api/auth/password-policy').flush({ data: { minLength: 6 } });
    await tick();
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector('input[name="pwMin"]') as HTMLInputElement;
    expect(input.value).toBe('6');
    const save = el.querySelector('.adm-btn--primary') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    input.value = '3';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(save.disabled).toBe(true);

    input.value = '10';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(save.disabled).toBe(false);
    save.click();
    const req = httpMock.expectOne('/api/config/password-policy');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ minLength: 10 });
    req.flush({ data: { minLength: 10 } });
    await tick();
    fixture.detectChanges();
    expect(el.textContent).toContain('Guardado ✓');
  });
});
