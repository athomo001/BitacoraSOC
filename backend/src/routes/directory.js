/**
 * File Purpose: backend/src/routes/directory.js
 * Responsibilities: Expose REST endpoints for centralized contact directory.
 * QA Notes: Keep auth parity with other protected admin modules.
 */

const express = require('express');
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/directoryContactController');

// Configuración de multer para carga de archivos en memoria con límite de 2MB
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }
});

const router = express.Router();

const normalizeCargo = (value = '') =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const EDIT_ONLY_CARGOS = new Set([
  'qa nivel 1',
  'qa nivel 2',
  'customer success manager (csm)',
  'customer success manager',
  'csm'
]);

const FULL_DIRECTORY_CARGOS = new Set([
  'n2',
  'n3',
  'jefe area',
  'gerente area',
  'arquitecto siem'
]);

const isAdmin = (req) => req?.user?.role === 'admin';

const canWriteDirectory = (req) => {
  if (isAdmin(req)) {
    return true;
  }
  const cargo = normalizeCargo(req?.user?.cargoLabel || '');
  // Permite la creación y edición de contactos a cualquier cargo definido,
  // incluyendo a los analistas de nivel N1 ('n1'). La eliminación sigue restringida.
  return !!cargo;
};

const canDeleteDirectory = (req) => {
  if (isAdmin(req)) {
    return true;
  }
  const cargo = normalizeCargo(req?.user?.cargoLabel || '');
  return FULL_DIRECTORY_CARGOS.has(cargo);
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
};

const requireDirectoryWrite = (req, res, next) => {
  if (!canWriteDirectory(req)) {
    return res.status(403).json({ error: 'No tienes permisos para crear o editar contactos en el directorio' });
  }
  return next();
};

const requireDirectoryDelete = (req, res, next) => {
  if (!canDeleteDirectory(req)) {
    return res.status(403).json({ error: 'No tienes permisos para eliminar contactos del directorio' });
  }
  return next();
};

router.get('/search', authenticate, controller.searchDirectoryContacts);
router.post('/rebuild-from-escalation', authenticate, requireAdmin, controller.rebuildDirectoryFromEscalation);
router.post('/merge-duplicates', authenticate, requireDirectoryWrite, controller.mergeDirectoryDuplicatesNow);
router.post('/sync-users-from-directory', authenticate, requireDirectoryWrite, controller.syncUsersFromDirectoryNow);
router.post('/sync-users-to-directory', authenticate, requireDirectoryWrite, controller.syncUsersToDirectoryNow);
router.get('/', authenticate, controller.listDirectoryContacts);
router.get('/:id', authenticate, controller.getDirectoryContactById);
router.post('/', authenticate, requireDirectoryWrite, controller.createDirectoryContact);
router.put('/:id', authenticate, requireDirectoryWrite, controller.updateDirectoryContact);
router.delete('/:id', authenticate, requireDirectoryDelete, controller.deleteDirectoryContact);

// Endpoint para importar contactos del directorio mediante archivo CSV
router.post('/import-csv', authenticate, requireDirectoryWrite, csvUpload.single('file'), controller.importDirectoryContactsCsv);

module.exports = router;
