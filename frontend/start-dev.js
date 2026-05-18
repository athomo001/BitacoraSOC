/**
 * File Purpose: frontend/start-dev.js
 * Responsibilities: Explain intent, contracts, and expected maintenance boundaries.
 * QA Notes: Preserve deterministic behavior and document validation assumptions.
 */

const { spawn } = require('child_process');
const http = require('http');

let currentSslState = null;
let activeNgProcess = null;
let isRestarting = false;

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  🚀  INICIANDO ENTORNO ANGULAR CON AUTO-POLLING 🚀   ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

function checkBackendState() {
    if (isRestarting) return;

    const req = http.get('http://localhost:3000/health', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const payload = JSON.parse(data);
                if (payload.status === 'ok') {
                    const useSsl = payload.httpsReady === true;

                    if (currentSslState === null) {
                        currentSslState = useSsl;
                        startAngular(useSsl, payload.forceHttps);
                    } else if (currentSslState !== useSsl) {
                        console.log(`\n🔄 [AUTO-RESTART] Cambio en configuración SSL detectado (de ${currentSslState} a ${useSsl})`);
                        currentSslState = useSsl;
                        restartAngular(useSsl, payload.forceHttps);
                    }
                }
            } catch (e) {
                // Silently ignore parsing errors during polling
            }
        });
    }).on('error', (err) => {
        if (currentSslState === null) {
            console.log(`\n⚠️  Backend inalcanzable. Asegúrate de correr 'pnpm start' en /backend primero.`);
            currentSslState = false;
            startFallback();
        }
    });

    req.setTimeout(2000, () => req.abort());
}

function startAngular(useSsl, forceHttps) {
    console.log(`📡 Backend detectado! Estado: HTTPS Listo = ${useSsl}, Forzar HTTPS = ${forceHttps}`);
    const args = ['serve', '--host', '0.0.0.0', '--port', '4200', '--no-hmr'];

    if (useSsl) {
        console.log('🔒 EXIGENCIA HTTPS DETECTADA (Backend SSL Listo).');
        console.log('Levantando servidor de desarrollo Angular con el flag SSL automático (--ssl true)...');
        args.push('--ssl', 'true');
    } else {
        console.log('🔓 Iniciando servidor de desarrollo Angular en modo estandar HTTP...');
    }
    console.log('');

    spawnNg(args);
}

function startFallback() {
    console.log('⚠️  Iniciando Angular en modo HTTP predeterminado como respaldo...\n');
    spawnNg(['serve', '--host', '0.0.0.0', '--port', '4200', '--no-hmr']);
}

function spawnNg(args) {
    activeNgProcess = spawn('pnpm', ['exec', 'ng', ...args], { stdio: 'inherit', shell: true });

    activeNgProcess.on('close', (code) => {
        if (!isRestarting) {
            process.exit(code);
        }
    });
}

function restartAngular(useSsl, forceHttps) {
    isRestarting = true;
    console.log('🛑 Deteniendo proceso actual de Angular...');

    if (activeNgProcess) {
        if (process.platform === 'win32') {
            const { spawnSync } = require('child_process');
            spawnSync('taskkill', ['/pid', activeNgProcess.pid, '/f', '/t'], { stdio: 'ignore' });
            activeNgProcess = null;
            finishRestart(useSsl, forceHttps);
        } else {
            activeNgProcess.kill('SIGINT'); // Send interrupt signal

            setTimeout(() => {
                if (activeNgProcess) activeNgProcess.kill('SIGKILL');
            }, 3000);

            activeNgProcess.on('exit', () => {
                activeNgProcess = null;
                finishRestart(useSsl, forceHttps);
            });
        }
    } else {
        finishRestart(useSsl, forceHttps);
    }
}

function finishRestart(useSsl, forceHttps) {
    console.log('✅ Proceso detenido exitosamente. Lanzando nueva configuración en 1 segundo...');
    setTimeout(() => {
        isRestarting = false;
        startAngular(useSsl, forceHttps);
    }, 1000);
}

// Initial check
checkBackendState();

// Poll every 5 seconds for TLS config changes
setInterval(checkBackendState, 5000);
