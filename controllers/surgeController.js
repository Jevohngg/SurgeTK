// controllers/surgeController.js
/*  ---------------------------------------------------------------------------
 *  Thin REST layer for the Surge feature.
 *  Heavy async work (PDF generation, queue jobs) is intentionally deferred
 *  to Phase 3+, so every handler below MUST remain non-blocking.
 *  ------------------------------------------------------------------------- */
const mongoose               = require('mongoose');
const { validationResult }   = require('express-validator');
const Surge                  = require('../models/Surge');
const SurgeSnapshot          = require('../models/SurgeSnapshot');
const Household              = require('../models/Household');
const {
  uploadFile,
  buildSurgeUploadKey,
  deleteFile,
  generatePreSignedUrl,
  buildSurgePacketKey
} = require('../utils/s3');
const { VALUE_ADD_TYPES }    = require('../utils/constants');

const { buildPacketJob }     = require('../utils/pdf/packetBuilder');
const surgeQueuePromise      = require('../utils/queue/surgeQueue');

/* NEW → helper to pre-seed missing Value-Add docs */
const { seedValueAdds }      = require('../utils/valueAdd/seedHelper');
const { buildHouseholdRow } = require('../utils/surge/householdRowHelper');

const WARNING_TYPES = require('../utils/constants').WARNING_TYPES;

/* ---------------------------------------------------------------------------
 *  Helper – ensure request came from same firm
 * ------------------------------------------------------------------------- */
function assertFirmMatch(doc, userFirmId) {
  if (!doc || doc.firmId.toString() !== userFirmId.toString()) {
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }
}

/* ===========================================================================
   1.  POST  /api/surge        – Create Surge
   ======================================================================== */
exports.createSurge = async (req, res, next) => {
  try {
    // 1) Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, startDate, endDate } = req.body;
    const firmId    = req.session.user.firmId;
    const createdBy = req.session.user._id;

    const localStart = new Date(`${startDate}T00:00:00`);
    const localEnd   = new Date(`${endDate}T00:00:00`);
    
    const surge = await Surge.create({
      firmId,
      name:      name.trim(),
      startDate: localStart,
      endDate:   localEnd,
      valueAdds: VALUE_ADD_TYPES.map(t => ({ type: t })), // default: all enabled
      order:     VALUE_ADD_TYPES.slice(),
      uploads:   [],
      createdBy
    });

    return res.status(201).json({ surge });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'A Surge with that name already exists.' });
    }
    next(err);
  }
};

/* ===========================================================================
   2.  GET   /api/surge        – List Surges (paginated)
   ======================================================================== */
exports.listSurges = async (req, res, next) => {
  try {
    const firmId = req.session.user.firmId;
    let { page = 1, limit = 10, status } = req.query;
    page  = Number(page);
    limit = Number(limit);

    // 1) Base query
    const query = { firmId };
    if (status) {
      query.$expr = { // server‐side filter by computed status
        $eq: [
          status,
          {
            $switch: {
              branches: [
                { case: { $lt: ['$$NOW', '$startDate'] }, then: 'upcoming' },
                { case: { $gt: ['$$NOW', '$endDate']   }, then: 'past'     }
              ],
              default: 'active'
            }
          }
        ]
      };
    }

    // 2) Fetch raw surge docs + total count
    const [ rawSurges, total ] = await Promise.all([
      Surge.find(query)
           .sort({ createdAt: -1 })
           .skip((page - 1) * limit)
           .limit(limit)
           .lean(),
      Surge.countDocuments(query),
    ]);

    // 3) Compute householdCount once (all households in your firm)
    const householdCount = await Household.countDocuments({ firmId });

    // 4) For each surge, compute status and how many snapshots it has
    const surges = await Promise.all(rawSurges.map(async s => {
      // a) status string
      const now = new Date();
      let st = 'active';
      if (now < s.startDate) st = 'upcoming';
      else if (now > s.endDate)  st = 'past';

      // b) number of prepared packets = SurgeSnapshot count
      const preparedCount   = await SurgeSnapshot.countDocuments({ surgeId: s._id });
      const unpreparedCount = householdCount - preparedCount;

      return {
        _id:           s._id,
        name:          s.name,
        startDate:     s.startDate,
        endDate:       s.endDate,
        status:        st,
        preparedCount,                  // e.g. 3
        householdCount,                 // same for all rows
        createdAt:     s.createdAt,
        updatedAt:     s.updatedAt,
        unpreparedCount
      };
    }));

    // 5) Return enriched objects
    return res.json({
      surges,
      currentPage: page,
      totalPages:  Math.ceil(total / limit),
      total,
    });
  } catch (err) {
    next(err);
  }
};

