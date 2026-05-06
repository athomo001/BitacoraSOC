/**
 * File Purpose: backend/src/server.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * 🛡️ BITÁCORA SOC - Backend Express
 * Marca de autor en comentarios: Athan Espinoza
 * 
 * Arquitectura:
 *   - Express 5.1 + MongoDB + Mongoose
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
const tls = require('tls');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/database');
const AppConfig = require('./models/AppConfig');
const User = require('./models/User');
const Complement = require('./models/Complement');
const { authenticate } = require('./middleware/auth');
const { isComplementVisibleToUser } = require('./utils/complement-manager');
const { apiLimiter } = require('./middleware/rate-limiter');
const rateLimitResetPublic = require('./routes/rate-limit-reset-public');
const requestIdMiddleware = require('./middleware/request-id');
const captureMetadata = require('./middleware/metadata');
const inputSanitizer = require('./middleware/input-sanitizer');
const { logger } = require('./utils/logger');
const { getBrandingSnapshot, getAppTitleForText } = require('./utils/branding');
const { startChecklistAlertScheduler } = require('./utils/checklistAlertScheduler');
const { startBackupScheduler, stopBackupScheduler } = require('./utils/backup-scheduler');
const { startAuditRetentionScheduler, stopAuditRetentionScheduler } = require('./utils/audit-retention-scheduler');
const { startShiftReminderScheduler } = require('./utils/shiftReminderScheduler');
const {
  startComplementCircuitHealthChecks,
  stopComplementCircuitHealthChecks
} = require('./utils/complement-circuit-breaker');

const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 3000;
const APP_VERSION = process.env.APP_VERSION || 'dev';
const DEFAULT_HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT) || 4200;

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

const isWildcardAddress = (value) => {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return normalized === '0.0.0.0' || normalized === '::' || normalized === '[::]';
};

const getTrustedHosts = (req) => {
  const hosts = new Set();
  const requestHost = getSafeHostname(req.headers.host);
  const hostDomain = process.env.HOST_DOMAIN;

  if (requestHost) hosts.add(requestHost);
  if (hostDomain && !isWildcardAddress(hostDomain)) hosts.add(hostDomain);
  hosts.add('localhost');
  hosts.add('127.0.0.1');

  return hosts;
};

const isSameTrustedHostOrigin = (req, origin) => {
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    return getTrustedHosts(req).has(parsed.hostname);
  } catch {
    return false;
  }
};

const buildAutoAllowedOriginsSet = (req) => {
  const hosts = getTrustedHosts(req);

  const runtimeSecurityConfig = normalizeRuntimeSecurityConfig(req.app.locals.runtimeSecurityConfig);
  const ports = new Set([
    Number(process.env.BACKEND_PORT) || Number(PORT) || 3000,
    Number(process.env.HTTPS_PORT) || Number(runtimeSecurityConfig.httpsPort) || DEFAULT_HTTPS_PORT,
    Number(process.env.BACKEND_HTTPS_PORT) || Number(process.env.HTTPS_PORT) || Number(runtimeSecurityConfig.httpsPort) || DEFAULT_HTTPS_PORT,
    FRONTEND_PORT,
    80,
    443
  ].filter((value) => Number.isFinite(value) && value > 0));

  const normalized = new Set();
  hosts.forEach((host) => {
    ports.forEach((port) => {
      const httpOrigin = port === 80 ? `http://${host}` : `http://${host}:${port}`;
      const httpsOrigin = port === 443 ? `https://${host}` : `https://${host}:${port}`;
      normalized.add(httpOrigin);
      normalized.add(httpsOrigin);
    });
  });

  return normalized;
};

const buildComplementArtifactCsp = (complement) => {
  const runtimePolicy = complement?.runtimePolicy || {};
  const cspPolicy = runtimePolicy.csp || {};

  const scriptSrc = ["'self'", "'unsafe-inline'", 'https:', 'http:'];
  if (cspPolicy.allowUnsafeEval) {
    scriptSrc.push("'unsafe-eval'");
  }

  const connectSrc = [
    "'self'",
    'data:',
    'blob:',
    'https:',
    'http:',
    'wss:',
    'ws:',
    ...((cspPolicy.extraConnectSrc || []).map((value) => String(value).trim()).filter(Boolean))
  ];
  const childSrc = [
    "'self'",
    'data:',
    'blob:',
    'https:',
    'http:',
    ...((cspPolicy.extraChildSrc || []).map((value) => String(value).trim()).filter(Boolean))
  ];
  const workerSrc = cspPolicy.allowBlobWorker ? ["'self'", 'blob:'] : ["'self'", 'blob:'];

  const directives = [
    `default-src 'self' data: blob: https: http:`,
    `script-src ${Array.from(new Set(scriptSrc)).join(' ')}`,
    `style-src 'self' 'unsafe-inline' https: http:`,
    `img-src 'self' data: blob: https: http:`,
    `font-src 'self' data: https: http:`,
    `connect-src ${Array.from(new Set(connectSrc)).join(' ')}`,
    `worker-src ${Array.from(new Set(workerSrc)).join(' ')}`,
    `child-src ${Array.from(new Set(childSrc)).join(' ')}`,
    `frame-src ${Array.from(new Set(childSrc)).join(' ')}`,
    `media-src 'self' data: blob: https: http:`,
    `object-src 'none'`,
    `frame-ancestors 'self' http://localhost:* https://localhost:*`
  ];

  return directives.join('; ');
};

// Validación básica de variables de entorno requeridas
const validateEnv = () => {
  const required = ['MONGODB_URI', 'JWT_SECRET'];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`❌ Faltan variables de entorno requeridas: ${missing.join(', ')}`);
    process.exit(1);
  }
};

validateEnv();

app.locals.runtimeSecurityConfig = { ...DEFAULT_RUNTIME_SECURITY_CONFIG };
app.locals.httpsReady = false;

/*
 * QA / seguridad — orden del pipeline HTTP (no reordenar sin revisar impacto):
 * 1) trust proxy: afecta IP real y `req.secure` detrás de balanceadores.
 * 2) Helmet: cabeceras de mitigación (CSP, HSTS, etc.); probar front con Material/iframe.
 * 3) Parsers JSON/urlencoded: límite 50mb; validar que uploads grandes vayan por ruta adecuada.
 * 4) requestId: trazabilidad; correlacionar con logs y auditoría.
 * 5) Redirección/426 HTTPS: API usa 426 para no romper cookies/CORS (ver comentario inline).
 * 6) Bajo `/api/`: CORS + rate limit → metadata cliente → inputSanitizer (antes de rutas).
 * Casos de prueba manuales sugeridos: login con cookie, refresh, upload complemento, health.
 */

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
      frameSrc: ["'self'", "https:", "http:"],
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

  const forwardedHost = req.headers['x-forwarded-host'];
  const baseHost = forwardedHost || req.headers.host;
  const secureHost = baseHost ? getSafeHostname(baseHost) : 'localhost';

  const publicPort = process.env.PUBLIC_HTTPS_PORT;
  let targetHost = secureHost;

  if (publicPort) {
    targetHost = publicPort === '443' ? secureHost : `${secureHost}:${publicPort}`;
  } else if (!forwardedHost) {
    const httpsPort = Number(securityConfig.httpsPort) || DEFAULT_HTTPS_PORT;
    targetHost = httpsPort === 443 ? secureHost : `${secureHost}:${httpsPort}`;
  } else {
    targetHost = baseHost;
  }

  const targetUrl = `https://${targetHost}${req.originalUrl}`;

  // Fundamental: Para API requests (que usa el Frontend), siempre devolver 426 en lugar de redirección 307.
  // Esto previene que el navegador siga un redireccionamiento CORS automático que destruye la cookie de sesión (causando 401).
  // En su lugar, el Interceptor de Angular atrapa el 426 y rehace el request manualmente con { withCredentials: true }.
  if (req.path.startsWith('/api') || req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(426).json({
      message: 'HTTPS requerido para esta operación',
      targetUrl
    });
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.redirect(307, targetUrl);
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
      if (!origin) {
        callback(null, true);
        return;
      }

      const configuredOrigins = getAllowedOriginsSet(process.env.ALLOWED_ORIGINS || '');
      if (configuredOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('No permitido por CORS'));
    }
    : true, // En desarrollo permite cualquier origen
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-https-retry'],
  exposedHeaders: ['Content-Length', 'X-Request-Id', 'x-https-retry'],
  maxAge: 600
};

