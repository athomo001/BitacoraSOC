/**
 * File Purpose: backend/scripts/restart-clean.js
 * Responsibilities: Explain intent, contracts, and expected maintenance boundaries.
 * QA Notes: Preserve deterministic behavior and document validation assumptions.
 */

const { execSync } = require('child_process');

const ports = [3000, 3443, 5000];

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
  console.log('🧹 Liberando puertos 3000/3443/5000...');

  if (process.platform === 'win32') {
    try {
      const listenersBeforeKill = getWindowsListeners();
      const listenerPids = new Set(listenersBeforeKill.map((item) => item.pid));

      if (listenerPids.size === 0) {
        console.log('ℹ️ No hay listeners en 3000/3443/5000.');
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
          `No se pudieron liberar los puertos requeridos (${details}). ` +
          'Cierra esos procesos manualmente o ejecuta la terminal como Administrador y reintenta.'
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('No se pudieron liberar puertos automáticamente en Windows.');
    }

    return;
  }

  try {
    run('fuser -k 3000/tcp 3443/tcp 5000/tcp');
  } catch {
    console.log('ℹ️ No se pudieron liberar puertos automáticamente (Unix). Continuando...');
  }
};

const startServer = () => {
  console.log('🚀 Iniciando backend...');
  run('pnpm start');
};

try {
  freePorts();
  startServer();
} catch (error) {
  console.error('❌ Error en restart:clean:', error.message);
  process.exit(1);
}
