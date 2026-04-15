const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const AppConfig = require('../models/AppConfig');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { invalidateCache } = require('../utils/email');
const { validateCryptoPair, isPortFree } = require('../utils/tls-validator');

// Configurar multer para logo
const logoStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/logos');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `logo-${Date.now()}${ext}`);
  }
});

const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp|svg\+xml/;
    const mimeType = allowedTypes.test(file.mimetype);
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

    if (mimeType && extname) {
      return cb(null, true);
    }
    cb(new Error('Solo se permiten imágenes (jpg, png, webp, svg)'));
  }
});

// Configurar multer para favicon
const faviconStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/favicons');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `favicon-${Date.now()}${ext || '.ico'}`);
  }
});

const uploadFavicon = multer({
  storage: faviconStorage,
  limits: { fileSize: 256 * 1024 }, // 256KB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /png|x-icon|vnd\.microsoft\.icon/;
    const allowedExt = /\.(png|ico)$/i;
    const mimeType = allowedTypes.test(file.mimetype);
    const extname = allowedExt.test(path.extname(file.originalname).toLowerCase());

    if (mimeType && extname) {
      return cb(null, true);
    }
    cb(new Error('Solo se permiten favicons PNG o ICO (máx 256KB)'));
  }
});

const parseBase64Image = (dataUrl) => {
  const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!matches) return null;
  return {
    mimeSubtype: matches[1].toLowerCase(),
    base64Data: matches[2]
  };
};

const tlsStorage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const uploadDir = path.join(__dirname, '../../secrets');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (_req, file, cb) => {
    if (file.fieldname === 'tlsCert') {
      cb(null, 'cert.pem');
    } else if (file.fieldname === 'tlsKey') {
      cb(null, 'key.pem');
    } else if (file.fieldname === 'tlsCa') {
      cb(null, 'ca.pem');
    } else {
      const ext = path.extname(file.originalname).toLowerCase() || '.pem';
      const baseName = path.basename(file.originalname, path.extname(file.originalname)).replace(/[^a-zA-Z0-9-_]/g, '');
      cb(null, `${baseName || 'tls'}-${Date.now()}${ext}`);
    }
  }
});

const uploadTls = multer({
  storage: tlsStorage,
  limits: { fileSize: 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const hasNoExtension = !ext;
    const allowedExt = /\.(pem|crt|cer|key)$/i;
    const hasAllowedExtension = allowedExt.test(ext);
    if (hasNoExtension || hasAllowedExtension) {
      return cb(null, true);
    }
    cb(new Error('Archivo inválido. Tipos permitidos: .pem, .crt, .cer, .key (también se acepta archivo sin extensión)'));
  }
});

const DEFAULT_SECURITY_CONFIG = {
  httpsEnabled: false,
  forceHttps: false,
  httpsPort: 3443,
  tlsCertPath: '',
  tlsKeyPath: '',
  tlsCaPath: ''
};

const extractSecurityConfig = (config) => ({
  ...DEFAULT_SECURITY_CONFIG,
  ...(config?.security || {})
});

const getTlsFileInfo = (security) => ({
  certUploaded: !!security?.tlsCertPath,
  keyUploaded: !!security?.tlsKeyPath,
  caUploaded: !!security?.tlsCaPath,
  certFileName: security?.tlsCertPath ? path.basename(security.tlsCertPath) : '',
  keyFileName: security?.tlsKeyPath ? path.basename(security.tlsKeyPath) : '',
  caFileName: security?.tlsCaPath ? path.basename(security.tlsCaPath) : ''
});

const fileHasPemToken = async (filePath, tokenCandidates) => {
  const content = await fs.readFile(filePath, 'utf8');
  const normalized = String(content || '').toUpperCase();
  return tokenCandidates.some((token) => normalized.includes(token));
};

const removeUploadedFileSilently = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore cleanup errors
  }
};

const resolveStoredTlsPath = (storedPath) => {
  if (!storedPath || typeof storedPath !== 'string') {
    return '';
  }

  const normalized = storedPath.replace(/\\/g, '/').trim();
  if (!normalized) {
    return '';
  }

  if (!normalized.startsWith('uploads/tls/') && !normalized.startsWith('secrets/')) {
    return '';
  }

  return path.join(__dirname, '../..', normalized);
};

