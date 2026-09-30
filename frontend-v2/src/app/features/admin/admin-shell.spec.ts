import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminShellComponent } from './admin-shell';

describe('AdminShellComponent', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve));

  beforeEach(() => {
    localStorage.removeItem('bitacora.admin.section');
    TestBed.configureTestingModule({ imports: [AdminShellComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
  });

  function render() {
    const fixture = TestBed.createComponent(AdminShellComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const items = () => [...el.querySelectorAll('.adm__item-label')].map((b) => b.textContent?.trim());
    return { fixture, el, items };
  }

  it('lista plana agrupada por tema, sin botón Compactar, y abre en Usuarios y grupos', () => {
    const { el, items } = render();
    expect([...el.querySelectorAll('.adm__group-label')].map((g) => g.textContent?.trim())).toEqual(['Personas', 'Operación', 'Catálogos', 'Sistema']);
    expect(items()).toContain('Checklist');
    expect(el.textContent).not.toContain('Compactar');
    expect(el.querySelector('[aria-current="page"]')?.textContent).toContain('Usuarios y grupos');
    expect(el.querySelector('app-admin-access')).toBeTruthy();
  });

  it('el buscador filtra sin tildes y Enter abre la primera coincidencia, que queda recordada', async () => {
    const { fixture, el, items } = render();
    const input = el.querySelector('.adm__search input') as HTMLInputElement;
    input.value = 'auditoria';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(items()).toEqual(['Auditoría']);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    await settle();
    expect(el.querySelector('app-admin-audit')).toBeTruthy();
    expect(input.value).toBe('');
    expect(localStorage.getItem('bitacora.admin.section')).toBe('audit');
  });

  /** Responde el estado de la instalación y el usuario admin que pide ModuleAccessService. */
  async function answerModules(fixture: { detectChanges(): void }, flags: { socEnabled: boolean; nocEnabled: boolean }) {
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/setup/status').flush({ data: { setupCompleted: true, ...flags } });
    http.expectOne('/api/users/me').flush({ data: { id: 'u1', username: 'admin', role: 'admin' } });
    http.expectOne('/api/users/me/capabilities').flush({ data: { moduleScope: 'both', capabilities: [] } });
    await settle();
    fixture.detectChanges();
  }

  it('con NOC apagado, Territorio no aparece (ni un aviso de "desactivado") y la sección recordada cae en Usuarios y grupos', async () => {
    localStorage.setItem('bitacora.admin.section', 'territory');
    const { fixture, el, items } = render();
    await answerModules(fixture, { socEnabled: true, nocEnabled: false });
    expect(items()).not.toContain('Territorio');
    expect(el.textContent).not.toMatch(/desactivad/i);
    expect(el.querySelector('app-admin-territory')).toBeNull();
    expect(el.querySelector('[aria-current="page"]')?.textContent).toContain('Usuarios y grupos');
  });

  it('con NOC encendido, Territorio aparece en Catálogos', async () => {
    const { fixture, items } = render();
    await answerModules(fixture, { socEnabled: false, nocEnabled: true });
    expect(items()).toContain('Territorio');
  });

  it('Ctrl+K enfoca el buscador', () => {
    const { el } = render();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    expect(document.activeElement).toBe(el.querySelector('.adm__search input'));
  });
});
