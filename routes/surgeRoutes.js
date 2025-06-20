/* ────────────────────────────────────────────────────────────────────────────
 * routes/surgeRoutes.js
 * ---------------------------------------------------------------------------
 * REST layer for the Surge feature
 * ------------------------------------------------------------------------- */
const express    = require('express');
const { body, param } = require('express-validator');
const multer     = require('multer');
const rateLimit  = require('express-rate-limit');

const upload = multer({ storage: multer.memoryStorage() });

const { ensureAuthenticated } = require('../middleware/authMiddleware');
const surgeCtl                = require('../controllers/surgeController');
// (VALUE_ADD_TYPES is still imported in case future validators need it)
const { VALUE_ADD_TYPES }     = require('../utils/constants');

const router = express.Router();

/* ===========================================================================
 *  ⬤  Rate‑limit  /prepare  – 6 attempts / minute / IP
 * ======================================================================== */
const prepareLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 min
  max: 6,                // 6 requests
  standardHeaders: true,
  legacyHeaders: false
});

/* ===========================================================================
 *  Helper validators
 * ======================================================================== */
const dateISO = (field) =>
  body(field).isISO8601().withMessage(`${field} must be ISO date`);

const mongoId = (field) =>
  param(field, 'Invalid ObjectId').isMongoId();

/* ===========================================================================
 *  1.  POST /api/surge           – Create Surge
 * ======================================================================== */
router.post(
  '/',
  ensureAuthenticated,
  [
    body('name').trim().isLength({ min: 1, max: 60 }),
    dateISO('startDate'),
    dateISO('endDate')
  ],
  surgeCtl.createSurge
);

/* ===========================================================================
 *  2.  GET /api/surge            – List Surges
 * ======================================================================== */
router.get('/', ensureAuthenticated, surgeCtl.listSurges);

/* ===========================================================================
 *  3.  GET /api/surge/:id        – Surge detail
 * ======================================================================== */
router.get('/:id', ensureAuthenticated, mongoId('id'), surgeCtl.getSurge);


/* ===========================================================================
 *  PATCH /api/surge/:id        – Update Surge name & dates
 * ======================================================================== */
router.patch(
    '/:id',
    ensureAuthenticated,
    mongoId('id'),
    body('name').trim().isLength({ min: 1, max: 60 }).withMessage('Name is required (1–60 chars)'),
    dateISO('startDate'),
    dateISO('endDate'),
    surgeCtl.updateSurge
  );
  

/* ===========================================================================
 *  4.  PATCH /api/surge/:id/reorder   – Update module strip order
 * ======================================================================== */
router.patch(
  '/:id/reorder',
  ensureAuthenticated,
  mongoId('id'),
  body('order').isArray({ min: 1 }),          // ← single mixed array (VA types + uploadIds)
  surgeCtl.reorderSurge
);

/* ===========================================================================
 *  5.  POST /api/surge/:id/upload       – Add PDF upload
 * ======================================================================== */
router.post(
  '/:id/upload',
  ensureAuthenticated,
  mongoId('id'),
  upload.single('file'),
  surgeCtl.uploadPdf
);

/* ===========================================================================
 *  6.  DELETE /api/surge/:id/upload/:uploadId   – Remove upload
 * ======================================================================== */
router.delete(
  '/:id/upload/:uploadId',
  ensureAuthenticated,
  mongoId('id'),
  mongoId('uploadId'),
  surgeCtl.deleteUpload
);

/* ===========================================================================
 *  7.  GET /api/surge/:id/households   – Household list (lazy)
 * ======================================================================== */
router.get(
  '/:id/households',
  ensureAuthenticated,
  mongoId('id'),
  surgeCtl.listHouseholds
);

/* ===========================================================================
 *  8.  POST /api/surge/:id/prepare     – Batch build
 * ======================================================================== */
router.post(
  '/:id/prepare',
  ensureAuthenticated,
  prepareLimiter,                          // ⬅ rate‑limit
  mongoId('id'),
  [
    body('households').isArray({ min: 1, max: 20 }),
    body('order').isArray({ min: 1 }),
    body('action').isIn(['save', 'save-download', 'save-print'])
  ],
  surgeCtl.prepareSurge
);

/* ===========================================================================
 *  9.  GET /api/surge/:id/packet/:householdId   – Presigned link
 * ======================================================================== */
router.get(
  '/:id/packet/:householdId',
  ensureAuthenticated,
  mongoId('id'),
  mongoId('householdId'),
  surgeCtl.getPacketLink
);

/* ========================================================================
 * 10. PATCH /api/surge/:id/value-adds   – Choose Value‑Adds for this Surge
 * ===================================================================== */
router.patch(
  '/:id/value-adds',                 // ⬅︎ path now matches the pattern above
  ensureAuthenticated,
  mongoId('id'),
  body('valueAdds').isArray({ min: 1 }),   // basic body validator
  surgeCtl.updateValueAdds            // ⬅︎ same alias used everywhere else
);
module.exports = router;