/* ===========================================================================
   3.  GET   /api/surge/:id    – Detail
   ======================================================================== */
exports.getSurge = async (req, res, next) => {
  try {
    const surge = await Surge.findById(req.params.id);
    assertFirmMatch(surge, req.session.user.firmId);
    res.json({ surge });
  } catch (err) {
    next(err);
  }
};

/* ===========================================================================
   4.  PATCH /api/surge/:id/reorder   – Update valueAdds / uploads order
   ======================================================================== */
exports.reorderSurge = async (req, res, next) => {
  try {
    const { order } = req.body;                     // ← single array now
    const surge     = await Surge.findById(req.params.id);
    assertFirmMatch(surge, req.session.user.firmId);

    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ message: 'order must be a non-empty array' });
    }

    // 1) Build lookup maps
    const vaByType = new Map(surge.valueAdds.map(v => [v.type, v]));
    const upById   = new Map(surge.uploads  .map(u => [u._id.toString(), u]));

    // 2) Re-assemble in the supplied order
    const newVAs = [];
    const newUps = [];
    order.forEach(entry => {
      if (vaByType.has(entry))     newVAs.push(vaByType.get(entry));
      else if (upById.has(entry))  newUps.push(upById.get(entry));
      // silently ignore unknown ids
    });

    // 3) Persist
    surge.valueAdds = newVAs;
    surge.uploads   = newUps;
    surge.order     = order;  
    await surge.save();

    res.json({ message: 'Order updated', surge });
  } catch (err) {
    next(err);
  }
};


/* ──────────────────────────────────────────────────────────────────────────
 * PATCH /api/surge/:id/value-adds
 * Body ⇒ { valueAdds:[ 'BUCKETS', 'NET_WORTH', … ] }
 * Replaces the Value‑Add list for ONE Surge and rewrites surge.order.
 * ─────────────────────────────────────────────────────────────────────── */
exports.updateValueAdds = async (req, res, next) => {
    try {
      const { valueAdds } = req.body;
      if (!Array.isArray(valueAdds))
        return res.status(400).json({ message: 'valueAdds must be an array' });
  
      const surge = await Surge.findById(req.params.id);
      assertFirmMatch(surge, req.session.user.firmId);
  
      // 1️⃣ replace valueAdds[]
      surge.valueAdds = valueAdds.map(t => ({ type: t }));
  
      // 2️⃣ re‑create order[]  (VA tokens first, then any existing uploads)
      const uploadIds = surge.uploads.map(u => u._id.toString());
      surge.order = [...valueAdds, ...uploadIds];
  
      await surge.save();
      return res.json({ message: 'Value‑Adds updated', surge });
    } catch (err) { next(err); }
  };
  

/* ===========================================================================
   5.  POST  /api/surge/:id/upload   – Add a PDF upload
   ======================================================================== */
