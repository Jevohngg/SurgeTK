// routes/apiHouseholdRoutes.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const householdController = require('../controllers/householdController');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');
const noCache = require('../middleware/noCacheMiddleware'); 


const { getAccountsSummaryByHousehold, getMonthlyNetWorth } = require('../controllers/accountController');

// === Specific API Routes ===

router.get('/api/leadAdvisors', ensureAuthenticated, ensureOnboarded, householdController.getFirmAdvisors);



  router.get(
    '/filtered-households',
    ensureAuthenticated,
    householdController.getFilteredHouseholds
  );


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
router.put('/bulk-assign-leadAdvisors', ensureAuthenticated, householdController.bulkAssignAdvisors);
router.get('/banner-stats', ensureAuthenticated, householdController.getBannerStats);

router.get('/client/:clientId', householdController.getClientById);
router.post('/client/:clientId', householdController.updateClient);
router.delete('/client/:clientId', householdController.deleteClient);



router.delete('/:id', ensureAuthenticated, householdController.deleteSingleHousehold);

// 7. Edit Households
router.put('/:id', ensureAuthenticated, householdController.updateHousehold);

router.get('/:householdId/accounts-summary', ensureAuthenticated, getAccountsSummaryByHousehold);
router.get('/:householdId/monthly-net-worth', ensureAuthenticated, getMonthlyNetWorth);

// router.get('/:householdId/guardrails', householdController.showGuardrailsPage);





// === CRUD API Endpoints with noCache Middleware ===

// 7. Get all households
router.get('/', ensureAuthenticated, ensureOnboarded, noCache, householdController.getHouseholds);

// 8. Create a new household
router.post('/', ensureAuthenticated, noCache, householdController.createHousehold);

// === Dynamic API Routes ===

// 9. Get a household by ID
router.get('/:id', ensureAuthenticated, noCache, householdController.getHouseholdById);

module.exports = router;
