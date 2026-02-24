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
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|svg\+xml/;
    const mimeType = allowedTypes.test(file.mimetype);
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

    if (mimeType && extname) {
      return cb(null, true);
    }
    cb(new Error('Solo se permiten imágenes (jpg, png, svg)'));
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
        checklistAlertEnabled: true,
        checklistAlertTime: '09:30'
      });
    }

    res.json(config);
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
    body('checklistAlertEnabled').optional().isBoolean(),
    body('checklistAlertTime').optional().matches(/^\d{2}:\d{2}$/).withMessage('Formato de hora inválido (HH:mm)'),
    body('logoUrl').optional().trim(),
    body('faviconUrl').optional().trim(),
    body('defaultLogSourceId').optional({ checkFalsy: true }).isMongoId().withMessage('ID de LogSource inválido'),
    body('emailReportConfig.enabled').optional().isBoolean(),
    body('emailReportConfig.recipients').optional().isArray(),
    body('emailReportConfig.includeChecklist').optional().isBoolean(),
    body('emailReportConfig.includeEntries').optional().isBoolean(),
    body('emailReportConfig.subjectTemplate').optional().trim(),
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

      if (!config) {
        config = new AppConfig(req.body);
      } else {
        Object.assign(config, req.body);
      }

      config.lastUpdatedBy = req.user._id;
      await config.save();

      // Invalidar cache de SMTP si se actualizó
      if (req.body.smtpConfig) {
        invalidateCache();
      }

      // Populate defaultLogSourceId para retornar nombre
      await config.populate('defaultLogSourceId', 'name enabled');

      res.json({ message: 'Configuración actualizada', config });
    } catch (error) {
      console.error('Error al actualizar config:', error);
      res.status(500).json({ message: 'Error al actualizar configuración' });
    }
  }
);

// GET /api/config/logo - Obtener logo actual (PÚBLICO - para mostrar en login)
router.get('/logo', async (req, res) => {
  try {
    const config = await AppConfig.findOne();
    
    if (!config || !config.logoUrl) {
      return res.json({ logoUrl: '' });
    }

    // Devolver ruta relativa - el navegador la resolverá automáticamente
    res.json({ logoUrl: config.logoUrl });
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

          // Validar tamaño (2MB máx)
          if (buffer.length > 2 * 1024 * 1024) {
            return res.status(400).json({ message: 'La imagen es muy grande (máx 2MB)' });
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

module.exports = router;
