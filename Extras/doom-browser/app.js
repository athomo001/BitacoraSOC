/**
 * File Purpose: Extras/doom-browser/app.js
 * Responsibilities: Explain intent, contracts, and expected maintenance boundaries.
 * QA Notes: Preserve deterministic behavior and document validation assumptions.
 */

const startBtn = document.getElementById('startBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const statusText = document.getElementById('statusText');
const fpsText = document.getElementById('fpsText');
const buildVersionEl = document.getElementById('buildVersion');
const dosboxElement = document.getElementById('dosbox');
const fileProtocolNote = document.getElementById('fileProtocolNote');

/** Build visible para QA (debe coincidir con lo publicado en ZIP). */
const COMPLEMENT_VERSION = 'v0.8.0';
const DOS_CYCLES = 12000;

/** @type {any | null} */
let playerInstance = null;
let isRunning = false;
let fpsRafId = 0;
let fpsLastTs = 0;
let fpsFrames = 0;

const LOCAL_ZIP_URL = 'vendor/DOOM-@evilution.zip';
const LOCAL_DOSBOX_RUNTIME = 'vendor/wdosbox.js';
const LOCAL_WASM_JS_URL = 'vendor/wdosbox.wasm.js';

function isFileProtocol() {
  return window.location.protocol === 'file:';
}

function toAbsolute(path) {
  return new URL(path, window.location.href).toString();
}

function setStatus(message) {
  statusText.textContent = message;
}

function setFpsLabel(value) {
  if (!fpsText) {
    return;
  }
  fpsText.textContent = Number.isFinite(value) ? `FPS ${value.toFixed(1)}` : 'FPS --';
}

function startFpsMonitor() {
  if (fpsRafId) {
    cancelAnimationFrame(fpsRafId);
  }
  fpsFrames = 0;
  fpsLastTs = performance.now();
  setFpsLabel(0);

  const loop = (ts) => {
    fpsFrames += 1;
    const delta = ts - fpsLastTs;
    if (delta >= 500) {
      const fps = (fpsFrames * 1000) / delta;
      setFpsLabel(fps);
      fpsFrames = 0;
      fpsLastTs = ts;
    }
    fpsRafId = requestAnimationFrame(loop);
  };

  fpsRafId = requestAnimationFrame(loop);
}

function stopFpsMonitor() {
  if (fpsRafId) {
    cancelAnimationFrame(fpsRafId);
    fpsRafId = 0;
  }
  setFpsLabel(Number.NaN);
}

function markRunning() {
  isRunning = true;
  startBtn.disabled = true;
  fullscreenBtn.disabled = false;
  startFpsMonitor();
}

function markStopped() {
  isRunning = false;
  startBtn.disabled = false;
  fullscreenBtn.disabled = true;
  stopFpsMonitor();
}

/**
 * js-dos inserta un teclado virtual (.qwerty-input) con tabIndex=1 y stopPropagation
 * en keydown. Al deshabilitar el boton Iniciar, el foco puede saltar a ese input oculto
 * y el juego deja de recibir teclas (SDL escucha en document).
 */
function releaseQwertyKeyboardTrap() {
  const input = document.querySelector('.qwerty-input');
  if (input) {
    input.tabIndex = -1;
    input.blur();
  }
  const row = document.querySelector('.qwerty-input-row');
  if (row) {
    row.tabIndex = -1;
  }
  const send = document.querySelector('.qwerty-send');
  if (send) {
    send.tabIndex = -1;
  }
  const container = document.querySelector('.qwerty-container');
  if (container) {
    container.tabIndex = -1;
  }
}

function focusGameCanvas() {
  const host =
    document.querySelector('.dosbox-container canvas') ||
    (dosboxElement && dosboxElement.tagName === 'CANVAS' ? dosboxElement : null);
  if (!host) {
    return;
  }
  host.tabIndex = 0;
  host.style.outline = 'none';
  try {
    host.focus({ preventScroll: true });
  } catch (_e) {
    host.focus();
  }
}

/**
 * Comprueba lectura de assets; en file:// algunos navegadores bloquean fetch()
 * a rutas locales: en ese caso se omite la sonda y se delega al runtime.
 */
async function probeAsset(url, label) {
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      return `${label}: HTTP ${response.status}`;
    }
    return null;
  } catch (error) {
    if (isFileProtocol()) {
      return null;
    }
    const message = error && error.message ? error.message : String(error);
    return `${label}: ${message}`;
  }
}

