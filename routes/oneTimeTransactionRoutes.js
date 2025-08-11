// routes/oneTimeTransactionRoutes.js
const express = require('express');
const router = express.Router({ mergeParams: true });
const ctrl = require('../controllers/oneTimeTransactionController');

// Base path examples shown below in 3b
router.get('/api/accounts/:accountId/one-time-transactions', ctrl.list);
router.post('/api/accounts/:accountId/one-time-transactions', ctrl.create);
router.put('/api/accounts/:accountId/one-time-transactions/:txnId', ctrl.update);
router.delete('/api/accounts/:accountId/one-time-transactions/:txnId', ctrl.destroy);

module.exports = router;
