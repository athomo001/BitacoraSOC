/**
 * File Purpose: backend/src/config/database.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Configuración de Conexión MongoDB
 * Marca de autor en comentarios: Athan Espinoza
 * 
 * Configuración:
 *   - MONGODB_URI: mongodb://localhost:27017/bitacora_soc (sin auth local)
 *   - MONGODB_URI: mongodb://user:pass@host:27017/bitacora_soc (con auth producción)
 * 
 * Opciones de conexión:
 *   - useNewUrlParser y useUnifiedTopology están DEPRECATED desde Driver 4.0.0
 *   - No es necesario especificarlas (se usan automáticamente)
 * 
 * Índices:
 *   - syncIndexes() crea índices de texto en Entry para búsqueda full-text
 *   - Se ejecuta automáticamente al conectar (idempotente)
 * 
 * Manejo de errores:
 *   - Si falla conexión, process.exit(1) detiene el servidor
 *   - Evita que el backend arranque sin DB (fail-fast pattern)
 */
const mongoose = require('mongoose');
const { logger } = require('../utils/logger');

/**
 * Conecta a MongoDB y sincroniza índices
 * @throws {Error} Si la conexión falla, termina el proceso con exit code 1
 */
const connectDB = async () => {
  try {
    // Opciones deprecated eliminadas (useNewUrlParser, useUnifiedTopology)
    // MongoDB Driver 4.0+ las ignora automáticamente
    await mongoose.connect(process.env.MONGODB_URI);
    
    logger.info({ event: 'mongodb.connected' }, 'MongoDB conectado correctamente');
    console.log('✅ MongoDB conectado correctamente');
    
    // Sincronizar índices críticos (idempotente).
    // Incluye Entry (búsqueda) y AuditLog (TTL de retención).
    const Entry = require('../models/Entry');
    const AuditLog = require('../models/AuditLog');
    await Promise.all([
      Entry.syncIndexes(),
      AuditLog.syncIndexes()
    ]);
    logger.info({ event: 'mongodb.indexes.synced' }, 'Índices de MongoDB sincronizados');
    
  } catch (error) {
    logger.error({ event: 'mongodb.connection.failed', error: error.message }, 'Error al conectar con MongoDB');
    console.error('❌ Error al conectar con MongoDB:', error.message);
    console.error('💡 Verifica que MongoDB esté corriendo: Get-Service MongoDB (Windows) o systemctl status mongod (Linux)');
    process.exit(1); // Fail-fast: no arrancar sin DB
  }
};

module.exports = connectDB;
