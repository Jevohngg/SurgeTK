// routes/householdFeeRoutes.js
const express = require('express');
const router = express.Router({ mergeParams: true });
const ctrl = require('../controllers/householdFeeController');

// REST endpoints expected by the frontend JS
router.get('/api/households/:householdId/fee-entries', ctrl.list);
router.post('/api/households/:householdId/fee-entries', ctrl.create);
router.put('/api/households/:householdId/fee-entries/:entryId', ctrl.update);
router.delete('/api/households/:householdId/fee-entries/:entryId', ctrl.destroy);

module.exports = router;
