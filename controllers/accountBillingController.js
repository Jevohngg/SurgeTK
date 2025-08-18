// controllers/accountBillingController.js
const Account = require('../models/Account'); // adjust path if needed
const { logActivity, shallowDiff } = require('../utils/activityLogger');

// ───────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────
function parseMoney(n) {
  if (typeof n === 'string') n = n.replace(/,/g, '');
  const num = Number(n);
  return Number.isFinite(num) ? num : NaN;
}

// Validate periodType + periodKey coming from the UI
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

// Convert one Map bucket to array rows (for list)
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
  return t === 'month' ? 'billingByMonth' : (t === 'quarter' ? 'billingByQuarter' : 'billingByYear');
}

// Read a single entry (if present) as a small object for logging
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

  if (m instanceof Map) {
    return m.delete(periodKey);
  } else if (typeof m === 'object') {
    if (Object.prototype.hasOwnProperty.call(m, periodKey)) {
      delete m[periodKey];
      return true;
    }
  }
  return false;
}

// Collect which quarter/month entries would be auto-cleared by a YEAR write
function collectAutoClearsForYear(doc, yearStr) {
  const cleared = [];
  const q = doc?.billing?.billingByQuarter;
  if (q) {
    const qKeys = q instanceof Map ? Array.from(q.keys()) : Object.keys(q);
    for (const k of qKeys) {
      if (k.startsWith(yearStr + '-Q') || k.startsWith(yearStr + 'Q')) {
        cleared.push(`quarter:${k}`);
      }
    }
  }
  const m = doc?.billing?.billingByMonth;
  if (m) {
    const mKeys = m instanceof Map ? Array.from(m.keys()) : Object.keys(m);
    for (const k of mKeys) {
      if (k.startsWith(yearStr + '-')) {
        cleared.push(`month:${k}`);
      }
    }
  }
  return cleared;
}

