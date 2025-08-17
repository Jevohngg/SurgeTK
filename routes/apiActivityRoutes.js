// routes/apiActivityRoutes.js
const express = require('express');
const router = express.Router();
const ActivityLog = require('../models/ActivityLog');
const CompanyID = require('../models/CompanyID');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');
const mongoose = require('mongoose');
let Household, Client;
try { Household = require('../models/Household'); } catch {}
try { Client    = require('../models/Client');    } catch {}

// ---------- Friendly Household name helpers ----------
function looksGenericHouseholdLabel(label) {
    if (!label) return true;
    const x = String(label).trim();
    if (!x) return true;
    if (/^H-\d+$/i.test(x)) return true;                             // H-2006
    if (/^[0-9]+$/.test(x)) return true;                              // 421832
    if (/^Household(\s|$|[#—-])/i.test(x)) return true;               // "Household — ..."
    if (/^[a-f0-9]{24}$/i.test(x)) return true;                       // Mongo ObjectId
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x)) return true; // UUID
    return false;
  }
  
  function pickFirst(m) { return (m?.preferredName || m?.firstName || '').trim(); }
  function pickLast(m)  { return (m?.lastName || '').trim(); }
  
  function formatHouseholdName(membersRaw = []) {
    const members = membersRaw
      .map(m => ({ first: pickFirst(m), last: pickLast(m) }))
      .filter(m => m.first || m.last);
  
    if (!members.length) return null;
  
    if (members.length === 1) {
      const m = members[0];
      return m.last && m.first ? `${m.last}, ${m.first}` : (m.first || m.last);
    }
  
    const uniqLasts = [...new Set(members.map(m => m.last.toLowerCase()).filter(Boolean))];
  
    if (uniqLasts.length === 1) {
      const last = members[0].last;
      const given = members.slice(0, 2).map(m => m.first || '(Unnamed)').join(' & ');
      const extra = members.length > 2 ? ` & ${members.length - 2} other${members.length - 2 > 1 ? 's' : ''}` : '';
      return last ? `${last}, ${given}${extra}` : `${given}${extra}`;
    } else {
      const pair = members.slice(0, 2).map(m => m.last ? `${m.last}, ${m.first || '(Unnamed)'}` : (m.first || '(Unnamed)')).join(' & ');
      const extra = members.length > 2 ? ` & ${members.length - 2} other${members.length - 2 > 1 ? 's' : ''}` : '';
      return `${pair}${extra}`;
    }
  }
  const NAMES_DEBUG = process.env.ACTIVITY_LOG_DEBUG_NAMES === '1';

  // Collect client ObjectIds from a log snapshot (changes.before / changes.after)
function collectClientIdsFromSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return [];
  
    const ids = new Set();
    const pushId = (v) => {
      if (!v) return;
      // Support raw ObjectId, string, or {_id: ...}
      const id =
        (typeof v === 'object' && v._id && mongoose.Types.ObjectId.isValid(v._id) && String(v._id)) ||
        (typeof v === 'string' && mongoose.Types.ObjectId.isValid(v) && v) ||
        (mongoose.Types.ObjectId.isValid(v) && String(v)) ||
        null;
      if (id) ids.add(id);
    };
  
    // Common shapes
    const scalarKeys = [
      'headOfHousehold',
      'primaryClient', 'primaryClientId',
      'secondaryClient', 'secondaryClientId',
      'spouse', 'spouseId',
      'coClient', 'coClientId',
      'partner', 'partnerId',
      'client', 'clientId'
    ];
  
    const arrayKeys = [
      'members', 'clients', 'clientIds', 'participants', 'people'
    ];
  
    // Scalars
    for (const k of scalarKeys) {
      if (snap[k] !== undefined) pushId(snap[k]);
    }
  
    // Arrays of ids or embedded docs
    for (const k of arrayKeys) {
      const arr = snap[k];
      if (Array.isArray(arr)) {
        for (const m of arr) {
          if (m && typeof m === 'object') {
            if (m._id) pushId(m._id);
            else pushId(m); // in case array of ObjectIds
          } else {
            pushId(m);
          }
        }
      }
    }
  
    return [...ids];
  }
  
  // Batch: use snapshots to fill friendly names for any unresolved items
  async function applyFriendlyFromSnapshots(unresolvedItems = []) {
    if (!unresolvedItems.length || !Client) return;
  
    // 1) Gather all candidate client IDs across items
    const allIds = new Set();
    for (const it of unresolvedItems) {
      const beforeIds = collectClientIdsFromSnapshot(it?.changes?.before);
      const afterIds  = collectClientIdsFromSnapshot(it?.changes?.after);
      for (const id of [...beforeIds, ...afterIds]) allIds.add(id);
    }
  
    if (!allIds.size) return;
  
    // 2) Fetch clients once
    const clientDocs = await Client.find(
      { _id: { $in: [...allIds].map(id => new mongoose.Types.ObjectId(id)) } },
      { _id: 1, firstName: 1, preferredName: 1, lastName: 1 }
    ).lean();
  
    const clientById = new Map(clientDocs.map(c => [c._id.toString(), c]));
  
    // 3) For each item, compose a friendly name from whatever clients we found
    for (const it of unresolvedItems) {
      const ids = [
        ...collectClientIdsFromSnapshot(it?.changes?.before),
        ...collectClientIdsFromSnapshot(it?.changes?.after)
      ];
      const members = ids
        .map(id => clientById.get(id))
        .filter(Boolean);
  
      if (members.length) {
        const friendly = formatHouseholdName(members);
        if (friendly) {
          it.entity.display = friendly;
        }
      }
    }
  }
  



  async function injectFriendlyHouseholdDisplays(items = [], firmObjectId = null) {
    // Identify candidate Household items whose display looks generic (or missing)
    const targets = items.filter(it =>
      it?.entity?.type === 'Household' &&
      (it?.entity?.id || it?.entity?.display) &&
      looksGenericHouseholdLabel(it?.entity?.display)
    );
  
    if (!targets.length) return items;
  
    const idList = [];
    const codeList = [];
  
    for (const it of targets) {
      const rawId = it.entity.id;
  
      // If entity.id is a valid ObjectId, collect it
      if (rawId && mongoose.Types.ObjectId.isValid(rawId)) {
        idList.push(String(rawId));
      }
  
      // ALWAYS collect possible codes from id/display ("H-2006", UUIDs, numerics)
      if (typeof rawId === 'string') {
        codeList.push(...extractHouseholdCodes(rawId));
      }
      if (typeof it.entity.display === 'string') {
        codeList.push(...extractHouseholdCodes(it.entity.display));
      }
    }
  
    const { nameById, nameByCode } = await buildHouseholdNameMap({ idList, codeList, firmObjectId });
  
    // Apply friendly names back onto the outgoing items
    const unresolved = [];
    for (const it of targets) {
      let friendly = null;
  
      if (it.entity.id && mongoose.Types.ObjectId.isValid(it.entity.id)) {
        friendly = nameById.get(String(it.entity.id));
      }
  
      if (!friendly) {
        const codes = [
          ...(typeof it.entity.id === 'string' ? extractHouseholdCodes(it.entity.id) : []),
          ...(typeof it.entity.display === 'string' ? extractHouseholdCodes(it.entity.display) : [])
        ];
        for (const c of codes) {
          friendly = nameByCode.get(c);
          if (friendly) break;
        }
      }
  
      if (friendly) {
        it.entity.display = friendly;
      } else {
        unresolved.push(it);
        if (NAMES_DEBUG) {
          console.debug('[ActivityNames] no friendly found (pre-snapshot) for item:', {
            logId: it._id?.toString?.(),
            entityId: it.entity?.id,
            entityDisplay: it.entity?.display
          });
        }
      }
    }
  
    // FINAL FALLBACK: build from snapshots (changes.before/after)
    if (unresolved.length) {
      await applyFriendlyFromSnapshots(unresolved);
    }
  
    return items;
  }
  
  