const apiCorsMiddleware = (req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    return cors(corsOptions)(req, res, next);
  }

  const dynamicCorsOptions = {
    ...corsOptions,
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const configuredOrigins = getAllowedOriginsSet(process.env.ALLOWED_ORIGINS || '');
      const autoOrigins = buildAutoAllowedOriginsSet(req);
      if (configuredOrigins.has(origin) || autoOrigins.has(origin) || isSameTrustedHostOrigin(req, origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('No permitido por CORS'));
    }
  };

  return cors(dynamicCorsOptions)(req, res, next);
};

// Reinicio de rate limits (sin pasar por apiLimiter; auth por RATE_LIMIT_RESET_SECRET)
app.post('/api/system/rate-limit-reset', rateLimitResetPublic);

// Rate limiting
app.use('/api/', apiCorsMiddleware, apiLimiter);
app.use('/api/', captureMetadata);
app.use('/api/', inputSanitizer);

// Servir archivos estáticos (logos y complementos publicados)
app.use('/uploads', async (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');

  // Proteger artefactos de complementos: no deben quedar públicos por conocer la URL.
  if (req.path.startsWith('/complements/')) {
    await authenticate(req, res, async () => {
      const relative = req.path.replace(/^\/+/, '');
      const [prefix, mode, slugOrPreviewId] = relative.split('/');

      if (prefix !== 'complements' || !mode || !slugOrPreviewId) {
        return res.status(404).json({ message: 'Ruta de complemento inválida' });
      }

      if (mode === 'preview') {
        if (req.user?.role !== 'admin') {
          return res.status(403).json({ message: 'Solo admins pueden acceder al preview de complementos' });
        }
      }

      if (mode === 'published') {
        const complement = await Complement.findOne({ slug: slugOrPreviewId });
        if (!complement) {
          return res.status(404).json({ message: 'Complemento no encontrado' });
        }

        if (!isComplementVisibleToUser(complement, req.user)) {
          return res.status(403).json({ message: 'No tienes acceso a este complemento' });
        }

        res.removeHeader('X-Frame-Options');
        res.header('Content-Security-Policy', buildComplementArtifactCsp(complement));
        return next();
      }

      // Preview (admin): política más flexible para validar artefactos antes de publicar.
      res.removeHeader('X-Frame-Options');
      res.header('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors 'self' http://localhost:* https://localhost:*");
      next();
    });
    return;
  }
  next();
}, express.static(path.join(__dirname, '../uploads')));

const getHealthPayload = (req) => ({
  status: 'ok',
  version: APP_VERSION,
  timestamp: new Date().toISOString(),
  timezone: process.env.TZ || 'America/Santiago',
  httpsReady: req ? req.app.locals.httpsReady : false,
  forceHttps: req && req.app.locals.runtimeSecurityConfig ? req.app.locals.runtimeSecurityConfig.forceHttps : false
});

// Health check para Docker y Frontend Dev Script
app.get('/health', (req, res) => {
  res.status(200).json(getHealthPayload(req));
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
app.use('/api/directory', require('./routes/directory')); // Directorio centralizado
app.use('/api/escalation', require('./routes/escalation')); // Módulo de escalaciones
app.use('/api/work-shift-assignments', require('./routes/work-shift-assignments')); // Asignaciones operativas
app.use('/api/work-shifts', require('./routes/work-shifts')); // Turnos de trabajo
app.use('/api/audit-logs', require('./routes/audit-logs')); // Logs de auditoría
app.use('/api/complements', require('./routes/complements')); // Gestión de complementos
app.use('/api/internal/versions', require('./routes/internal/versions'));
app.use('/api/internal/v1', require('./routes/internal/v1'));
app.use('/api/internal/v2', require('./routes/internal/v2'));
app.use('/api/system', require('./routes/system'));

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
  app.get('(.*)', (req, res) => {
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
} else {
  app.get('/', async (_req, res) => {
    const { appTitle } = await getBrandingSnapshot();
    res.status(200).json({
      message: `Backend ${getAppTitleForText(appTitle, 'activo').trim() === 'activo' ? 'activo' : `${appTitle} activo`}`,
      health: '/health',
      apiDocs: '/api-docs'
    });
  });
}

// Swagger documentation (próximo paso)
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');
try {
  const swaggerDocument = YAML.parse(fs.readFileSync(path.join(__dirname, './docs/swagger.yaml'), 'utf8'));
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

const isBackendAlreadyRunningOnPort = (listenPort) => new Promise((resolve) => {
  const request = http.get({
    host: '127.0.0.1',
    port: Number(listenPort),
    path: '/health',
    timeout: 1200
  }, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      body += chunk;
    });
    response.on('end', () => {
      if (response.statusCode !== 200) {
        resolve(false);
        return;
      }

      try {
        const payload = JSON.parse(body || '{}');
        resolve(payload?.status === 'ok');
      } catch {
        resolve(false);
      }
    });
  });

  request.on('error', () => resolve(false));
  request.on('timeout', () => {
    request.destroy();
    resolve(false);
  });
});

const attachServerErrorHandler = (serverInstance, label, listenPort) => {
  serverInstance.on('error', async (error) => {
    if (error.code === 'EADDRINUSE') {
      if (label === 'http') {
        const alreadyRunning = await isBackendAlreadyRunningOnPort(listenPort);
        if (alreadyRunning) {
          logger.info({ event: 'server.http.already.running', host: HOST, port: listenPort }, 'Otra instancia del backend ya está ejecutándose en el puerto HTTP');
          console.log(`ℹ️ Backend ya está corriendo en http://${HOST}:${listenPort}.`);
          return process.exit(0);
        }
      }

      logger.error({ event: 'server.port.in.use', protocol: label, host: HOST, port: listenPort }, 'Puerto en uso, no se pudo iniciar');
      console.error(`❌ Puerto ${listenPort} en uso para ${label.toUpperCase()}.`);

      if (label === 'https') {
        app.locals.httpsReady = false;
        logger.warn({ event: 'server.https.disabled.port.in.use', host: HOST, port: listenPort }, 'HTTPS deshabilitado por puerto en uso; backend seguirá en HTTP');
        return;
      }

      return process.exit(1);
    }

    logger.error({ event: 'server.listen.error', protocol: label, error: error.message }, 'Error al iniciar servidor');
    console.error(`❌ Error al iniciar servidor ${label.toUpperCase()}:`, error.message);

    if (label === 'https') {
      app.locals.httpsReady = false;
      logger.warn({ event: 'server.https.disabled.listen.error', error: error.message }, 'HTTPS deshabilitado por error de listener; backend seguirá en HTTP');
      return;
    }

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

const ensureInitialAdminUser = async () => {
  const userCount = await User.countDocuments();
  if (userCount > 0) {
    return;
  }

  const adminUsername = (process.env.ADMIN_USERNAME || '').trim();
  const adminPassword = process.env.ADMIN_PASSWORD || '';

  if (!adminUsername || !adminPassword) {
    logger.warn({ event: 'bootstrap.admin.skipped.missing.env' }, 'No se pudo crear el admin inicial porque faltan credenciales en variables de entorno');
    return;
  }

  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@bitacora.local').trim();

  await User.create({
    username: adminUsername,
    password: adminPassword,
    email: adminEmail,
    fullName: 'Administrador Maestro SOC',
    role: 'admin',
    cargoLabel: 'Líder Técnico SOC',
    isActive: true,
    theme: 'dark'
  });

  logger.info({ event: 'bootstrap.admin.created', username: adminUsername, email: adminEmail }, 'Usuario administrador inicial creado');
};

let currentSecureContext = null;

const buildSecureContext = () => {
  const securityConfig = normalizeRuntimeSecurityConfig(app.locals.runtimeSecurityConfig);
  if (!securityConfig.httpsEnabled) return null;

  const certPath = resolveTlsPath(securityConfig.tlsCertPath);
  const keyPath = resolveTlsPath(securityConfig.tlsKeyPath);
  const caPath = resolveTlsPath(securityConfig.tlsCaPath);

  if (!certPath || !keyPath || !fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    return null;
  }

  try {
    const options = {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath)
    };

    if (caPath && fs.existsSync(caPath)) {
      options.ca = fs.readFileSync(caPath);
    }

    return tls.createSecureContext(options);
  } catch (error) {
    logger.error({ event: 'server.https.context.failed', error: error.message }, 'No se pudo crear el contexto TLS en memoria');
    return null;
  }
};

app.locals.applyRuntimeSecurityConfig = () => {
  const securityConfig = normalizeRuntimeSecurityConfig(app.locals.runtimeSecurityConfig);
  const httpsPort = Number(securityConfig.httpsPort) || DEFAULT_HTTPS_PORT;
  const shouldStartHttps = !!securityConfig.httpsEnabled;

  currentSecureContext = buildSecureContext();

  if (shouldStartHttps) {
    if (!httpsServer) {
      httpsServer = https.createServer({
        SNICallback: (domain, cb) => {
          if (currentSecureContext) {
            cb(null, currentSecureContext);
          } else {
            // Intentar reconstruir si no está disponible (resiliencia ante reinicio)
            const retryContext = buildSecureContext();
            if (retryContext) {
              currentSecureContext = retryContext;
              cb(null, currentSecureContext);
            } else {
              logger.error({ event: 'server.https.sni.fallback.failed', domain }, 'Contexto TLS no disponible en SNICallback');
              cb(new Error('Contexto TLS no disponible'));
            }
          }
        }
      }, app);

      attachServerErrorHandler(httpsServer, 'https', httpsPort);
      httpsServer.listen(httpsPort, HOST, () => {
        app.locals.httpsReady = !!currentSecureContext;
        logger.info({ event: 'server.https.started', host: HOST, port: httpsPort }, 'Servidor HTTPS iniciado con SNI estricto');
        console.log(`🔒 HTTPS activo en https://${HOST}:${httpsPort}`);
      });
    } else {
      app.locals.httpsReady = !!currentSecureContext;
      console.log(`🔒 HTTPS contexto criptográfico recargado exitosamente en caliente.`);
    }
  } else {
    app.locals.httpsReady = false;
    currentSecureContext = null;
    if (httpsServer) {
      httpsServer.close(() => {
        logger.info({ event: 'server.https.stopped' }, 'Servidor HTTPS detenido por usuario');
        console.log(`🔓 Listener HTTPS apagado correctamente.`);
      });
      httpsServer = null;
    }
  }
};

const startHttpsServerIfEnabled = () => {
  app.locals.applyRuntimeSecurityConfig();
};

const startServers = async () => {
  await connectDB();
  await ensureInitialAdminUser();
  await loadRuntimeSecurityConfigFromDb();
  const { appTitle } = await getBrandingSnapshot();
  const backendBannerTitle = appTitle ? `${appTitle} - BACKEND` : 'BACKEND';

  httpServer = http.createServer(app);
  attachServerErrorHandler(httpServer, 'http', PORT);
  httpServer.listen(PORT, HOST, () => {
    console.log(`
╔════════════════════════════════════════╗
║     🛡️  ${backendBannerTitle.padEnd(29)}║
╠════════════════════════════════════════╣
║  Host:     ${HOST.padEnd(26)} ║
║  Port:     ${PORT.toString().padEnd(26)} ║
║  Timezone: ${(process.env.TZ || 'America/Santiago').padEnd(26)} ║
║  API Docs: http://${HOST}:${PORT}/api-docs ${' '.repeat(3)}║
╚════════════════════════════════════════╝
    `);

    startChecklistAlertScheduler();
    startBackupScheduler();
    startAuditRetentionScheduler();
    startComplementCircuitHealthChecks();
    startShiftReminderScheduler();

    const { startScheduler: startShiftReportScheduler } = require('./utils/shift-scheduler');
    startShiftReportScheduler();

    // Iniciar HTTPS solo cuando HTTP ya está confirmado.
    // Evita ruido de "puerto HTTPS en uso" cuando se ejecuta una segunda instancia
    // y el puerto HTTP ya estaba ocupado por una instancia previa.
    startHttpsServerIfEnabled();
  });
};

const gracefulShutdown = (signal) => {
  logger.info({ event: 'server.shutdown', signal }, 'Shutting down server');
  stopBackupScheduler();
  stopAuditRetentionScheduler();
  stopComplementCircuitHealthChecks();

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