// Build ctx object your audit stack expects
function makeActivityCtx(req, accountDoc) {
  const actor = req.user ? {
    _id: req.user._id,
    email: req.user.email || req.user.username || '',
    name: req.user.name || [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
    roles: req.user.roles || [],
  } : { _id: null, email: 'system@surgetk', name: 'System', roles: [] };

  return {
    companyId: accountDoc.firmId, // REQUIRED by ActivityLog schema
    actor,
    meta: {
      path: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('user-agent')
    }
  };
}

// When reading (list) we can use lean; when modifying, we need a full doc.
async function ensureAccountAccess(req, accountId, { forWrite = false } = {}) {
  const q = forWrite ? Account.findById(accountId) : Account.findById(accountId).lean();
  const acct = await q.exec();
  if (!acct) {
    const err = new Error('Account not found');
    err.status = 404;
    throw err;
  }
  // TODO: enforce authorization for req.user over this account, if applicable.
  return acct;
}

// ───────────────────────────────────────────────────────────
// Controller actions
// ───────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { accountId } = req.params;
    const acct = await ensureAccountAccess(req, accountId, { forWrite: false });

    const billing = (acct && acct.billing) || {};
    const rows = [
      ...mapToRows(billing.billingByYear, 'year'),
      ...mapToRows(billing.billingByQuarter, 'quarter'),
      ...mapToRows(billing.billingByMonth, 'month'),
    ].sort((a, b) => periodStartMs(b.periodType, b.periodKey) - periodStartMs(a.periodType, a.periodKey));

    res.json({ ok: true, data: rows });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { accountId } = req.params;
    const doc = await ensureAccountAccess(req, accountId, { forWrite: true });

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

    // --- capture "before" (did this key already exist?)
    const beforeEntry = readEntry(doc, periodType, periodKey);
    const entryAction = beforeEntry ? 'update' : 'create';

    // If creating a YEAR entry, note which lower granularities will be auto-cleared
    const autoCleared = periodType === 'year'
      ? collectAutoClearsForYear(doc, periodKey)
      : [];

    ensureBillingContainer(doc);

    // Attach activity context so your audit plugin (on Account.save) can log full-doc diff
    const activityCtx = makeActivityCtx(req, doc);
    // doc.$locals = doc.$locals || {};
    // doc.$locals.activityCtx = activityCtx;           

    // Persist using model helper (handles overrides for year)
    doc.setBillingEntry({
      billType: 'account',
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

    // Focused, human‑sized activity entry
    await logActivity(activityCtx, {
        entity: { type: 'Account', id: doc._id, display: doc.accountNumber || `Account #${doc._id}` },
        action: 'update', // <- always "update" for Account; see entryAction in meta
      before: beforeEntry,
      after: afterEntry,
      diff: shallowDiff(beforeEntry || {}, afterEntry),
      meta: {
        notes: 'Account Billing (AUM) — manual entry',
        extra: {
          category: 'accountBilling',
          entryId: makeRowId({ periodType, periodKey }),
          entryAction,                     // 'create' or 'update'
          autoClearedEntries: autoCleared  // quarters/months cleared by a year write
        }
      }
    });

    const responseRow = {
      id: makeRowId({ periodType, periodKey }),
      periodType,
      periodKey,
      amount: parsedAmount,
      note: afterEntry.note,
    };
    res.status(201).json({ ok: true, data: responseRow });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { accountId, entryId } = req.params;
    const doc = await ensureAccountAccess(req, accountId, { forWrite: true });

    // Parse old id: "type:key"
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

    // — determine beforeEntry
    let beforeEntry;
    const periodChanged = (oldType !== periodType) || (oldKey !== periodKey);
    if (periodChanged) {
      beforeEntry = readEntry(doc, oldType, oldKey) || null;
    } else {
      beforeEntry = readEntry(doc, periodType, periodKey) || null;
    }

    // If new is YEAR, collect auto-clears
    const autoCleared = periodType === 'year'
      ? collectAutoClearsForYear(doc, periodKey)
      : [];

    // If the period changed, remove the old entry explicitly
    if (periodChanged) {
      deleteEntryFromDoc(doc, oldType, oldKey);
    }

    ensureBillingContainer(doc);

    const activityCtx = makeActivityCtx(req, doc);
    // doc.$locals = doc.$locals || {};
    // doc.$locals.activityCtx = activityCtx;    

    doc.setBillingEntry({
      billType: 'account',
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
      entity: { type: 'Account', id: doc._id, display: doc.accountNumber || `Account #${doc._id}` },
      action: 'update',
      before: beforeEntry,
      after: afterEntry,
      diff: shallowDiff(beforeEntry || {}, afterEntry),
      meta: {
        notes: 'Account Billing (AUM) — manual update',
        extra: {
          category: 'accountBilling',
          entryId: makeRowId({ periodType, periodKey }),
          previousEntryId: `${oldType}:${oldKey}`,
          periodChanged,
          autoClearedEntries: autoCleared,
          entryAction: 'update'
        }
      }
    });

    const responseRow = {
      id: makeRowId({ periodType, periodKey }),
      periodType,
      periodKey,
      amount: parsedAmount,
      note: afterEntry.note,
    };
    res.json({ ok: true, data: responseRow });
  } catch (err) {
    next(err);
  }
};

exports.destroy = async (req, res, next) => {
  try {
    const { accountId, entryId } = req.params;
    const doc = await ensureAccountAccess(req, accountId, { forWrite: true });

    const sepIdx = String(entryId).indexOf(':');
    if (sepIdx <= 0) {
      const err = new Error('Invalid entryId format');
      err.status = 400;
      throw err;
    }
    const periodType = entryId.slice(0, sepIdx);
    const periodKey = entryId.slice(sepIdx + 1);

    const beforeEntry = readEntry(doc, periodType, periodKey);
    if (!beforeEntry) {
      const err = new Error('Billing entry not found');
      err.status = 404;
      throw err;
    }

    const activityCtx = makeActivityCtx(req, doc);
    // doc.$locals = doc.$locals || {};
    // doc.$locals.activityCtx = activityCtx;          

    const ok = deleteEntryFromDoc(doc, periodType, periodKey);
    if (!ok) {
      const err = new Error('Billing entry not found');
      err.status = 404;
      throw err;
    }

    await doc.save();

    await logActivity(activityCtx, {
      entity: { type: 'Account', id: doc._id, display: doc.accountNumber || `Account #${doc._id}` },
      action: 'update',
      before: beforeEntry,
      after: null,
      diff: shallowDiff(beforeEntry || {}, null),
      meta: {
        notes: 'Account Billing (AUM) — manual delete',
        extra: {
          category: 'accountBilling',
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
