/**
 * Log Forwarder - Envío de logs a colector externo
 * 
 * Características:
 *   - TCP plain o TLS
 *   - Queue en memoria (max 1000 logs)
 *   - Backoff exponencial si colector down
 *   - Sanitización automática de secrets
 *   - Formato NDJSON (compatible SIEM)
 * 
 * Uso:
 *   logForwarder.forward(auditRecord)
 *   logForwarder.testConnection()
 * 
 * Variables de entorno (seguridad):
 *   - LOG_FORWARD_CLIENT_KEY: client key para mTLS (no guardar en DB)
 */
const net = require('net');
const tls = require('tls');
const dgram = require('dgram');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { URL } = require('url');
const LogForwardingConfig = require('../models/LogForwardingConfig');
const { logger, sanitize } = require('./logger');
const { assertOutboundUrlSafe } = require('./outbound-url-guard');

class LogForwarder {
  constructor() {
    this.configs = [];
    
    // Cargar config al iniciar
    this.loadConfig();
  }
  
  /**
   * Cargar configuración de forwarding desde MongoDB
   */
  async loadConfig() {
    try {
      this.configs = await LogForwardingConfig.find({ enabled: true }).sort({ createdAt: 1 }).lean();

      logger.info({
        event: 'logforward.config.loaded',
        enabledCount: this.configs.length
      }, 'Log forwarding configs loaded');
    } catch (error) {
      logger.error({ err: error }, 'Error loading log forwarding config');
      this.configs = [];
    }
  }
  
  /**
   * Recargar config (llamado desde API cuando admin actualiza)
   */
  async reloadConfig() {
    logger.info({ event: 'logforward.config.reload' }, 'Reloading log forwarding config');
    await this.loadConfig();
  }
  
  /**
   * Enviar log a colector (llamado desde audit.js)
   */
  async forward(auditRecord) {
    if (!this.configs || this.configs.length === 0) {
      return;
    }

    const targets = this.configs.filter(config => this.shouldForwardLevel(config, auditRecord.level));
    if (targets.length === 0) {
      return;
    }

    const sendTasks = targets.map(config => this.sendWithRetry(config, auditRecord));
    await Promise.allSettled(sendTasks);
  }
  
  /**
   * Determinar si el log debe forwardearse según nivel configurado
   */
  shouldForwardLevel(config, logLevel) {
    const { forwardLevel } = config;
    
    // audit-only: solo eventos de AuditLog (todos tienen level info/warn/error)
    if (forwardLevel === 'audit-only') {
      return true;
    }
    
    // Mapear niveles a números para comparación
    const levels = { info: 0, warn: 1, error: 2 };
    const configLevel = levels[forwardLevel] || 0;
    const currentLevel = levels[logLevel] || 0;
    
    return currentLevel >= configLevel;
  }
  
  /**
   * Preparar payload NDJSON
   */
  preparePayload(auditRecord, config) {
    const payload = {
      timestamp: auditRecord.timestamp.toISOString(),
      event: auditRecord.event,
      level: auditRecord.level,
      actor: auditRecord.actor,
      request: auditRecord.request,
      result: auditRecord.result,
      metadata: sanitize(auditRecord.metadata)
    };

    if (this.getFormat(config) === 'rfc5424') {
      const appName = 'BitacoraSOC';
      const host = config.host || '-';
      const msg = JSON.stringify(payload);
      return `<134>1 ${payload.timestamp} ${host} ${appName} - - - ${msg}`;
    }

    // JSON/NDJSON
    return JSON.stringify(payload) + '\n';
  }
  
