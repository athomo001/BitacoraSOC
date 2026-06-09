/**
 * BatEasterEggService — Servicio global del Easter Egg de murciélagos (#bat)
 *
 * Gestiona el estado del minijuego Y renderiza el HUD directamente en
 * document.body para evitar problemas de CSS heredados (overflow:auto del
 * content-wrapper, transform:translate3d del mat-sidenav, backdrop-filter del
 * toolbar, etc.) que impiden que position:fixed funcione correctamente dentro
 * de los componentes Angular.
 */
import { Injectable } from '@angular/core';

export interface BatHudState {
  /** true en cuanto se escribe el primer #bat en la sesión */
  active: boolean;
  /** murciélagos volando actualmente en pantalla */
  activeBats: number;
  /** intentos de clic fallidos */
  attempts: number;
  /** murciélagos cazados con éxito */
  caught: number;
}

@Injectable({ providedIn: 'root' })
export class BatEasterEggService {
  private _state: BatHudState = {
    active: false,
    activeBats: 0,
    attempts: 0,
    caught: 0
  };

  /** Referencia al nodo HUD inyectado en document.body */
  private _hudEl: HTMLElement | null = null;

  // ── Lectura del estado ────────────────────────────────────────────────────

  get snapshot(): BatHudState {
    return { ...this._state };
  }

  // ── Mutaciones del estado ─────────────────────────────────────────────────

  /**
   * Actualiza la cantidad de murciélagos activos.
   * Activa el HUD si es la primera vez que aparece un murciélago.
   */
  setActiveBats(count: number): void {
    this._state = {
      ...this._state,
      active: this._state.active || count > 0,
      activeBats: count
    };
    this._syncHud();
  }

  /** Registra un intento fallido de captura. */
  registerAttempt(): void {
    this._state = { ...this._state, attempts: this._state.attempts + 1 };
    this._syncHud();
  }

  /**
   * Registra una captura exitosa.
   * @param newActiveBats murciélagos que quedan volando tras la captura
   */
  registerCatch(newActiveBats: number): void {
    this._state = {
      ...this._state,
      active: true,
      caught: this._state.caught + 1,
      activeBats: newActiveBats
    };
    this._syncHud();
  }

  // ── HUD directo en document.body ──────────────────────────────────────────

  /**
   * Crea el nodo HUD en document.body la primera vez que se activa y lo
   * actualiza en cada cambio de estado. Al estar en body, position:fixed es
   * siempre relativo al viewport sin importar el contexto CSS del árbol Angular.
   */
  private _syncHud(): void {
    if (!this._state.active) {
      return; // No mostrar hasta que se active el easter egg
    }

    // Crear el elemento la primera vez
    if (!this._hudEl) {
      this._hudEl = document.createElement('div');
      // Estilos ultralimpios y de alta legibilidad
      Object.assign(this._hudEl.style, {
        position: 'fixed',
        top: '10px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '2147483647',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '6px 16px',
        background: '#1e1e1e', // Fondo oscuro sólido para evitar que el fondo Matrix dificulte la lectura
        border: '1px solid #333333', // Borde gris simple y visible
        borderRadius: '4px',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '14px', // Tamaño ligeramente mayor para máxima claridad
        fontWeight: '600',
        color: '#ffffff',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)', // Sombra simple para despegarlo del fondo
        pointerEvents: 'none'
      });

      // Keyframe de entrada (se inyecta una sola vez)
      if (!document.getElementById('bat-hud-style')) {
        const style = document.createElement('style');
        style.id = 'bat-hud-style';
        style.textContent = `
          @keyframes batHudSlide {
            from { transform: translate(-50%, -140%); opacity: 0; }
            to   { transform: translate(-50%, 0);     opacity: 1; }
          }
        `;
        document.head.appendChild(style);
      }

      document.body.appendChild(this._hudEl);
    }

    // Actualizar el contenido con color blanco explícito en cada span y !important para vencer cualquier regla global
    this._hudEl.innerHTML =
      `<span style="color: #ffffff !important; display: flex; align-items: center; gap: 4px;">🦇 ${this._state.activeBats}</span>` +
      `<span style="color: #888888 !important; margin: 0 4px;">|</span>` +
      `<span style="color: #ffffff !important; display: flex; align-items: center; gap: 4px;">🎯 ${this._state.attempts}</span>` +
      `<span style="color: #888888 !important; margin: 0 4px;">|</span>` +
      `<span style="color: #ffffff !important; display: flex; align-items: center; gap: 4px;">🏆 ${this._state.caught}</span>`;
  }
}