const removeStoredTlsFileSilently = async (storedPath) => {
  const filePath = resolveStoredTlsPath(storedPath);
  if (!filePath) return;

  try {
    await fs.unlink(filePath);
  } catch {
    // ignore cleanup errors
  }
};

const validateTlsFilesByContent = async ({ certFile, keyFile, caFile }) => {
  let certPem = null;
  let keyPem = null;
  let caPem = null;

  try {
    if (certFile) certPem = await fs.readFile(certFile.path, 'utf8');
    if (keyFile) keyPem = await fs.readFile(keyFile.path, 'utf8');
    if (caFile) caPem = await fs.readFile(caFile.path, 'utf8');

    if (certPem || keyPem) {
      validateCryptoPair({ certPem: certPem || '', keyPem: keyPem || '', caPem });
    }
  } catch (error) {
    throw error;
  }
};

// GET /api/config - Obtener configuración
router.get('/', authenticate, async (req, res) => {
  try {
    let config = await AppConfig.findOne().populate('defaultLogSourceId', 'name enabled');

    if (!config) {
      config = await AppConfig.create({
        guestModeEnabled: false,
        guestMaxDurationDays: 2,
        shiftCheckCooldownHours: 240,
        checklistCloseEmailEnabled: false,
        alertNokEnabled: false,
        alertNokRoleTarget: ['N2'],
        checklistAlertEnabled: true,
        checklistAlertTime: '09:30',
        checklistWeeklyAlertEnabled: false,
        checklistWeeklyReminderDay: 1,
        checklistWeeklyReminderTime: '16:00',
        checklistWeeklyCutoffTime: '18:00',
        checklistWeeklyTimezone: 'America/Santiago',
        escalationReminderEnabled: false,
        escalationReminderCargoLabels: ['N2'],
        escalationReminderDaysAhead: 7,
        security: DEFAULT_SECURITY_CONFIG
      });
    }

    // Sanitize config by removing sensitive info
    const configData = config.toObject();
    if (configData.smtpConfig && configData.smtpConfig.pass) {
      delete configData.smtpConfig.pass;
    }

    configData.security = {
      ...extractSecurityConfig(configData),
      ...getTlsFileInfo(configData?.security)
    };

    res.json(configData);
  } catch (error) {
    console.error('Error al obtener config:', error);
    res.status(500).json({ message: 'Error al obtener configuración' });
  }
});

