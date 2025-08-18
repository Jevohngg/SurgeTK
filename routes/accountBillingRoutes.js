// routes/accountBillingRoutes.js
const express = require('express');
const router = express.Router({ mergeParams: true });
const ctrl = require('../controllers/accountBillingController');

// These paths line up with the frontend (account-billing-modal.js)
router.get('/api/accounts/:accountId/billing-entries', ctrl.list);
router.post('/api/accounts/:accountId/billing-entries', ctrl.create);
router.put('/api/accounts/:accountId/billing-entries/:entryId', ctrl.update);
router.delete('/api/accounts/:accountId/billing-entries/:entryId', ctrl.destroy);

module.exports = router;
