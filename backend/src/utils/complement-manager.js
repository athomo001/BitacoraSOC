const crypto = require('crypto');
const mongoose = require('mongoose');
const Complement = require('../models/Complement');
const Entry = require('../models/Entry');
const ComplementSharedRecord = require('../models/ComplementSharedRecord');
const { audit, auditSystem } = require('./audit');
const { assertOutboundUrlSafe } = require('./outbound-url-guard');
const { issueComplementToken } = require('./complement-token');
const { requestJson } = require('./complement-http');
const { probeComplementHealth, getCircuitState } = require('./complement-circuit-breaker');
const { removePublishedArtifacts } = require('./complement-publisher');

const PURGE_MODELS = [Entry, ComplementSharedRecord];

const COMPLEMENT_DB_PREFIX = 'bitacora_ext_';

const DEFAULT_LOCAL_COMPLEMENT_URLS = process.env.COMPLEMENT_ALLOW_PRIVATE_URLS !== 'false';

const sanitizeCollections = (collections = []) => Array.from(new Set(
  collections
    .map((value) => String(value || '').trim())
    .filter(Boolean)
));

const sanitizeScopes = (scopes = []) => Array.from(new Set(
  scopes
    .map((value) => String(value || '').trim())
    .filter(Boolean)
));

const sanitizeRoles = (roles = []) => Array.from(new Set(
  roles
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
));

const sanitizeCargoLabels = (cargoLabels = []) => Array.from(new Set(
  cargoLabels
    .map((value) => String(value || '').trim())
    .filter(Boolean)
));

const normalizeSourceArtifact = (sourceArtifact = {}) => ({
  sourceType: String(sourceArtifact.sourceType || 'manual').trim() || 'manual',
  stackKey: sourceArtifact.stackKey ? String(sourceArtifact.stackKey).trim() : null,
  originalFileName: sourceArtifact.originalFileName ? String(sourceArtifact.originalFileName).trim() : null,
  previewUrl: sourceArtifact.previewUrl ? String(sourceArtifact.previewUrl).trim() : null,
  previewRelativePath: sourceArtifact.previewRelativePath ? String(sourceArtifact.previewRelativePath).trim() : null,
  publishedUrl: sourceArtifact.publishedUrl ? String(sourceArtifact.publishedUrl).trim() : null,
  publishedRelativePath: sourceArtifact.publishedRelativePath ? String(sourceArtifact.publishedRelativePath).trim() : null,
  managedByPlatform: Boolean(sourceArtifact.managedByPlatform),
  lastPreviewAt: sourceArtifact.lastPreviewAt ? new Date(sourceArtifact.lastPreviewAt).toISOString() : null,
  publishedAt: sourceArtifact.publishedAt ? new Date(sourceArtifact.publishedAt).toISOString() : null
});

const assertComplementDbNameAllowed = (dbName) => {
  if (!String(dbName || '').startsWith(COMPLEMENT_DB_PREFIX)) {
    throw new Error('dbName inválido para wipe-out seguro');
  }
};

const buildDefaultComplementDbName = (slug) => {
  const normalizedSlug = String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-/g, '_');

  return `${COMPLEMENT_DB_PREFIX}${normalizedSlug || 'app'}`;
};

const resolveRuntimeBaseUrl = (complementOrPayload = {}) => String(complementOrPayload.internalBaseUrl || complementOrPayload.baseUrl || '').trim();

const validateComplementUrl = async (urlValue, options = {}) => {
  const allowPrivateHosts = options.allowPrivateHosts ?? DEFAULT_LOCAL_COMPLEMENT_URLS;
  await assertOutboundUrlSafe(urlValue, {
    requireHttps: options.requireHttps ?? !allowPrivateHosts,
    allowHttp: options.allowHttp ?? allowPrivateHosts,
    allowPrivateHosts
  });
};

const enforceComplementLimits = async () => {
  const maxDbs = Number(process.env.COMPLEMENT_MAX_DBS) || 5;
  const current = await Complement.countDocuments();
  if (current >= maxDbs) {
    throw new Error(`Se alcanzó el máximo de complementos permitidos (${maxDbs})`);
  }
};

