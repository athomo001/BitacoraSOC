import { Injectable, inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';

export type SseEventCallback = (eventType: string, data: unknown, id?: string) => void;

/**
 * Consumo de `GET /api/stream/events` (hub SSE genérico de la Fase 2,
 * primer consumidor real en el frontend, Fase 9 HU-7d). El `EventSource`
 * nativo del navegador no sirve acá: no soporta headers custom, y la ruta
 * exige `Authorization: Bearer` (`internal/middleware/auth.go`, sin
 * *fallback* por query param — no se toca esa superficie de seguridad). Se
 * usa `fetch()` (sí soporta headers) leyendo el body como stream y
 * parseando a mano el formato `id:`/`event:`/`data:\n\n` que ya emite
 * `writeEvent` en `sse_handler.go`, con reconexión automática pasando
 * `Last-Event-ID` tras un corte — mismo contrato de resiliencia que el
 * backend ya prueba (spec/09-alta-disponibilidad-2-nodos.md sección 3.2).
 *
 * Genérico a propósito (no acoplado a `deployment_ready`): cualquier
 * feature futura que necesite eventos en vivo reusa `connect()`.
 */
@Injectable({ providedIn: 'root' })
export class SseService {
  private readonly auth = inject(AuthService);

  /** Devuelve una función para cortar la conexión (llamarla en ngOnDestroy). */
  connect(onEvent: SseEventCallback, onError?: (error: unknown) => void): () => void {
    let stopped = false;
    let controller: AbortController | null = null;
    let lastEventId: string | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const run = async (): Promise<void> => {
      while (!stopped) {
        controller = new AbortController();
        try {
          const headers: Record<string, string> = {};
          const token = this.auth.token();
          if (token) headers['Authorization'] = `Bearer ${token}`;
          if (lastEventId) headers['Last-Event-ID'] = lastEventId;

          const response = await fetch('/api/stream/events', { headers, signal: controller.signal });
          if (!response.ok || !response.body) {
            throw new Error(`stream respondió ${response.status}`);
          }
          lastEventId = await readEventStream(response.body, (eventType, id, data) => {
            lastEventId = id ?? lastEventId;
            onEvent(eventType, data, id);
          });
        } catch (error) {
          if (stopped) return;
          onError?.(error);
        }
        if (stopped) return;
        // Reconexión con backoff simple — el servidor repone lo perdido vía Last-Event-ID.
        await new Promise((resolve) => {
          retryTimer = setTimeout(resolve, 3000);
        });
      }
    };

    void run();

    return () => {
      stopped = true;
      controller?.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }
}

/** Lee el stream por bloques `\n\n`, parsea id:/event:/data: y llama onEvent. Devuelve el último id visto. */
async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (eventType: string, id: string | undefined, data: unknown) => void,
): Promise<string | undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastId: string | undefined;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseEventBlock(block);
      if (parsed) {
        lastId = parsed.id ?? lastId;
        onEvent(parsed.eventType, parsed.id, parsed.data);
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
  return lastId;
}

function parseEventBlock(block: string): { eventType: string; id?: string; data: unknown } | null {
  let eventType = 'message';
  let id: string | undefined;
  let rawData = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('event:')) eventType = line.slice(6).trim();
    else if (line.startsWith('data:')) rawData += line.slice(5).trim();
  }
  if (!rawData) return null;
  let data: unknown = rawData;
  try {
    data = JSON.parse(rawData);
  } catch {
    // payload no-JSON: se entrega tal cual
  }
  return { eventType, id, data };
}
