/**
 * File Purpose: backend/src/utils/tls-validator.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const tls = require('tls');
const net = require('net');

/**
 * Valida criptográficamente que un certificado y una llave privada encapsulen
 * el mismo contexto de seguridad matemático. Además pre-filtra llaves cifradas.
 */
const validateCryptoPair = ({ certPem, keyPem, caPem }) => {
    if (!certPem || !keyPem) {
        throw new Error('Certificado y llave privada son obligatorios para validación.');
    }

    const keyString = String(keyPem);
    if (keyString.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----') || keyString.includes('Proc-Type: 4,ENCRYPTED')) {
        throw new Error('Llave privada cifrada no soportada. Sube una llave PEM sin passphrase.');
    }

    try {
        const contextOptions = {
            cert: certPem,
            key: keyPem
        };
        if (caPem) {
            contextOptions.ca = caPem;
        }

        tls.createSecureContext(contextOptions);
        return true;
    } catch (err) {
        throw new Error(`Los certificados TLS son inválidos o no corresponden matemáticamente entre sí: ${err.message}`);
    }
};

/**
 * Valida asíncronamente si el sistema operativo permite enlazar (bind) un puerto.
 * Se utiliza para evitar configurar HTTPS en puertos ya ocupados.
 */
const isPortFree = (port, host = '0.0.0.0') => {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', (err) => {
            resolve({ free: false, error: err.message });
        });
        srv.once('listening', () => {
            srv.close(() => resolve({ free: true }));
        });
        srv.listen(port, host);
    });
};

module.exports = {
    validateCryptoPair,
    isPortFree
};