/* ===========================================================================
   5.  POST  /api/surge/:id/upload   – Add a PDF upload
   ======================================================================== */
   exports.uploadPdf = async (req, res, next) => {
    try {
      // Ensure a file is present and is a PDF
      if (!req.file)
        return res.status(400).json({ message: 'No file uploaded.' });
      if (req.file.mimetype !== 'application/pdf')
        return res.status(400).json({ message: 'Only PDF files are allowed.' });
  
      const surge = await Surge.findById(req.params.id);
      assertFirmMatch(surge, req.session.user.firmId);
  
      /* ------------------------------------------------------------------
       * 1.  Pre‑generate an ObjectId so we can compute the final S3 key
       * ------------------------------------------------------------------ */
      const uploadId = new mongoose.Types.ObjectId();          // NEW
      const finalKey = buildSurgeUploadKey(surge._id, uploadId);
  
      /* ------------------------------------------------------------------
       * 2.  Upload the file to S3 first — if this fails nothing is saved
       * ------------------------------------------------------------------ */
      await uploadFile(req.file.buffer, req.file.originalname, finalKey);
  
      /* ------------------------------------------------------------------
       * 3.  Push the fully‑formed sub‑document (s3Key already set) and save
       * ------------------------------------------------------------------ */
      surge.uploads.push({
        _id      : uploadId,
        fileName : req.file.originalname,
        s3Key    : finalKey,
        pageCount: null
      });
      surge.order.push(uploadId.toString());
      await surge.save();            // ✅ passes validation: s3Key present
  
      /* ------------------------------------------------------------------
       * 4.  Respond with the newly created upload object
       * ------------------------------------------------------------------ */
      const newUpload = surge.uploads.id(uploadId).toObject();
      return res.status(201).json({ upload: newUpload });
  
    } catch (err) {
      next(err);
    }
  };
  

/* ===========================================================================
   6.  DELETE /api/surge/:id/upload/:uploadId   – Remove upload
   ======================================================================== */
/* ===========================================================================
   6.  DELETE /api/surge/:id/upload/:uploadId   – Remove upload
   ======================================================================== */
   exports.deleteUpload = async (req, res, next) => {
    try {
      const { id, uploadId } = req.params;
  
      // 1) Fetch Surge doc (NOT .lean()) so we get mutatable arrays
      const surge = await Surge.findById(id);
      assertFirmMatch(surge, req.session.user.firmId);
  
      // 2) Locate the upload sub‑doc
      const upload = surge.uploads.id(uploadId);
      if (!upload) return res.status(404).json({ message: 'Upload not found.' });
  
      // 3) Delete the S3 object first – if that fails we abort
      await deleteFile(upload.s3Key);
  
      // 4) Remove from the uploads array *and* from surge.order
      surge.uploads.pull(uploadId);                                // ← SAFE in Mongoose 6
      surge.order   = surge.order.filter(tok => tok !== uploadId); // keep tokens in sync
  
      await surge.save();
  
      res.json({ message: 'Upload deleted.' });
    } catch (err) {
      next(err);   // central error handler will log it
    }
  };
  

/* ===========================================================================
   7.  GET /api/surge/:id/households    – Lazy list for composer table
   ======================================================================== */



