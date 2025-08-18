// controllers/householdFeeController.js
const Household = require('../models/Household');             // path matches your code base
const { logActivity, shallowDiff } = require('../utils/activityLogger');

// ───────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────
function parseMoney(n) {
  if (typeof n === 'string') n = n.replace(/,/g, '');
  const num = Number(n);
  return Number.isFinite(num) ? num : NaN;
}

function validateAndNormalizePeriod({ periodType, periodKey }) {
  const t = String(periodType || '').trim().toLowerCase();
  if (!['month', 'quarter', 'year'].includes(t)) {
    const err = new Error('periodType must be one of "month", "quarter", or "year"');
    err.status = 400;
    throw err;
  }

  let k = String(periodKey || '').trim();
  if (t === 'month') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(k)) {
      const err = new Error('periodKey for month must be "YYYY-MM"');
      err.status = 400;
      throw err;
    }
  } else if (t === 'quarter') {
    k = k.toUpperCase();
    if (!/^\d{4}-Q[1-4]$/.test(k)) {
      const err = new Error('periodKey for quarter must be "YYYY-Q#"');
      err.status = 400;
      throw err;
    }
  } else {
    if (!/^\d{4}$/.test(k)) {
      const err = new Error('periodKey for year must be "YYYY"');
      err.status = 400;
      throw err;
    }
  }

  return { periodType: t, periodKey: k };
}

function makeRowId({ periodType, periodKey }) {
  return `${periodType}:${periodKey}`;
}

function periodStartMs(periodType, periodKey) {
  if (periodType === 'month') {
    const [yy, mm] = periodKey.split('-').map(Number);
    return Date.UTC(yy, mm - 1, 1);
  }
  if (periodType === 'quarter') {
    const [yy, q] = periodKey.split('-Q').map(Number);
    const startMonth = (q - 1) * 3;
    return Date.UTC(yy, startMonth, 1);
  }
  const y = Number(periodKey);
  return Date.UTC(y, 0, 1);
}

function ensureBillingContainer(doc) {
  if (!doc.billing) doc.billing = {};
  return doc.billing;
}

function bucketNameForType(t) {
  return t === 'month' ? 'feeByMonth' : (t === 'quarter' ? 'feeByQuarter' : 'feeByYear');
}

function readEntry(doc, periodType, periodKey) {
  const bucket = bucketNameForType(periodType);
  const b = doc?.billing?.[bucket];
  if (!b) return null;
  const raw = b instanceof Map ? b.get(periodKey) : b?.[periodKey];
  if (!raw) return null;
  return {
    periodType,
    periodKey,
    amount: raw.amount ?? 0,
    note: raw.note || undefined,
    source: raw.source || undefined,
  };
}

function deleteEntryFromDoc(doc, periodType, periodKey) {
  ensureBillingContainer(doc);
  const mapName = bucketNameForType(periodType);
  const m = doc.billing[mapName];
  if (!m) return false;

  if (m instanceof Map) return m.delete(periodKey);

  if (typeof m === 'object') {
    if (Object.prototype.hasOwnProperty.call(m, periodKey)) {
      delete m[periodKey];
      return true;
    }
  }
  return false;
}

function collectAutoClearsForYear(doc, yearStr) {
  const cleared = [];
  const q = doc?.billing?.feeByQuarter;
  if (q) {
    const keys = q instanceof Map ? Array.from(q.keys()) : Object.keys(q);
    for (const k of keys) {
      if (k.startsWith(yearStr + '-Q') || k.startsWith(yearStr + 'Q')) {
        cleared.push(`quarter:${k}`);
      }
    }
  }
  const m = doc?.billing?.feeByMonth;
  if (m) {
    const keys = m instanceof Map ? Array.from(m.keys()) : Object.keys(m);
    for (const k of keys) {
      if (k.startsWith(yearStr + '-')) {
        cleared.push(`month:${k}`);
      }
    }
  }
  return cleared;
}

