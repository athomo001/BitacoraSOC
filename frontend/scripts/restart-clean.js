/**
 * File Purpose: frontend/scripts/restart-clean.js
 * Responsibilities: Explain intent, contracts, and expected maintenance boundaries.
 * QA Notes: Preserve deterministic behavior and document validation assumptions.
 */

const { execSync } = require('child_process');

const ports = [4200];

const run = (command) => {
  execSync(command, { stdio: 'inherit' });
};

const runText = (command) => execSync(command, { encoding: 'utf8' });

const getWindowsListeners = () => {
  const netstatOutput = runText('netstat -ano -p tcp');
  const listeners = [];

  const lines = netstatOutput.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes('LISTENING')) continue;

    const columns = line.trim().split(/\s+/);
    const localAddress = columns[1];
    const pid = columns[4];
    if (!localAddress || !pid) continue;

    const port = Number(localAddress.split(':').pop());
    if (!ports.includes(port)) continue;

    listeners.push({ port, pid });
  }

  return listeners;
};

const freePorts = () => {
  console.log('🧹 Liberando puerto 4200...');

  if (process.platform === 'win32') {
    const listenersBeforeKill = getWindowsListeners();
    const listenerPids = new Set(listenersBeforeKill.map((item) => item.pid));

    if (listenerPids.size === 0) {
      console.log('ℹ️ No hay listeners en 4200.');
    } else {
      for (const pid of listenerPids) {
        try {
          run(`taskkill /PID ${pid} /F`);
        } catch {
          console.log(`ℹ️ No se pudo terminar PID=${pid}. Continuando...`);
        }
      }
    }

    const listenersAfterKill = getWindowsListeners();
    if (listenersAfterKill.length > 0) {
      const details = listenersAfterKill
        .map((item) => `PID=${item.pid} PORT=${item.port}`)
        .join(', ');

      throw new Error(
        `No se pudo liberar el puerto requerido (${details}). ` +
        'Cierra esos procesos manualmente o ejecuta la terminal como Administrador y reintenta.'
      );
    }

    return;
  }

  try {
    run('fuser -k 4200/tcp');
  } catch {
    console.log('ℹ️ No se pudo liberar automáticamente en Unix. Continuando...');
  }
};

const startFrontend = () => {
  console.log('🚀 Iniciando frontend...');
  run('npm start');
};

try {
  freePorts();
  startFrontend();
} catch (error) {
  console.error('❌ Error en restart:clean:', error.message);
  process.exit(1);
}
