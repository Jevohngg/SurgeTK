// routes/viewHouseholdRoutes.js

const express = require('express');
const router = express.Router();
const householdController = require('../controllers/householdController');
const { ensureAuthenticated } = require('../middleware/authMiddleware');

// === View Routes ===

// 1. Get Households Page
router.get('/households', ensureAuthenticated, householdController.getHouseholdsPage);

// 2. Get Import Page
router.get('/import', ensureAuthenticated, householdController.getImportPage);

// 3. Route to Render Household Details Page
router.get('/households/:id', ensureAuthenticated, householdController.renderHouseholdDetailsPage);

module.exports = router;
