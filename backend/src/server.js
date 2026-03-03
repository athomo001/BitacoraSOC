/**
 * 🛡️ BITÁCORA SOC - Backend Express
 * 
 * Arquitectura:
 *   - Express 4.18 + MongoDB + Mongoose
 *   - JWT authentication con RBAC (admin/user/guest)
 *   - Rate limiting diferenciado
 *   - CORS por IP (no wildcard '*')
 * 
 * Ejecución por IP:
 *   - HOST=0.0.0.0 para escuchar todas las interfaces
 *   - ALLOWED_ORIGINS debe configurarse con IPs permitidas (ej: http://192.168.1.10:4200)
 *   - Requisito SOC: Sin '*' en CORS para prevenir acceso no autorizado
 * 
 * Timezone: America/Santiago (configurable vía TZ env)
 * Puerto: 3000 (configurable vía PORT env)
 */
require('dotenv').config();
const express = require('express');
const http = require('http');
const https = require('https');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/database');
const AppConfig = require('./models/AppConfig');
const { apiLimiter } = require('./middleware/rate-limiter');
const requestIdMiddleware = require('./middleware/request-id');
const captureMetadata = require('./middleware/metadata');
const inputSanitizer = require('./middleware/input-sanitizer');
const { logger } = require('./utils/logger');
const { startChecklistAlertScheduler } = require('./utils/checklistAlertScheduler');
const { startBackupScheduler, stopBackupScheduler } = require('./utils/backup-scheduler');

const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 3000;
const APP_VERSION = process.env.APP_VERSION || 'dev';
const DEFAULT_HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;

const DEFAULT_RUNTIME_SECURITY_CONFIG = {
  httpsEnabled: false,
  forceHttps: false,
  httpsPort: DEFAULT_HTTPS_PORT,
  tlsCertPath: '',
  tlsKeyPath: '',
  tlsCaPath: ''
};

const normalizeRuntimeSecurityConfig = (value) => ({
  ...DEFAULT_RUNTIME_SECURITY_CONFIG,
  ...(value || {})
});

const isSecureRequest = (req) => {
  if (req.secure) {
    return true;
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  if (!forwardedProto) {
    return false;
  }

  return forwardedProto.split(',')[0].trim() === 'https';
};

const getSafeHostname = (hostHeader) => {
  if (!hostHeader) return 'localhost';
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return hostHeader;
  }
};

const resolveTlsPath = (rawPath) => {
  if (!rawPath || typeof rawPath !== 'string') {
    return '';
  }

  const trimmedPath = rawPath.trim();
  if (!trimmedPath) {
    return '';
  }

  if (path.isAbsolute(trimmedPath)) {
    return trimmedPath;
  }

  return path.resolve(__dirname, '..', trimmedPath);
};

const getAllowedOriginsSet = (rawOrigins) => {
  const origins = (rawOrigins || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const normalized = new Set();
  origins.forEach((origin) => {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        normalized.add(origin);
        return;
      }

      normalized.add(`http://${parsed.host}`);
      normalized.add(`https://${parsed.host}`);
    } catch {
      normalized.add(origin);
    }
  });

  return normalized;
};

// Validación básica de variables de entorno requeridas
const validateEnv = () => {
  const required = ['MONGODB_URI', 'JWT_SECRET'];
  if (process.env.NODE_ENV === 'production') {
    required.push('ALLOWED_ORIGINS');
  }

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`❌ Faltan variables de entorno requeridas: ${missing.join(', ')}`);
    process.exit(1);
  }
};

validateEnv();

app.locals.runtimeSecurityConfig = { ...DEFAULT_RUNTIME_SECURITY_CONFIG };
app.locals.httpsReady = false;

const trustProxyEnv = process.env.TRUST_PROXY;
if (trustProxyEnv === 'true') {
  app.set('trust proxy', true);
} else if (trustProxyEnv === 'false') {
  app.set('trust proxy', false);
} else {
  app.set('trust proxy', process.env.NODE_ENV === 'production');
}

// Middlewares de seguridad
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"], // En Angular 17+ se podría requerir 'unsafe-eval' en dev, pero ajustamos a prod
      styleSrc: ["'self'", "'unsafe-inline'"], // Angular Material requiere unsafe-inline
      imgSrc: ["'self'", "data:", "blob:"], // Permitimos imagenes locales, dataURIs y blobs
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true
}));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Correlation ID (X-Request-Id)
app.use(requestIdMiddleware);