const normalizeComplementPayload = (body = {}) => ({
  slug: String(body.slug || '').trim().toLowerCase(),
  name: String(body.name || '').trim(),
  baseUrl: String(body.baseUrl || '').trim(),
  internalBaseUrl: String(body.internalBaseUrl || '').trim(),
  dbName: String(body.dbName || buildDefaultComplementDbName(body.slug)).trim(),
  apiVersion: String(body.apiVersion || 'v1').trim() || 'v1',
  status: String(body.status || 'active').trim() || 'active',
  cleanupHookPath: String(body.cleanupHookPath || '/hook/cleanup').trim() || '/hook/cleanup',
  healthPath: String(body.healthPath || '/health').trim() || '/health',
  iframePath: String(body.iframePath || '/').trim() || '/',
  permissions: {
    scopes: sanitizeScopes(body.permissions?.scopes || []),
    allowedCollections: sanitizeCollections(body.permissions?.allowedCollections || [])
  },
  visibility: {
    roles: sanitizeRoles(body.visibility?.roles || []),
    cargoLabels: sanitizeCargoLabels(body.visibility?.cargoLabels || [])
  },
  sourceArtifact: normalizeSourceArtifact(body.sourceArtifact || {}),
  metadata: typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : {}
});

const getComplementSummary = (complement) => {
  // Para zip-static usar ruta relativa para que funcione en cualquier origen (dev:4200, Docker:80, HTTPS:443)
  const iframeUrl = (complement.sourceArtifact?.sourceType === 'zip-static' && complement.sourceArtifact?.publishedRelativePath)
    ? `/uploads/${complement.sourceArtifact.publishedRelativePath}/index.html`
    : new URL(complement.iframePath || '/', complement.baseUrl).toString();

  return {
    _id: complement._id,
    slug: complement.slug,
    name: complement.name,
    baseUrl: complement.baseUrl,
    internalBaseUrl: complement.internalBaseUrl || '',
    iframeUrl,
    dbName: complement.dbName,
    apiVersion: complement.apiVersion,
    status: complement.status,
    cleanupHookPath: complement.cleanupHookPath,
    healthPath: complement.healthPath,
    permissions: complement.permissions,
    visibility: complement.visibility || { roles: [], cargoLabels: [] },
    sourceArtifact: complement.sourceArtifact || null,
    metadata: complement.metadata || {},
    lastTokenIssuedAt: complement.lastTokenIssuedAt,
    circuit: getCircuitState(complement.slug),
    createdAt: complement.createdAt,
    updatedAt: complement.updatedAt
  };
};

const isComplementVisibleToUser = (complement, user) => {
  if (!user) {
    return false;
  }

  if (user.role === 'admin') {
    return true;
  }

  const allowedRoles = sanitizeRoles(complement.visibility?.roles || []);
  const allowedCargoLabels = sanitizeCargoLabels(complement.visibility?.cargoLabels || [])
    .map((value) => value.toLowerCase());

  if (allowedRoles.length === 0 && allowedCargoLabels.length === 0) {
    return true;
  }

  if (allowedRoles.includes(String(user.role || '').trim().toLowerCase())) {
    return true;
  }

  const userCargoLabel = String(user.cargoLabel || '').trim().toLowerCase();
  return Boolean(userCargoLabel) && allowedCargoLabels.includes(userCargoLabel);
};

const createComplement = async (req, payload) => {
  await enforceComplementLimits();
  assertComplementDbNameAllowed(payload.dbName);
  await validateComplementUrl(payload.baseUrl);
  if (payload.internalBaseUrl) {
    await validateComplementUrl(payload.internalBaseUrl, {
      requireHttps: false,
      allowHttp: true,
      allowPrivateHosts: true
    });
  }

  let complement;
  let issued;
  try {
    complement = await Complement.create(payload);
    issued = issueComplementToken(complement);
    complement.tokenHash = issued.tokenHash;
    complement.lastTokenIssuedAt = new Date();
    await complement.save();
  } catch (error) {
    if (complement?._id) {
      await Complement.deleteOne({ _id: complement._id }).catch(() => undefined);
    }
    throw error;
  }

  await audit(req, {
    event: 'complement.install',
    level: 'info',
    source: 'complement',
    sourceId: complement.slug,
    result: { success: true },
    metadata: {
      slug: complement.slug,
      baseUrl: complement.baseUrl,
      internalBaseUrl: complement.internalBaseUrl || null,
      dbName: complement.dbName,
      scopes: complement.permissions?.scopes || [],
      visibility: complement.visibility || { roles: [], cargoLabels: [] }
    }
  });

  return {
    complement,
    token: issued.token,
    expiresAt: issued.expiresAt
  };
};

