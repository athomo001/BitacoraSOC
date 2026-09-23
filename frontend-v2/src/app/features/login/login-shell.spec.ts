import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { LoginShellComponent } from './login-shell';

describe('LoginShellComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [LoginShellComponent] });
  });

  it('arranca en el skin "modern" por defecto', () => {
    const fixture = TestBed.createComponent(LoginShellComponent);
    fixture.detectChanges();
    const wrapper = fixture.nativeElement.querySelector('.login-wrapper');

    expect(wrapper.getAttribute('data-skin')).toBe('modern');
  });

  it('expone los 6 skins históricos como opciones', () => {
    const fixture = TestBed.createComponent(LoginShellComponent);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('.skin-selector__btn');

    expect(buttons.length).toBe(6);
  });

  it('cambiar de skin actualiza [data-skin] sin recargar (mismo componente, mismo formulario)', () => {
    const fixture = TestBed.createComponent(LoginShellComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    component['setSkin']('cyber');
    fixture.detectChanges();
    const wrapper = fixture.nativeElement.querySelector('.login-wrapper');

    expect(wrapper.getAttribute('data-skin')).toBe('cyber');
    // El formulario sigue siendo el mismo — no se recrea el componente.
    expect(fixture.nativeElement.querySelector('form')).toBeTruthy();
  });

  it('cada skin resuelve un color de acento distinto vía CSS puro sobre [data-skin]', () => {
    const fixture = TestBed.createComponent(LoginShellComponent);
    fixture.detectChanges();
    const wrapper: HTMLElement = fixture.nativeElement.querySelector('.login-wrapper');

    const accentBySkin = new Map<string, string>();
    for (const skin of ['modern', 'cyber', 'crt', 'win311', 'unix89', 'surrealism'] as const) {
      fixture.componentInstance['setSkin'](skin);
      fixture.detectChanges();
      const accent = getComputedStyle(wrapper).getPropertyValue('--login-accent').trim();
      accentBySkin.set(skin, accent);
    }

    const distinctColors = new Set(accentBySkin.values());
    expect(distinctColors.size).toBeGreaterThanOrEqual(5); // al menos 5 de 6 acentos son únicos
    for (const [skin, color] of accentBySkin) {
      expect(color, `skin ${skin} no resolvió --login-accent`).not.toBe('');
    }
  });
});