// Pull "household-ish" identifiers from a string: H-####, UUID, raw numeric/id-ish tokens
function extractHouseholdCodes(text) {
    if (!text) return [];
    const s = String(text);
  
    const codes = new Set();
  
    // UUID v4 (and most UUIDs)
    const uuidRx = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/ig;
    // Household code like H-2006
    const hnumRx = /\bH-\d+\b/ig;
    // Bare numeric IDs (at least 3 digits to avoid matching times like "6:23")
    const numRx  = /\b\d{3,}\b/g;
  
    const pushAll = (matches) => {
      if (!matches) return;
      for (const t of matches) codes.add(t);
    };
  
    // Try full string
    pushAll(s.match(uuidRx));
    pushAll(s.match(hnumRx));
    pushAll(s.match(numRx));
  
    // Also strip common prefixes like "Household — " or "Household - " and try the tail
    const tail = s.replace(/^Household\s*[—-]\s*/i, '').trim();
    if (tail && tail !== s) {
      pushAll(tail.match(uuidRx));
      pushAll(tail.match(hnumRx));
      pushAll(tail.match(numRx));
    }
  
    return [...codes];
  }
  
  
  
// Build maps of friendly names by household _id and by code
async function buildHouseholdNameMap({ idList = [], codeList = [], firmObjectId = null } = {}) {
    // Deduplicate inputs
    const idSet   = new Set(idList.filter(Boolean).map(String));
    const codeSet = new Set(codeList.filter(Boolean).map(String));
  
    const idObjs = [...idSet]
      .map(id => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null))
      .filter(Boolean);
  
    if (!Household && !Client) {
      if (NAMES_DEBUG) console.debug('[ActivityNames] Household/Client models missing – aborting');
      return { nameById: new Map(), nameByCode: new Map() };
    }
  
    const nameById   = new Map();  // key: household _id (string) -> friendly name
    const nameByCode = new Map();  // key: userHouseholdId/householdId (string) -> friendly name
  
  // -----------------------------
  // 1) CLIENT-FIRST (ObjectId path)
  // -----------------------------
  const membersByHhId = new Map();

  if (Client && idObjs.length) {
    const cq = { household: { $in: idObjs } };
    if (firmObjectId && Client.schema.path('firmId')) cq.firmId = firmObjectId;

    if (NAMES_DEBUG) console.debug('[ActivityNames] Client lookup by household _id:', {
      countIds: idObjs.length, scoped: !!cq.firmId
    });

    let cdocs = await Client.find(cq, {
      _id: 1, firstName: 1, preferredName: 1, lastName: 1, household: 1
    }).lean();

    // If strict firm scoping returns zero, retry unscoped (common during migrations)
    if ((!cdocs || !cdocs.length) && cq.firmId) {
      if (NAMES_DEBUG) console.debug('[ActivityNames] Client lookup returned 0; retrying without firm scope');
      delete cq.firmId;
      cdocs = await Client.find(cq, {
        _id: 1, firstName: 1, preferredName: 1, lastName: 1, household: 1
      }).lean();
    }

    for (const c of cdocs) {
      const hh = c.household && (c.household._id || c.household);
      if (!hh) continue;
      const key = String(hh);
      if (!membersByHhId.has(key)) membersByHhId.set(key, []);
      membersByHhId.get(key).push(c);
    }

    for (const [hhIdStr, members] of membersByHhId.entries()) {
      const friendly = formatHouseholdName(members);
      if (friendly) nameById.set(hhIdStr, friendly);
    }

    if (NAMES_DEBUG) console.debug('[ActivityNames] Built names from Clients:', {
      householdsWithMembers: nameById.size
    });
  }

  
    // ---------------------------------------------
    // 2) HOUSEHOLD LOOKUP (for codes + HoH fallback)
    // ---------------------------------------------
    // We still need to:
    //  - resolve 'codes' (userHouseholdId / householdId) to _id
    //  - pick up Head-of-Household as a fallback for any hh without clients
    //  - map codes -> friendly names
  
    // Build $or for households; include ids we already have (to map codes + hoh),
    // and include the incoming codes
    const hhOr = [];
    if (idObjs.length) hhOr.push({ _id: { $in: idObjs } });
    if (codeSet.size) {
      const codes = [...codeSet];
      hhOr.push({ userHouseholdId: { $in: codes } });
      hhOr.push({ householdId:     { $in: codes } });
    }
  
    let hhDocs = [];
    if (Household && hhOr.length) {
      let hhMatch = { $or: hhOr };
      if (firmObjectId) hhMatch.firmId = firmObjectId;
  
      if (NAMES_DEBUG) console.debug('[ActivityNames] Household lookup (scoped):', {
        orClauses: hhOr.length, scoped: !!firmObjectId
      });
  
      hhDocs = await Household.find(hhMatch, {
        _id: 1, headOfHousehold: 1, householdId: 1, userHouseholdId: 1
      }).lean();
  
      // If nothing found under firm scope (common data-migration hiccup), retry without scope
      if (!hhDocs.length && firmObjectId) {
        const unscopedMatch = { $or: hhOr };
        if (NAMES_DEBUG) console.debug('[ActivityNames] Household lookup yielded 0; retrying without firm scope');
        hhDocs = await Household.find(unscopedMatch, {
          _id: 1, headOfHousehold: 1, householdId: 1, userHouseholdId: 1
        }).lean();
      }
    }
  
    if (!hhDocs.length) {
      if (NAMES_DEBUG) console.debug('[ActivityNames] No households matched (by id/codes)');
      return { nameById, nameByCode };
    }
  
    const hhById = new Map(hhDocs.map(h => [h._id.toString(), h]));
  
    // Preload HoH to guarantee at least one name when no clients
    const hohIds = hhDocs
      .map(h => (h.headOfHousehold && mongoose.Types.ObjectId.isValid(h.headOfHousehold) ? h.headOfHousehold : null))
      .filter(Boolean);
  
    const hohMap = new Map();
    if (hohIds.length && Client) {
      if (NAMES_DEBUG) console.debug('[ActivityNames] Loading Heads-of-Household:', { count: hohIds.length });
      const hohClients = await Client.find(
        { _id: { $in: hohIds } },
        { _id: 1, firstName: 1, preferredName: 1, lastName: 1 }
      ).lean();
      for (const c of hohClients) hohMap.set(c._id.toString(), c);
    }
  
    // For any household lacking members, try HoH fallback
    for (const h of hhDocs) {
      const hhIdStr = h._id.toString();
  
      if (!nameById.has(hhIdStr)) {
        const hohId = h.headOfHousehold?.toString?.();
        if (hohId && hohMap.has(hohId)) {
          const friendly = formatHouseholdName([hohMap.get(hohId)]);
          if (friendly) nameById.set(hhIdStr, friendly);
        }
      }
  
      // Map codes to friendly (if we have one)
      if (nameById.has(hhIdStr)) {
        const friendly = nameById.get(hhIdStr);
        if (h.householdId)     nameByCode.set(String(h.householdId), friendly);
        if (h.userHouseholdId) nameByCode.set(String(h.userHouseholdId), friendly);
      }
    }
  
    if (NAMES_DEBUG) console.debug('[ActivityNames] Final name maps:', {
      byId: nameById.size, byCode: nameByCode.size
    });
  
    return { nameById, nameByCode };
  }
  
  
  
  

