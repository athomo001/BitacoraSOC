import { environment } from '@env/environment';

/**
 * Función encargada de asegurar la consola del navegador.
 * En entornos de producción, anula los métodos de registro no esenciales
 * para evitar la fuga de información a través del inspector del navegador (F12),
 * y decora el método de error para proveer registros estructurados y seguros.
 */
export function securizeConsole(): void {
  if (environment.production) {
    // Listado de métodos de consola que se desean silenciar en producción
    const silentMethods: Array<keyof Console> = [
      'log',
      'info',
      'debug',
      'dir',
      'dirxml',
      'group',
      'groupCollapsed',
      'groupEnd',
      'table',
      'trace',
      'count',
      'time',
      'timeEnd'
    ];

    // Reemplaza cada método no esencial con una función vacía
    silentMethods.forEach(method => {
      if (typeof console[method] === 'function') {
        (console[method] as any) = () => {};
      }
    });

    // Guardar referencia original de console.error para invocarla con los datos procesados
    const originalError = console.error;

    // Decorar console.error para estructurar la salida de errores y omitir datos sensibles
    console.error = (...args: any[]) => {
      const timestamp = new Date().toISOString();
      const currentUrl = window.location.href;
      
      const processedArgs = args.map(arg => {
        // Si el argumento es una instancia de Error, extraemos los detalles más relevantes
        if (arg instanceof Error) {
          return {
            name: arg.name,
            message: arg.message,
            stack: arg.stack,
            url: currentUrl,
            timestamp
          };
        }
        
        // Detección y sanitización preventiva de objetos que contengan credenciales o tokens
        if (arg && typeof arg === 'object') {
          try {
            const strRepresentation = JSON.stringify(arg);
            if (/password|passwd|token|jwt|auth|secret|credential/i.test(strRepresentation)) {
              return '[SOC-SECURITY-WARN] Objeto con posible información sensible omitido por seguridad.';
            }
          } catch {
            // Se ignora el fallo de serialización (por ejemplo, por referencias circulares)
          }
        }
        
        return arg;
      });

      // Invoca el console.error original con metadatos útiles estructurados
      originalError.apply(console, [`[SOC-CRITICAL-ERROR][${timestamp}][URL: ${currentUrl}]`, ...processedArgs]);
    };
  }
}
