import { TestBed } from '@angular/core/testing';
import { PreferencesService } from './preferences.service';

describe('PreferencesService', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
    delete document.documentElement.dataset['font'];
  });

  function create(): PreferencesService {
    const service = TestBed.inject(PreferencesService);
    TestBed.tick();
    return service;
  }

  it('por defecto: tema oscuro, español, sin fuente para dislexia', () => {
    create();
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(document.documentElement.lang).toBe('es');
    expect(document.documentElement.dataset['font']).toBeUndefined();
  });

  it('recupera las preferencias guardadas del puesto', () => {
    localStorage.setItem('bitacora.theme', 'pink');
    localStorage.setItem('bitacora.language', 'en');
    localStorage.setItem('bitacora.dyslexiaFont', 'true');
    create();
    expect(document.documentElement.dataset['theme']).toBe('pink');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dataset['font']).toBe('dyslexic');
  });

  it('ignora un tema guardado que ya no existe', () => {
    localStorage.setItem('bitacora.theme', 'neon');
    expect(create().theme()).toBe('dark');
  });

  it('persiste los cambios', () => {
    const prefs = create();
    prefs.cycleTheme();
    prefs.toggleDyslexiaFont();
    TestBed.tick();
    expect(localStorage.getItem('bitacora.theme')).toBe('light');
    expect(localStorage.getItem('bitacora.dyslexiaFont')).toBe('true');
  });
});
