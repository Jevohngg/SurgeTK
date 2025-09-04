// routes/exportViewRoutes.js
const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');
const exportController = require('../controllers/exportController');

router.get('/exports', ensureAuthenticated, ensureOnboarded, exportController.renderExportPage);

module.exports = router;
