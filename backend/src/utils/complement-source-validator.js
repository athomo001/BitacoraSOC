/**
 * File Purpose: backend/src/utils/complement-source-validator.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const path = require('path');
const unzipper = require('unzipper');

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 200;
const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_PACKAGE_JSON_BYTES = 256 * 1024;

const BLOCKED_EXTENSIONS = {
  '.py': 'Python',
  '.java': 'Java',
  '.cs': 'C#/.NET',
  '.go': 'Go',
  '.php': 'PHP',
  '.rb': 'Ruby',
  '.rs': 'Rust',
  '.kt': 'Kotlin',
  '.swift': 'Swift'
};

const SUPPORTED_STACKS = {
  'static-html': {
    key: 'static-html',
    label: 'HTML/JS simple',
    description: 'Complemento de frontend estático con index.html y scripts propios.',
    runtime: 'iframe',
    recommendedPermissions: {
      scopes: ['READ_CONTEXT', 'WRITE_LOGS'],
      allowedCollections: ['auditlogs']
    }
  },
  'vite-frontend': {
    key: 'vite-frontend',
    label: 'Frontend Vite',
    description: 'Proyecto frontend empaquetado con Vite para ejecutarse como iframe.',
    runtime: 'build+iframe',
    recommendedPermissions: {
      scopes: ['READ_CONTEXT', 'WRITE_LOGS', 'READ_STORAGE', 'WRITE_STORAGE'],
      allowedCollections: ['auditlogs', 'shared_storage']
    }
  },
  'react-vite': {
    key: 'react-vite',
    label: 'React + Vite',
    description: 'Aplicación React que se publica como interfaz de complemento.',
    runtime: 'build+iframe',
    recommendedPermissions: {
      scopes: ['READ_CONTEXT', 'WRITE_LOGS', 'READ_STORAGE', 'WRITE_STORAGE'],
      allowedCollections: ['auditlogs', 'shared_storage']
    }
  },
  'node-service': {
    key: 'node-service',
    label: 'Node.js service',
    description: 'Servicio Node/Express más apropiado para casos avanzados o Docker.',
    runtime: 'service',
    recommendedPermissions: {
      scopes: ['READ_CONTEXT', 'WRITE_LOGS', 'WRITE_ENTRIES', 'READ_STORAGE', 'WRITE_STORAGE'],
      allowedCollections: ['auditlogs', 'entries', 'shared_storage']
    }
  }
};

const getComplementSourceLimits = () => ({
  maxArchiveBytes: MAX_ARCHIVE_BYTES,
  maxArchiveMb: Math.round(MAX_ARCHIVE_BYTES / (1024 * 1024)),
  maxFiles: MAX_ARCHIVE_FILES,
  maxUncompressedBytes: MAX_UNCOMPRESSED_BYTES,
  maxUncompressedMb: Math.round(MAX_UNCOMPRESSED_BYTES / (1024 * 1024)),
  acceptedExtensions: ['.zip'],
  supportedLanguageSummary: [
    'HTML + JavaScript',
    'TypeScript + JavaScript empaquetado con Vite',
    'React + Vite',
    'Node.js/Express'
  ],
  unsupportedPolicy: 'Cualquier paquete fuera de esos stacks se rechaza, aunque no aparezca nombrado explícitamente en la lista de ejemplos.',
  supportedStacks: Object.values(SUPPORTED_STACKS),
  blockedLanguages: Object.values(BLOCKED_EXTENSIONS),
  notes: [
    'Por ahora solo se analiza y valida el paquete; el despliegue automático vendrá en la siguiente etapa.',
    'El camino recomendado para admins es subir un ZIP de frontend simple o Vite/React.',
    'Servicios Node siguen siendo posibles, pero son un caso más avanzado.',
    'La lista de lenguajes bloqueados muestra ejemplos frecuentes, no un catálogo exhaustivo de todo lo que será rechazado.'
  ]
});

const normalizeEntryName = (value) => String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');

const slugify = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/^@/, '')
  .replace(/\//g, '-')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 32);

const titleizeName = (value) => String(value || '')
  .replace(/[-_]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (char) => char.toUpperCase());

const hasFile = (entries, fileName) => entries.includes(fileName);
const hasAny = (entries, candidates) => candidates.some((candidate) => hasFile(entries, candidate));

const buildSuggestedConfig = (stack, packageJson, entries) => {
  const rawName = packageJson?.name || path.basename(entries[0] || 'complement');
  const slug = slugify(rawName || 'complement');
  const stackConfig = SUPPORTED_STACKS[stack] || SUPPORTED_STACKS['static-html'];

  return {
    slug,
    name: titleizeName(packageJson?.displayName || packageJson?.name || slug || 'Complemento'),
    dbName: `bitacora_ext_${(slug || 'app').replace(/-/g, '_')}`,
    apiVersion: 'v2',
    status: 'active',
    healthPath: stack === 'node-service' ? '/health' : '/health',
    cleanupHookPath: '/hook/cleanup',
    iframePath: '/',
    permissions: stackConfig.recommendedPermissions
  };
};

const detectBlockedLanguage = (entries) => {
  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (BLOCKED_EXTENSIONS[ext]) {
      return {
        allowed: false,
        stack: null,
        language: BLOCKED_EXTENSIONS[ext],
        reason: `Se detectó ${BLOCKED_EXTENSIONS[ext]}. En esta primera etapa solo se permiten complementos web/Node empaquetados en ZIP.`
      };
    }
  }

  return null;
};

const detectStack = (entries, packageJson) => {
  const blocked = detectBlockedLanguage(entries);
  if (blocked) {
    return blocked;
  }

  const dependencies = {
    ...(packageJson?.dependencies || {}),
    ...(packageJson?.devDependencies || {})
  };

  const hasIndexHtml = hasFile(entries, 'index.html') || entries.some((entry) => entry.endsWith('/index.html'));
  const hasViteConfig = hasAny(entries, ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs']);
  const hasReact = Boolean(dependencies.react || dependencies['react-dom']);
  const hasPackageJson = Boolean(packageJson);
  const hasNodeEntry = hasAny(entries, ['server.js', 'index.js', 'app.js', 'src/server.js', 'src/index.js']);
  const hasExpress = Boolean(dependencies.express);
  const hasSrcMain = entries.some((entry) => /^src\/main\.(js|ts|jsx|tsx)$/.test(entry));

  if (hasPackageJson && hasViteConfig && hasReact && hasSrcMain) {
    return { allowed: true, stack: 'react-vite', language: 'TypeScript/JavaScript', reason: 'Proyecto React con Vite detectado.' };
  }

  if (hasPackageJson && hasViteConfig && hasSrcMain) {
    return { allowed: true, stack: 'vite-frontend', language: 'TypeScript/JavaScript', reason: 'Frontend Vite detectado.' };
  }

  if (hasPackageJson && (hasNodeEntry || hasExpress)) {
    return { allowed: true, stack: 'node-service', language: 'JavaScript/Node.js', reason: 'Servicio Node.js detectado.' };
  }

  if (hasIndexHtml) {
    return { allowed: true, stack: 'static-html', language: 'HTML/JavaScript', reason: 'Complemento estático detectado.' };
  }

  return {
    allowed: false,
    stack: null,
    language: hasPackageJson ? 'JavaScript/TypeScript' : 'Desconocido',
    reason: 'No se pudo detectar un stack permitido. Solo se aceptan paquetes HTML/JS simples, Vite, React + Vite o Node.js.'
  };
};

const inspectArchive = async (buffer) => {
  const directory = await unzipper.Open.buffer(buffer);
  const files = directory.files.filter((file) => file.type === 'File');

  if (!files.length) {
    throw new Error('El ZIP no contiene archivos válidos');
  }

  if (files.length > MAX_ARCHIVE_FILES) {
    throw new Error(`El ZIP supera el máximo permitido de ${MAX_ARCHIVE_FILES} archivos`);
  }

  let totalUncompressedBytes = 0;
  const entries = [];
  let packageJson = null;

  for (const file of files) {
    const normalized = normalizeEntryName(file.path);
    if (!normalized || normalized.endsWith('/')) {
      continue;
    }

    totalUncompressedBytes += Number(file.uncompressedSize || 0);
    if (totalUncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new Error(`El ZIP supera el máximo descomprimido permitido de ${Math.round(MAX_UNCOMPRESSED_BYTES / (1024 * 1024))} MB`);
    }

    entries.push(normalized);

    if (normalized === 'package.json' && Number(file.uncompressedSize || 0) <= MAX_PACKAGE_JSON_BYTES) {
      try {
        packageJson = JSON.parse((await file.buffer()).toString('utf8'));
      } catch {
        packageJson = null;
      }
    }
  }

  const detection = detectStack(entries, packageJson);
  const stackConfig = detection.stack ? SUPPORTED_STACKS[detection.stack] : null;

  return {
    allowed: detection.allowed,
    detectedStack: stackConfig,
    detectedLanguage: detection.language,
    reason: detection.reason,
    packageJson: packageJson ? {
      name: packageJson.name || '',
      version: packageJson.version || '',
      scripts: Object.keys(packageJson.scripts || {}),
      dependencies: Object.keys(packageJson.dependencies || {}),
      devDependencies: Object.keys(packageJson.devDependencies || {})
    } : null,
    archive: {
      fileCount: entries.length,
      totalUncompressedBytes,
      sampleFiles: entries.slice(0, 20)
    },
    limits: getComplementSourceLimits(),
    suggestedConfig: detection.allowed && detection.stack ? buildSuggestedConfig(detection.stack, packageJson, entries) : null,
    nextStep: detection.allowed
      ? 'Puedes usar la sugerencia para rellenar la configuración avanzada y luego publicar.'
      : 'Corrige el paquete o usa un stack permitido antes de continuar.'
  };
};

const validateComplementSourceArchive = async (file) => {
  if (!file || !file.buffer) {
    throw new Error('No se recibió ningún archivo');
  }

  if (Number(file.size || 0) > MAX_ARCHIVE_BYTES) {
    throw new Error(`El archivo supera el máximo permitido de ${Math.round(MAX_ARCHIVE_BYTES / (1024 * 1024))} MB`);
  }

  const result = await inspectArchive(file.buffer);
  return {
    fileName: file.originalname,
    fileSize: Number(file.size || 0),
    ...result
  };
};

module.exports = {
  getComplementSourceLimits,
  validateComplementSourceArchive
};