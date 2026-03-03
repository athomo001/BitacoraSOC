/**
 * Environment de producción
 * 
 * apiUrl usa window.location.hostname para detectar automáticamente la IP del servidor.
 * En producción, el frontend y backend deben estar en el mismo host o configurar CORS.
 * No requiere configuración manual - se adapta automáticamente.
 */
export const environment = {
  production: true,
  apiUrl: `${window.location.protocol === 'https:' ? 'https' : 'http'}://${window.location.hostname}:${window.location.protocol === 'https:' ? '3443' : '3000'}/api`,
  backendBaseUrl: `${window.location.protocol === 'https:' ? 'https' : 'http'}://${window.location.hostname}:${window.location.protocol === 'https:' ? '3443' : '3000'}`,
  appVersion: '__APP_VERSION__'
};