const regenerateComplementToken = async (req, complement) => {
  const issued = issueComplementToken(complement);
  complement.tokenHash = issued.tokenHash;
  complement.lastTokenIssuedAt = new Date();
  await complement.save();

  await audit(req, {
    event: 'complement.update.permissions',
    level: 'info',
    source: 'complement',
    sourceId: complement.slug,
    result: { success: true },
    metadata: {
      slug: complement.slug,
      changedFields: ['tokenHash', 'lastTokenIssuedAt']
    }
  });

  return issued;
};

const updateComplement = async (req, complement, payload) => {
  await validateComplementUrl(payload.baseUrl);
  if (payload.internalBaseUrl) {
    await validateComplementUrl(payload.internalBaseUrl, {
      requireHttps: false,
      allowHttp: true,
      allowPrivateHosts: true
    });
  }
  assertComplementDbNameAllowed(payload.dbName);

  const changedFields = [];
  ['name', 'baseUrl', 'internalBaseUrl', 'dbName', 'apiVersion', 'status', 'cleanupHookPath', 'healthPath', 'iframePath', 'metadata']
    .forEach((field) => {
      if (JSON.stringify(complement[field]) !== JSON.stringify(payload[field])) {
        complement[field] = payload[field];
        changedFields.push(field);
      }
    });

  if (JSON.stringify(complement.permissions || {}) !== JSON.stringify(payload.permissions || {})) {
    complement.permissions = payload.permissions;
    changedFields.push('permissions');
  }

  if (JSON.stringify(complement.visibility || {}) !== JSON.stringify(payload.visibility || {})) {
    complement.visibility = payload.visibility;
    changedFields.push('visibility');
  }

  if (JSON.stringify(complement.sourceArtifact || {}) !== JSON.stringify(payload.sourceArtifact || {})) {
    complement.sourceArtifact = payload.sourceArtifact;
    changedFields.push('sourceArtifact');
  }

  await complement.save();

  await audit(req, {
    event: changedFields.includes('permissions') ? 'complement.update.permissions' : 'complement.update.config',
    level: 'info',
    source: 'complement',
    sourceId: complement.slug,
    result: { success: true },
    metadata: {
      slug: complement.slug,
      changedFields
    }
  });

  return complement;
};

const runCleanupHook = async (complement) => {
  if (complement.sourceArtifact?.managedByPlatform) {
    return;
  }

  const hookUrl = new URL(complement.cleanupHookPath || '/hook/cleanup', resolveRuntimeBaseUrl(complement)).toString();
  try {
    const response = await requestJson(hookUrl, {
      method: 'POST',
      timeoutMs: 5000,
      body: {
        slug: complement.slug,
        reason: 'DELETE_COMPLEMENTO'
      }
    });

    await auditSystem({
      event: 'complement.wipe.hook_sent',
      level: 'info',
      source: 'complement',
      sourceId: complement.slug,
      result: { success: response.statusCode < 500, reason: `HTTP ${response.statusCode}` },
      metadata: {
        slug: complement.slug,
        hookUrl,
        responseStatus: response.statusCode
      },
      actor: {
        username: `complement:${complement.slug}`,
        role: 'complement'
      }
    });
  } catch (error) {
    await auditSystem({
      event: 'complement.wipe.hook_timeout',
      level: 'warn',
      source: 'complement',
      sourceId: complement.slug,
      result: { success: false, reason: error.message },
      metadata: {
        slug: complement.slug,
        hookUrl,
        timeoutMs: 5000
      },
      actor: {
        username: `complement:${complement.slug}`,
        role: 'complement'
      }
    });
  }
};

