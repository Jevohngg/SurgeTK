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


const { uploadFile, buildSurgeUploadKey, deleteFile, generatePreSignedUrl, buildSurgePacketKey } = require('../utils/s3');
const { buildZipAndUpload } = require('../utils/pdf/zipHelper');
const { VALUE_ADD_TYPES }    = require('../utils/constants');

const { buildPacketJob }     = require('../utils/pdf/packetBuilder');
const { randomUUID } = require('crypto');
const { surgeQueue, surgeEvents, redisClient } = require('../utils/queue/surgeQueue');


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

    if (!(localStart instanceof Date) || isNaN(localStart) ||
    !(localEnd   instanceof Date) || isNaN(localEnd)   ||
    localEnd <= localStart) {
  return res.status(400).json({ message: 'End date must be after the start date.' });
}
    
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
    // Duplicate name (unique index) -> 409 Conflict with a human-friendly message
    if (err && err.code === 11000) {
      return res.status(409).json({
        message: "A surge with that name already exists."
      });
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
   7.  GET /api/surge/:id/households  – Optimised list for composer table
   ======================================================================== */
   exports.listHouseholds = async (req, res, next) => {
    try {
      console.log('\n[surge:listHouseholds] URL:', req.originalUrl);
      console.log('[surge:listHouseholds] raw query:', req.query);
      /* ── 1.  Parse & normalise query params ─────────────────────────── */
      const firmId  = req.session.user.firmId;
      const surgeId = req.params.id;
  
      const page  = Math.max(+req.query.page  || 1, 1);
      const limit = Math.min(+req.query.limit || 20, 100);
  
      const search    = String(req.query.search || '').trim();
      const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1;
  
      /* ⇢ multi‑select warn filters:   ANY | NONE | individual IDs */
      const warnFilters = Array.isArray(req.query.warn)
        ? req.query.warn
        : String(req.query.warn || '').split(',').filter(Boolean);
  
      /* ⇢ prepared filter: checkbox pair (yes / no) */
      let preparedFilter = 'all';             // default
      if (Array.isArray(req.query.prepared) && req.query.prepared.length) {
        const hasYes = req.query.prepared.includes('yes');
        const hasNo  = req.query.prepared.includes('no');
        preparedFilter = (hasYes && hasNo) ? 'all'
                        :  hasYes         ? 'yes'
                        :  hasNo          ? 'no'
                        :  'all';
      }
  
      /* ★ NEW — parse advisor filters (accepts advisor / advisors / advisorIds, array or CSV) */
      const toMulti = v =>
        Array.isArray(v) ? v : String(v || '').split(',').map(s => s.trim()).filter(Boolean);
  
      const advisorFilterIds = Array.from(new Set([
        ...toMulti(req.query.advisor),
        ...toMulti(req.query.advisors),
        ...toMulti(req.query.advisorIds)
      ])).filter(id => id.toLowerCase() !== 'all'); // ignore accidental 'all'
  
      const isHex24 = s => /^[0-9a-fA-F]{24}$/.test(s);
  
      /* ── 2.  Fetch the Surge doc once ───────────────────────────────── */
      const surgeDoc = await Surge.findById(surgeId).lean();
      if (!surgeDoc) return res.status(404).json({ message: 'Surge not found' });
  
      /* ── 3.  Pull **all** household IDs (firm‑scoped) ───────────────── */
      const match = { firmId: new mongoose.Types.ObjectId(firmId) };
  
      /* ★ NEW — OPTIONAL DB pushdown if leadAdvisors is an array of ObjectIds on Household */
      if (advisorFilterIds.length) {
        const advisorOids = advisorFilterIds.filter(isHex24).map(id => new mongoose.Types.ObjectId(id));
        if (advisorOids.length) {
          // For single field: match.advisorId = { $in: advisorOids }
          // For array field (your schema): leadAdvisors: ObjectId[]
          match.leadAdvisors = { $in: advisorOids };
        }
      }
  
      const idDocs = await Household.aggregate()
        .match(match)
        .sort({ householdName: sortOrder })      // retains sort toggle
        .project({ _id: 1 })
        .exec();
  
      let candidateIds = idDocs.map(d => d._id.toString());
      console.log('[surge:listHouseholds] candidateIds count (post match):', candidateIds.length);
  
      /* ── 4.  Prepared filter – set membership, zero per‑row queries ─── */
      if (preparedFilter !== 'all') {
        const snaps = await SurgeSnapshot
          .find({ surgeId })
          .select('household')
          .lean();
        const preparedSet  = new Set(snaps.map(s => s.household.toString()));
        const wantPrepared = preparedFilter === 'yes';
        candidateIds = candidateIds.filter(id => preparedSet.has(id) === wantPrepared);
      }
  
      /* ── 5.  Decide whether we need deep evaluation ──────────────────── */
      // ★ CHANGED — include advisor filters so we can apply them in-code if needed
      const needDeepEval = warnFilters.length > 0 || search.length > 0 || advisorFilterIds.length > 0;
  
      let totalCount = candidateIds.length;
      let totalPages = Math.max(Math.ceil(totalCount / limit), 1);
      let householdsPage;
  
      /* ── 6‑A. FAST‑PATH: no search, no warnings, no advisor filters ──── */
      if (!needDeepEval) {
        const idsPage = candidateIds.slice((page - 1) * limit, page * limit);
  
        householdsPage = (await Promise.all(
          idsPage.map(id =>
            buildHouseholdRow({ surge: surgeDoc, householdId: id })
          )
        )).filter(Boolean);
  
        /* client‑side sort keeps UI toggle working */
        householdsPage.sort((a, b) =>
          a.householdName.localeCompare(b.householdName) * sortOrder
        );
      }
  
      /* ── 6‑B. SLOW‑PATH: search and/or warnings and/or advisors ──────── */
      else {
        /* Build rows only for *candidate* IDs (already prepared‑filtered) */
        const allRows = (await Promise.all(
          candidateIds.map(id =>
            buildHouseholdRow({ surge: surgeDoc, householdId: id })
          )
        )).filter(Boolean);
  
        let filtered = allRows;
  
        /* TEXT SEARCH (household name or advisor) */
        if (search) {
          const q = search.toLowerCase();
          filtered = filtered.filter(h =>
            h.householdName.toLowerCase().includes(q) ||
            (h.advisorName || '').toLowerCase().includes(q)
          );
        }
  
        /* Warning filters */
        if (warnFilters.length) {
          const wantsAny  = warnFilters.includes('ANY');
          const wantsNone = warnFilters.includes('NONE');
          const specific  = warnFilters.filter(w => !['ANY', 'NONE'].includes(w));
  
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
  
        /* ★ NEW — Advisor filters (match by any household advisor) */
        if (advisorFilterIds.length) {
          console.log('[surge:listHouseholds] advisorFilterIds:', advisorFilterIds);
          const want = new Set(advisorFilterIds.map(String));
          filtered = filtered.filter(h => {
            if (Array.isArray(h.advisorIds) && h.advisorIds.length) {
              return h.advisorIds.some(id => want.has(String(id)));
            }
            if (h.advisorId) return want.has(String(h.advisorId));
            return false;
          });
          console.log('[surge:listHouseholds] after advisor filter:', filtered.length);
        }
  
        /* Final sort before paging */
        filtered.sort((a, b) =>
          a.householdName.localeCompare(b.householdName) * sortOrder
        );
  
        /* Re‑compute totals after deep filters */
        totalCount = filtered.length;
        totalPages = Math.max(Math.ceil(totalCount / limit), 1);
  
        const start = (page - 1) * limit;
        householdsPage = filtered.slice(start, start + limit);
      }
  
      /* ── 7.  Response ───────────────────────────────────────────────── */
      return res.json({
        households     : householdsPage,
        currentPage    : page,
        totalPages,
        totalHouseholds: totalCount
      });
    } catch (err) {
      next(err);
    }
  };
  
  
  


/* ===========================================================================
   8.  POST /api/surge/:id/prepare   – Kick off batch build
   ======================================================================== */
   exports.prepareSurge = async (req, res) => {
    try {
      /* ── 0.  Basic look‑ups & guards ─────────────────────────────────── */
      const surgeId                       = req.params.id;
      const { households, order, action, regenerate = true } = req.body; // default to “rebuild & replace”
      const surgeDoc                      = await Surge.findById(surgeId).lean();
  
      if (!surgeDoc) {
        return res.status(404).json({ message: 'Surge not found' });
      }
      if (!Array.isArray(households) || households.length === 0) {
        return res.status(400).json({ message: 'No households specified' });
      }
      // --- A) Acquire a per-user+surge lock (10–15 min TTL) ----------------
      const userId  = req.session.user._id.toString();
      const runId   = randomUUID();                              // this run’s ID
      const lockKey = `surge:lock:${surgeId}:${userId}`;
      const lockMs  = 15 * 60 * 1000;
      const gotLock = await redisClient.set(lockKey, runId, 'PX', lockMs, 'NX');
      if (!gotLock) {
        return res.status(409).json({ message: 'A packet build is already in progress for this Surge. Please wait.' });
      }
  
      /* ── 1.  Socket room & progress helper ───────────────────────────── */
      const io       = req.app.locals.io;
      const userRoom = req.session.user._id.toString();
  
      const stepsPerHousehold = surgeDoc.valueAdds.length + surgeDoc.uploads.length;
      const successHH   = new Set();   // householdIds that completed in THIS run
      const failedHH    = new Set();   // householdIds that failed in THIS run
      const pendingJobs = new Map();   // jobId -> householdId for THIS run
      const prefix = `${runId}:`;

      const totalSteps        = households.length * stepsPerHousehold;
      if (totalSteps === 0) {
        await redisClient.del(lockKey);
        return res.status(400).json({ message: 'Nothing to build – no Value‑Adds or uploads enabled.' });
      }
  
      let stepsCompleted = 0;
  
      const emitProgress = () => {
        console.log('⏱ Emitting progress →', { surgeId, completed: stepsCompleted, total: totalSteps });
        io.to(userRoom).emit('surge:progress', {
          surgeId,
          completed: stepsCompleted,
          total:     totalSteps
        });
      };
  
      /* kick off bar at 0 % */
      emitProgress();

      try { await surgeEvents.waitUntilReady(); } catch (e) {
        await redisClient.del(lockKey);
        console.error('[Surge] QueueEvents not ready:', e);
        return res.status(503).json({ message: 'Queue event bus unavailable.' });
      }


  
      /* ── 2.  Subscribe to BullMQ events (scoped to this Surge) ───────── */
      let successCount = 0;
      let errorCount   = 0;
  
      /* Track per‑job partials so we add only the delta on each update */
      const jobParts = new Map();                  // jobId → last numeric value

      // helper: parse returnvalue (BullMQ sends stringified JSON by default)
function getHhFromReturnValue(rv) {
  if (!rv) return null;
  try {
    const val = typeof rv === 'string' ? JSON.parse(rv) : rv;
    return val && val.householdId ? val.householdId : null;
  } catch {
    return null;
  }
}

  


      const onProgress = ({ jobId, data }) => {
        if (!jobId?.startsWith(prefix)) return;   // ignore other runs/users
        if (typeof data !== 'number') return;      // ignore malformed payloads
        const prev  = jobParts.get(jobId) || 0;
        const delta = data - prev;
        if (delta <= 0) return;                    // no backward motion / repeats
        jobParts.set(jobId, data);
  
        stepsCompleted += delta;                   // accumulate across ALL jobs
        emitProgress();
      };
      let finalized = false;

      const finalize = async () => {
        if (finalized) return;
        finalized = true;
        let zipUrl = '';
        if (action === 'save-download') {
          try {
            const householdIds = [...successHH];  // zip only successful ones
            zipUrl = await buildZipAndUpload({ surgeId, householdIds });
          } catch (zipErr) {
            console.error('[Surge] ZIP build failed:', zipErr);
          }
        }
  
        /* lock UI at 100 % */
        stepsCompleted = totalSteps;
        emitProgress();
  
        io.to(userRoom).emit('surge:allDone', {
          surgeId,
          action,
          successCount,
          errorCount,
          total: households.length,
          zippedHouseholds: [...successHH],      // optional: show in UI
          failedHouseholds: [...failedHH],       // optional: show in UI
          zipUrl
        });
  
        /* Detach listeners so future Surge runs don’t get duplicate events */
        surgeEvents.off('progress',  onProgress);
        surgeEvents.off('completed', onCompleted);
        surgeEvents.off('failed',    onFailed);
        // release the lock if this run still owns it
        try { if ((await redisClient.get(lockKey)) === runId) await redisClient.del(lockKey); } catch {}
      };

      const onCompleted = ({ jobId, returnvalue }) => {
        if (!jobId?.startsWith(prefix)) return;
      
        // derive hhId in the safest order
        const hhId =
          pendingJobs.get(jobId) ||                 // what we enqueued
          getHhFromReturnValue(returnvalue) ||      // what the worker returned
          jobId.split(':').pop();                   // prefix:surgeId:householdId
      
        if (hhId) successHH.add(hhId);
      
        successCount++;
        pendingJobs.delete(jobId);
      
        if (!finalized && pendingJobs.size === 0) finalize();
      };
      
      const onFailed = ({ jobId /*, failedReason*/ }) => {
        if (!jobId?.startsWith(prefix)) return;
      
        const hhId = pendingJobs.get(jobId) || jobId.split(':').pop();
        if (hhId) failedHH.add(hhId);
      
        errorCount++;
        pendingJobs.delete(jobId);
      
        if (!finalized && pendingJobs.size === 0) finalize();
      };
      
  
      /* Register listeners for THIS prepare call */
      surgeEvents.on('progress',  onProgress);
      surgeEvents.on('completed', onCompleted);
      surgeEvents.on('failed',    onFailed);
     

      /* ── 2 bis.  Make sure Redis is reachable before we start ───────── */
      try {
        await surgeQueue.waitUntilReady();       // <— throws fast if down
      } catch (err) {
        console.error('[Surge] queue unavailable:', err);
        try { if ((await redisClient.get(lockKey)) === runId) await redisClient.del(lockKey); } catch {}
        return res.status(503).json({ message: 'Queue service unavailable. Is Redis running?' });
      }

  
      /* ── 3.  Enqueue each requested household ────────────────────────── */
      for (const hhId of order) {
        if (!households.includes(hhId)) continue;
        const jobId = `${prefix}${surgeId}:${hhId}`;
        pendingJobs.set(jobId, hhId);
        await surgeQueue.add(
          'build',
          {
            surgeId,
            householdId: hhId,
            runId,
            host:   process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`,
            cookieHeader: req.headers.cookie,
            userId: req.session.user._id.toString(),
            regenerate: !!regenerate
          },
          {
            jobId,                       // de‑dupe within this run
            removeOnComplete: { count: 500 },
            removeOnFail:     { count: 500 }
          }
        );
        console.log('[Surge] enqueued job id:', jobId, 'for household', hhId);
      }

      try {
        const counts = await surgeQueue.getJobCounts('waiting','active','delayed','failed','completed');
        console.log('[Surge] queue counts after enqueue:', counts);
      } catch (e) {
        console.warn('[Surge] getJobCounts failed:', e);
      }
  
      /* ── 4.  Immediate 202 Accepted ──────────────────────────────────── */
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

  