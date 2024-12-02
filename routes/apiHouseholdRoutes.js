// routes/apiHouseholdRoutes.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const householdController = require('../controllers/householdController');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const noCache = require('../middleware/noCacheMiddleware'); // Import the middleware

// === Specific API Routes ===

// 1. Route to fetch paginated import reports
router.get('/imports', ensureAuthenticated, householdController.getImportReports);

// 2. Route to download original import file
router.get('/imports/:id/download', ensureAuthenticated, householdController.downloadImportFile);

// 3. Route to generate import report
router.get('/import/report', ensureAuthenticated, householdController.generateImportReport);

// 4. Import Households with Mapping
router.post('/import/mapped', ensureAuthenticated, upload.single('fileUpload'), householdController.importHouseholdsWithMapping);

// 5. Import Households
router.post('/import', ensureAuthenticated, upload.single('fileUpload'), householdController.importHouseholds);

// 6. Bulk Delete Households
router.delete('/bulk-delete', ensureAuthenticated, householdController.deleteHouseholds);

// 7. Edit Households
router.put('/:id', ensureAuthenticated, householdController.updateHousehold);



// === CRUD API Endpoints with noCache Middleware ===

// 7. Get all households
router.get('/', ensureAuthenticated, noCache, householdController.getHouseholds);

// 8. Create a new household
router.post('/', ensureAuthenticated, noCache, householdController.createHousehold);

// === Dynamic API Routes ===

// 9. Get a household by ID
router.get('/:id', ensureAuthenticated, noCache, householdController.getHouseholdById);

module.exports = router;