app.use((req, res, next) => {
  const securityConfig = normalizeRuntimeSecurityConfig(req.app.locals.runtimeSecurityConfig);
  if (!securityConfig.forceHttps || !req.app.locals.httpsReady) {
    return next();
  }

  if (req.path === '/health' || req.path.startsWith('/uploads/')) {
    return next();
  }

  if (isSecureRequest(req)) {
    return next();
  }

  const httpsPort = Number(securityConfig.httpsPort) || DEFAULT_HTTPS_PORT;
  const hostname = getSafeHostname(req.headers.host);
  const hostWithPort = httpsPort === 443 ? hostname : `${hostname}:${httpsPort}`;
  const targetUrl = `https://${hostWithPort}${req.originalUrl}`;

  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.redirect(308, targetUrl);
  }

  return res.status(426).json({
    message: 'HTTPS requerido para esta operación',
    targetUrl
  });
});

// 🔒 CORS - En desarrollo permite todo, en producción restringe
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? (origin, callback) => {
      const allowedOrigins = getAllowedOriginsSet(process.env.ALLOWED_ORIGINS || '');

      if (allowedOrigins.size === 0) {
        callback(new Error('ALLOWED_ORIGINS no está configurado correctamente'));
      } else if (!origin) {
        callback(null, true);
      } else if (allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(new Error('No permitido por CORS'));
      }
    }
    : true, // En desarrollo permite cualquier origen
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Length', 'X-Request-Id'],
  maxAge: 600
};

// Rate limiting
app.use('/api/', cors(corsOptions), apiLimiter);
app.use('/api/', captureMetadata);
app.use('/api/', inputSanitizer);

// Servir archivos estáticos (logos) - CORS permisivo para imágenes
app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(path.join(__dirname, '../uploads')));

const getHealthPayload = () => ({
  status: 'ok',
  version: APP_VERSION,
  timestamp: new Date().toISOString(),
  timezone: process.env.TZ || 'America/Santiago'
});

// Health check para Docker
app.get('/health', (req, res) => {
  res.status(200).json(getHealthPayload());
});

// Rutas de API
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/entries', require('./routes/entries'));
app.use('/api/notes', require('./routes/notes'));
app.use('/api/checklist', require('./routes/checklist'));
app.use('/api/tags', require('./routes/tags'));
app.use('/api/smtp', require('./routes/smtp'));
app.use('/api/logging', require('./routes/logging'));
app.use('/api/glpi', require('./routes/glpi'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/config', require('./routes/config'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/admin/catalog', require('./routes/admin-catalog')); // CRUD admin
app.use('/api/escalation', require('./routes/escalation')); // Módulo de escalaciones
app.use('/api/work-shifts', require('./routes/work-shifts')); // Turnos de trabajo
app.use('/api/audit-logs', require('./routes/audit-logs')); // Logs de auditoría

// Health check (ANTES del fallback SPA)
app.get('/health', (req, res) => {
  res.json(getHealthPayload());
});

// Servir frontend compilado (SPA) si existe dist
const clientDistPath = path.join(__dirname, '../../frontend/dist/bitacora-soc');
const clientIndexPath = path.join(clientDistPath, 'index.html');
if (fs.existsSync(clientDistPath) && fs.existsSync(clientIndexPath)) {
  app.use(express.static(clientDistPath));

  // SPA Fallback - DEBE estar al final, después de todas las rutas API
  app.get('*', (req, res) => {
    // No servir index.html para rutas de API
    if (req.path.startsWith('/api/') || req.path.startsWith('/api-docs') || req.path.startsWith('/uploads/')) {
      return res.status(404).json({ message: 'API endpoint not found' });
    }

    // Solo fallback SPA para navegación HTML, no para assets (ej: /favicon.ico)
    if (!req.accepts('html')) {
      return res.status(404).json({ message: 'Not found' });
    }

    res.sendFile(clientIndexPath);
  });
}

// Swagger documentation (próximo paso)
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
try {
  const swaggerDocument = YAML.load(path.join(__dirname, './docs/swagger.yaml'));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
} catch (error) {
  logger.info({ event: 'server.swagger.missing' }, 'Swagger documentation not found');
}

// Manejo de errores global
app.use((err, req, res, next) => {
  logger.error({
    err,
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    ip: req.ip
  }, 'Global error handler');

  if (err.message === 'No permitido por CORS') {
    return res.status(403).json({ message: 'Origen no permitido' });
  }

  res.status(err.status || 500).json({
    message: err.message || 'Error interno del servidor',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

let httpServer = null;
let httpsServer = null;

const attachServerErrorHandler = (serverInstance, label, listenPort) => {
  serverInstance.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      logger.error({ event: 'server.port.in.use', protocol: label, host: HOST, port: listenPort }, 'Puerto en uso, no se pudo iniciar');
      console.error(`❌ Puerto ${listenPort} en uso para ${label.toUpperCase()}.`);
      return process.exit(1);
    }

    logger.error({ event: 'server.listen.error', protocol: label, error: error.message }, 'Error al iniciar servidor');
    console.error(`❌ Error al iniciar servidor ${label.toUpperCase()}:`, error.message);
    process.exit(1);
  });
};

const loadRuntimeSecurityConfigFromDb = async () => {
  try {
    const config = await AppConfig.findOne().select('security').lean();
    app.locals.runtimeSecurityConfig = normalizeRuntimeSecurityConfig(config?.security);
  } catch (error) {
    logger.warn({ event: 'server.security.load.failed', error: error.message }, 'No se pudo cargar configuración HTTPS desde DB; se usarán defaults');
    app.locals.runtimeSecurityConfig = { ...DEFAULT_RUNTIME_SECURITY_CONFIG };
  }
};

const startHttpsServerIfEnabled = () => {
  app.locals.httpsReady = false;
  const securityConfig = normalizeRuntimeSecurityConfig(app.locals.runtimeSecurityConfig);
  if (!securityConfig.httpsEnabled) {
    return;
  }

  const certPath = resolveTlsPath(securityConfig.tlsCertPath);
  const keyPath = resolveTlsPath(securityConfig.tlsKeyPath);
  const caPath = resolveTlsPath(securityConfig.tlsCaPath);
  const httpsPort = Number(securityConfig.httpsPort) || DEFAULT_HTTPS_PORT;

  if (!certPath || !keyPath) {
    logger.warn({ event: 'server.https.disabled.missing.paths' }, 'HTTPS habilitado en config pero faltan rutas de certificado/llave');
    return;
  }

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    logger.warn({ event: 'server.https.disabled.invalid.paths', certPath, keyPath }, 'HTTPS no iniciado: archivo de certificado o llave no existe');
    return;
  }

  try {
    const tlsOptions = {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath)
    };

    if (caPath && fs.existsSync(caPath)) {
      tlsOptions.ca = fs.readFileSync(caPath);
    }

    httpsServer = https.createServer(tlsOptions, app);
    attachServerErrorHandler(httpsServer, 'https', httpsPort);
    httpsServer.listen(httpsPort, HOST, () => {
      app.locals.httpsReady = true;
      logger.info({ event: 'server.https.started', host: HOST, port: httpsPort }, 'Servidor HTTPS iniciado');
      console.log(`🔒 HTTPS activo en https://${HOST}:${httpsPort}`);
    });
  } catch (error) {
    logger.error({ event: 'server.https.start.failed', error: error.message }, 'No se pudo iniciar servidor HTTPS');
  }
};