// PUT /api/config - Actualizar configuración (admin)
router.put('/',
  authenticate,
  authorize('admin'),
  [
    body('guestModeEnabled').optional().isBoolean(),
    body('guestMaxDurationDays').optional().isInt({ min: 1, max: 30 }).toInt(),
    body('shiftCheckCooldownHours').optional().isInt({ min: 1, max: 1440 }).toInt(),
    body('checklistCloseEmailEnabled').optional().isBoolean(),
    body('alertNokEnabled').optional().isBoolean(),
    body('alertNokRoleTarget').optional().isArray({ max: 20 }).withMessage('Debes enviar una lista valida de cargos'),
    body('alertNokRoleTarget.*').optional().isString().trim().isLength({ min: 1, max: 80 }).withMessage('Cargo invalido'),
    body('checklistAlertEnabled').optional().isBoolean(),
    body('checklistAlertTime').optional().matches(/^\d{2}:\d{2}$/).withMessage('Formato de hora inválido (HH:mm)'),
    body('checklistWeeklyAlertEnabled').optional().isBoolean(),
    body('checklistWeeklyReminderDay').optional().isInt({ min: 0, max: 6 }).toInt(),
    body('checklistWeeklyReminderTime').optional().matches(/^\d{2}:\d{2}$/).withMessage('Formato de hora de recordatorio inválido (HH:mm)'),
    body('checklistWeeklyCutoffTime').optional().matches(/^\d{2}:\d{2}$/).withMessage('Formato de hora de corte inválido (HH:mm)'),
    body('checklistWeeklyTimezone').optional().isString().trim().isLength({ min: 3, max: 80 }),
    body('escalationReminderEnabled').optional().isBoolean(),
    body('escalationReminderCargoLabels').optional().isArray({ min: 1, max: 20 }).withMessage('Debes seleccionar al menos un cargo'),
    body('escalationReminderCargoLabels.*').optional().isString().trim().isLength({ min: 1, max: 80 }).withMessage('Cargo inválido'),
    body('escalationReminderDaysAhead').optional().isInt({ min: 1, max: 60 }).toInt().withMessage('Días de antelación inválidos (1-60)'),
    body('appTitle').optional().isString().trim().isLength({ max: 80 }).withMessage('El título no puede superar 80 caracteres'),
    body('loginTheme').optional().isIn(['crt', 'infoflow']).withMessage('Tema inválido'),
    body('security.httpsEnabled').optional().isBoolean(),
    body('security.forceHttps').optional().isBoolean(),
    body('security.httpsPort').optional({ nullable: true }).custom((value) => {
      if (value === null || value === undefined || value === '') return true;
      const numeric = Number(value);
      if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
        throw new Error('Puerto HTTPS inválido');
      }
      return true;
    }).toInt(),
    body('security.tlsCertPath').optional().isString().trim().isLength({ max: 500 }),
    body('security.tlsKeyPath').optional().isString().trim().isLength({ max: 500 }),
    body('security.tlsCaPath').optional().isString().trim().isLength({ max: 500 }),
    body('logoUrl').optional().trim(),
    body('faviconUrl').optional().trim(),
    body('defaultLogSourceId').optional({ checkFalsy: true }).isMongoId().withMessage('ID de LogSource inválido'),
    body('emailReportConfig.enabled').optional().isBoolean(),
    body('emailReportConfig.recipients').optional().isArray(),
    body('emailReportConfig.includeChecklist').optional().isBoolean(),
    body('emailReportConfig.includeEntries').optional().isBoolean(),
    body('emailReportConfig.subjectTemplate').optional().trim(),
    body('emailReportConfig.reportTableColor').optional().matches(/^#([A-Fa-f0-9]{6})$/).withMessage('Color de tabla inválido. Usa formato #RRGGBB'),
    body('smtpConfig.host').optional().trim(),
    body('smtpConfig.port').optional().isInt({ min: 1, max: 65535 }).toInt(),
    body('smtpConfig.secure').optional().isBoolean(),
    body('smtpConfig.user').optional().trim(),
    body('smtpConfig.pass').optional(),
    body('smtpConfig.from').optional().trim()
  ],
  validate,
  async (req, res) => {
    try {
      let config = await AppConfig.findOne();
      const incomingSecurity = req.body.security;

      if (!config) {
        config = new AppConfig(req.body);
      } else {
        const oldPass = config.smtpConfig ? config.smtpConfig.pass : null;
        const previousSecurity = extractSecurityConfig(config);
        Object.assign(config, req.body);

        if (incomingSecurity) {
          config.security = {
            ...previousSecurity,
            ...incomingSecurity
          };
        }

        // Preserve password if it wasn't provided or was sent as empty string (masked)
        if (req.body.smtpConfig) {
          if (!req.body.smtpConfig.pass && oldPass) {
            config.smtpConfig.pass = oldPass;
          }
        }
      }

      const effectiveSecurity = extractSecurityConfig(config);

      // PRECHECK de PUERTO (SEC-HTTPS-019) si https está activo o se va a forzar
      if (effectiveSecurity.httpsEnabled) {
        if (!effectiveSecurity.tlsCertPath || !effectiveSecurity.tlsKeyPath) {
          return res.status(400).json({ message: 'Para habilitar HTTPS debes cargar certificado y llave TLS' });
        }

        // Solo verificamos puertos si cambió o si estamos prendiéndolo
        const httpsPort = Number(effectiveSecurity.httpsPort) || 3443;
        const portCheck = await isPortFree(httpsPort);

        // Si no está libre y no es el mismo que ya tenemos levantado...
        // Nota: Si ya estaba levantado localmente por nosotros, no fallará de inmediato porque node lo tiene,
        // pero evitamos falsos check por ahora, asumiendo que el server.js se recargará vía SNI.
        // Si el puerto cambia respecto a lo que tenemos en memory
        const currentInMemoryConfig = req.app.locals.runtimeSecurityConfig || {};
        if (Number(currentInMemoryConfig.httpsPort) !== httpsPort && !portCheck.free) {
          return res.status(400).json({ message: `El puerto HTTPS ${httpsPort} está ocupado por otro proceso.` });
        }
      }

      if (effectiveSecurity.forceHttps) {
        if (!effectiveSecurity.httpsEnabled) {
          return res.status(400).json({ message: 'No puedes forzar HTTPS si el listener HTTPS está deshabilitado' });
        }

        if (!effectiveSecurity.tlsCertPath || !effectiveSecurity.tlsKeyPath) {
          return res.status(400).json({ message: 'Para forzar HTTPS debes tener certificado y llave TLS cargados' });
        }
      }

      config.lastUpdatedBy = req.user._id;
      await config.save();

      req.app.locals.runtimeSecurityConfig = extractSecurityConfig(config);

      // Emit config reload event for SNICallback (SEC-HTTPS-002)
      if (req.app.locals.applyRuntimeSecurityConfig) {
        req.app.locals.applyRuntimeSecurityConfig();
      }

      // Invalidar cache de SMTP si se actualizó
      if (req.body.smtpConfig) {
        invalidateCache();
      }

      // Populate defaultLogSourceId para retornar nombre
      await config.populate('defaultLogSourceId', 'name enabled');

      const responseConfig = config.toObject();
      responseConfig.security = {
        ...extractSecurityConfig(responseConfig),
        ...getTlsFileInfo(responseConfig?.security)
      };

      res.json({ message: 'Configuración actualizada', config: responseConfig });
    } catch (error) {
      console.error('Error al actualizar config:', error);
      res.status(500).json({ message: `Error al actualizar configuración: ${error.message}` });
    }
  }
);

