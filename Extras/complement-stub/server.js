/**
 * File Purpose: Extras/complement-stub/server.js
 * Responsibilities: Explain intent, contracts, and expected maintenance boundaries.
 * QA Notes: Preserve deterministic behavior and document validation assumptions.
 */

const express = require('express');

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 8080;
const slug = process.env.COMPLEMENT_SLUG || 'test-complement';
const bitacoraApiUrl = String(process.env.BITACORA_API_URL || '').trim();
const complementToken = String(process.env.COMPLEMENT_TOKEN || '').trim();

const localState = {
  cleanupCount: 0,
  lastCleanupAt: null,
  events: []
};

const maybeDelay = async () => {
  if (String(process.env.SIMULATE_SLOW || 'false').toLowerCase() === 'true') {
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
};

const pushEvent = (type, payload) => {
  localState.events.unshift({
    type,
    timestamp: new Date().toISOString(),
    payload
  });
  localState.events = localState.events.slice(0, 20);
};

const requestBitacora = async (path, options = {}) => {
  if (!bitacoraApiUrl) {
    throw new Error('BITACORA_API_URL no configurada');
  }

  if (!complementToken) {
    throw new Error('COMPLEMENT_TOKEN no configurado');
  }

  const response = await fetch(new URL(path, `${bitacoraApiUrl.replace(/\/?$/, '/')}`).toString(), {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${complementToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }

  if (!response.ok) {
    const message = parsed && typeof parsed === 'object' && parsed.message
      ? parsed.message
      : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return parsed;
};

app.get('/health', async (_req, res) => {
  await maybeDelay();
  if (String(process.env.SIMULATE_FAILURE || 'false').toLowerCase() === 'true') {
    return res.status(503).json({ status: 'down', reason: 'simulated failure' });
  }
  return res.json({
    status: 'ok',
    slug,
    tokenConfigured: Boolean(complementToken),
    internalApiConfigured: Boolean(bitacoraApiUrl)
  });
});

app.get('/', async (_req, res) => {
  await maybeDelay();
  res.send(`<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Complemento Genérico</title>
      <style>
        body { font-family: system-ui, sans-serif; margin: 0; background: #0f1720; color: #e7eef8; }
        .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
        .hero { display: grid; grid-template-columns: 1.3fr 1fr; gap: 16px; margin-bottom: 16px; }
        .card { background: #17212d; border: 1px solid #243244; border-radius: 16px; padding: 18px; }
        .card h1, .card h2, .card h3, .card p { margin-top: 0; }
        .actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        button { cursor: pointer; border: 0; border-radius: 12px; padding: 12px 14px; font-weight: 700; background: #37c27c; color: #082313; }
        button.secondary { background: #355fdf; color: #fff; }
        button.warn { background: #e8b84f; color: #291600; }
        code, pre { background: #0c131b; border-radius: 12px; padding: 12px; display: block; overflow: auto; color: #b8f7d4; }
        textarea { width: 100%; min-height: 110px; border-radius: 12px; border: 1px solid #314355; background: #0c131b; color: #fff; padding: 12px; box-sizing: border-box; }
        .muted { color: #97a8bc; }
        .status-ok { color: #80f1ae; }
        .status-bad { color: #ff8f8f; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .stack { display: grid; gap: 16px; }
        @media (max-width: 900px) { .hero, .grid, .actions { grid-template-columns: 1fr; } }
      </style>
    </head>
    <body style="font-family: sans-serif; padding: 24px;">
      <div class="wrap">
        <div class="hero">
          <section class="card">
            <h1>Complemento Genérico de Prueba</h1>
            <p>Slug: <strong>${slug}</strong></p>
            <p class="muted">Este complemento permite probar la plataforma sin escribir otro proyecto primero. Valida contexto, logs, storage compartido, creación de entradas y hook de cleanup.</p>
            <div id="healthLine" class="muted">Cargando estado...</div>
          </section>
          <section class="card">
            <h2>Checklist de plataforma</h2>
            <ul>
              <li>Contexto del usuario y turno</li>
              <li>Registro de logs desde complemento</li>
              <li>Escritura y lectura de storage compartido</li>
              <li>Creación de entrada operativa</li>
              <li>Borrado con cleanup hook</li>
            </ul>
          </section>
        </div>

        <div class="grid">
          <section class="card stack">
            <h2>Acciones</h2>
            <div class="actions">
              <button onclick="runAction('context')">Leer contexto</button>
              <button class="secondary" onclick="runAction('log')">Escribir log</button>
              <button class="secondary" onclick="runAction('storageSave')">Guardar storage</button>
              <button onclick="runAction('storageRead')">Leer storage</button>
              <button onclick="runAction('entry')">Crear entrada</button>
              <button class="warn" onclick="runAction('selftest')">Autoprueba</button>
            </div>

            <div>
              <h3>Texto de prueba</h3>
              <textarea id="entryContent">Entrada de prueba generada por el complemento stub.</textarea>
            </div>
          </section>

          <section class="card">
            <h2>Resultado</h2>
            <pre id="result">Sin ejecutar.</pre>
          </section>
        </div>

        <div class="grid" style="margin-top: 16px;">
          <section class="card">
            <h2>Contexto desde Core</h2>
            <pre id="context">Esperando contexto...</pre>
          </section>
          <section class="card">
            <h2>Eventos locales</h2>
            <pre id="events">[]</pre>
          </section>
        </div>
      </div>
      <script>
        async function refreshHealth() {
          const response = await fetch('/health');
          const payload = await response.json();
          document.getElementById('healthLine').innerHTML = payload.tokenConfigured && payload.internalApiConfigured
            ? '<span class="status-ok">OK:</span> token y API interna configurados.'
            : '<span class="status-bad">Pendiente:</span> falta token o API interna.';
        }

        async function runAction(action) {
          const content = document.getElementById('entryContent').value;
          const routes = {
            context: ['/api/context', { method: 'POST' }],
            log: ['/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Log emitido desde el stub genérico', level: 'info' }) }],
            storageSave: ['/api/storage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'generic-test', value: { savedAt: new Date().toISOString(), from: '${slug}' } }) }],
            storageRead: ['/api/storage', { method: 'GET' }],
            entry: ['/api/entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }],
            selftest: ['/api/self-test', { method: 'POST' }]
          };

          const [url, options] = routes[action];
          const response = await fetch(url, options);
          const payload = await response.json();
          document.getElementById('result').textContent = JSON.stringify(payload, null, 2);
          await refreshEvents();
        }

        async function refreshEvents() {
          const response = await fetch('/api/events');
          const payload = await response.json();
          document.getElementById('events').textContent = JSON.stringify(payload, null, 2);
        }

        window.addEventListener('message', function (event) {
          if (!event.data || event.data.version !== 1) return;
          document.getElementById('context').textContent = JSON.stringify(event.data, null, 2);
        });
        window.parent.postMessage({ type: 'REQUEST_CONTEXT', version: 1, slug: '${slug}' }, '*');
        refreshHealth();
        refreshEvents();
      </script>
    </body>
  </html>`);
});

app.get('/api/events', (_req, res) => {
  res.json(localState.events);
});

app.post('/api/context', async (_req, res) => {
  try {
    const context = await requestBitacora('context');
    pushEvent('context', context);
    res.json({ ok: true, context });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/log', async (req, res) => {
  try {
    const payload = await requestBitacora('log', {
      method: 'POST',
      body: {
        event: 'generic_stub_log',
        level: req.body?.level || 'info',
        message: req.body?.message || 'Log desde complemento stub',
        metadata: { source: slug }
      }
    });
    pushEvent('log', payload);
    res.json({ ok: true, payload });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/storage', async (req, res) => {
  try {
    const payload = await requestBitacora('storage', {
      method: 'POST',
      body: {
        key: String(req.body?.key || 'generic-test'),
        value: req.body?.value || { savedAt: new Date().toISOString(), slug },
        metadata: { source: 'generic-stub' }
      }
    });
    pushEvent('storage.save', payload);
    res.json({ ok: true, payload });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get('/api/storage', async (_req, res) => {
  try {
    const payload = await requestBitacora('storage');
    pushEvent('storage.read', payload);
    res.json({ ok: true, payload });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/entry', async (req, res) => {
  try {
    const now = new Date();
    const payload = await requestBitacora('log-entry', {
      method: 'POST',
      body: {
        content: String(req.body?.content || 'Entrada de prueba desde complemento stub'),
        entryType: 'operativa',
        entryDate: now.toISOString(),
        entryTime: now.toISOString().slice(11, 16),
        tags: ['complement', slug]
      }
    });
    pushEvent('entry.create', payload);
    res.json({ ok: true, payload });
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.post('/api/self-test', async (_req, res) => {
  const report = {
    context: null,
    log: null,
    storage: null,
    ok: false
  };

  try {
    report.context = await requestBitacora('context');
    await requestBitacora('log', {
      method: 'POST',
      body: {
        event: 'generic_stub_selftest',
        level: 'info',
        message: 'Autoprueba ejecutada'
      }
    });
    report.log = 'ok';
    report.storage = await requestBitacora('storage', {
      method: 'POST',
      body: {
        key: 'selftest',
        value: { checkedAt: new Date().toISOString(), slug }
      }
    });
    report.ok = true;
    pushEvent('self-test', report);
    res.json(report);
  } catch (error) {
    report.ok = false;
    report.error = error.message;
    pushEvent('self-test.error', report);
    res.status(500).json(report);
  }
});

app.post('/hook/cleanup', async (_req, res) => {
  await maybeDelay();
  if (String(process.env.SIMULATE_CLEANUP_FAIL || 'false').toLowerCase() === 'true') {
    return res.status(500).json({ cleaned: false, reason: 'simulated cleanup fail' });
  }
  localState.cleanupCount += 1;
  localState.lastCleanupAt = new Date().toISOString();
  localState.events = [];
  return res.json({ cleaned: true, cleanupCount: localState.cleanupCount, lastCleanupAt: localState.lastCleanupAt });
});

app.listen(PORT, () => {
  console.log(`[complement-stub] running on :${PORT}`);
});