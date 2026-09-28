import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

export type Theme = 'dark' | 'light' | 'pink';
export type Language = 'es' | 'en';

const THEMES: readonly Theme[] = ['dark', 'light', 'pink'];
const KEYS = { theme: 'bitacora.theme', language: 'bitacora.language', dyslexia: 'bitacora.dyslexiaFont' } as const;

/**
 * Preferencias visuales por operador (tema, idioma, fuente para dislexia) —
 * diseño aprobado "BitacoraSOC UI Base": se controlan desde el pie de la
 * barra lateral y aplican a toda la app vía atributos en <html>
 * (`data-theme`, `data-font`, `lang`), que es lo que leen los tokens de
 * styles/tokens.css. Es una preferencia del puesto, no un dato de negocio:
 * vive en localStorage y, si el almacenamiento falla (modo privado, cuota),
 * la app sigue con los valores por defecto.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly root = inject(DOCUMENT).documentElement;

  readonly theme = signal<Theme>(readTheme());
  readonly language = signal<Language>(read(KEYS.language) === 'en' ? 'en' : 'es');
  readonly dyslexiaFont = signal(read(KEYS.dyslexia) === 'true');

  constructor() {
    effect(() => {
      const theme = this.theme();
      this.root.dataset['theme'] = theme;
      write(KEYS.theme, theme);
    });
    effect(() => {
      const language = this.language();
      this.root.lang = language;
      write(KEYS.language, language);
    });
    effect(() => {
      const on = this.dyslexiaFont();
      if (on) this.root.dataset['font'] = 'dyslexic';
      else delete this.root.dataset['font'];
      write(KEYS.dyslexia, String(on));
    });
  }

  /** Rota oscuro → claro → rosa → oscuro, igual que el botón del diseño. */
  cycleTheme(): void {
    this.theme.update((current) => THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);
  }

  toggleDyslexiaFont(): void {
    this.dyslexiaFont.update((on) => !on);
  }
}

function readTheme(): Theme {
  const stored = read(KEYS.theme);
  return THEMES.includes(stored as Theme) ? (stored as Theme) : 'dark';
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sin almacenamiento la preferencia dura solo esta sesión — no es un error de negocio.
  }
}
