// routes/importUndoRoutes.js
const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const importUndoCtrl = require('../controllers/importUndoController');

// POST /api/new-import/:importId/undo
router.post('/new-import/:importId/undo', ensureAuthenticated, importUndoCtrl.start);

// GET /api/new-import/:importId/undo/stream (SSE)
router.get('/new-import/:importId/undo/stream', ensureAuthenticated, importUndoCtrl.streamSSE);

// GET /api/new-import/:importId/undo/status (polling fallback)
router.get('/new-import/:importId/undo/status', ensureAuthenticated, importUndoCtrl.status);

module.exports = router;
