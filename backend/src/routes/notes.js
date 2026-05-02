/**
 * File Purpose: backend/src/routes/notes.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const AdminNote = require('../models/AdminNote');
const PersonalNote = require('../models/PersonalNote');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');

// ========== NOTAS DEL ADMINISTRADOR ==========

// GET /api/notes/admin - Obtener nota del administrador
router.get('/admin', authenticate, async (req, res) => {
  try {
    let note = await AdminNote.findOne();
    
    if (!note) {
      note = await AdminNote.create({ content: '' });
    }

    res.json(note);
  } catch (error) {
    console.error('Error al obtener nota admin:', error);
    res.status(500).json({ message: 'Error al obtener nota' });
  }
});

// PUT /api/notes/admin - Actualizar nota del administrador (solo admin)
router.put('/admin',
  authenticate,
  authorize('admin'),
  [
    body('content').isString().withMessage('El contenido debe ser texto')
  ],
  validate,
  async (req, res) => {
    try {
      const { content } = req.body;

      let note = await AdminNote.findOne();

      if (!note) {
        note = new AdminNote({
          content,
          lastEditedBy: req.user._id,
          lastEditedByUsername: req.user.username
        });
      } else {
        note.content = content;
        note.lastEditedBy = req.user._id;
        note.lastEditedByUsername = req.user.username;
      }

      await note.save();

      res.json({ message: 'Nota actualizada', note });
    } catch (error) {
      console.error('Error al actualizar nota admin:', error);
      res.status(500).json({ message: 'Error al actualizar nota' });
    }
  }
);

// ========== NOTAS PERSONALES ==========

// GET /api/notes/personal - Obtener nota personal del usuario
router.get('/personal', authenticate, async (req, res) => {
  try {
    let note = await PersonalNote.findOne({ userId: req.user._id });

    if (!note) {
      note = await PersonalNote.create({
        userId: req.user._id,
        content: ''
      });
    }

    res.json(note);
  } catch (error) {
    console.error('Error al obtener nota personal:', error);
    res.status(500).json({ message: 'Error al obtener nota personal' });
  }
});

// PUT /api/notes/personal - Actualizar nota personal
router.put('/personal',
  authenticate,
  [
    body('content').isString().withMessage('El contenido debe ser texto')
  ],
  validate,
  async (req, res) => {
    try {
      const { content } = req.body;

      let note = await PersonalNote.findOne({ userId: req.user._id });

      if (!note) {
        note = new PersonalNote({
          userId: req.user._id,
          content
        });
      } else {
        note.content = content;
      }

      await note.save();

      res.json({ message: 'Nota personal actualizada', note });
    } catch (error) {
      console.error('Error al actualizar nota personal:', error);
      res.status(500).json({ message: 'Error al actualizar nota personal' });
    }
  }
);

module.exports = router;
