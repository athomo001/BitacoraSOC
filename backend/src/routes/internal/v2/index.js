/**
 * File Purpose: backend/src/routes/internal/v2/index.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const express = require('express');

const router = express.Router();

router.get('/context', (_req, res) => {
  res.status(501).json({ message: 'API interna v2 aún no disponible' });
});

module.exports = router;