async function startGame() {
  if (isRunning) {
    return;
  }

  if (typeof window.Dos !== 'function') {
    setStatus('No se encontro window.Dos. Verifica que vendor/js-dos.js cargue.');
    return;
  }

  if (isFileProtocol() && fileProtocolNote) {
    fileProtocolNote.hidden = false;
  }

  setStatus('Inicializando emulador (js-dos 6.22.60 + wdosbox.wasm.js)...');
  startBtn.disabled = true;

  const runtimeRef = isFileProtocol() ? LOCAL_DOSBOX_RUNTIME : toAbsolute(LOCAL_DOSBOX_RUNTIME);
  const zipRef = isFileProtocol() ? LOCAL_ZIP_URL : toAbsolute(LOCAL_ZIP_URL);

  const runtimeErr = await probeAsset(toAbsolute(LOCAL_DOSBOX_RUNTIME), 'Runtime wdosbox.js');
  const wasmJsErr = await probeAsset(toAbsolute(LOCAL_WASM_JS_URL), 'wdosbox.wasm.js');
  const zipErr = await probeAsset(toAbsolute(LOCAL_ZIP_URL), 'Paquete DOOM zip');
  if (runtimeErr || wasmJsErr || zipErr) {
    startBtn.disabled = false;
    setStatus(`No se pudieron leer assets locales. ${[runtimeErr, wasmJsErr, zipErr].filter(Boolean).join(' | ')}`);
    return;
  }

  try {
    setStatus('Extrayendo bundle local...');

    window.Dos(dosboxElement, {
      wdosboxUrl: runtimeRef,
      cycles: DOS_CYCLES,
      autolock: true
    }).ready((fs, main) => {
      fs.extract(zipRef)
        .then(() => {
          setStatus('Lanzando DOOM.EXE...');
          return main(['-c', 'cd DOOM', '-c', 'DOOM.EXE']);
        })
        .then((ci) => {
          playerInstance = ci;
          markRunning();
          releaseQwertyKeyboardTrap();
          focusGameCanvas();
          requestAnimationFrame(() => {
            releaseQwertyKeyboardTrap();
            focusGameCanvas();
          });
          setStatus(
            `DOOM en ejecucion. Build ${COMPLEMENT_VERSION}. Rendimiento: ${DOS_CYCLES} cycles.`
          );
        })
        .catch((error) => {
          markStopped();
          const message = error && error.message ? error.message : String(error);
          setStatus(`Fallo al iniciar: ${message}`);
        });
    });
  } catch (error) {
    markStopped();
    const message = error && error.message ? error.message : String(error);
    setStatus(`Fallo al iniciar: ${message}`);
  }
}

function toggleFullscreen() {
  if (!playerInstance) {
    return;
  }

  if (typeof playerInstance.setFullScreen === 'function') {
    playerInstance.setFullScreen(true);
    return;
  }

  if (typeof playerInstance.fullscreen === 'function') {
    playerInstance.fullscreen();
  }
}

startBtn.addEventListener('click', () => {
  startBtn.blur();
  startGame();
});

document.addEventListener(
  'pointerdown',
  (event) => {
    if (!isRunning) {
      return;
    }
    const t = event.target;
    if (t && typeof t.closest === 'function' && t.closest('.dosbox-container')) {
      releaseQwertyKeyboardTrap();
      focusGameCanvas();
    }
  },
  true
);
fullscreenBtn.addEventListener('click', toggleFullscreen);

buildVersionEl.textContent = COMPLEMENT_VERSION;
setStatus(`Listo. Build ${COMPLEMENT_VERSION}. Incluye wdosbox.wasm.js junto a wdosbox.js.`);
setFpsLabel(Number.NaN);

window.addEventListener('error', (event) => {
  if (!event || !event.message) {
    return;
  }
  markStopped();
  setStatus(`Error: ${event.message}`);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event && event.reason;
  const message =
    reason && typeof reason === 'object' && 'message' in reason
      ? reason.message
      : reason
        ? String(reason)
        : '(sin detalle)';
  markStopped();
  setStatus(`Promesa rechazada: ${message}`);
});
