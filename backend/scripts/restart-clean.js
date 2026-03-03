const { execSync } = require('child_process');

const ports = [3000, 3443, 5000];

const run = (command) => {
  execSync(command, { stdio: 'inherit' });
};

const runText = (command) => execSync(command, { encoding: 'utf8' });

const freePorts = () => {
  console.log('🧹 Liberando puertos 3000/3443/5000...');

  if (process.platform === 'win32') {
    try {
      const netstatOutput = runText('netstat -ano -p tcp');
      const listenerPids = new Set();

      const lines = netstatOutput.split(/\r?\n/);
      for (const line of lines) {
        if (!line.includes('LISTENING')) continue;

        const columns = line.trim().split(/\s+/);
        const localAddress = columns[1];
        const pid = columns[4];
        if (!localAddress || !pid) continue;

        if (ports.some((port) => localAddress.endsWith(`:${port}`))) {
          listenerPids.add(pid);
        }
      }

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
    } catch {
      console.log('ℹ️ No se pudieron liberar puertos automáticamente en Windows. Continuando...');
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
  run('npm start');
};

try {
  freePorts();
  startServer();
} catch (error) {
  console.error('❌ Error en restart:clean:', error.message);
  process.exit(1);
}
