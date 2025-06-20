// routes/firmRoutes.js
const express = require('express');
const router  = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const firmCtl = require('../controllers/firmController');

router.get('/value-adds', ensureAuthenticated, firmCtl.getEnabledValueAdds);

module.exports = router;
