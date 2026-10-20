import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { RaciPanelComponent } from './raci-panel';
import { RaciActivity } from '../../core/raci/raci.service';

/** Escalamiento → RACI (paridad con «Matriz RACI» del legacy, 2026-10-20). */
const person = (id: string, name: string, email: string) => ({
  id, name, kind: 'raci', members: [{ name, channels: [{ channelType: 'email', value: email, preferred: true, href: `mailto:${email}` }] }],
});
const none = { responsible: [], accountable: [], consulted: [], informed: [] };
const ACTIVITIES: RaciActivity[] = [
  { id: 'a1', clientId: 'c1', clientName: 'Casinos', topic: 'Monitoreo CDC', activity: 'Escalamiento de alertas',
    notes: 'Después de las 17 h el aviso va por el grupo de WhatsApp',
    letters: { ...none, responsible: [person('t1', 'Lista CDC', 'cdc@cliente.test')], accountable: [person('t2', 'Ana Pérez', 'ana@cliente.test')] } as RaciActivity['letters'] },
  { id: 'a2', clientId: 'c1', clientName: 'Casinos', topic: 'Monitoreo CDC', activity: 'Resolución de alertas', notes: '',
    letters: { ...none, responsible: [person('t2', 'Ana Pérez', 'ana@cliente.test')], accountable: [person('t1', 'Lista CDC', 'cdc@cliente.test')] } as RaciActivity['letters'] },
  { id: 'a3', clientId: 'c2', clientName: 'Netics', topic: 'Red Team', activity: 'Envío de los informes', notes: '',
    letters: { ...none, responsible: [person('t3', 'Pedro Soto', 'pedro@netics.test')], accountable: [person('t3', 'Pedro Soto', 'pedro@netics.test')] } as RaciActivity['letters'] },
];
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('Escalamiento → RACI', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [RaciPanelComponent], providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  async function render(preset: string | null) {
    const fixture = TestBed.createComponent(RaciPanelComponent);
    fixture.componentRef.setInput('presetClientId', preset);
    fixture.detectChanges();
    http.expectOne('/api/raci').flush({ data: ACTIVITIES });
    await settle();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('parte con el cliente del servicio y muestra tópico, letras y notas', async () => {
    const { el } = await render('c1');
    expect((el.querySelector('select[name="raciClient"]') as HTMLSelectElement).value).toBe('c1');
    expect(el.querySelectorAll('.rt__group').length).toBe(1);
    expect(el.textContent).toContain('Monitoreo CDC');
    expect(el.textContent).toContain('Escalamiento de alertas');
    expect(el.textContent).toContain('Después de las 17 h');
    expect(el.textContent).toContain('ana@cliente.test');
    expect(el.textContent).not.toContain('Pedro Soto');
  });

  it('sin cliente elegido abre el primero, y se puede cambiar', async () => {
    const { fixture, el } = await render(null);
    const select = el.querySelector('select[name="raciClient"]') as HTMLSelectElement;
    expect(select.value).toBe('c1');
    select.value = 'c2';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    expect(el.textContent).toContain('Pedro Soto');
    expect(el.textContent).not.toContain('Ana Pérez');
  });

  it('copia el correo con un clic', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { fixture, el } = await render('c1');
    (el.querySelector('button[aria-label="Copiar ana@cliente.test"]') as HTMLButtonElement).click();
    await settle();
    fixture.detectChanges();
    expect(writeText).toHaveBeenCalledWith('ana@cliente.test');
    expect(el.textContent).toContain('Copiado');
  });

  it('sin matrices lo dice', async () => {
    const fixture = TestBed.createComponent(RaciPanelComponent);
    fixture.detectChanges();
    http.expectOne('/api/raci').flush({ data: [] });
    await settle();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Ningún cliente tiene una matriz RACI todavía');
  });
});
