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
      // Mantiene el comportamiento nativo imprimiendo los demás errores en consola
      console.error(error);
    }
  }
}
