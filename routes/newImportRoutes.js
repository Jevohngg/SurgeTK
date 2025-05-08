// routes/newImportRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage });


const householdController = require('../controllers/householdController');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');
const noCache = require('../middleware/noCacheMiddleware'); 
const { uploadAccountFile, processAccountImport } = require('../controllers/accountImportController'); 

const {
  uploadContactFile,
  processContactImport
} = require('../controllers/newImportController');



// 1) POST /api/new-import/contact/file
//    Use in-memory upload
router.post('/contact/file', upload.single('file'), uploadContactFile);

// 2) POST /api/new-import/contact/process
router.post('/contact/process', processContactImport);

router.post('/account/file', upload.single('file'), uploadAccountFile);
router.post('/account/process', processAccountImport);

module.exports = router;
