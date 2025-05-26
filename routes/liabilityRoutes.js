// routes/liabilityRoutes.js
const express = require('express');
const router = express.Router();
const liabController = require('../controllers/liabilitiesController');
const multer = require('multer'); // Only if you're not already using it here
const upload = multer({ dest: 'uploads/' });
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');

// Create a new liability
router.post(
  '/households/:householdId/liabilities',
  ensureAuthenticated,
  ensureOnboarded,
  liabController.createLiability
);

// List / search / paginate liabilities
router.get(
  '/households/:householdId/liabilities',
  ensureAuthenticated,
  ensureOnboarded,
  liabController.getLiabilities
);

// Get one liability
router.get(
  '/liabilities/:id',
  ensureAuthenticated,
  ensureOnboarded,
  liabController.getLiabilityById
);

// Update a liability
router.put(
  '/liabilities/:id',
  ensureAuthenticated,
  liabController.updateLiability
);

// Bulk-delete
router.delete(
  '/liabilities/bulk-delete',
  ensureAuthenticated,
  liabController.bulkDeleteLiabilities
);

// Delete one
router.delete(
  '/liabilities/:id',
  ensureAuthenticated,
  liabController.deleteLiability
);



module.exports = router;
