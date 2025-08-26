'use strict';

const mongoose = require('mongoose');

let Insurance;
try {
  Insurance = require('../models/Insurance');
} catch (e1) {
  try {
    Insurance = require('../models/InsurancePolicy');
  } catch (e2) {
    throw new Error('Cannot find Insurance model. Expected ../models/Insurance or ../models/InsurancePolicy');
  }
}

// Optional models
let Client = null;
try {
  Client = require('../models/Client');
} catch (e) {
  // If Clients model isn't available under this path, owner-name search will exclude that facet.
}


/** -------------------- Constants: labels & options -------------------- */
// Single source of truth for friendly labels
const TYPE_LABELS = Object.freeze({
  TERM: 'Term',
  PERMANENT: 'Permanent'
});

const SUBTYPE_LABELS = Object.freeze({
  LEVEL_TERM: 'Level Term',
  DECREASING_TERM: 'Decreasing Term',
  RENEWABLE_TERM: 'Renewable Term',
  CONVERTIBLE_TERM: 'Convertible Term',
  WHOLE_LIFE: 'Whole Life',
  UL: 'Universal Life',
  IUL: 'Indexed Universal Life',
  VUL: 'Variable Universal Life',
  GUL: 'Guaranteed Universal Life',
  OTHER: 'Other'
});

const STATUS_LABELS = Object.freeze({
  IN_FORCE: 'In Force',
  LAPSED: 'Lapsed',
  EXPIRED: 'Expired',
  SURRENDERED: 'Surrendered',
  CLAIM_PAID: 'Claim Paid'
});

// Valid subtype choices per family
const SUBTYPE_OPTIONS = Object.freeze({
  TERM: ['LEVEL_TERM','DECREASING_TERM','RENEWABLE_TERM','CONVERTIBLE_TERM','OTHER'],
  PERMANENT: ['WHOLE_LIFE','UL','IUL','VUL','GUL','OTHER']
});

// --- Utilities ------------------------------------------------

/** Express async wrapper to forward errors to global handler */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Only allow setting of whitelisted fields */
const ALLOWED_FIELDS = new Set([
  'firmId','household','ownerClient','insuredClient',
  'policyFamily','policySubtype',
  'carrierName','policyNumber','productName',
  'status','faceAmount',
  'effectiveDate','expirationDate',
  'hasCashValue','cashValue',
  'premiumAmount','premiumMode',
  'beneficiaries','notes'
]);

