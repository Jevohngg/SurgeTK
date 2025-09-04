// routes/apiExportRoutes.js
const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');
const exportController = require('../controllers/exportController');

router.get('/columns', ensureAuthenticated, ensureOnboarded, exportController.getColumns);
router.get('/scope-text', ensureAuthenticated, ensureOnboarded, exportController.getScopeText);

router.post('/list', ensureAuthenticated, ensureOnboarded, exportController.list);      // server-side listing
router.post('/preview', ensureAuthenticated, ensureOnboarded, exportController.preview);
router.post('/run', ensureAuthenticated, ensureOnboarded, exportController.run);

router.get('/history', ensureAuthenticated, ensureOnboarded, exportController.history);
router.get('/download/:id', ensureAuthenticated, ensureOnboarded, exportController.download);

module.exports = router;
