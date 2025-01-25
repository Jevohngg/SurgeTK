// routes/valueAddRoutes.js

const express = require('express');
const router = express.Router();
const valueAddController = require('../controllers/valueAddController');

// 1) Get all ValueAdds for a household
router.get('/household/:householdId', valueAddController.getValueAddsForHousehold);

// 2) Get a single ValueAdd by ID
router.get('/:id', valueAddController.getValueAdd);

// 3) Create a Guardrails ValueAdd
router.post('/household/:householdId/guardrails', valueAddController.createGuardrailsValueAdd);

// 4) Update an existing Guardrails ValueAdd
router.put('/:id/guardrails', valueAddController.updateGuardrailsValueAdd);

// 5) Render the Pug page for the Guardrails ValueAdd
// router.get('/:id/view', valueAddController.viewGuardrailsPage);


// CREATE a Buckets ValueAdd
router.post('/household/:householdId/buckets', valueAddController.createBucketsValueAdd);

// UPDATE a Buckets ValueAdd
router.put('/:id/buckets', valueAddController.updateBucketsValueAdd);

// GET the "view" for any ValueAdd type
router.get('/:id/view', valueAddController.viewValueAddPage);

router.get('/:id/download', valueAddController.downloadValueAddPDF);
router.post('/:id/email', valueAddController.emailValueAddPDF);



module.exports = router;