function pickAllowed(input) {
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (ALLOWED_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

/** The same UTC date-only normalizer used in your model */
function toUTCDateOnly(value) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
  }
  const dt = new Date(value);
  if (isNaN(dt.getTime())) return undefined;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

/** Normalize date fields on inbound payloads (for update queries) */
function normalizeDateFields(payload) {
  if (!payload) return payload;
  if ('effectiveDate' in payload) {
    const v = toUTCDateOnly(payload.effectiveDate);
    if (v) payload.effectiveDate = v;
  }
  if ('expirationDate' in payload) {
    const v = payload.expirationDate === null ? null : toUTCDateOnly(payload.expirationDate);
    // Allow explicit null
    if (v !== undefined) payload.expirationDate = v;
  }
  return payload;
}

/** Attempt to pull firmId from req.user, otherwise require it explicitly */
function resolveFirmId(req, explicitFirmId) {
  // Adjust these field names if your auth puts firm/company on a different key
  return explicitFirmId || req?.user?.firmId || req?.user?.companyId || null;
}

/** Uniform error payload for duplicate key violations */
function mapMongooseError(err) {
  if (!err) return err;
  if (err?.code === 11000) {
    return Object.assign(new Error('Duplicate policy detected for this firm (carrierName + policyNumber must be unique).'), { status: 409 });
  }
  if (err?.name === 'ValidationError') {
    const details = Object.values(err.errors).map(e => e.message);
    const e2 = new Error('Validation failed: ' + details.join('; '));
    e2.status = 400;
    return e2;
  }
  return err;
}



/** Build query filters from req.query with firm scoping (excluding text search) */
function buildFilters(req) {
  const q = {};
  const firmId = resolveFirmId(req, req.query.firmId);
  if (!firmId) throw Object.assign(new Error('firmId is required (derive from auth or pass ?firmId=).'), { status: 400 });
  q.firmId = firmId;

  const {
    household, ownerClient, insuredClient, status, policyFamily, policySubtype,
    hasCashValue, minFace, maxFace, carrierName, policyNumber
  } = req.query;

  if (household) q.household = household;
  if (ownerClient) q.ownerClient = ownerClient;
  if (insuredClient) q.insuredClient = insuredClient;
  if (status) q.status = status;
  if (policyFamily) q.policyFamily = policyFamily;
  if (policySubtype) q.policySubtype = policySubtype;
  if (hasCashValue === 'true') q.hasCashValue = true;
  if (hasCashValue === 'false') q.hasCashValue = false;

  if (minFace || maxFace) {
    q.faceAmount = {};
    if (minFace) q.faceAmount.$gte = Number(minFace);
    if (maxFace) q.faceAmount.$lte = Number(maxFace);
  }

  // Preserve explicit carrier/policyNumber filters (regex)
  if (carrierName) q.carrierName = new RegExp(String(carrierName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  if (policyNumber) q.policyNumber = new RegExp(String(policyNumber).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  return q;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Controller Actions --------------------------------------

/** GET /api/insurance
 *  Query params: pagination, sorting, and filters (see buildFilters)
 *  Enhanced: `search` now matches owner name, policy family/subtype labels, plus carrier/policyNumber/productName/notes.
 */
exports.list = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 25,
    sortBy = 'createdAt',
    sortDir = 'desc',
    select,
    populate // e.g., 'ownerClient,insuredClient,household'
  } = req.query;

  const filters = buildFilters(req);

  // --- Enhanced search (owner name + family/subtype friendly labels + existing fields) ---
  const searchRaw = (req.query.search || '').toString().trim();
  if (searchRaw) {
    const rx = new RegExp(escapeRegex(searchRaw), 'i');
    const or = [];

    // Owner name facet (optional if Client model is present)
    if (Client) {
      const firmScoped = { $or: [{ firstName: rx }, { lastName: rx }, { displayName: rx }] };
      // If you track firm on Client, include it to scope
      if (filters.firmId) firmScoped.firmId = filters.firmId;
      const ownerIds = await Client.find(firmScoped).distinct('_id').exec();
      if (ownerIds && ownerIds.length) {
        or.push({ ownerClient: { $in: ownerIds } });
      }
    }

    // Policy family/subtype by friendly labels
    const sLower = searchRaw.toLowerCase();
    const matchedFamilies = Object.entries(TYPE_LABELS)
      .filter(([, label]) => label.toLowerCase().includes(sLower))
      .map(([code]) => code);
    const matchedSubtypes = Object.entries(SUBTYPE_LABELS)
      .filter(([, label]) => label.toLowerCase().includes(sLower))
      .map(([code]) => code);

    if (matchedFamilies.length) or.push({ policyFamily: { $in: matchedFamilies } });
    if (matchedSubtypes.length) or.push({ policySubtype: { $in: matchedSubtypes } });

    // Preserve legacy broad search across string fields
    or.push({ carrierName: rx }, { policyNumber: rx }, { productName: rx }, { notes: rx });

    if (or.length) {
      // Combine with any existing $or by wrapping in an $and
      if (filters.$or) {
        filters.$and = [{ $or: filters.$or }, { $or: or }];
        delete filters.$or;
      } else {
        filters.$or = or;
      }
    }
  }

  const skip = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));
  const sort = { [sortBy]: String(sortDir).toLowerCase() === 'asc' ? 1 : -1 };

  let query = Insurance.find(filters).sort(sort).skip(skip).limit(Math.max(1, Number(limit)));

  if (select) query = query.select(String(select).split(',').join(' '));
  if (populate) {
    const paths = String(populate).split(',').map(s => s.trim()).filter(Boolean);
    paths.forEach(p => query.populate(p));
  } else {
    query = query.populate('ownerClient insuredClient household');
  }

  const [items, total] = await Promise.all([
    query.exec(),
    Insurance.countDocuments(filters)
  ]);

  res.json({
    page: Number(page),
    limit: Number(limit),
    total,
    totalPages: Math.ceil(total / Math.max(1, Number(limit))),
    items,
    meta: {
      TYPE_LABELS,
      SUBTYPE_LABELS,
      STATUS_LABELS,
      SUBTYPE_OPTIONS
    }
  });
});

