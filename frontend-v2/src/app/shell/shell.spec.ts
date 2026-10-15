import { I18nService } from '../core/i18n/i18n.service';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { ShellComponent } from './shell';
import { SseEventCallback, SseService } from '../core/sse/sse.service';
import { PreferencesService } from '../core/preferences/preferences.service';
import { SystemFeaturesService } from '../core/system-features/system-features.service';

describe('ShellComponent', () => {
  let httpMock: HttpTestingController;
  let sseCallback: SseEventCallback | undefined;

  beforeEach(() => {
    localStorage.clear();
    sseCallback = undefined;
    TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: SseService,
          useValue: {
            connect: (cb: SseEventCallback) => {
              sseCallback = cb;
              return () => undefined;
            },
          },
        },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    delete document.documentElement.dataset['theme'];
    delete document.documentElement.dataset['font'];
  });

  async function render(features: { code: string; isEnabled: boolean }[], capabilities: string[] = [], scope: { moduleScope?: string; areas?: string[] } = {}) {
    const fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
    // El usuario lo piden la sesión y los permisos (capacidades de grupo).
    for (const req of httpMock.match('/api/users/me')) req.flush({ data: { id: '1', username: 'ana.rojas', fullName: 'Ana Rojas', email: 'ana@x.cl', role: 'user' } });
    httpMock.expectOne('/api/users/me/capabilities').flush({ data: { moduleScope: scope.moduleScope ?? 'both', capabilities, areas: scope.areas ?? ['soc'] } });
    httpMock.expectOne('/api/system-features').flush({ data: features });
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function navLabels(el: HTMLElement): string[] {
    return [...el.querySelectorAll('.shell__nav-label')].map((n) => n.textContent?.trim() ?? '');
  }

  it('muestra las secciones del núcleo, el Mapa con NOC, y oculta la ticketera si está apagada', async () => {
    const { el } = await render([{ code: 'native_tickets', isEnabled: false }]);
    expect(navLabels(el)).toEqual(['Bitácora', 'Turnos y Checklist', 'Escalamiento', 'Mapa', 'Directorio', 'Inventario', 'Agenda', 'Reportes', 'Administración']);
  });

  it('alguien de Infra (no Operativo) ve Turnos y Escalamiento, no Bitácora ni Reportes', async () => {
    const { el } = await render([], [], { moduleScope: 'none', areas: ['infraestructura'] });
    const labels = navLabels(el);
    expect(labels).toContain('Turnos y Checklist');
    expect(labels).toContain('Escalamiento');
    expect(labels).not.toContain('Bitácora');
    expect(labels).not.toContain('Reportes');
  });

  it('sin el módulo NOC no aparece el Mapa', async () => {
    const { fixture, el } = await render([]);
    sseCallback?.('config.modules.updated', { socEnabled: true, nocEnabled: false });
    fixture.detectChanges();
    expect(navLabels(el)).not.toContain('Mapa');
    expect(navLabels(el)).toContain('Escalamiento');
  });

  it('Inventario muestra cuántas solicitudes de baja esperan a quien decide', async () => {
    const { fixture, el } = await render([]);
    httpMock.match('/api/inventory/requests').forEach((r) => r.flush({ data: [{ id: 'q1' }, { id: 'q2' }] }));
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    const item = [...el.querySelectorAll('.shell__nav-item')].find((a) => a.textContent?.includes('Inventario'));
    expect(item?.querySelector('.pill')?.textContent?.trim()).toBe('2');
  });

  it('Mi equipo solo aparece para la jefatura de área', async () => {
    const { el } = await render([], ['area:lead']);
    expect(navLabels(el)).toContain('Mi equipo');
  });

  it('tras recargar la página vuelve a pedir el usuario y muestra su nombre al pie de la barra', async () => {
    const { el } = await render([]);
    expect(el.querySelector('.shell__profile-name')?.textContent?.trim()).toBe('Ana Rojas');
  });

  it('Complementos no aparece apagado, ni encendido sin complementos visibles', async () => {
    const { fixture, el } = await render([{ code: 'complements', isEnabled: true }]);
    httpMock.expectOne('/api/complements/active').flush({ data: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(navLabels(el)).not.toContain('Complementos');
  });

  it('Complementos aparece con la funcionalidad encendida y algún complemento visible', async () => {
    const { fixture, el } = await render([{ code: 'complements', isEnabled: true }]);
    httpMock.expectOne('/api/complements/active').flush({
      data: [{ slug: 'doom', name: 'DOOM', icon: 'sports_esports', status: 'active', sourceType: 'zip_static', circuit: 'CLOSED' }],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(navLabels(el)).toContain('Complementos');
  });

  it('con la ticketera activa la muestra como sección propia justo debajo de Bitácora', async () => {
    const { el } = await render([{ code: 'native_tickets', isEnabled: true }]);
    expect(navLabels(el).slice(0, 2)).toEqual(['Bitácora', 'Ticketera']);
  });

  it('activar la ticketera desde Administración la agrega al menú sin recargar', async () => {
    const { fixture, el } = await render([{ code: 'native_tickets', isEnabled: false }]);
    const features = TestBed.inject(SystemFeaturesService);
    const pending = features.setEnabled('native_tickets', true);
    httpMock.expectOne('/api/system-features/native_tickets').flush({ data: { code: 'native_tickets', isEnabled: true } });
    await pending;
    fixture.detectChanges();
    expect(navLabels(el)).toContain('Ticketera');
  });

  it('un cambio hecho por otro admin llega por SSE y actualiza el menú', async () => {
    const { fixture, el } = await render([{ code: 'native_tickets', isEnabled: true }]);
    sseCallback?.('system_feature.updated', { code: 'native_tickets', isEnabled: false });
    fixture.detectChanges();
    expect(navLabels(el)).not.toContain('Ticketera');
  });

  it('EN traduce el menú completo', async () => {
    const { fixture, el } = await render([{ code: 'native_tickets', isEnabled: true }]);
    const en = [...el.querySelectorAll<HTMLButtonElement>('.shell__seg')].find((b) => b.textContent?.trim() === 'EN');
    en?.click();
    // El inglés se descarga al elegir EN (no va en el bundle inicial).
    await TestBed.inject(I18nService).loadEnglish();
    fixture.detectChanges();
    expect(navLabels(el)).toEqual(['Logbook', 'Tickets', 'Shifts & Checklist', 'Escalation', 'Map', 'Directory', 'Inventory', 'Agenda', 'Reports', 'Administration']);
    expect(document.documentElement.lang).toBe('en');
  });

  it('el botón de tema rota oscuro → claro → rosa y lo aplica a <html>', async () => {
    const { fixture, el } = await render([]);
    const themeButton = el.querySelector<HTMLButtonElement>('.shell__theme');
    themeButton?.click();
    fixture.detectChanges();
    expect(document.documentElement.dataset['theme']).toBe('light');
    themeButton?.click();
    fixture.detectChanges();
    expect(document.documentElement.dataset['theme']).toBe('pink');
    expect(TestBed.inject(PreferencesService).theme()).toBe('pink');
  });

  it('el botón de accesibilidad activa la fuente para dislexia', async () => {
    const { fixture, el } = await render([]);
    const button = el.querySelector<HTMLButtonElement>('[aria-pressed].shell__icon-btn');
    button?.click();
    fixture.detectChanges();
    expect(document.documentElement.dataset['font']).toBe('dyslexic');
    expect(button?.getAttribute('aria-pressed')).toBe('true');
  });

  it('Alt+6 no navega a la ticketera si está apagada', async () => {
    const { fixture } = await render([{ code: 'native_tickets', isEnabled: false }]);
    const event = new KeyboardEvent('keydown', { key: '6', altKey: true, cancelable: true });
    window.dispatchEvent(event);
    fixture.detectChanges();
    expect(event.defaultPrevented).toBe(false);
  });
});
