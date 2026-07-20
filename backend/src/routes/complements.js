/**
 * File Purpose: backend/src/routes/complements.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const Complement = require('../models/Complement');
const ComplementSharedRecord = require('../models/ComplementSharedRecord');
const { authenticate, authorize } = require('../middleware/auth');
const { validateSchema } = require('../utils/complement-schema-validator');
const {
  getComplementSourceLimits,
  validateComplementSourceArchive
} = require('../utils/complement-source-validator');
const {
  createStaticPreview,
  publishStaticArchive
} = require('../utils/complement-publisher');
const {
  createComplement,
  deleteComplement,
  getComplementSummary,
  isComplementVisibleToUser,
  normalizeComplementPayload,
  regenerateComplementToken,
  testComplement,
  updateComplement
} = require('../utils/complement-manager');
const { audit } = require('../utils/audit');
const { logger } = require('../utils/logger');

const router = express.Router();

const complementAdminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false
});

const complementDeleteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false
});

const complementSourceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: getComplementSourceLimits().maxArchiveBytes },
  fileFilter: (_req, file, cb) => {
    const isZip = file.mimetype === 'application/zip'
      || file.mimetype === 'application/x-zip-compressed'
      || /\.zip$/i.test(file.originalname || '');

    if (!isZip) {
      return cb(new Error('Solo se permiten archivos ZIP de código fuente'));
    }

    cb(null, true);
  }
});

router.get('/active', authenticate, async (req, res) => {
  const complements = await Complement.find({ status: { $in: ['active', 'maintenance'] } }).sort({ name: 1 });
  const visibleComplements = complements.filter((complement) => isComplementVisibleToUser(complement, req.user));

  // QA: No auditar la lectura automática del listado de complementos activos en la carga del layout para evitar inundación de logs basura

  res.json(visibleComplements.map(getComplementSummary));
});

router.get('/:slug/browser-state', authenticate, async (req, res) => {
  const complement = await Complement.findOne({ slug: req.params.slug, status: { $in: ['active', 'maintenance'] } });
  if (!complement) {
    return res.status(404).json({ message: 'Complemento no encontrado' });
  }

  if (!isComplementVisibleToUser(complement, req.user)) {
    return res.status(403).json({ message: 'No tienes acceso a este complemento' });
  }

  const record = await ComplementSharedRecord.findOne({
    ownerComplementId: complement.slug,
    key: 'browser-state'
  }).lean();

  return res.json({
    slug: complement.slug,
    value: record?.value || null,
    updatedAt: record?.updatedAt || null
  });
});

router.put('/:slug/browser-state', authenticate, async (req, res) => {
  const complement = await Complement.findOne({ slug: req.params.slug, status: { $in: ['active', 'maintenance'] } });
  if (!complement) {
    return res.status(404).json({ message: 'Complemento no encontrado' });
  }

  if (!isComplementVisibleToUser(complement, req.user)) {
    return res.status(403).json({ message: 'No tienes acceso a este complemento' });
  }

  const value = req.body?.value;
  const record = await ComplementSharedRecord.findOneAndUpdate(
    {
      ownerComplementId: complement.slug,
      key: 'browser-state'
    },
    {
      ownerComplementId: complement.slug,
      collectionName: 'browser_state',
      key: 'browser-state',
      value,
      metadata: {
        updatedByUserId: req.user?._id || null,
        updatedByUsername: req.user?.username || null,
        updatedVia: 'complement-browser-state'
      }
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  ).lean();

  return res.json({
    slug: complement.slug,
    value: record.value,
    updatedAt: record.updatedAt || null
  });
});

router.get('/source/limits', authenticate, authorize('admin'), complementAdminLimiter, async (_req, res) => {
  res.json(getComplementSourceLimits());
});

router.post('/source/validate', authenticate, authorize('admin'), complementAdminLimiter, (req, res) => {
  complementSourceUpload.single('archive')(req, res, async (error) => {
    if (error) {
      return res.status(400).json({ message: error.message || 'No se pudo procesar el archivo' });
    }

    try {
      const result = await validateComplementSourceArchive(req.file);
      return res.json(result);
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message || 'No se pudo validar el paquete' });
    }
  });
});

router.post('/source/preview', authenticate, authorize('admin'), complementAdminLimiter, (req, res) => {
  complementSourceUpload.single('archive')(req, res, async (error) => {
    if (error) {
      return res.status(400).json({ message: error.message || 'No se pudo procesar el archivo' });
    }

    try {
      const payload = req.body?.config ? JSON.parse(req.body.config) : {};
      const preview = await createStaticPreview(req, req.file, payload.slug);
      return res.json(preview);
    } catch (previewError) {
      return res.status(400).json({ message: previewError.message || 'No se pudo generar el preview' });
    }
  });
});

router.post('/source/publish', authenticate, authorize('admin'), complementAdminLimiter, (req, res) => {
  complementSourceUpload.single('archive')(req, res, async (error) => {
    if (error) {
      return res.status(400).json({ message: error.message || 'No se pudo procesar el archivo' });
    }

    try {
      const requestedConfig = req.body?.config ? JSON.parse(req.body.config) : {};
      const analysis = await validateComplementSourceArchive(req.file);
      if (!analysis.allowed || analysis.detectedStack?.key !== 'static-html') {
        return res.status(400).json({ message: 'Por ahora la publicación automática solo soporta ZIP HTML/JS simple' });
      }

      const basePayload = normalizeComplementPayload({
        ...analysis.suggestedConfig,
        ...requestedConfig,
        sourceArtifact: {
          ...(requestedConfig?.sourceArtifact || {}),
          sourceType: 'zip-static',
          stackKey: analysis.detectedStack?.key || 'static-html',
          originalFileName: req.file?.originalname || null,
          managedByPlatform: true,
          lastPreviewAt: requestedConfig?.sourceArtifact?.lastPreviewAt || null,
          publishedAt: new Date().toISOString()
        }
      });

      const publishedArtifact = await publishStaticArchive(req, req.file, basePayload.slug);
      const finalPayload = normalizeComplementPayload({
        ...basePayload,
        baseUrl: publishedArtifact.baseUrl,
        internalBaseUrl: publishedArtifact.internalBaseUrl,
        iframePath: publishedArtifact.iframePath,
        healthPath: publishedArtifact.healthPath,
        cleanupHookPath: '/hook/cleanup',
        sourceArtifact: {
          ...basePayload.sourceArtifact,
          publishedUrl: publishedArtifact.publishedUrl,
          publishedRelativePath: publishedArtifact.publishedRelativePath,
          managedByPlatform: true,
          publishedAt: new Date().toISOString()
        }
      });

      const existingComplement = await Complement.findOne({ slug: finalPayload.slug });
      if (existingComplement) {
        const updated = await updateComplement(req, existingComplement, {
          ...finalPayload,
          sourceArtifact: {
            ...finalPayload.sourceArtifact,
            previewUrl: existingComplement.sourceArtifact?.previewUrl || finalPayload.sourceArtifact.previewUrl || null,
            previewRelativePath: existingComplement.sourceArtifact?.previewRelativePath || finalPayload.sourceArtifact.previewRelativePath || null,
            lastPreviewAt: existingComplement.sourceArtifact?.lastPreviewAt || finalPayload.sourceArtifact.lastPreviewAt || null
          }
        });

        return res.json({
          mode: 'updated',
          complement: getComplementSummary(updated),
          publishedUrl: publishedArtifact.publishedUrl
        });
      }

      const created = await createComplement(req, finalPayload);
      return res.status(201).json({
        mode: 'created',
        complement: getComplementSummary(created.complement),
        token: created.token,
        expiresAt: created.expiresAt,
        publishedUrl: publishedArtifact.publishedUrl
      });
    } catch (publishError) {
      return res.status(400).json({ message: publishError.message || 'No se pudo publicar el paquete' });
    }
  });
});

router.get('/:slug', authenticate, async (req, res) => {
  const query = req.user?.role === 'admin'
    ? { slug: req.params.slug }
    : { slug: req.params.slug, status: { $in: ['active', 'maintenance'] } };

  const complement = await Complement.findOne(query);
  if (!complement) {
    return res.status(404).json({ message: 'Complemento no encontrado' });
  }

  if (!isComplementVisibleToUser(complement, req.user)) {
    return res.status(403).json({ message: 'No tienes acceso a este complemento' });
  }

  await audit(req, {
    event: 'complement.detail.view',
    result: { success: true },
    source: 'complement',
    sourceId: complement.slug,
    metadata: {
      slug: complement.slug,
      status: complement.status,
      role: req.user?.role || 'unknown'
    }
  }).catch((auditError) => {
    logger.warn({ err: auditError }, 'No se pudo registrar auditoría de detalle de complemento');
  });

  res.json(getComplementSummary(complement));
});

router.use(authenticate, authorize('admin'), complementAdminLimiter);

router.get('/', async (_req, res) => {
  const complements = await Complement.find().sort({ createdAt: -1 });
  res.json(complements.map(getComplementSummary));
});

router.post('/', async (req, res) => {
  const payload = normalizeComplementPayload(req.body);
  const validation = validateSchema('complement.schema.json', payload);
  if (!validation.valid) {
    return res.status(400).json({ message: 'Payload de complemento inválido', errors: validation.errors });
  }

  const created = await createComplement(req, payload);
  res.status(201).json({
    complement: getComplementSummary(created.complement),
    token: created.token,
    expiresAt: created.expiresAt
  });
});

router.put('/:slug', async (req, res) => {
  const complement = await Complement.findOne({ slug: req.params.slug });
  if (!complement) {
    return res.status(404).json({ message: 'Complemento no encontrado' });
  }

  const payload = normalizeComplementPayload({ ...complement.toObject(), ...req.body, slug: complement.slug });
  const validation = validateSchema('complement.schema.json', payload);
  if (!validation.valid) {
    return res.status(400).json({ message: 'Payload de complemento inválido', errors: validation.errors });
  }

  const updated = await updateComplement(req, complement, payload);
  res.json(getComplementSummary(updated));
});

router.post('/:slug/test', async (req, res) => {
  const complement = await Complement.findOne({ slug: req.params.slug });
  if (!complement) {
    return res.status(404).json({ message: 'Complemento no encontrado' });
  }

  const result = await testComplement(complement, req.requestId);
  res.json({
    slug: complement.slug,
    ...result
  });
});

router.post('/:slug/token', async (req, res) => {
  const complement = await Complement.findOne({ slug: req.params.slug });
  if (!complement) {
    return res.status(404).json({ message: 'Complemento no encontrado' });
  }

  const issued = await regenerateComplementToken(req, complement);
  res.json({
    slug: complement.slug,
    token: issued.token,
    expiresAt: issued.expiresAt
  });
});

router.delete('/:slug', complementDeleteLimiter, async (req, res) => {
  const complement = await Complement.findOne({ slug: req.params.slug });
  if (!complement) {
    return res.status(404).json({ message: 'Complemento no encontrado' });
  }

  await deleteComplement(req, complement, String(req.body?.reason || 'DELETE_COMPLEMENTO').trim() || 'DELETE_COMPLEMENTO');
  res.json({ message: 'Complemento eliminado con wipe-out completo' });
});

module.exports = router;