function mapToRows(mapValue, periodType) {
  if (!mapValue) return [];
  const entries = mapValue instanceof Map ? Array.from(mapValue.values()) : Object.values(mapValue);
  return entries.map(v => ({
    id: makeRowId({ periodType, periodKey: v.periodKey }),
    periodType,
    periodKey: v.periodKey,
    amount: v.amount ?? 0,
    note: v.note || undefined,
  }));
}

function makeActivityCtx(req, householdDoc) {
  const actor = req.user ? {
    _id: req.user._id,
    email: req.user.email || req.user.username || '',
    name: req.user.name || [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
    roles: req.user.roles || [],
  } : { _id: householdDoc.owner, email: 'system@surgetk', name: 'System', roles: [] }; // fallback to owner id to satisfy required actor._id

  return {
    companyId: householdDoc.firmId,
    actor,
    meta: {
      path: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('user-agent')
    }
  };
}

// When reading we can lean; when writing we need full doc.
async function ensureHouseholdAccess(req, householdId, { forWrite = false } = {}) {
  const q = forWrite ? Household.findById(householdId) : Household.findById(householdId).lean();
  const hh = await q.exec();
  if (!hh) {
    const err = new Error('Household not found');
    err.status = 404;
    throw err;
  }
  // TODO: add authorization for req.user over this household as needed.
  return hh;
}

// ───────────────────────────────────────────────────────────
// Controller actions
// ───────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { householdId } = req.params;
    const hh = await ensureHouseholdAccess(req, householdId, { forWrite: false });

    const billing = (hh && hh.billing) || {};
    const rows = [
      ...mapToRows(billing.feeByYear, 'year'),
      ...mapToRows(billing.feeByQuarter, 'quarter'),
      ...mapToRows(billing.feeByMonth, 'month'),
    ].sort((a, b) => periodStartMs(b.periodType, b.periodKey) - periodStartMs(a.periodType, a.periodKey));

    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { householdId } = req.params;
    const doc = await ensureHouseholdAccess(req, householdId, { forWrite: true });

    const parsedAmount = parseMoney(req.body.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      const err = new Error('amount must be a number >= 0');
      err.status = 400;
      throw err;
    }

    const { periodType, periodKey } = validateAndNormalizePeriod({
      periodType: req.body.periodType,
      periodKey: req.body.periodKey,
    });

    const beforeEntry = readEntry(doc, periodType, periodKey);
    const entryAction = beforeEntry ? 'update' : 'create';
    const autoCleared = periodType === 'year' ? collectAutoClearsForYear(doc, periodKey) : [];

    ensureBillingContainer(doc);

    // Attach activity context for audit plugin (will log Household "update"); remove next 2 lines if you only want the compact log below.
    const activityCtx = makeActivityCtx(req, doc);
    doc.$locals = doc.$locals || {};
    doc.$locals.activityCtx = activityCtx;

    doc.setFeeEntry({
      periodType,
      periodKey,
      amount: parsedAmount,
      source: 'manual',
      note: (req.body.note || '').trim() || undefined,
    });

    await doc.save();

    const afterEntry = {
      periodType,
      periodKey,
      amount: parsedAmount,
      note: (req.body.note || '').trim() || undefined,
      source: 'manual'
    };

    // Compact activity entry — always log as Household "update"
    await logActivity(activityCtx, {
      entity: { type: 'Household', id: doc._id, display: doc.userHouseholdId || doc.householdId || `Household #${doc._id}` },
      action: 'update',
      before: beforeEntry,
      after: afterEntry,
      diff: shallowDiff(beforeEntry || {}, afterEntry),
      meta: {
        notes: 'Household Billing (Fees) — manual entry',
        extra: {
          category: 'householdFee',
          entryId: makeRowId({ periodType, periodKey }),
          entryAction,                   // 'create' or 'update'
          autoClearedEntries: autoCleared
        }
      }
    });

    res.status(201).json({
      ok: true,
      data: {
        id: makeRowId({ periodType, periodKey }),
        periodType,
        periodKey,
        amount: parsedAmount,
        note: afterEntry.note,
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { householdId, entryId } = req.params;
    const doc = await ensureHouseholdAccess(req, householdId, { forWrite: true });

    const sepIdx = String(entryId).indexOf(':');
    if (sepIdx <= 0) {
      const err = new Error('Invalid entryId format');
      err.status = 400;
      throw err;
    }
    const oldType = entryId.slice(0, sepIdx);
    const oldKey = entryId.slice(sepIdx + 1);

    const parsedAmount = parseMoney(req.body.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      const err = new Error('amount must be a number >= 0');
      err.status = 400;
      throw err;
    }

    const { periodType, periodKey } = validateAndNormalizePeriod({
      periodType: req.body.periodType,
      periodKey: req.body.periodKey,
    });

    let beforeEntry;
    const periodChanged = (oldType !== periodType) || (oldKey !== periodKey);
    if (periodChanged) {
      beforeEntry = readEntry(doc, oldType, oldKey) || null;
    } else {
      beforeEntry = readEntry(doc, periodType, periodKey) || null;
    }

    const autoCleared = periodType === 'year' ? collectAutoClearsForYear(doc, periodKey) : [];

    if (periodChanged) {
      deleteEntryFromDoc(doc, oldType, oldKey);
    }

    ensureBillingContainer(doc);

    const activityCtx = makeActivityCtx(req, doc);
    doc.$locals = doc.$locals || {};
    doc.$locals.activityCtx = activityCtx;

    doc.setFeeEntry({
      periodType,
      periodKey,
      amount: parsedAmount,
      source: 'manual',
      note: (req.body.note || '').trim() || undefined,
    });

    await doc.save();

    const afterEntry = {
      periodType,
      periodKey,
      amount: parsedAmount,
      note: (req.body.note || '').trim() || undefined,
      source: 'manual'
    };

    await logActivity(activityCtx, {
      entity: { type: 'Household', id: doc._id, display: doc.userHouseholdId || doc.householdId || `Household #${doc._id}` },
      action: 'update',
      before: beforeEntry,
      after: afterEntry,
      diff: shallowDiff(beforeEntry || {}, afterEntry),
      meta: {
        notes: 'Household Billing (Fees) — manual update',
        extra: {
          category: 'householdFee',
          entryId: makeRowId({ periodType, periodKey }),
          previousEntryId: `${oldType}:${oldKey}`,
          periodChanged,
          entryAction: 'update',
          autoClearedEntries: autoCleared
        }
      }
    });

    res.json({
      ok: true,
      data: {
        id: makeRowId({ periodType, periodKey }),
        periodType,
        periodKey,
        amount: parsedAmount,
        note: afterEntry.note,
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.destroy = async (req, res, next) => {
  try {
    const { householdId, entryId } = req.params;
    const sepIdx = String(entryId).indexOf(':');
    if (sepIdx <= 0) {
      const err = new Error('Invalid entryId format');
      err.status = 400;
      throw err;
    }
    const periodType = entryId.slice(0, sepIdx);
    const periodKey = entryId.slice(sepIdx + 1);

    const doc = await ensureHouseholdAccess(req, householdId, { forWrite: true });

    const beforeEntry = readEntry(doc, periodType, periodKey);
    if (!beforeEntry) {
      const err = new Error('Fee entry not found');
      err.status = 404;
      throw err;
    }

    const activityCtx = makeActivityCtx(req, doc);
    doc.$locals = doc.$locals || {};
    doc.$locals.activityCtx = activityCtx;

    const ok = deleteEntryFromDoc(doc, periodType, periodKey);
    if (!ok) {
      const err = new Error('Fee entry not found');
      err.status = 404;
      throw err;
    }

    await doc.save();

    await logActivity(activityCtx, {
      entity: { type: 'Household', id: doc._id, display: doc.userHouseholdId || doc.householdId || `Household #${doc._id}` },
      action: 'update', // ← always "update" for Household (even when deleting a fee entry)
      before: beforeEntry,
      after: null,
      diff: shallowDiff(beforeEntry || {}, null),
      meta: {
        notes: 'Household Billing (Fees) — manual delete',
        extra: {
          category: 'householdFee',
          entryId,
          entryAction: 'delete'
        }
      }
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};
