const express = require('express');

const router = express.Router();

router.get('/context', (_req, res) => {
  res.status(501).json({ message: 'API interna v2 aún no disponible' });
});

module.exports = router;