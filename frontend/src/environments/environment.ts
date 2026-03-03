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
  apiUrl: `${window.location.protocol === 'https:' ? 'https' : 'http'}://${window.location.hostname}:${window.location.protocol === 'https:' ? '3443' : '3000'}/api`,
  backendBaseUrl: `${window.location.protocol === 'https:' ? 'https' : 'http'}://${window.location.hostname}:${window.location.protocol === 'https:' ? '3443' : '3000'}`,
  appVersion: 'dev'
};
