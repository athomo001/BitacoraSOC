import { HttpErrorResponse } from '@angular/common/http';

/**
 * Extrae el `detail` de un error RFC 7807 (spec/04-contratos-api.md,
 * convención global) para mostrarlo tal cual — el backend ya lo redacta
 * legible para humanos, no hace falta re-traducir cada `type` acá.
 */
export function problemDetail(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error;
    if (body && typeof body === 'object' && typeof body.detail === 'string') {
      return body.detail;
    }
    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed?.detail === 'string') {
          return parsed.detail;
        }
      } catch {
        // cuerpo no-JSON: se cae al fallback
      }
    }
  }
  return fallback;
}