  sendUdp(config, payload) {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const message = Buffer.from(payload, 'utf8');

      socket.send(message, config.port, config.host, (err) => {
        socket.close();
        if (err) {
          logger.error({ err }, 'Error sending UDP log payload');
          return reject(err);
        }
        resolve();
      });
    });
  }

  sendHttp(config, payload) {
    return new Promise((resolve, reject) => {
      (async () => {
        const endpoint = config.http?.url;
        if (!endpoint) {
          return reject(new Error('HTTP url no configurada para log forwarding'));
        }

        await assertOutboundUrlSafe(endpoint, { requireHttps: true });

        const url = new URL(endpoint);
        const client = url.protocol === 'https:' ? https : http;
        const body = payload.endsWith('\n') ? payload.trimEnd() : payload;
        const method = config.http?.method || 'POST';
        const timeoutMs = config.http?.timeoutMs || 5000;
        const customHeaders = config.http?.headers || {};

        const req = client.request({
          method,
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: `${url.pathname || '/'}${url.search || ''}`,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            ...customHeaders
          },
          timeout: timeoutMs
        }, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`HTTP ${res.statusCode} al enviar log`));
          }
        });

        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy(new Error('Timeout enviando log via HTTP'));
        });
        req.write(body);
        req.end();
      })().catch((error) => {
        reject(error);
      });
    });
  }

  sendTcp(config, payload) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: config.host, port: config.port }, () => {
        socket.write(payload, 'utf8', (err) => {
          socket.destroy();
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      socket.setTimeout(5000, () => {
        socket.destroy(new Error('Connection timeout (5s)'));
      });

      socket.on('error', reject);
    });
  }

  sendTls(config, payload) {
    return new Promise((resolve, reject) => {
      const tlsConfig = config.tls || {};
      const tlsOptions = {
        host: config.host,
        port: config.port,
        rejectUnauthorized: tlsConfig.rejectUnauthorized !== false
      };

      if (tlsConfig.caCert) {
        tlsOptions.ca = [this.readCert(tlsConfig.caCert)];
      }

      if (tlsConfig.clientCert) {
        tlsOptions.cert = this.readCert(tlsConfig.clientCert);
      }

      const clientKey = process.env.LOG_FORWARD_CLIENT_KEY;
      if (clientKey) {
        tlsOptions.key = this.readCert(clientKey);
      }

      const socket = tls.connect(tlsOptions, () => {
        socket.write(payload, 'utf8', (err) => {
          socket.destroy();
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      socket.setTimeout(5000, () => {
        socket.destroy(new Error('Connection timeout (5s)'));
      });

      socket.on('error', reject);
    });
  }

  getTransport(config) {
    if (config.transport) {
      return config.transport;
    }

    return config.mode === 'plain' ? 'tcp' : 'tls';
  }

  getFormat(config) {
    return config.format || 'json';
  }
  
  /**
   * Leer certificado (desde string PEM o path a archivo)
   */
  readCert(certOrPath) {
    // Si empieza con -----BEGIN, es PEM directo
    if (certOrPath.startsWith('-----BEGIN')) {
      return certOrPath;
    }
    
    // Si no, es path a archivo
    try {
      return fs.readFileSync(certOrPath, 'utf8');
    } catch (error) {
      logger.error({ err: error, path: certOrPath }, 'Error reading certificate file');
      return '';
    }
  }
  
  /**
   * Test de conexión (llamado desde API /test)
   */
  async testConnection(configId = null) {
    let config = null;

    if (configId) {
      config = await LogForwardingConfig.findById(configId).lean();
    }

    if (!config) {
      config = await LogForwardingConfig.findOne({ enabled: true }).sort({ updatedAt: -1 }).lean();
    }

    if (!config) {
      config = await LogForwardingConfig.findOne().sort({ updatedAt: -1 }).lean();
    }

    if (!config) {
      throw new Error('No log forwarding configuration found');
    }

    const testRecord = {
      timestamp: new Date(),
      event: 'logforward.test',
      level: 'info',
      actor: null,
      request: { requestId: 'test' },
      result: { success: true },
      metadata: {
        message: 'Test connection from BitacoraSOC',
        source: 'test'
      }
    };

    await this.sendToConfig(config, testRecord);
    return { success: true, message: 'Conexión exitosa' };
  }

  async sendWithRetry(config, auditRecord) {
    const retryConfig = config.retry || {};
    const retryEnabled = retryConfig.enabled !== false;
    const maxRetries = retryEnabled ? (retryConfig.maxRetries || 0) : 0;
    const baseBackoff = retryConfig.backoffMs || 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.sendToConfig(config, auditRecord);
        return;
      } catch (error) {
        const isLastAttempt = attempt >= maxRetries;
        logger.warn({
          event: 'logforward.delivery.failed',
          configId: config._id,
          name: config.name,
          attempt: attempt + 1,
          maxAttempts: maxRetries + 1,
          err: error
        }, 'Log forwarding delivery failed');

        if (isLastAttempt) {
          return;
        }

        const delayMs = baseBackoff * Math.pow(2, attempt);
        await this.delay(delayMs);
      }
    }
  }

  async sendToConfig(config, auditRecord) {
    const payload = this.preparePayload(auditRecord, config);
    const transport = this.getTransport(config);

    if (transport === 'udp') {
      await this.sendUdp(config, payload);
      return;
    }

    if (transport === 'http') {
      await this.sendHttp(config, payload);
      return;
    }

    if (transport === 'tcp') {
      await this.sendTcp(config, payload);
      return;
    }

    await this.sendTls(config, payload);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
const logForwarder = new LogForwarder();

module.exports = logForwarder;
