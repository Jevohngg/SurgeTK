// routes/newImportRoutes.js
const express = require('express');
const router = express.Router();

const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage });

const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { uploadAccountFile, processAccountImport } = require('../controllers/accountImportController'); 
const {
  uploadContactFile,
  processContactImport,
  getImportReports // <--- import the new function
} = require('../controllers/newImportController');


const { downloadImportedFile } = require('../controllers/newImportController');

router.get('/history/:reportId/download', ensureAuthenticated, downloadImportedFile);


// Contact Import Endpoints
router.post('/contact/file', upload.single('file'), uploadContactFile);
router.post('/contact/process', processContactImport);

// Account Import Endpoints
router.post('/account/file', upload.single('file'), uploadAccountFile);
router.post('/account/process', processAccountImport);

// NEW: Import History GET
router.get('/history', ensureAuthenticated, getImportReports);

module.exports = router;
