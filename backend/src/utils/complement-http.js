const http = require('http');
const https = require('https');

const requestJson = (urlValue, options = {}) => new Promise((resolve, reject) => {
  const target = new URL(urlValue);
  const client = target.protocol === 'https:' ? https : http;
  const timeoutMs = Number(options.timeoutMs) || 3000;
  const body = options.body ? JSON.stringify(options.body) : null;

  const request = client.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    method: options.method || (body ? 'POST' : 'GET'),
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      ...(options.headers || {})
    },
    timeout: timeoutMs
  }, (response) => {
    let raw = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      raw += chunk;
    });
    response.on('end', () => {
      let parsed = null;
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
      }

      resolve({
        statusCode: response.statusCode || 0,
        headers: response.headers,
        body: parsed
      });
    });
  });

  request.on('error', reject);
  request.on('timeout', () => {
    request.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
  });

  if (body) {
    request.write(body);
  }

  request.end();
});

module.exports = {
  requestJson
};