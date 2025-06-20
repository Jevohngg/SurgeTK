// routes/surgeViewRoutes.js
const express = require('express');
const router  = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { ensureOnboarded     } = require('../middleware/onboardingMiddleware');
const view = require('../controllers/surgeViewController');

router.get('/surge',           ensureAuthenticated, ensureOnboarded, view.renderSurgeListPage);
router.get('/surge/:id',       ensureAuthenticated, ensureOnboarded, view.renderSurgeDetailPage);

module.exports = router;
