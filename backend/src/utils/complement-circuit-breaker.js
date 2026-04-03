const fs = require('fs');
const path = require('path');
const Complement = require('../models/Complement');
const { auditSystem } = require('./audit');
const { logger } = require('./logger');
const { requestJson } = require('./complement-http');

const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

const circuitStates = new Map();
let healthInterval = null;

const getTimeoutMs = () => Number(process.env.COMPLEMENT_CIRCUIT_TIMEOUT_MS) || 3000;
const getFailThreshold = () => Number(process.env.COMPLEMENT_CIRCUIT_FAIL_THRESHOLD) || 3;
const getResetMs = () => Number(process.env.COMPLEMENT_CIRCUIT_RESET_MS) || 30000;

const getStateRecord = (slug) => {
  if (!circuitStates.has(slug)) {
    circuitStates.set(slug, {
      state: 'CLOSED',
      failCount: 0,
      lastFailure: null,
      lastCheck: null,
      lastError: null,
      openedAt: null
    });
  }

  return circuitStates.get(slug);
};

const buildHealthUrl = (complement) => new URL(complement.healthPath || '/health', complement.internalBaseUrl || complement.baseUrl).toString();

const emitStateEvent = async (eventSuffix, complement, metadata = {}, level = 'info') => {
  await auditSystem({
    event: `complement.circuit.${eventSuffix}`,
    level,
    source: 'complement',
    sourceId: complement.slug,
    result: { success: eventSuffix !== 'open', reason: metadata.reason },
    metadata: {
      slug: complement.slug,
      ...metadata
    },
    actor: {
      username: `complement:${complement.slug}`,
      role: 'complement'
    }
  });
};

const markFailure = async (complement, reason) => {
  const state = getStateRecord(complement.slug);
  state.failCount += 1;
  state.lastFailure = new Date().toISOString();
  state.lastError = reason;
  state.lastCheck = new Date().toISOString();

  if (state.failCount >= getFailThreshold() && state.state !== 'OPEN') {
    state.state = 'OPEN';
    state.openedAt = Date.now();
    await emitStateEvent('open', complement, {
      reason,
      failCount: state.failCount,
      lastError: reason
    }, 'warn');
  }

  return state;
};

const markSuccess = async (complement) => {
  const state = getStateRecord(complement.slug);
  const previousState = state.state;
  const recoveredAfterMs = state.openedAt ? Date.now() - state.openedAt : 0;

  state.state = 'CLOSED';
  state.failCount = 0;
  state.lastCheck = new Date().toISOString();
  state.lastError = null;
  state.lastFailure = null;
  state.openedAt = null;

  if (previousState === 'OPEN' || previousState === 'HALF_OPEN') {
    await emitStateEvent('close', complement, { recoveredAfterMs });
  }

  return state;
};

const probeComplementHealth = async (complement, options = {}) => {
  const state = getStateRecord(complement.slug);
  const now = Date.now();

  if (state.state === 'OPEN' && state.openedAt && now - state.openedAt < getResetMs() && !options.force) {
    return state;
  }

  if (state.state === 'OPEN') {
    state.state = 'HALF_OPEN';
    await emitStateEvent('half_open', complement, { checkUrl: buildHealthUrl(complement) });
  }

  // Para complementos ZIP estáticos el "health" es que el archivo publicado exista en disco.
  // No hay servicio HTTP al que conectarse, así que el check HTTP siempre falla.
  const isZipStatic = complement.sourceArtifact?.sourceType === 'zip-static';
  if (isZipStatic) {
    const relativePath = complement.sourceArtifact?.publishedRelativePath;
    if (relativePath) {
      const indexFile = path.join(UPLOADS_ROOT, relativePath, 'index.html');
      if (fs.existsSync(indexFile)) {
        return markSuccess(complement);
      }
      return markFailure(complement, 'Archivo publicado no encontrado en disco');
    }
    // Sin publishedRelativePath aún no está publicado; no contar como fallo
    return state;
  }

  try {
    const response = await requestJson(buildHealthUrl(complement), {
      timeoutMs: getTimeoutMs(),
      headers: {
        'X-Request-Id': options.requestId || 'system'
      }
    });

    if (response.statusCode >= 500 || response.statusCode === 0) {
      return markFailure(complement, `Health check status ${response.statusCode}`);
    }

    return markSuccess(complement);
  } catch (error) {
    return markFailure(complement, error.message);
  }
};

const getCircuitState = (slug) => {
  const state = getStateRecord(slug);
  return {
    state: state.state,
    failCount: state.failCount,
    lastFailure: state.lastFailure,
    lastCheck: state.lastCheck,
    lastError: state.lastError
  };
};

const startComplementCircuitHealthChecks = () => {
  if (healthInterval) {
    return;
  }

  healthInterval = setInterval(async () => {
    try {
      const complements = await Complement.find({ status: { $in: ['active', 'maintenance'] } }).lean();
      for (const complement of complements) {
        await probeComplementHealth(complement);
      }
    } catch (error) {
      logger.warn({ event: 'complement.circuit.scheduler.failed', error: error.message }, 'No se pudo ejecutar health check de complementos');
    }
  }, getResetMs());

  healthInterval.unref?.();
};

const stopComplementCircuitHealthChecks = () => {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
};

module.exports = {
  getCircuitState,
  probeComplementHealth,
  startComplementCircuitHealthChecks,
  stopComplementCircuitHealthChecks
};