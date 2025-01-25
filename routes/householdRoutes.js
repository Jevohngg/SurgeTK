// routes/householdRoutes.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const householdController = require('../controllers/householdController');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { ensureOnboarded } = require('./middleware/onboardingMiddleware');
const noCache = require('../middleware/noCacheMiddleware'); // Import the middleware

// === API Routes ===

// 1. Specific API Routes

// Route to fetch paginated import reports
router.get('/imports', ensureAuthenticated, householdController.getImportReports);

// Route to download original import file
router.get('/api/imports/:id/download', ensureAuthenticated, householdController.downloadImportFile);

// Route to generate import report
router.get('/api/households/import/report', ensureAuthenticated, householdController.generateImportReport);

// Import Households with Mapping
router.post('/api/households/import/mapped', ensureAuthenticated, upload.single('fileUpload'), householdController.importHouseholdsWithMapping);

// Import Households
router.post('/api/households/import', ensureAuthenticated, upload.single('fileUpload'), householdController.importHouseholds);

// Bulk Delete Households
router.delete('/api/households/bulk-delete', ensureAuthenticated, householdController.deleteHouseholds);

// 2. CRUD API Endpoints with noCache Middleware

router.get('/api/households', ensureAuthenticated, noCache, householdController.getHouseholds);
router.post('/api/households', ensureAuthenticated, noCache, householdController.createHousehold);
router.get('/api/households/:id', ensureAuthenticated, noCache, householdController.getHouseholdById);
router.put('/api/households/:id', householdController.updateHousehold);

// === View Routes ===

// Get Households Page
router.get('/households', ensureAuthenticated, ensureOnboarded, householdController.getHouseholdsPage);

// Get Import Page
router.get('/import', ensureAuthenticated, ensureOnboarded, householdController.getImportPage);

// Route to Render Household Details Page
router.get('/households/:id', ensureAuthenticated, ensureOnboarded, householdController.renderHouseholdDetailsPage);

module.exports = router;
