// routes/householdRoutes.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const householdController = require('../controllers/householdController');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const noCache = require('../middleware/noCacheMiddleware'); // Import the middleware

// Get Households Page
router.get('/households', ensureAuthenticated, householdController.getHouseholdsPage);


router.post('/api/households/import/mapped', ensureAuthenticated, upload.single('fileUpload'), householdController.importHouseholdsWithMapping);
router.post('/api/households/import', ensureAuthenticated, upload.single('fileUpload'), householdController.importHouseholds);
  



// API Endpoints with noCache Middleware
router.get('/api/households', ensureAuthenticated, noCache, householdController.getHouseholds);
router.post('/api/households', ensureAuthenticated, noCache, householdController.createHousehold);
router.get('/api/households/:id', ensureAuthenticated, noCache, householdController.getHouseholdById);

// Bulk Delete Households
router.delete('/api/households/bulk-delete', ensureAuthenticated, householdController.deleteHouseholds);


// Route to Render Household Details Page
router.get('/households/:id', ensureAuthenticated, householdController.renderHouseholdDetailsPage);


module.exports = router;