async function resolveFirmObjectId(companyIdFromCtx) {
  // If it's an ObjectId-like value, keep it
  if (companyIdFromCtx && typeof companyIdFromCtx === 'object') return companyIdFromCtx;
  // If it's a 24-char hex string, try casting
  if (typeof companyIdFromCtx === 'string' && /^[a-f0-9]{24}$/i.test(companyIdFromCtx)) return companyIdFromCtx;
  // Otherwise, treat it as your human/company code (e.g. "abc123") and look up the CompanyID doc
  if (typeof companyIdFromCtx === 'string' && companyIdFromCtx.trim()) {
    const firm = await CompanyID.findOne({ companyId: companyIdFromCtx.toLowerCase() }, { _id: 1 }).lean();
    return firm?._id || null;
  }
  return null;
}

// GET /api/activity
router.get('/activity', ensureAuthenticated, ensureOnboarded, async (req, res) => {
  try {
    const firmObjectId = await resolveFirmObjectId(req.activityCtx?.companyId);
    if (!firmObjectId) {
      return res.status(200).json({ success: true, items: [], total: 0, page: 1, pages: 0 });
    }

    const {
      page = 1,
      limit = 25,
      entityType,
      action,
      actorEmail,
      q,
      dateFrom,
      dateTo
    } = req.query;

    const find = { companyId: firmObjectId };

    if (entityType) find['entity.type'] = String(entityType);
    if (action) find.action = String(action);
    if (actorEmail) find['actor.email'] = new RegExp(String(actorEmail), 'i');

    if (q) {
      const rx = new RegExp(String(q), 'i');
      find.$or = [
        { 'entity.display': rx },
        { 'meta.notes': rx },
        { 'actor.email': rx }
      ];
    }

    if (dateFrom || dateTo) {
      find.createdAt = {};
      if (dateFrom) {
        const d = new Date(dateFrom);
        if (!Number.isNaN(d.getTime())) find.createdAt.$gte = d;
      }
      if (dateTo) {
        const d = new Date(dateTo);
        if (!Number.isNaN(d.getTime())) {
          d.setHours(23, 59, 59, 999);
          find.createdAt.$lte = d;
        }
      }
      if (Object.keys(find.createdAt).length === 0) delete find.createdAt;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [itemsRaw, total] = await Promise.all([
        ActivityLog.find(find).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
        ActivityLog.countDocuments(find)
      ]);
      
      const items = await injectFriendlyHouseholdDisplays(itemsRaw, firmObjectId);
      
      
      return res.json({
        success: true,
        items,
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit))
      });
      
  } catch (err) {
    console.error('[GET /api/activity] error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load activity.' });
  }
});

// GET /api/activity/:id
router.get('/activity/:id', ensureAuthenticated, ensureOnboarded, async (req, res) => {
  try {
    const firmObjectId = await resolveFirmObjectId(req.activityCtx?.companyId);
    if (!firmObjectId) return res.status(404).json({ success: false, message: 'Not found' });

    const { id } = req.params;
    const log = await ActivityLog.findOne({ _id: id, companyId: firmObjectId }).lean();
    if (!log) return res.status(404).json({ success: false, message: 'Not found' });
    
    // Decorate single item too (re-use the batch helper)
    const [decorated] = await injectFriendlyHouseholdDisplays([log], firmObjectId);

    
    return res.json({ success: true, item: decorated });
    
  } catch (err) {
    console.error('[GET /api/activity/:id] error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load activity item.' });
  }
});

module.exports = router;
