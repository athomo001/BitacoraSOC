import { ErrorHandler, Injectable } from '@angular/core';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  handleError(error: any): void {
    // Convierte el error a string para realizar la comprobación de manera segura
    const errorStr = error ? String(error.message || error) : '';

    // Detecta errores típicos de carga de módulos (chunks) eliminados tras un nuevo despliegue
    const chunkFailedMessage = /chunk|Loading chunk|dynamically imported module/i;

    if (chunkFailedMessage.test(errorStr)) {
      console.warn('Se detectó un fallo al cargar un módulo (chunk). Recargando aplicación para forzar actualización...', error);
      // Recarga la ventana omitiendo el caché para descargar el nuevo index.html y assets
      window.location.reload();
    } else {
      // Formatear el error no controlado con metadatos útiles para depuración en el SOC
      const detailedError = {
        message: error?.message || (typeof error === 'string' ? error : 'Error no controlado sin mensaje'),
        stack: error?.stack || 'No disponible',
        name: error?.name || 'Error genérico',
        url: window.location.href,
        timestamp: new Date().toISOString()
      };

      // Se envía el error estructurado a la consola (donde será procesado o formateado según el entorno)
      console.error(detailedError);
    }
  }
}
