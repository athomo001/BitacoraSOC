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
    const targetDir = path.join(path.join(__dirname, '../../uploads'), relativePath);
    await fs.rm(targetDir, { recursive: true, force: true });
  }));
};

module.exports = {
  createStaticPreview,
  publishStaticArchive,
  removePublishedArtifacts
};