import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/**
 * Descarga un archivo de la API autenticada. Un `<a href="/api/...">` no
 * sirve acá: el navegador no manda el header `Authorization` (el JWT no va
 * en cookie), así que el enlace respondía 401 — pasó con "Exportar CSV" de
 * auditoría y "Descargar" de respaldos. Se pide por HttpClient (el
 * interceptor pone el token) y se entrega al usuario como archivo.
 */
export async function downloadFile(http: HttpClient, url: string, fallbackName: string, params?: HttpParams): Promise<void> {
  const response = await firstValueFrom(http.get(url, { params, observe: 'response', responseType: 'blob' }));
  const name = fileNameFrom(response.headers.get('Content-Disposition')) ?? fallbackName;
  const href = URL.createObjectURL(response.body ?? new Blob());
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.click();
  // Se libera después del clic: revocar en el mismo tick puede cortar la descarga en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

/** Nombre de archivo de `Content-Disposition` (acepta `filename*=` RFC 5987 y `filename="…"`). */
export function fileNameFrom(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // cae al filename simple
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}
