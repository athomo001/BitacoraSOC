/**
 * File Purpose: backend/src/utils/complement-publisher.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const unzipper = require('unzipper');
const { validateComplementSourceArchive } = require('./complement-source-validator');

const COMPLEMENT_UPLOADS_ROOT = path.join(__dirname, '../../uploads/complements');
const COMPLEMENT_PREVIEW_ROOT = path.join(COMPLEMENT_UPLOADS_ROOT, 'preview');
const COMPLEMENT_PUBLISHED_ROOT = path.join(COMPLEMENT_UPLOADS_ROOT, 'published');
const PREVIEW_RETENTION_HOURS = Math.max(1, Number(process.env.COMPLEMENT_PREVIEW_RETENTION_HOURS) || 24);
const PREVIEW_RETENTION_MS = PREVIEW_RETENTION_HOURS * 60 * 60 * 1000;

const resolveUploadsRelativePath = (relativePath = '') => {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized.includes('..')) {
    return null;
  }
  return path.join(path.join(__dirname, '../../uploads'), normalized);
};

const normalizeArchiveEntry = (entryPath) => String(entryPath || '')
  .replace(/\\/g, '/')
  .replace(/^\/+/, '')
  .trim();

const getCommonRootPrefix = (entries) => {
  const normalizedEntries = entries
    .map(normalizeArchiveEntry)
    .filter(Boolean);

  if (!normalizedEntries.length) {
    return '';
  }

  const firstSegments = normalizedEntries.map((entry) => entry.split('/')[0]).filter(Boolean);
  const uniqueFirstSegments = Array.from(new Set(firstSegments));
  const hasRootFiles = normalizedEntries.some((entry) => !entry.includes('/'));

  if (uniqueFirstSegments.length !== 1 || hasRootFiles) {
    return '';
  }

  return `${uniqueFirstSegments[0]}/`;
};

const assertArchivePathSafe = (entryPath) => {
  const normalized = normalizeArchiveEntry(entryPath);
  if (!normalized || normalized.includes('..')) {
    throw new Error('El ZIP contiene rutas inválidas o potencialmente peligrosas');
  }

  return normalized;
};

const ensureDirectory = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const listPreviewDirectories = async () => {
  await ensureDirectory(COMPLEMENT_PREVIEW_ROOT);
  const entries = await fs.readdir(COMPLEMENT_PREVIEW_ROOT, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
};

const cleanupPreviewArtifacts = async ({ slug, mode = 'stale' } = {}) => {
  const now = Date.now();
  const previewDirs = await listPreviewDirectories();
  let deletedCount = 0;

  for (const dirName of previewDirs) {
    const fullPath = path.join(COMPLEMENT_PREVIEW_ROOT, dirName);
    const isSlugMatch = slug ? dirName.startsWith(`${slug}-`) : true;

    if (mode === 'slug') {
      if (!isSlugMatch) {
        continue;
      }
      await fs.rm(fullPath, { recursive: true, force: true });
      deletedCount++;
      continue;
    }

    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats) {
      continue;
    }

    const isStale = (now - stats.mtimeMs) > PREVIEW_RETENTION_MS;
    if (isStale) {
      await fs.rm(fullPath, { recursive: true, force: true });
      deletedCount++;
    }
  }

  return deletedCount;
};

const writePlatformHealthFile = async (targetDir, slug) => {
  const healthPayload = {
    status: 'ok',
    managedByPlatform: true,
    slug,
    timestamp: new Date().toISOString()
  };

  await fs.writeFile(
    path.join(targetDir, 'health.json'),
    `${JSON.stringify(healthPayload, null, 2)}\n`,
    'utf8'
  );
};

const extractArchiveToDirectory = async (buffer, targetDir) => {
  const directory = await unzipper.Open.buffer(buffer);
  const fileEntries = directory.files.filter((file) => file.type === 'File');
  const rootPrefix = getCommonRootPrefix(fileEntries.map((file) => file.path));

  await fs.rm(targetDir, { recursive: true, force: true });
  await ensureDirectory(targetDir);

  for (const file of fileEntries) {
    const archivePath = assertArchivePathSafe(file.path);
    const relativePath = rootPrefix && archivePath.startsWith(rootPrefix)
      ? archivePath.slice(rootPrefix.length)
      : archivePath;

    if (!relativePath) {
      continue;
    }

    const destinationPath = path.join(targetDir, relativePath);
    const destinationDir = path.dirname(destinationPath);
    await ensureDirectory(destinationDir);
    await fs.writeFile(destinationPath, await file.buffer());
  }
};

const buildAppOrigin = (req) => {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const host = req.get('host');

  if (!host) {
    throw new Error('No se pudo determinar el origen público de la aplicación');
  }

  return `${protocol}://${host}`;
};

const buildPreviewTarget = (slug) => {
  const previewId = `${slug || 'complement'}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  return {
    previewId,
    targetDir: path.join(COMPLEMENT_PREVIEW_ROOT, previewId),
    relativeBasePath: `complements/preview/${previewId}`
  };
};

const buildPublishedTarget = (slug) => ({
  targetDir: path.join(COMPLEMENT_PUBLISHED_ROOT, slug),
  relativeBasePath: `complements/published/${slug}`
});

const buildHostedUrls = (req, relativeBasePath) => {
  const appOrigin = buildAppOrigin(req);
  const basePath = `/uploads/${relativeBasePath}/`;

  return {
    baseUrl: `${appOrigin}${basePath}`,
    iframeUrl: `${appOrigin}${basePath}index.html`,
    healthUrl: `${appOrigin}${basePath}health.json`,
    relativeBasePath
  };
};

const createStaticPreview = async (req, file, preferredSlug) => {
  const analysis = await validateComplementSourceArchive(file);
  if (!analysis.allowed || analysis.detectedStack?.key !== 'static-html') {
    throw new Error('Por ahora el preview automático solo está disponible para ZIP HTML/JS simple');
  }

  const slug = String(preferredSlug || analysis.suggestedConfig?.slug || 'complemento').trim().toLowerCase();
  // Mantener solo el preview más reciente por slug para evitar acumulación de artefactos temporales.
  await cleanupPreviewArtifacts({ slug, mode: 'slug' });
  const previewTarget = buildPreviewTarget(slug);
  await extractArchiveToDirectory(file.buffer, previewTarget.targetDir);
  await writePlatformHealthFile(previewTarget.targetDir, slug);

  const hosted = buildHostedUrls(req, previewTarget.relativeBasePath);
  return {
    analysis,
    previewUrl: hosted.iframeUrl,
    previewBaseUrl: hosted.baseUrl,
    previewRelativePath: previewTarget.relativeBasePath
  };
};

const publishStaticArchive = async (req, file, slug) => {
  // Limpieza preventiva de previews antiguos en cada publicación.
  await cleanupPreviewArtifacts({ mode: 'stale' });
  const publishTarget = buildPublishedTarget(slug);
  await extractArchiveToDirectory(file.buffer, publishTarget.targetDir);
  await writePlatformHealthFile(publishTarget.targetDir, slug);

  const hosted = buildHostedUrls(req, publishTarget.relativeBasePath);
  return {
    baseUrl: hosted.baseUrl,
    internalBaseUrl: hosted.baseUrl,
    iframePath: 'index.html',
    healthPath: 'health.json',
    publishedUrl: hosted.iframeUrl,
    publishedRelativePath: publishTarget.relativeBasePath
  };
};

const removePublishedArtifacts = async (sourceArtifact = {}) => {
  const relativePaths = [
    sourceArtifact.previewRelativePath,
    sourceArtifact.publishedRelativePath
  ].filter(Boolean);

  await Promise.all(relativePaths.map(async (relativePath) => {
    const targetDir = resolveUploadsRelativePath(relativePath);
    if (!targetDir) {
      return;
    }
    await fs.rm(targetDir, { recursive: true, force: true });
  }));
};

const removeAllComplementArtifacts = async ({ slug, sourceArtifact = {} } = {}) => {
  await removePublishedArtifacts(sourceArtifact);

  const normalizedSlug = String(slug || '').trim().toLowerCase();
  if (!normalizedSlug) {
    return;
  }

  // Publicado estable del complemento (ruta canónica de publicación)
  await fs.rm(path.join(COMPLEMENT_PUBLISHED_ROOT, normalizedSlug), { recursive: true, force: true });

  // Todos los previews históricos para el slug (previene residuos por múltiples previews)
  const previewDirs = await listPreviewDirectories().catch(() => []);
  await Promise.all(previewDirs
    .filter((dirName) => dirName.startsWith(`${normalizedSlug}-`))
    .map((dirName) => fs.rm(path.join(COMPLEMENT_PREVIEW_ROOT, dirName), { recursive: true, force: true })));
};

module.exports = {
  cleanupPreviewArtifacts,
  createStaticPreview,
  publishStaticArchive,
  removePublishedArtifacts,
  removeAllComplementArtifacts
};
