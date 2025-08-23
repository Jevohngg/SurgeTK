// routes/insuranceRoutes.js
// SurgeTK / Invictus — Insurance Routes
// -------------------------------------------------------------
// Mount under /api/insurance (recommended).
// If you have an auth middleware like requireUser, apply it here.

'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });

// If your project uses authentication, require and apply it here.
// const { requireUser } = require('../middleware/auth');

const controller = require('../controllers/insuranceController');

// Bulk operations should be defined before routes that take :id
router.post('/bulk-delete', /* requireUser, */ controller.bulkDelete);

// Collection routes
router.get('/', /* requireUser, */ controller.list);
router.post('/', /* requireUser, */ controller.create);

// Item routes
router.get('/:id', /* requireUser, */ controller.getById);
router.put('/:id', /* requireUser, */ controller.update);
router.patch('/:id', /* requireUser, */ controller.update);
router.delete('/:id', /* requireUser, */ controller.remove);

module.exports = router;