/* ===========================================================================
   7.  GET /api/surge/:id/households    – Robust list for composer table
   ======================================================================== */
   exports.listHouseholds = async (req, res, next) => {
    try {
      /* ── 1.  Parse & normalise query params ─────────────────────────── */
      const firmId   = req.session.user.firmId;
      const surgeId  = req.params.id;
  
      const page   = Math.max(+req.query.page  || 1, 1);
      const limit  = Math.min(+req.query.limit || 20, 100);
  
      const search       = String(req.query.search || '').trim();
      const sortOrder    = req.query.sortOrder === 'desc' ? -1 : 1;
  
      /* ⇢ NEW – multi‑select warn filters
         Accepts  ☐ ANY  ☐ NONE  ☐ individual IDs                       */
      const warnFilters = Array.isArray(req.query.warn) ?
                            req.query.warn : String(req.query.warn || '').split(',').filter(Boolean);
  
      /* ⇢ NEW – checkbox pair rather than dropdown                      */
      let preparedFilter = 'all';                       // default
      if (Array.isArray(req.query.prepared) && req.query.prepared.length) {
        const hasYes = req.query.prepared.includes('yes');
        const hasNo  = req.query.prepared.includes('no');
        preparedFilter = (hasYes && hasNo) ? 'all'
                        :  hasYes         ? 'yes'
                        :  hasNo          ? 'no'
                        :  'all';
      }
  
      /* ── 2.  Fetch the Surge doc just once (needed later) ───────────── */
      const surgeDoc = await Surge.findById(surgeId).lean();
      if (!surgeDoc) return res.status(404).json({ message: 'Surge not found' });
  
      /* ── 3.  Build initial MongoDB `$match` (firm‑scoped + search) ──── */
      /* 3) Base match – firm scope only.
                                     */
    const match = { firmId: new mongoose.Types.ObjectId(firmId) };

  
      /* ── 4.  Pull **all** matching household IDs (no paging yet) ───── */
      const allIds = await Household.aggregate()
        .match(match)
        .sort({ householdName: sortOrder })          // server‑side sort
        .project({ _id: 1 })
        .exec();
  
      /* ── 5.  Enrich every household with warnings + prepared flag ──── */
      const householdsFull = (await Promise.all(
        allIds.map(r => buildHouseholdRow({ surge: surgeDoc, householdId: r._id }))
      )).filter(Boolean);                            // drop nulls
  
      /* ── 6.  Apply prepared & warning filters BEFORE paging ─────────── */
      let filtered = householdsFull;
            /* ⇢ TEXT SEARCH (now runs on the computed householdName & advisorName) */
            if (search) {
                const q = search.toLowerCase();
                filtered = filtered.filter(h =>
                  h.householdName.toLowerCase().includes(q) ||
                  (h.advisorName || '').toLowerCase().includes(q)
                );
              }

      /* keep sort toggle working */
      filtered.sort((a, b) => {
        return a.householdName.localeCompare(b.householdName) * (sortOrder);
      });

        
  
      /* prepared yes|no */
      if (preparedFilter === 'yes')
        filtered = filtered.filter(h =>  h.prepared);
      else if (preparedFilter === 'no')
        filtered = filtered.filter(h => !h.prepared);
  
      /* warning filters */
      if (warnFilters.length) {
        const wantsAny  = warnFilters.includes('ANY');
        const wantsNone = warnFilters.includes('NONE');
        const specific  = warnFilters.filter(w => !['ANY','NONE'].includes(w));
  
        filtered = filtered.filter(h => {
          const hasWarns = h.warningIds.length > 0;
  
          /* (1) ANY */
          if (wantsAny && hasWarns) return true;
  
          /* (2) NONE */
          if (wantsNone && !hasWarns) return true;
  
          /* (3) specific IDs (OR logic) */
          if (specific.length && specific.some(id => h.warningIds.includes(id)))
            return true;
  
          return false;
        });
      }
  
      /* ── 7.  Manual pagination (now that record‑set is final) ──────── */
      const totalCount = filtered.length;
      const totalPages = Math.max(Math.ceil(totalCount / limit), 1);
  
      const start = (page - 1) * limit;
      const householdsPage = filtered.slice(start, start + limit);
  
      return res.json({
        households      : householdsPage,
        currentPage     : page,
        totalPages,
        totalHouseholds : totalCount
      });
    } catch (err) { next(err); }
  };
  