const dropComplementDatabase = async (complement) => {
  assertComplementDbNameAllowed(complement.dbName);
  const privateDb = mongoose.connection.client.db(complement.dbName);
  await privateDb.dropDatabase();
  await auditSystem({
    event: 'complement.wipe.db_dropped',
    level: 'warn',
    source: 'complement',
    sourceId: complement.slug,
    result: { success: true },
    metadata: {
      slug: complement.slug,
      dbName: complement.dbName
    },
    actor: {
      username: `complement:${complement.slug}`,
      role: 'complement'
    }
  });
  return privateDb;
};

const purgeGeneralData = async (complement) => {
  const collectionsAffected = [];
  let docsRemoved = 0;

  for (const Model of PURGE_MODELS) {
    if (!Model.schema.path('ownerComplementId')) {
      continue;
    }

    const result = await Model.deleteMany({ ownerComplementId: complement.slug });
    const removed = result.deletedCount || 0;
    if (removed > 0) {
      collectionsAffected.push(Model.collection.collectionName);
      docsRemoved += removed;
    }
  }

  await auditSystem({
    event: 'complement.wipe.general_purged',
    level: 'warn',
    source: 'complement',
    sourceId: complement.slug,
    result: { success: true },
    metadata: {
      slug: complement.slug,
      collectionsAffected,
      docsRemoved
    },
    actor: {
      username: `complement:${complement.slug}`,
      role: 'complement'
    }
  });

  return { collectionsAffected, docsRemoved };
};

const verifyWipeOut = async (complement, privateDb) => {
  const orphanCollections = [];
  const collections = await privateDb.listCollections().toArray();
  if (collections.length > 0) {
    orphanCollections.push(...collections.map((item) => item.name));
  }

  const generalOrphans = [];
  for (const Model of PURGE_MODELS) {
    if (!Model.schema.path('ownerComplementId')) {
      continue;
    }

    const count = await Model.countDocuments({ ownerComplementId: complement.slug });
    if (count > 0) {
      generalOrphans.push(`${Model.collection.collectionName}:${count}`);
    }
  }

  if (orphanCollections.length || generalOrphans.length) {
    await auditSystem({
      event: 'complement.wipe.orphans_detected',
      level: 'error',
      source: 'complement',
      sourceId: complement.slug,
      result: { success: false, reason: 'Artefactos remanentes tras wipe-out' },
      metadata: {
        slug: complement.slug,
        orphanCollections: [...orphanCollections, ...generalOrphans]
      },
      actor: {
        username: `complement:${complement.slug}`,
        role: 'complement'
      }
    });
  }
};

const deleteComplement = async (req, complement, reason) => {
  await audit(req, {
    event: 'complement.delete.initiated',
    level: 'warn',
    source: 'complement',
    sourceId: complement.slug,
    result: { success: true },
    metadata: {
      slug: complement.slug,
      adminId: req.user?._id,
      reason
    }
  });

  await runCleanupHook(complement);

  let privateDb;
  try {
    privateDb = await dropComplementDatabase(complement);
  } catch (error) {
    await audit(req, {
      event: 'complement.delete.completed',
      level: 'error',
      source: 'complement',
      sourceId: complement.slug,
      result: { success: false, reason: error.message },
      metadata: {
        slug: complement.slug,
        reason,
        phase: 'dropDatabase'
      }
    });
    throw error;
  }

  await purgeGeneralData(complement);
  await removePublishedArtifacts(complement.sourceArtifact || {});
  await Complement.deleteOne({ _id: complement._id });
  await verifyWipeOut(complement, privateDb);

  await audit(req, {
    event: 'complement.delete.completed',
    level: 'warn',
    source: 'complement',
    sourceId: complement.slug,
    result: { success: true },
    metadata: {
      slug: complement.slug,
      adminId: req.user?._id,
      reason
    }
  });
};

const testComplement = async (complement, requestId) => {
  const circuit = await probeComplementHealth(complement, { force: true, requestId });
  return {
    circuit,
    healthUrl: new URL(complement.healthPath || '/health', resolveRuntimeBaseUrl(complement)).toString()
  };
};

module.exports = {
  createComplement,
  deleteComplement,
  getComplementSummary,
  isComplementVisibleToUser,
  normalizeComplementPayload,
  regenerateComplementToken,
  testComplement,
  updateComplement
};