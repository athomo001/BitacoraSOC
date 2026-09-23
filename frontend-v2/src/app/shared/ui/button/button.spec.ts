import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ButtonComponent, ButtonVariant } from './button';

@Component({
  standalone: true,
  imports: [ButtonComponent],
  template: `<app-button [variant]="variant()" icon="save">Guardar</app-button>`,
})
class HostComponent {
  readonly variant = input<ButtonVariant>('secondary');
}

describe('ButtonComponent', () => {
  // Regresión: con un <ng-content> por rama del @switch, solo la variante
  // default recibía el texto proyectado — primary/critical/text mostraban
  // únicamente el ícono.
  for (const variant of ['primary', 'secondary', 'critical', 'text'] as const) {
    it(`la variante ${variant} muestra el texto proyectado`, () => {
      const fixture = TestBed.createComponent(HostComponent);
      fixture.componentRef.setInput('variant', variant);
      fixture.detectChanges();
      const button = (fixture.nativeElement as HTMLElement).querySelector('button');
      expect(button?.textContent).toContain('Guardar');
    });
  }
});
