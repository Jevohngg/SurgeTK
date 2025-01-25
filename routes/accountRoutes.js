// routes/accountRoutes.js

const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');
const multer = require('multer'); // Only if you're not already using it here
const upload = multer({ dest: 'uploads/' });
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');

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

router.delete(
  '/accounts/:accountId',
  ensureAuthenticated,
  accountController.deleteAccount
);


// Get account details
router.get('/accounts/:accountId', ensureAuthenticated, ensureOnboarded, accountController.getAccountById);

router.put('/accounts/:accountId', ensureAuthenticated, accountController.updateAccount);

/**
 * Import Accounts - Step 1:
 * POST /accounts/import
 *  - Accepts a file upload (CSV/Excel)
 *  - Parses the file, extracts the first row as headers, returns them
 */
router.post(
  '/accounts/import',
  ensureAuthenticated,
  upload.single('fileUpload'),
  accountController.importAccounts
);

/**
 * Import Accounts - Step 2:
 * POST /accounts/import/mapped
 *  - Receives the mapping + uploadedData from the frontend
 *  - Performs the actual create/update of accounts
 */
router.post(
  '/accounts/import/mapped',
  ensureAuthenticated,
  accountController.importAccountsWithMapping
);





module.exports = router;