// POST /api/config/security/certificates - Subir certificados TLS (admin)
router.post('/security/certificates',
  authenticate,
  authorize('admin'),
  (req, res) => {
    uploadTls.fields([
      { name: 'tlsCert', maxCount: 1 },
      { name: 'tlsKey', maxCount: 1 },
      { name: 'tlsCa', maxCount: 1 }
    ])(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ message: err.message || 'Error al subir certificados TLS' });
      }

      try {
        const files = req.files || {};
        const certFile = files.tlsCert?.[0];
        const keyFile = files.tlsKey?.[0];
        const caFile = files.tlsCa?.[0];

        if (!certFile && !keyFile && !caFile) {
          return res.status(400).json({ message: 'Debes seleccionar al menos un archivo TLS' });
        }

        await validateTlsFilesByContent({ certFile, keyFile, caFile });

        let config = await AppConfig.findOne();
        if (!config) {
          config = new AppConfig();
        }

        const currentSecurity = extractSecurityConfig(config);

        // Capturar paths antiguos (SEC-HTTPS-014)
        const oldCerts = {
          cert: currentSecurity.tlsCertPath,
          key: currentSecurity.tlsKeyPath,
          ca: currentSecurity.tlsCaPath
        };

        if (certFile) {
          currentSecurity.tlsCertPath = `secrets/${certFile.filename}`;
        }

        if (keyFile) {
          currentSecurity.tlsKeyPath = `secrets/${keyFile.filename}`;
        }

        if (caFile) {
          currentSecurity.tlsCaPath = `secrets/${caFile.filename}`;
        }

        // Habilitador automático: si sube cert+key nuevos o se complementan, activa HTTPS (SEC-HTTPS-016)
        if (currentSecurity.tlsCertPath && currentSecurity.tlsKeyPath) {
          currentSecurity.httpsEnabled = true;
        }

        config.security = currentSecurity;
        config.lastUpdatedBy = req.user._id;
        await config.save();

        req.app.locals.runtimeSecurityConfig = extractSecurityConfig(config);

        // Emitir recarga estricta por SNI en runtime
        if (req.app.locals.applyRuntimeSecurityConfig) {
          req.app.locals.applyRuntimeSecurityConfig();
        }

        // Limpieza de certificados viejos si todo salió bien y si no se llaman igual (SEC-HTTPS-014)
        if (certFile && oldCerts.cert && oldCerts.cert !== currentSecurity.tlsCertPath) await removeStoredTlsFileSilently(oldCerts.cert);
        if (keyFile && oldCerts.key && oldCerts.key !== currentSecurity.tlsKeyPath) await removeStoredTlsFileSilently(oldCerts.key);
        if (caFile && oldCerts.ca && oldCerts.ca !== currentSecurity.tlsCaPath) await removeStoredTlsFileSilently(oldCerts.ca);

        return res.json({
          message: 'Certificados TLS actualizados y aplicados.',
          security: {
            ...extractSecurityConfig(config),
            ...getTlsFileInfo(config.security),
            httpsReady: req.app.locals.httpsReady || false
          }
        });
      } catch (error) {
        const files = req.files || {};
        await removeUploadedFileSilently(files.tlsCert?.[0]?.path);
        await removeUploadedFileSilently(files.tlsKey?.[0]?.path);
        await removeUploadedFileSilently(files.tlsCa?.[0]?.path);
        return res.status(400).json({ message: error.message || 'Error al guardar certificados TLS' });
      }
    });
  }
);