const startServers = async () => {
  await connectDB();
  await loadRuntimeSecurityConfigFromDb();

  httpServer = http.createServer(app);
  attachServerErrorHandler(httpServer, 'http', PORT);
  httpServer.listen(PORT, HOST, () => {
    console.log(`
╔════════════════════════════════════════╗
║     🛡️  BITÁCORA SOC - BACKEND       ║
╠════════════════════════════════════════╣
║  Host:     ${HOST.padEnd(26)} ║
║  Port:     ${PORT.toString().padEnd(26)} ║
║  Timezone: ${(process.env.TZ || 'America/Santiago').padEnd(26)} ║
║  API Docs: http://${HOST}:${PORT}/api-docs ${' '.repeat(3)}║
╚════════════════════════════════════════╝
    `);

    startChecklistAlertScheduler();
    startBackupScheduler();

    const { startScheduler: startShiftReportScheduler } = require('./utils/shift-scheduler');
    startShiftReportScheduler();
  });

  startHttpsServerIfEnabled();
};

const gracefulShutdown = (signal) => {
  logger.info({ event: 'server.shutdown', signal }, 'Shutting down server');
  stopBackupScheduler();

  const closeTargets = [httpServer, httpsServer].filter(Boolean);
  if (!closeTargets.length) {
    return process.exit(0);
  }

  let pending = closeTargets.length;
  const onClosed = () => {
    pending -= 1;
    if (pending <= 0) {
      logger.info({ event: 'server.shutdown.completed' }, 'Servidor detenido');
      process.exit(0);
    }
  };

  closeTargets.forEach((serverInstance) => {
    serverInstance.close(onClosed);
  });

  setTimeout(() => process.exit(1), 5000).unref();
};

startServers().catch((error) => {
  logger.error({ event: 'server.start.failed', error: error.message }, 'Error fatal al iniciar backend');
  console.error('❌ Error fatal al iniciar backend:', error.message);
  process.exit(1);
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'server.unhandled.rejection', reason }, 'Unhandled promise rejection');
  console.error('❌ Unhandled Rejection:', reason);
});
process.on('uncaughtException', (error) => {
  logger.error({ event: 'server.uncaught.exception', error: error.message }, 'Uncaught exception');
  gracefulShutdown('uncaughtException');
});
