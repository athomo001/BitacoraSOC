import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MarkdownComponent } from './markdown';

@Component({
  standalone: true,
  imports: [MarkdownComponent],
  template: `<app-markdown [content]="content" />`,
})
class HostComponent {
  content = '';
}

function render(content: string): ComponentFixture<HostComponent> {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.content = content;
  fixture.detectChanges();
  return fixture;
}

describe('MarkdownComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('renderiza una lista de checklist "- [ ]"/"- [x]" como checkboxes reales', () => {
    const fixture = render('- [ ] pendiente\n- [x] hecho');
    const checkboxes = fixture.nativeElement.querySelectorAll('input[type="checkbox"]');

    expect(checkboxes.length).toBe(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);
  });

  it('sanitiza un <script> inyectado: no queda ningún <script> en el DOM renderizado', () => {
    const fixture = render('Hola <script>window.__pwned = true;</script> mundo');
    const scripts = fixture.nativeElement.querySelectorAll('script');

    expect(scripts.length).toBe(0);
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(fixture.nativeElement.textContent).toContain('Hola');
    expect(fixture.nativeElement.textContent).toContain('mundo');
  });

  it('sanitiza un manejador de evento inline inyectado (onerror)', () => {
    const fixture = render('<img src="x" onerror="window.__pwned2=true">');
    const img = fixture.nativeElement.querySelector('img');

    expect(img?.getAttribute('onerror')).toBeNull();
  });

  it('renderiza Markdown básico (negrita, encabezado) como HTML real', () => {
    const fixture = render('# Título\n\nTexto **en negrita**.');

    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain('Título');
    expect(fixture.nativeElement.querySelector('strong')?.textContent).toBe('en negrita');
  });
});
