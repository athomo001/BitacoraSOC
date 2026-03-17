const DEFAULT_FRONTEND_PORT = 4200;
const DEFAULT_FRONTEND_HTTPS_PORT = 4300;

const isWildcardAddress = (value) => {
  if (!value) return true;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '0.0.0.0' || normalized === '::' || normalized === '[::]';
};

const getSafeHostname = (hostHeader) => {
  if (!hostHeader) return 'localhost';
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return String(hostHeader).trim();
  }
};

const getExpectedPort = (protocol) => {
  if (protocol === 'https:') {
    return Number(process.env.FRONTEND_HTTPS_PORT) || DEFAULT_FRONTEND_HTTPS_PORT;
  }

  return Number(process.env.FRONTEND_PORT) || DEFAULT_FRONTEND_PORT;
};

const getOppositePort = (protocol) => {
  if (protocol === 'https:') {
    return Number(process.env.FRONTEND_PORT) || DEFAULT_FRONTEND_PORT;
  }

  return Number(process.env.FRONTEND_HTTPS_PORT) || DEFAULT_FRONTEND_HTTPS_PORT;
};

const normalizeFrontendBaseUrl = (rawUrl) => {
  const parsed = new URL(String(rawUrl).trim());
  const expectedPort = getExpectedPort(parsed.protocol);
  const oppositePort = getOppositePort(parsed.protocol);
  const normalized = new URL(parsed.origin);

  if (!parsed.port) {
    normalized.port = expectedPort === 80 || expectedPort === 443 ? '' : String(expectedPort);
  } else if (Number(parsed.port) === oppositePort) {
    normalized.port = String(expectedPort);
  } else {
    normalized.port = parsed.port;
  }

  return normalized.toString().replace(/\/$/, '');
};

const getOriginFromHeaders = (req) => {
  const originHeader = req?.headers?.origin;
  if (originHeader) {
    try {
      return new URL(originHeader).origin;
    } catch {
      return null;
    }
  }

  const refererHeader = req?.headers?.referer;
  if (refererHeader) {
    try {
      return new URL(refererHeader).origin;
    } catch {
      return null;
    }
  }

  return null;
};

const resolveFrontendBaseUrl = (req) => {
  if (process.env.FRONTEND_URL) {
    return normalizeFrontendBaseUrl(process.env.FRONTEND_URL);
  }

  const requestOrigin = getOriginFromHeaders(req);
  if (requestOrigin) {
    return normalizeFrontendBaseUrl(requestOrigin);
  }

  const hostDomain = process.env.HOST_DOMAIN;
  const forwardedHost = req?.headers?.['x-forwarded-host'];
  const requestHost = forwardedHost || req?.headers?.host;
  const hostname = !isWildcardAddress(hostDomain)
    ? hostDomain.trim()
    : getSafeHostname(requestHost);

  const forwardedProto = req?.headers?.['x-forwarded-proto'];
  const protocol = forwardedProto
    ? `${forwardedProto.split(',')[0].trim()}:`
    : req?.secure
      ? 'https:'
      : 'http:';

  const expectedPort = getExpectedPort(protocol);
  const defaultPort = protocol === 'https:' ? 443 : 80;
  const portSegment = expectedPort === defaultPort ? '' : `:${expectedPort}`;

  return `${protocol}//${hostname}${portSegment}`;
};

const buildFrontendResetUrl = (req, resetToken) => {
  const baseUrl = resolveFrontendBaseUrl(req);
  const resetUrl = new URL('/auth/reset-password', `${baseUrl}/`);
  resetUrl.searchParams.set('token', resetToken);
  return resetUrl.toString();
};

module.exports = {
  buildFrontendResetUrl,
  normalizeFrontendBaseUrl,
  resolveFrontendBaseUrl
};