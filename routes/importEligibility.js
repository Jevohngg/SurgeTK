// routes/importEligibility.js
const express = require('express');
const router  = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { getEligibility }     = require('../controllers/importEligibilityController');

router.get('/eligibility', ensureAuthenticated, getEligibility);

module.exports = router;
