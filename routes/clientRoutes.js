const express = require('express');
const router  = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const clientController = require('../controllers/clientController');

router.get('/clients', ensureAuthenticated, clientController.listClients);

module.exports = router;