// DELETE /api/config/security/certificates - Borrar certs y resetear HTTPS/TLS (admin)
router.delete('/security/certificates',
  authenticate,
  authorize('admin'),
  async (req, res) => {
    try {
      let config = await AppConfig.findOne();
      if (!config) {
        config = new AppConfig();
      }

      const currentSecurity = extractSecurityConfig(config);
      await Promise.all([
        removeStoredTlsFileSilently(currentSecurity.tlsCertPath),
        removeStoredTlsFileSilently(currentSecurity.tlsKeyPath),
        removeStoredTlsFileSilently(currentSecurity.tlsCaPath)
      ]);

      config.security = {
        ...DEFAULT_SECURITY_CONFIG
      };
      config.lastUpdatedBy = req.user._id;
      await config.save();

      req.app.locals.runtimeSecurityConfig = extractSecurityConfig(config);

      // Emitir recarga estricta por SNI en runtime para desactivar HTTPS y liberar memoria
      if (req.app.locals.applyRuntimeSecurityConfig) {
        req.app.locals.applyRuntimeSecurityConfig();
      }

      return res.json({
        message: 'Configuración HTTPS/TLS restablecida a valores por defecto',
        security: {
          ...extractSecurityConfig(config),
          ...getTlsFileInfo(config.security)
        }
      });
    } catch (error) {
      return res.status(500).json({ message: 'Error al restablecer configuración HTTPS/TLS' });
    }
  }
);

// GET /api/config/logo - Obtener logo actual (PÚBLICO - para mostrar en login)
router.get('/logo', async (req, res) => {
  try {
    const config = await AppConfig.findOne();

    if (!config) {
      return res.json({ logoUrl: '', loginTheme: 'crt', appTitle: '' });
    }

    // Devolver ruta relativa - el navegador la resolverá automáticamente
    res.json({ logoUrl: config.logoUrl || '', loginTheme: config.loginTheme || 'crt', appTitle: config.appTitle || '' });
  } catch (error) {
    console.error('Error al obtener logo:', error);
    res.status(500).json({ message: 'Error al obtener logo' });
  }
});

// GET /api/config/favicon - Obtener favicon actual (PÚBLICO)
router.get('/favicon', async (_req, res) => {
  try {
    const config = await AppConfig.findOne();

    if (!config || !config.faviconUrl) {
      return res.json({ faviconUrl: '' });
    }

    res.json({ faviconUrl: config.faviconUrl });
  } catch (error) {
    console.error('Error al obtener favicon:', error);
    res.status(500).json({ message: 'Error al obtener favicon' });
  }
});

// POST /api/config/logo - Subir logo (admin)
router.post('/logo',
  authenticate,
  authorize('admin'),
  async (req, res) => {
    // Middleware dinámico para manejar multipart o JSON
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
      // Manejar subida de archivo
      uploadLogo.single('logo')(req, res, async (err) => {
        if (err) {
          console.error('Error en multer:', err);
          return res.status(400).json({ message: err.message || 'Error al procesar archivo' });
        }

        try {
          if (!req.file) {
            return res.status(400).json({ message: 'No se proporcionó archivo' });
          }

          const logoUrl = `/uploads/logos/${req.file.filename}`;

          let config = await AppConfig.findOne();
          if (!config) {
            config = new AppConfig();
          }

          config.logoUrl = logoUrl;
          config.logoType = 'upload';
          config.lastUpdatedBy = req.user._id;
          await config.save();

          res.json({
            message: 'Logo actualizado',
            logoUrl
          });
        } catch (error) {
          console.error('Error al subir logo:', error);
          res.status(500).json({ message: 'Error al subir logo' });
        }
      });
    } else {
      // Manejar base64 o URL externa
      try {
        const { logoData, logoUrl } = req.body;

        if (!logoData && !logoUrl) {
          return res.status(400).json({ message: 'Debe proporcionar logoData (base64) o logoUrl' });
        }

        let config = await AppConfig.findOne();
        if (!config) {
          config = new AppConfig();
        }

        if (logoData) {
          // Guardar imagen base64 como archivo
          const parsed = parseBase64Image(logoData);
          if (!parsed) {
            return res.status(400).json({ message: 'Formato de imagen base64 inválido' });
          }

          const ext = parsed.mimeSubtype.split('+')[0].replace('jpeg', 'jpg');
          const base64Data = parsed.base64Data;
          const buffer = Buffer.from(base64Data, 'base64');

          // Validar tamaño (5MB máx)
          if (buffer.length > 5 * 1024 * 1024) {
            return res.status(400).json({ message: 'La imagen es muy grande (máx 5MB)' });
          }

          const uploadDir = path.join(__dirname, '../../uploads/logos');
          await fs.mkdir(uploadDir, { recursive: true });

          const filename = `logo-${Date.now()}.${ext}`;
          const filepath = path.join(uploadDir, filename);
          await fs.writeFile(filepath, buffer);

          config.logoUrl = `/uploads/logos/${filename}`;
          config.logoType = 'upload';
        } else if (logoUrl) {
          // URL externa
          config.logoUrl = logoUrl;
          config.logoType = 'external';
        }

        config.lastUpdatedBy = req.user._id;
        await config.save();

        res.json({
          message: 'Logo actualizado',
          logoUrl: config.logoUrl
        });
      } catch (error) {
        console.error('Error al guardar logo:', error);
        res.status(500).json({ message: 'Error al guardar logo' });
      }
    }
  }
);

