import { Injectable, inject } from '@angular/core';
import { PreferencesService } from '../preferences/preferences.service';
import { MESSAGES, MessageKey } from './messages';

/**
 * Traducción ES/EN en caliente (diseño aprobado: el selector ES/EN cambia
 * TODA la pantalla, no solo el menú). `t()` lee la señal de idioma, así que
 * un template que la llame se vuelve a pintar solo al cambiar de idioma,
 * incluso con OnPush. Un texto nuevo se agrega en `messages.ts` (ES es la
 * fuente; EN está tipado contra ES y no compila si falta una clave).
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly prefs = inject(PreferencesService);

  t(key: MessageKey): string {
    return MESSAGES[this.prefs.language()][key];
  }

  /** Texto con un valor: "Quedan {v}" → "Quedan 2 h" / "{v} left" → "2 h left". */
  tf(key: MessageKey, value: string | number): string {
    return this.t(key).replace('{v}', String(value));
  }
}
