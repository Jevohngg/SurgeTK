// routes/accountRoutes.js

const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');
const { ensureAuthenticated } = require('../middleware/authMiddleware');

// Create a new account
router.post(
  '/households/:householdId/accounts',
  ensureAuthenticated,
  accountController.createAccount
);

// Get accounts for a household
router.get(
  '/households/:householdId/accounts',
  ensureAuthenticated,
  accountController.getAccountsByHousehold
);

// Update an account
router.put(
  '/accounts/:accountId',
  ensureAuthenticated,
  accountController.updateAccount
);

// Delete an account
router.delete(
  '/accounts/:accountId',
  ensureAuthenticated,
  accountController.deleteAccount
);

module.exports = router;