// DELETE /api/config/logo - Eliminar logo (admin)
router.delete('/logo',
  authenticate,
  authorize('admin'),
  async (req, res) => {
    try {
      const config = await AppConfig.findOne();

      if (!config || !config.logoUrl) {
        return res.json({ message: 'No hay logo configurado' });
      }

      // Si es un archivo local, eliminarlo
      if (config.logoType === 'upload' && config.logoUrl.startsWith('/uploads/')) {
        const filepath = path.join(__dirname, '../..', config.logoUrl);
        try {
          await fs.unlink(filepath);
        } catch (err) {
          console.warn('No se pudo eliminar archivo:', err.message);
        }
      }

      config.logoUrl = '';
      config.logoType = undefined;
      config.lastUpdatedBy = req.user._id;
      await config.save();

      res.json({ message: 'Logo eliminado' });
    } catch (error) {
      console.error('Error al eliminar logo:', error);
      res.status(500).json({ message: 'Error al eliminar logo' });
    }
  }
);

// POST /api/config/favicon - Subir favicon (admin)
router.post('/favicon',
  authenticate,
  authorize('admin'),
  async (req, res) => {
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('multipart/form-data')) {
      uploadFavicon.single('favicon')(req, res, async (err) => {
        if (err) {
          console.error('Error en multer favicon:', err);
          return res.status(400).json({ message: err.message || 'Error al procesar favicon' });
        }

        try {
          if (!req.file) {
            return res.status(400).json({ message: 'No se proporcionó archivo favicon' });
          }

          const faviconUrl = `/uploads/favicons/${req.file.filename}`;

          let config = await AppConfig.findOne();
          if (!config) {
            config = new AppConfig();
          }

          config.faviconUrl = faviconUrl;
          config.faviconType = 'upload';
          config.lastUpdatedBy = req.user._id;
          await config.save();

          return res.json({
            message: 'Favicon actualizado',
            faviconUrl
          });
        } catch (error) {
          console.error('Error al subir favicon:', error);
          return res.status(500).json({ message: 'Error al subir favicon' });
        }
      });
    } else {
      try {
        const { faviconData, faviconUrl } = req.body;

        if (!faviconData && !faviconUrl) {
          return res.status(400).json({ message: 'Debe proporcionar faviconData (base64) o faviconUrl' });
        }

        let config = await AppConfig.findOne();
        if (!config) {
          config = new AppConfig();
        }

        if (faviconData) {
          const parsed = parseBase64Image(faviconData);
          if (!parsed) {
            return res.status(400).json({ message: 'Formato de favicon base64 inválido' });
          }

          const isPng = parsed.mimeSubtype === 'png';
          const isIco = parsed.mimeSubtype === 'x-icon' || parsed.mimeSubtype === 'vnd.microsoft.icon';

          if (!isPng && !isIco) {
            return res.status(400).json({ message: 'Solo se permiten favicon PNG o ICO' });
          }

          const buffer = Buffer.from(parsed.base64Data, 'base64');
          if (buffer.length > 256 * 1024) {
            return res.status(400).json({ message: 'El favicon es muy grande (máx 256KB)' });
          }

          const uploadDir = path.join(__dirname, '../../uploads/favicons');
          await fs.mkdir(uploadDir, { recursive: true });

          const ext = isPng ? 'png' : 'ico';
          const filename = `favicon-${Date.now()}.${ext}`;
          const filepath = path.join(uploadDir, filename);
          await fs.writeFile(filepath, buffer);

          config.faviconUrl = `/uploads/favicons/${filename}`;
          config.faviconType = 'upload';
        } else if (faviconUrl) {
          config.faviconUrl = faviconUrl;
          config.faviconType = 'external';
        }

        config.lastUpdatedBy = req.user._id;
        await config.save();

        return res.json({
          message: 'Favicon actualizado',
          faviconUrl: config.faviconUrl
        });
      } catch (error) {
        console.error('Error al guardar favicon:', error);
        return res.status(500).json({ message: 'Error al guardar favicon' });
      }
    }
  }
);