/** GET /api/insurance/:id */
exports.getById = asyncHandler(async (req, res) => {
  const filters = buildFilters(req);
  filters._id = req.params.id;
  const doc = await Insurance.findOne(filters).populate('ownerClient insuredClient household').exec();
  if (!doc) return res.status(404).json({ message: 'Insurance policy not found.' });
  res.json(doc);
});

/** POST /api/insurance */
exports.create = asyncHandler(async (req, res) => {
  const firmId = resolveFirmId(req, req.body.firmId);
  if (!firmId) return res.status(400).json({ message: 'firmId is required to create a policy.' });

  const payload = pickAllowed(req.body);
  payload.firmId = firmId;

  normalizeDateFields(payload);

  try {
    const doc = new Insurance(payload);
    // pass activity context to audit plugin (document save)
    doc.$locals = doc.$locals || {};
    doc.$locals.activityCtx = req.activityCtx;
    await doc.save();
    res.status(201).json(doc);
  } catch (err) {
    throw mapMongooseError(err);
  }
});

/** PUT/PATCH /api/insurance/:id — full or partial update */
exports.update = asyncHandler(async (req, res) => {
  const filters = buildFilters(req);
  filters._id = req.params.id;

  const doc = await Insurance.findOne(filters).exec();
  if (!doc) return res.status(404).json({ message: 'Insurance policy not found for this firm.' });

  const payload = pickAllowed(req.body);
  normalizeDateFields(payload);

  // For safety, never allow switching firm via update
  if ('firmId' in payload && String(payload.firmId) !== String(doc.firmId)) {
    return res.status(400).json({ message: 'firmId cannot be changed.' });
  }

  try {
    doc.set(payload);
    // pass activity context to audit plugin (document save)
    doc.$locals = doc.$locals || {};
    doc.$locals.activityCtx = req.activityCtx;
    await doc.save(); // triggers setters and validation middleware
    res.json(doc);
  } catch (err) {
    throw mapMongooseError(err);
  }
});

/** DELETE /api/insurance/:id */
exports.remove = asyncHandler(async (req, res) => {
  const filters = buildFilters(req);
  filters._id = req.params.id;

  const deleted = await Insurance.findOneAndDelete(filters, { activityCtx: req.activityCtx });
  if (!deleted) return res.status(404).json({ message: 'Insurance policy not found for this firm.' });
  res.json({ ok: true, id: deleted._id });
});

/** POST /api/insurance/bulk-delete { ids: [] } */
exports.bulkDelete = asyncHandler(async (req, res) => {
  const filters = buildFilters(req);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!ids || ids.length === 0) return res.status(400).json({ message: 'Provide a non-empty array of ids.' });

  let deletedCount = 0;
  // delete one-by-one so the audit plugin can log each delete event
  for (const _id of ids) {
    const deleted = await Insurance.findOneAndDelete({ ...filters, _id }, { activityCtx: req.activityCtx });
    if (deleted) deletedCount++;
  }
  res.json({ ok: true, deletedCount });
});

// --- Handy aliases to match other controller naming styles ---
exports.index = exports.list;
exports.show = exports.getById;
exports.destroy = exports.remove;
