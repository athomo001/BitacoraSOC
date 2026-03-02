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
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const connectDB = require('./config/database');
const { apiLimiter } = require('./middleware/rate-limiter');
const requestIdMiddleware = require('./middleware/request-id');
const inputSanitizer = require('./middleware/input-sanitizer');
const { logger } = require('./utils/logger');
const { startChecklistAlertScheduler } = require('./utils/checklistAlertScheduler');

const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 3000;
const APP_VERSION = process.env.APP_VERSION || 'dev';

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

// Conectar a MongoDB
connectDB();

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

// 🔒 CORS - En desarrollo permite todo, en producción restringe
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? (origin, callback) => {
      const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      if (allowedOrigins.length === 0) {
        callback(new Error('ALLOWED_ORIGINS no está configurado correctamente'));
      } else if (!origin) {
        callback(null, true);
      } else if (allowedOrigins.includes(origin)) {
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

// Iniciar servidor
const server = app.listen(PORT, HOST, () => {
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

  // Iniciar schedulers
  startChecklistAlertScheduler();

  const { startScheduler: startShiftReportScheduler } = require('./utils/shift-scheduler');
  startShiftReportScheduler();
});

// Manejo de errores de escucha y apagado ordenado
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error({ event: 'server.port.in.use', host: HOST, port: PORT }, 'Puerto en uso, no se pudo iniciar');
    console.error(`❌ Puerto ${PORT} en uso. Cierra procesos node que estén bloqueando el puerto y vuelve a iniciar.`);
    return process.exit(1);
  }

  logger.error({ event: 'server.listen.error', error: error.message }, 'Error al iniciar servidor');
  console.error('❌ Error al iniciar servidor:', error.message);
  process.exit(1);
});

const gracefulShutdown = (signal) => {
  logger.info({ event: 'server.shutdown', signal }, 'Shutting down server');
  server.close(() => {
    logger.info({ event: 'server.shutdown.completed' }, 'Servidor detenido');
    process.exit(0);
  });

  // Forzar cierre si demora más de 5s
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'server.unhandled.rejection', reason }, 'Unhandled promise rejection');
  // No cerramos el servidor, solo logueamos el error para debug
  console.error('❌ Unhandled Rejection:', reason);
});
process.on('uncaughtException', (error) => {
  logger.error({ event: 'server.uncaught.exception', error: error.message }, 'Uncaught exception');
  gracefulShutdown('uncaughtException');
});
