import { Injectable, effect, inject, signal } from '@angular/core';
import { PreferencesService } from '../preferences/preferences.service';
import { CoreKey, MESSAGES_ES, MessageKey } from './messages';
import { packText } from './registry';

/**
 * Traducción ES/EN en caliente (diseño aprobado: el selector ES/EN cambia
 * TODA la pantalla, no solo el menú). `t()` lee señales, así que un template
 * que la llame se vuelve a pintar solo al cambiar de idioma, incluso con
 * OnPush. Un texto nuevo se agrega en `messages.ts` (ES, la fuente) y en
 * `messages-en.ts` (tipado contra ES: no compila si falta una clave).
 *
 * El inglés se descarga recién cuando alguien elige EN; mientras llega (unos
 * milisegundos) se ve en español.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly prefs = inject(PreferencesService);
  private readonly en = signal<Record<CoreKey, string> | null>(null);
  private loading: Promise<void> | null = null;

  constructor() {
    effect(() => {
      if (this.prefs.language() === 'en') void this.loadEnglish();
    });
  }

  t(key: MessageKey): string {
    const language = this.prefs.language();
    const core: Record<string, string | undefined> = (language === 'en' ? this.en() : null) ?? MESSAGES_ES;
    // Núcleo primero; si no, el pack de la pantalla (ya registrado al cargar su código).
    return core[key] ?? packText(language, key) ?? key;
  }

  /** Texto con un valor: "Quedan {v}" → "Quedan 2 h" / "{v} left" → "2 h left". */
  tf(key: MessageKey, value: string | number): string {
    return this.t(key).replace('{v}', String(value));
  }

  /** Carga el diccionario inglés una sola vez (también lo usan las pruebas). */
  loadEnglish(): Promise<void> {
    this.loading ??= import('./messages-en').then((m) => this.en.set(m.EN));
    return this.loading;
  }
}
