/**
 * File Purpose: backend/src/middleware/metadata.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Middleware de Captura de Metadata
 * 
 * Función:
 *   - Extrae IP real del cliente (respeta X-Forwarded-For si hay proxy)
 *   - Captura User-Agent del navegador/cliente
 *   - Almacena en req.clientIp y req.clientUserAgent
 * 
 * Uso SOC:
 *   - Auditoría de entradas: ¿desde qué IP se registró el incidente?
 *   - Detección de accesos anómalos: ¿cambio repentino de IP/dispositivo?
 *   - Logs: trazabilidad completa de operaciones críticas
 * 
 * Aplicado en:
 *   - POST /api/entries (crear entrada)
 *   - POST /api/checklist/check (registrar check de turno)
 */
const crypto = require('crypto');

const getPrimaryIp = (req) => {
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor && typeof xForwardedFor === 'string') {
    return xForwardedFor.split(',')[0].trim();
  }

  return req.headers['x-real-ip']
    || req.connection?.remoteAddress
    || req.socket?.remoteAddress
    || req.ip
    || 'unknown';
};

const isPrivateIp = (ip = '') => {
  return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^127\.|^::1/.test(ip);
};

const buildDeviceFingerprint = (req) => {
  const source = [
    req.headers['user-agent'] || '',
    req.headers['sec-ch-ua'] || '',
    req.headers['sec-ch-ua-platform'] || '',
    req.headers['sec-ch-ua-mobile'] || '',
    req.headers['accept-language'] || '',
    req.headers['accept'] || ''
  ].join('|');

  return crypto.createHash('sha256').update(source).digest('hex').slice(0, 24);
};

const captureMetadata = (req, res, next) => {
  const ip = getPrimaryIp(req);
  const userAgent = req.headers['user-agent'] || '';
  const forwardedFor = req.headers['x-forwarded-for'];
  const via = req.headers.via;
  const cfConnectingIp = req.headers['cf-connecting-ip'];

  const vpnSignals = [];
  if (forwardedFor && typeof forwardedFor === 'string' && forwardedFor.includes(',')) {
    vpnSignals.push('multi_hop_forwarded_for');
  }
  if (via) {
    vpnSignals.push('via_header_present');
  }
  if (cfConnectingIp) {
    vpnSignals.push('proxy_edge_header');
  }
  if (!isPrivateIp(ip)) {
    vpnSignals.push('public_ip');
  }

  req.clientIp = ip;
  req.clientUserAgent = userAgent;
  req.clientMetadata = {
    device: {
      fingerprint: buildDeviceFingerprint(req),
      platform: req.headers['sec-ch-ua-platform'] || 'unknown',
      mobile: req.headers['sec-ch-ua-mobile'] || 'unknown',
      language: req.headers['accept-language'] || 'unknown'
    },
    network: {
      ip,
      isPrivateIp: isPrivateIp(ip),
      forwardedFor: typeof forwardedFor === 'string' ? forwardedFor : null,
      realIp: req.headers['x-real-ip'] || null,
      remoteAddress: req.socket?.remoteAddress || req.connection?.remoteAddress || null,
      protocol: req.protocol,
      vpnSignals,
      isLikelyVpnOrProxy: vpnSignals.length > 1
    }
  };

  next();
};

module.exports = captureMetadata;
