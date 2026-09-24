import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { SseService } from './sse.service';

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

describe('SseService', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve));
  let originalFetch: typeof fetch;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parsea id/event/data del formato SSE real (id:\\nevent:\\ndata:\\n\\n)', async () => {
    const events: { type: string; data: unknown; id?: string }[] = [];
    globalThis.fetch = (async () =>
      new Response(streamFrom(['id: 7\nevent: deployment_ready\ndata: {"version":"1.0","message":"hola"}\n\n']), {
        status: 200,
      })) as typeof fetch;

    const service = TestBed.inject(SseService);
    const stop = service.connect((eventType, data, id) => events.push({ type: eventType, data, id }));
    await tick();
    await tick();
    stop();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toEqual({ type: 'deployment_ready', data: { version: '1.0', message: 'hola' }, id: '7' });
  });

  it('reconecta pasando Last-Event-ID tras un corte', async () => {
    const seenHeaders: (string | undefined)[] = [];
    let call = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      seenHeaders.push(headers?.['Last-Event-ID']);
      call++;
      if (call === 1) {
        return new Response(streamFrom(['id: 3\nevent: message\ndata: "primero"\n\n']), { status: 200 });
      }
      return new Response(streamFrom([]), { status: 200 });
    }) as typeof fetch;

    const service = TestBed.inject(SseService);
    const stop = service.connect(() => {});
    await tick();
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 3100)); // pasa el backoff de reconexión
    stop();

    expect(seenHeaders[0]).toBeUndefined();
    expect(seenHeaders[1]).toBe('3');
  }, 8000);
});
