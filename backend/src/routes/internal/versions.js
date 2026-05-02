/**
 * File Purpose: backend/src/routes/internal/versions.js
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

const express = require('express');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    versions: [
      { version: 'v1', status: 'current', sunset: null }
    ],
    latest: 'v1'
  });
});

module.exports = router;