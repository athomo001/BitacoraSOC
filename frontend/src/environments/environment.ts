/**
 * File Purpose: frontend/src/environments/environment.ts
 * Responsibilities: Explain intent, contracts, and expected maintenance boundaries.
 * QA Notes: Preserve deterministic behavior and document validation assumptions.
 */

// Cambiar según tu IP del backend
/**
 * Environment de desarrollo
 * 
 * apiUrl usa window.location.hostname para detectar automáticamente la IP del servidor.
 * Funciona en: localhost, IPs locales (192.168.x.x), IPs públicas.
 * No requiere configuración manual - se adapta automáticamente.
 */
export const environment = {
  production: false,
  apiUrl: '/api',
  backendBaseUrl: '', // Usamos proxy de Webpack/Angular en dev (`proxy.conf.json`)
  appVersion: 'dev'
};
