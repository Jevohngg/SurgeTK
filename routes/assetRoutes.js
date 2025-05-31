// routes/assetRoutes.js

const express = require('express');
const router = express.Router();
const assetController = require('../controllers/assetsController');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');

// Create a new asset
router.post(
  '/households/:householdId/assets',
  ensureAuthenticated,
  ensureOnboarded,
  assetController.createAsset
);

// List / search / paginate assets
router.get(
  '/households/:householdId/assets',
  ensureAuthenticated,
  ensureOnboarded,
  assetController.getAssets
);

// ----------------------------------------
// ADD THE BULK-DELETE ROUTE BEFORE :id
// ----------------------------------------
router.delete(
  '/assets/bulk-delete',
  ensureAuthenticated,
  assetController.bulkDeleteAssets
);

// Get one asset
router.get(
  '/assets/:id',
  ensureAuthenticated,
  ensureOnboarded,
  assetController.getAssetById
);

// Update an asset
// Update an asset
router.put(
 '/households/:householdId/assets/:id',
 ensureAuthenticated,
 ensureOnboarded,
 assetController.updateAsset
);

// Delete one
router.delete(
  '/assets/:id',
  ensureAuthenticated,
  assetController.deleteAsset
);

module.exports = router;
