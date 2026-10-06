import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { BrandingService } from './branding.service';

describe('BrandingService (Administración → Marca)', () => {
  let service: BrandingService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(BrandingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    document.getElementById('brand-font')?.remove();
    document.documentElement.style.removeProperty('--app-title-font');
  });

  it('aplica nombre, favicon del logo y fuente propia', async () => {
    const loading = service.load();
    httpMock.expectOne('/api/branding').flush({
      data: { appTitle: 'Bitácora CDC', hasLogo: true, hasFavicon: false, titleFont: 'custom', fontName: 'Monarchia', incidentPalette: 'cdc-verde', bulletinColor: '#EF5350', version: 7 },
    });
    await loading;
    expect(document.title).toBe('Bitácora CDC');
    expect(service.logoUrl()).toBe('/api/branding/logo?v=7');
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.getAttribute('href')).toBe('/api/branding/favicon?v=7');
    expect(document.getElementById('brand-font')?.textContent).toContain('/api/branding/font?v=7');
    expect(document.documentElement.style.getPropertyValue('--app-title-font')).toContain('BrandTitle');
  });

  it('el favicon externo del legacy manda y sin fuente propia vuelve la de la app', () => {
    service.apply({ appTitle: 'X', hasLogo: true, hasFavicon: false, faviconUrl: 'https://ejemplo.cl/icono.png', titleFont: 'inter', incidentPalette: 'carbon', bulletinColor: '#EF5350', version: 2 });
    expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.getAttribute('href')).toBe('https://ejemplo.cl/icono.png');
    expect(document.getElementById('brand-font')).toBeNull();
  });

  it('si la marca no responde, queda la de fábrica', async () => {
    const loading = service.load();
    httpMock.expectOne('/api/branding').flush(null, { status: 500, statusText: 'Error' });
    await loading;
    expect(service.appTitle()).toBe('Bitácora Ops');
  });
});
