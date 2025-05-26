// routes/viewHouseholdRoutes.js

const express = require('express');
const router = express.Router();
const householdController = require('../controllers/householdController');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');
const valueAddController = require('../controllers/valueAddController');


// === View Routes ===

// 1. Get Households Page
router.get('/households', ensureAuthenticated, ensureOnboarded, householdController.getHouseholdsPage);

// 2. Get Import Page
router.get('/import', ensureAuthenticated, ensureOnboarded, householdController.getImportPage);

// 3. Route to Render Household Details Page
router.get('/households/:id', ensureAuthenticated, ensureOnboarded, householdController.renderHouseholdDetailsPage);

// routes/viewHouseholdRoutes.js
router.get('/households/:householdId/guardrails', ensureAuthenticated, ensureOnboarded, householdController.showGuardrailsPage);

router.get('/households/:householdId/buckets', ensureAuthenticated, ensureOnboarded, householdController.showBucketsPage);

router.get(
    '/households/:householdId/beneficiary',
    ensureAuthenticated,
    ensureOnboarded,
    householdController.showBeneficiaryPage
  );
  // routes/viewHouseholdRoutes.js
router.get('/households/:householdId/net-worth', ensureAuthenticated, ensureOnboarded, householdController.showNetWorthPage);



module.exports = router;
