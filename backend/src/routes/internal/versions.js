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