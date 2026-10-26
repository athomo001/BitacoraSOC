// Complemento con servidor de ejemplo (spec/11 §12.5, 10i). Node 20+, sin
// dependencias:
//
//   APP_TOKEN=<token de aplicación> BITACORA_URL=http://bitacora:8080 node servidor.mjs
//
// Declara en /complement.json una pestaña en el ticket, una acción en la
// entrada, su configuración, un gancho a un evento y una tarea programada.
// Con su token pide a la app su configuración y sus credenciales
// (/api/internal/v1/settings y /credentials); con la llave de integraciones
// escribe en /api/v1. Verifica la firma de todo lo que la app le manda.
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const PORT = Number(process.env.PORT ?? 8090);
const APP = (process.env.BITACORA_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const TOKEN = process.env.APP_TOKEN ?? '';
const here = new URL('.', import.meta.url);

const MANIFEST = {
  version: '1.0.0',
  panels: [{ id: 'resumen', target: 'ticket', title: 'Ejemplo', path: 'panel.html' }],
  actions: [{ id: 'saludar', target: 'entry', title: 'Saludar desde el ejemplo', path: 'panel.html' }],
  settings: [
    { key: 'saludo', label: 'Saludo del seguimiento', type: 'text', default: 'Revisado por el servicio de ejemplo' },
    { key: 'llaveExterna', label: 'Llave de un sistema externo', type: 'secret', help: 'Solo para mostrar cómo llega un secreto al servicio.' },
  ],
  events: ['entry.created'],
  schedules: [{ name: 'latido', title: 'Anota en el registro que sigue vivo', every: '15m' }],
  data: ['entries:read', 'entries:write'],
};

/** Lo que el servicio pide a la app con su token de aplicación (Runtime API). */
async function runtime(path) {
  const res = await fetch(APP + '/api/internal/v1/' + path, { headers: { Authorization: 'Bearer ' + TOKEN } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

let creds = null; // { apiBaseUrl, integrationKey, hookSecret }; cambian al volver a aprobar
async function credentials(refresh = false) {
  if (!creds || refresh) creds = await runtime('credentials');
  return creds;
}

/** «sha256=» + HMAC-SHA256 de «<timestamp>.<cuerpo>» (forward.Sign en la app). */
async function verified(req, body) {
  const ts = req.headers['x-bitacora-timestamp'] ?? '';
  const sig = String(req.headers['x-bitacora-signature'] ?? '');
  if (!ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  for (const refresh of [false, true]) {
    const { hookSecret } = await credentials(refresh);
    if (!hookSecret) continue;
    const want = 'sha256=' + createHmac('sha256', hookSecret).update(ts + '.').update(body).digest('hex');
    if (want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return true;
  }
  return false;
}

/** Escribe en la app con su llave de integraciones. */
async function api(method, path, payload) {
  const { apiBaseUrl, integrationKey } = await credentials();
  if (!integrationKey) throw new Error('sin permisos de datos aprobados');
  const res = await fetch(apiBaseUrl + path, {
    method, headers: { 'X-API-Key': integrationKey, 'Content-Type': 'application/json' }, body: payload && JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
  return res.json();
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  try {
    if (req.method === 'GET' && url.pathname === '/complement.json') return send(200, MANIFEST);
    if (req.method === 'GET' && url.pathname === '/health') return send(200, { ok: true });
    if (req.method === 'GET' && ['/panel.html', '/bitacora-complemento.js'].includes(url.pathname)) {
      const file = await readFile(new URL('.' + url.pathname, here));
      return send(200, file.toString(), url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    }
    if (req.method === 'POST' && url.pathname === '/hooks/events') {
      const body = await readBody(req);
      if (!(await verified(req, body))) return send(401, { error: 'firma inválida' });
      const ev = JSON.parse(body.toString());
      // Una entrada de incidente nueva: deja un seguimiento con el saludo configurado.
      if (ev.event === 'entry.created' && ev.data?.entryType === 'incidente' && ev.object?.id) {
        const { settings } = await runtime('settings');
        await api('POST', `/entries/${ev.object.id}/comments`, { content: settings.saludo || 'Revisado por el servicio de ejemplo' });
      }
      return send(204, '');
    }
    if (req.method === 'POST' && url.pathname.startsWith('/hooks/schedule/')) {
      const body = await readBody(req);
      if (!(await verified(req, body))) return send(401, { error: 'firma inválida' });
      console.log('tarea programada', url.pathname.split('/').pop(), new Date().toISOString());
      return send(204, '');
    }
    if (req.method === 'POST' && url.pathname === '/hook/cleanup') return send(200, { ok: true });
    send(404, { error: 'no encontrado' });
  } catch (e) {
    console.error(e);
    send(500, { error: String(e.message ?? e) });
  }
}).listen(PORT, () => console.log(`servicio de ejemplo en :${PORT}`));
