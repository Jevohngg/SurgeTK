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



router.delete(
  '/accounts/bulk-delete',
  ensureAuthenticated,
  accountController.bulkDeleteAccounts
);


// Get account details
router.get('/accounts/:accountId', ensureAuthenticated, accountController.getAccountById);

router.put('/accounts/:accountId', ensureAuthenticated, accountController.updateAccount);



module.exports = router;
