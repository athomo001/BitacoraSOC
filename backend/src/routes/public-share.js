/**
 * File Purpose: backend/src/routes/public-share.js
 * Responsibilities: Rutas públicas (sin sesión) montadas en `/p` para vistas de solo lectura que un
 *   admin habilita mediante un enlace con token. Hoy: grilla semanal de teletrabajo y apoyo.
 * QA Notes: Estas rutas NO pasan por el middleware global de `/api/` (CORS, sanitizer, apiLimiter):
 *   por eso aplican su propio `publicShareLimiter` y el controlador valida el token antes de la BD.
 */

const express = require('express');
const router = express.Router();
const { publicShareLimiter } = require('../middleware/rate-limiter');
const publicShareController = require('../controllers/publicShareController');

// Grilla semanal "Personal en Teletrabajo y Apoyo" (semana en curso, auto-refresco, sin JS).
router.get('/telework/:token', publicShareLimiter, publicShareController.renderTeleworkWeeklyPublic);

module.exports = router;
