import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
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

  it('Ctrl+K enfoca el buscador', () => {
    const { el } = render();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    expect(document.activeElement).toBe(el.querySelector('.adm__search input'));
  });
});