// DELETE /api/config/favicon - Eliminar favicon (admin)
router.delete('/favicon',
  authenticate,
  authorize('admin'),
  async (req, res) => {
    try {
      const config = await AppConfig.findOne();

      if (!config || !config.faviconUrl) {
        return res.json({ message: 'No hay favicon configurado' });
      }

      if (config.faviconType === 'upload' && config.faviconUrl.startsWith('/uploads/')) {
        const filepath = path.join(__dirname, '../..', config.faviconUrl);
        try {
          await fs.unlink(filepath);
        } catch (err) {
          console.warn('No se pudo eliminar favicon:', err.message);
        }
      }

      config.faviconUrl = '';
      config.faviconType = undefined;
      config.lastUpdatedBy = req.user._id;
      await config.save();

      return res.json({ message: 'Favicon eliminado' });
    } catch (error) {
      console.error('Error al eliminar favicon:', error);
      return res.status(500).json({ message: 'Error al eliminar favicon' });
    }
  }
);

// DEBUG: GET /api/config/debug/check - Verificar configuración actual (solo admin)
router.get('/debug/check', authenticate, authorize('admin'), async (req, res) => {
  try {
    const config = await AppConfig.findOne().select('emailReportConfig smtpConfig').lean();

    res.json({
      configExists: !!config,
      emailReportConfig: config?.emailReportConfig || null,
      smtpConfig: config?.smtpConfig ? {
        host: config.smtpConfig.host,
        port: config.smtpConfig.port,
        secure: config.smtpConfig.secure,
        user: config.smtpConfig.user ? '***' : 'NOT SET',
        pass: config.smtpConfig.pass ? '***' : 'NOT SET',
        from: config.smtpConfig.from
      } : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── MAIL-REM-043: CRUD de Recordatorios de Turno ─────────────────────────────
const shiftReminderCtrl = require('../controllers/shiftReminderController');
const { isMongoId } = require('express-validator');

const shiftReminderValidators = [
  body('label').notEmpty().trim().isLength({ max: 150 }).withMessage('Nombre obligatorio (máx 150)'),
  body('reminderText').notEmpty().trim().isLength({ max: 5000 }).withMessage('Texto obligatorio (máx 5000)'),
  body('frequencyType').optional().isIn(['hours', 'fixed']).withMessage('Tipo inválido'),
  body('intervalHours').optional().isInt({ min: 1, max: 24 }).toInt(),
  body('fixedTimes').optional().isArray({ max: 24 }),
  body('fixedTimes.*').optional().isString().trim().matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('Formato HH:MM requerido'),
  body('fixedTimes').custom((value, { req }) => {
    if ((req.body.frequencyType === 'fixed') && (!Array.isArray(value) || value.length === 0)) {
      throw new Error('Debes agregar al menos una hora cuando el tipo es \'Horas exactas\'');
    }
    return true;
  }),
  body('targetShiftIds').optional().isArray({ max: 50 }),
  body('targetShiftIds.*').optional().isMongoId().withMessage('ID de turno inválido'),
  body('enabled').optional().isBoolean()
];

router.get('/shift-reminders', authenticate, authorize('admin'), shiftReminderCtrl.list);
router.post('/shift-reminders', authenticate, authorize('admin'), shiftReminderValidators, validate, shiftReminderCtrl.create);
router.put('/shift-reminders/:id', authenticate, authorize('admin'), shiftReminderValidators, validate, shiftReminderCtrl.update);
router.delete('/shift-reminders/:id', authenticate, authorize('admin'), shiftReminderCtrl.remove);

module.exports = router;
