/**
 * Modelo de Usuario
 * 
 * Roles SOC:
 *   - admin: Acceso total (gestión usuarios, reportes, config, backups)
 *   - user:  Analista SOC (crear entradas, checks de turno, ver reportes)
 *   - guest: Acceso temporal limitado (solo lectura de entradas, sin checks)
 * 
 * Expiración Guest:
 *   - Al crear guest, se calcula guestExpiresAt = now + guestMaxDurationDays
 *   - isGuestExpired() verifica si la fecha expiró
 *   - Auth middleware desactiva cuenta si guest expiró
 * 
 * Seguridad:
 *   - Password hasheado con bcrypt (10 rounds) en pre-save hook
 *   - comparePassword() para validar login
 *   - toJSON() oculta password en respuestas API
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true, // Crea índice automáticamente
    trim: true,
    minlength: 3
  },
  email: {
    type: String,
    required: true,
    unique: true, // Crea índice automáticamente
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: false,
    trim: true,
    default: null
  },
  role: {
    type: String,
    enum: ['admin', 'user', 'auditor', 'guest'],
    default: 'user'
  },
  // Etiqueta de cargo (N1, N2, TI, etc) - solo para users/auditors
  cargoLabel: {
    type: String,
    trim: true,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Configuración de invitado
  guestExpiresAt: {
    type: Date,
    default: null
  },
  // Password reset tokens
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    default: null
  },
  // Preferencias
  theme: {
    type: String,
    enum: ['light', 'dark', 'sepia', 'pastel', 'cyberpunk'],
    default: 'light'
  },
  avatar: {
    type: String,
    default: null
  }
}, {
  timestamps: true // Añade createdAt y updatedAt automáticamente
});

// Índices adicionales (username y email ya tienen índice por unique: true)
// Solo definimos índices NO-UNIQUE adicionales para optimizar queries
userSchema.index({ role: 1 }); // Query: buscar usuarios por rol
userSchema.index({ guestExpiresAt: 1 }); // Query: limpiar guests expirados
userSchema.index({ resetPasswordToken: 1 }); // Query: validar token de reseteo

/**
 * Pre-save Hook: Hashear password con bcrypt
 * Solo se ejecuta si el password fue modificado (evita re-hashear en updates)
 */
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    // Reducido de 10 a 8 para mejor performance (sigue siendo seguro)
    const salt = await bcrypt.genSalt(8);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Método para comparar password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Método para verificar si el guest ha expirado
userSchema.methods.isGuestExpired = function() {
  if (this.role !== 'guest') return false;
  if (!this.guestExpiresAt) return true;
  return new Date() > this.guestExpiresAt;
};

// No retornar password en JSON
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
