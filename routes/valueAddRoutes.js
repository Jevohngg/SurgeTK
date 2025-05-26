// routes/valueAddRoutes.js

const express = require('express');
const router = express.Router();
const valueAddController = require('../controllers/valueAddController');
const {
    getValueAddsForHousehold,
    getValueAdd,
    createGuardrailsValueAdd,
    updateGuardrailsValueAdd,
    createBucketsValueAdd,
    updateBucketsValueAdd,
    createBeneficiaryValueAdd,
    updateBeneficiaryValueAdd,
    viewValueAddPage,
    downloadValueAddPDF,
    emailValueAddPDF,
    saveValueAddSnapshot,
    getValueAddSnapshots,
    viewSnapshot,
  
    // NEW: the two functions you just defined
    downloadValueAddSnapshotPDF,
    emailValueAddSnapshotPDF
  } = require('../controllers/valueAddController');
  

  

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

router.post('/household/:householdId/beneficiary', valueAddController.createBeneficiaryValueAdd);

// UPDATE a Buckets ValueAdd
router.put('/:id/buckets', valueAddController.updateBucketsValueAdd);
router.put('/:id/beneficiary', valueAddController.updateBeneficiaryValueAdd);

// Render the Beneficiary page
router.get(
  '/:id/view/beneficiary',
  valueAddController.viewBeneficiaryPage
);

// routes/valueAddRoutes.js
router.post('/household/:householdId/networth', valueAddController.createNetWorthValueAdd);
router.put('/:id/networth', valueAddController.updateNetWorthValueAdd);


// GET the "view" for any ValueAdd type
router.get('/:id/view', valueAddController.viewValueAddPage);

router.get('/:id/download', valueAddController.downloadValueAddPDF);
router.post('/:id/email', valueAddController.emailValueAddPDF);
router.post('/:id/save-snapshot', valueAddController.saveValueAddSnapshot);

// Download snapshot as PDF
router.get('/:id/download/:snapshotId', downloadValueAddSnapshotPDF);

// Email snapshot as PDF
router.post('/:id/email-snapshot/:snapshotId', emailValueAddSnapshotPDF);



// List Snapshots
router.get('/:id/snapshots', valueAddController.getValueAddSnapshots);

// Render a specific snapshot
router.get('/:id/view/:snapshotId', valueAddController.viewSnapshot)


module.exports = router;
