const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');

const IPV4_PRIVATE_RANGES = [
  { start: '0.0.0.0', end: '0.255.255.255' },
  { start: '10.0.0.0', end: '10.255.255.255' },
  { start: '127.0.0.0', end: '127.255.255.255' },
  { start: '169.254.0.0', end: '169.254.255.255' },
  { start: '172.16.0.0', end: '172.31.255.255' },
  { start: '192.168.0.0', end: '192.168.255.255' }
];

const toIpv4Long = (ip) => ip.split('.').reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);

const ipv4InRange = (ip, range) => {
  const value = toIpv4Long(ip);
  const start = toIpv4Long(range.start);
  const end = toIpv4Long(range.end);
  return value >= start && value <= end;
};

const isPrivateIpv4 = (ip) => IPV4_PRIVATE_RANGES.some((range) => ipv4InRange(ip, range));

const normalizeIpForChecks = (ip = '') => String(ip || '').trim().toLowerCase();

const isPrivateIpv6 = (ip) => {
  const normalized = normalizeIpForChecks(ip);
  if (!normalized) return true;

  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;

  const v4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) {
    return isPrivateIpv4(v4Mapped[1]);
  }

  return false;
};

const isPrivateIp = (ip) => {
  const ipVersion = net.isIP(ip);
  if (ipVersion === 4) return isPrivateIpv4(ip);
  if (ipVersion === 6) return isPrivateIpv6(ip);
  return true;
};

const parseAllowlist = () => {
  const raw = String(process.env.OUTBOUND_ALLOWLIST || '').trim();
  if (!raw) return [];

  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
};

const hostMatchesAllowlist = (host, allowlist) => {
  if (!allowlist.length) return true;
  const normalizedHost = String(host || '').trim().toLowerCase();

  return allowlist.some((rule) => {
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(1);
      return normalizedHost.endsWith(suffix);
    }
    return normalizedHost === rule;
  });
};

const assertOutboundUrlSafe = async (urlValue, options = {}) => {
  const {
    requireHttps = true,
    allowHttp = false,
    allowPrivateHosts = false,
    allowlist = parseAllowlist()
  } = options;

  let parsed;
  try {
    parsed = new URL(String(urlValue || '').trim());
  } catch (_error) {
    throw new Error('URL de destino inválida');
  }

  const protocol = String(parsed.protocol || '').toLowerCase();
  const isHttps = protocol === 'https:';
  const isHttp = protocol === 'http:';

  if (!isHttps && !isHttp) {
    throw new Error('Solo se permiten protocolos HTTP/HTTPS');
  }

  if (requireHttps && !isHttps) {
    throw new Error('Solo se permite HTTPS para destinos salientes');
  }

  if (!requireHttps && !allowHttp && !isHttps) {
    throw new Error('Protocolo no permitido para destino saliente');
  }

  if (parsed.username || parsed.password) {
    throw new Error('No se permiten credenciales embebidas en URL');
  }

  const host = String(parsed.hostname || '').trim().toLowerCase();
  if (!host) {
    throw new Error('URL de destino sin hostname');
  }

  if (host === 'localhost') {
    if (allowPrivateHosts) {
      return parsed;
    }
    throw new Error('Destino localhost no permitido');
  }

  if (!hostMatchesAllowlist(host, allowlist)) {
    throw new Error('Hostname no permitido por OUTBOUND_ALLOWLIST');
  }

  const isIpHost = net.isIP(host) !== 0;
  if (isIpHost) {
    if (allowPrivateHosts) {
      return parsed;
    }
    if (isPrivateIp(host)) {
      throw new Error('IP privada o loopback no permitida en destino saliente');
    }
    return parsed;
  }

  let resolved = [];
  try {
    resolved = await dns.lookup(host, { all: true, verbatim: true });
  } catch (_error) {
    throw new Error('No se pudo resolver el hostname de destino');
  }

  if (!resolved.length) {
    throw new Error('Hostname sin resolución IP válida');
  }

  const hasPrivateResolution = resolved.some((entry) => isPrivateIp(entry.address));
  if (hasPrivateResolution) {
    if (allowPrivateHosts) {
      return parsed;
    }
    throw new Error('Destino resuelve a red privada/loopback y fue bloqueado');
  }

  return parsed;
};

module.exports = {
  assertOutboundUrlSafe,
  isPrivateIp
};
