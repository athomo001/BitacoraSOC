/**
 * File Purpose: frontend/src/app/services/theme.service.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Servicio de Temas (Theming)
 * 
 * Funcionalidad:
 *   - Gestionar tema visual de la aplicación (light, pastel, cyberpunk)
 *   - Persistir preferencia en localStorage
 *   - Observable para cambios reactivos en UI
 * 
 * Temas SOC:
 *   - light: Tema claro (default)
 *   - pastel: Colores suaves (alternativa visual)
 *   - cyberpunk: Alto contraste neon para uso opcional
 * 
 * Implementación:
 *   - setTheme(): cambia tema + guarda en localStorage + aplica CSS
 *   - applyTheme(): modifica atributo data-theme en <html>
 *   - currentTheme$: observable para componentes que reaccionan a cambios
 * 
 * Uso:
 *   - Usuario cambia tema en settings o header
 *   - Se persiste entre sesiones (localStorage)
 *   - CSS usa [data-theme='light'] para estilos condicionales
 */
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Theme } from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private readonly THEME_KEY = 'bitacora_theme';
  // Comentario: Listado simplificado de temas visuales de la interfaz. Se eliminaron sepia y dark para evitar mantenimiento redundante de CSS.
  private readonly SUPPORTED_THEMES: Theme[] = ['light', 'pastel', 'cyberpunk'];
  private currentThemeSubject = new BehaviorSubject<Theme>(this.getStoredTheme());
  public currentTheme$ = this.currentThemeSubject.asObservable();

  constructor() {
    this.applyTheme(this.getStoredTheme());
  }

  setTheme(theme: Theme): void {
    localStorage.setItem(this.THEME_KEY, theme);
    this.currentThemeSubject.next(theme);
    this.applyTheme(theme);
  }

  getCurrentTheme(): Theme {
    return this.currentThemeSubject.value;
  }

  private getStoredTheme(): Theme {
    const stored = localStorage.getItem(this.THEME_KEY);
    if (stored && this.SUPPORTED_THEMES.includes(stored as Theme)) {
      return stored as Theme;
    }
    return 'light';
  }

  private applyTheme(theme: Theme): void {
    document.documentElement.setAttribute('data-theme', theme);
  }
}