/* ===========================================================================
   8.  POST /api/surge/:id/prepare   – Kick off batch build
   ======================================================================== */
   exports.prepareSurge = async (req, res) => {
    try {
      const surgeId                       = req.params.id;
      const { households, order, action } = req.body;
      const surge                         = await Surge.findById(surgeId).lean();
  
      if (!surge)        return res.status(404).json({ message: 'Surge not found' });
      if (!Array.isArray(households) || households.length === 0)
        return res.status(400).json({ message: 'No households specified' });
  
      /* ─────────────────────────────────────────────────────────────────────
       * 1.  Socket room & helper
       * ──────────────────────────────────────────────────────────────────── */
      const io       = req.app.locals.io;
      const userRoom = req.session.user._id.toString();
  
      /* ─────────────────────────────────────────────────────────────────────
       * 2.  Fine‑grained progress counters
       *     One “step” = one PDF rendered (Value‑Add or static upload)
       * ──────────────────────────────────────────────────────────────────── */
      const stepsPerHousehold =
        surge.valueAdds.length + surge.uploads.length;              // e.g. 4 VAs + 2 uploads = 6
      const totalSteps     = households.length * stepsPerHousehold; // immutable
      let   stepsCompleted = 0;
  
      const emitProgress = () => {
        io.to(userRoom).emit('surge:progress', {
          surgeId,
          completed: stepsCompleted,
          total:     totalSteps
        });
      };
  
      // Send an initial “0 %” tick so the bar appears instantly
      emitProgress();
  
      /* ─────────────────────────────────────────────────────────────────────
       * 3.  Queue setup
       * ──────────────────────────────────────────────────────────────────── */
      const surgeQueue  = await surgeQueuePromise;
      let   successCnt  = 0;
      let   errorCnt    = 0;
  
      /* progressCb handed down to every buildPacketJob */
      const progressCb = (inc = 1) => {
        stepsCompleted += inc;
        emitProgress();                       // push to client ASAP
      };
  
      /* ─────────────────────────────────────────────────────────────────────
       * 4.  Enqueue each household in the chosen order
       * ──────────────────────────────────────────────────────────────────── */
      for (const hhId of order) {
        if (!households.includes(hhId)) continue;   // user removed in modal
  
        surgeQueue.add(async () => {
          try {
            await buildPacketJob({
              surge,
              householdId:  hhId,
              host:         `${req.protocol}://${req.get('host')}`,
              progressCb,                           // ← NEW
              cookieHeader: req.headers.cookie
            });
            successCnt++;
          } catch (err) {
            console.error('[Surge] packet error →', hhId, err);
            errorCnt++;
          }
        });
      }
  
      /* ─────────────────────────────────────────────────────────────────────
       * 5.  When queue drains → optional ZIP build & final socket event
       * ──────────────────────────────────────────────────────────────────── */
      surgeQueue.onIdle().then(async () => {
        let zipUrl = '';
  
        if (action === 'save-download') {
          try {
            const { buildZipAndUpload } = require('../utils/pdf/zipHelper');
            zipUrl = await buildZipAndUpload({ surgeId, householdIds: order });
          } catch (zipErr) {
            console.error('[Surge] ZIP build failed:', zipErr);
          }
        }
  
        // Ensure progress bar hits 100 %
        stepsCompleted = totalSteps;
        emitProgress();
  
        io.to(userRoom).emit('surge:allDone', {
          surgeId,
          action,
          successCount: successCnt,
          errorCount:   errorCnt,
          total:        households.length,
          zipUrl
        });
      });
  
      /* ─────────────────────────────────────────────────────────────────────
       * 6.  Immediate 202 Accepted
       * ──────────────────────────────────────────────────────────────────── */
      return res.status(202).json({ queued: true, total: households.length });
    } catch (err) {
      console.error('[Surge] prepare error', err);
      return res.status(500).json({ message: 'Server error' });
    }
  };

/* ===========================================================================
   9.  GET /api/surge/:id/packet/:householdId   – Download link
   ======================================================================== */
exports.getPacketLink = async (req, res, next) => {
  try {
    const { id, householdId } = req.params;
    const surge              = await Surge.findById(id);
    assertFirmMatch(surge, req.session.user.firmId);

    const key = buildSurgePacketKey(id, householdId);
    const url = generatePreSignedUrl(key);
    res.json({ url });
  } catch (err) {
    next(err);
  }
};



/**
 * PATCH /api/surge/:id
 * Update surge name, startDate, endDate
 */
exports.updateSurge = async (req, res, next) => {
    try {
      const { name, startDate, endDate } = req.body;
      const surge = await Surge.findById(req.params.id);
      assertFirmMatch(surge, req.session.user.firmId);
  
      // apply updates
      surge.name      = name.trim();
      surge.startDate = new Date(startDate);
      surge.endDate   = new Date(endDate);
      await surge.save();
  
      // return the full updated object
      res.json({ surge: surge.toObject() });
    } catch (err) {
      next(err);
    }
  };


  /* ===========================================================================
   11.  DELETE /api/surge/:id          – Delete Surge + snapshots
   ======================================================================== */
exports.deleteSurge = async (req, res, next) => {
  try {
    const surge = await Surge.findById(req.params.id);
    assertFirmMatch(surge, req.session.user.firmId);

    // 1) Delete any SurgeSnapshots tied to this surge
    await SurgeSnapshot.deleteMany({ surgeId: surge._id });

    // 2) OPTIONAL: delete uploads from S3
    // for (const up of surge.uploads) await deleteFile(up.s3Key);

    // 3) Finally remove the surge itself
    await surge.deleteOne();

    return res.json({ message: 'Surge deleted' });
  } catch (err) {
    next(err);
  }
};

  