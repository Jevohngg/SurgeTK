// utils/activityLogger.js
const ActivityLog = require('../models/ActivityLog');

function redact(obj, opts = {}) {
  if (!obj) return obj;
  const deny = new Set([ 'password', 'token', 'apiSecret', 'ssn', 'plaidAccessToken' , ...(opts.deny || []) ]);
  const MAX_STR = opts.maxString || 500;

  const clone = JSON.parse(JSON.stringify(obj));
  function walk(o) {
    if (!o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      if (deny.has(k)) { o[k] = '[REDACTED]'; continue; }
      if (typeof o[k] === 'string' && o[k].length > MAX_STR) {
        o[k] = o[k].slice(0, MAX_STR) + '…';
      } else if (typeof o[k] === 'object') {
        walk(o[k]);
      }
    }
  }
  walk(clone);
  return clone;
}

// tiny diff (flat, best-effort; swap in a library later if needed)
function shallowDiff(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changed = {};
  for (const k of keys) {
    const a = before?.[k]; const b = after?.[k];
    const same = JSON.stringify(a) === JSON.stringify(b);
    if (!same) changed[k] = { from: a, to: b };
  }
  return changed;
}

async function logActivity(ctx, {
  companyId, // optional override
  entity = { type: 'Other', id: null, display: '' },
  action = 'other',
  before = null,
  after = null,
  diff = null,
  meta = {},
  notes = ''
}) {
  const firmId = companyId || ctx?.companyId;
  if (!firmId) {
    // No firm context — skip quietly to avoid noisy errors
    return;
  }
  const payload = {
    companyId: firmId,
    actor: ctx?.actor || { _id: null, email: 'system@surgetk', name: 'System', roles: [] },
    entity,
    action,
    changes: {
      before: before ? redact(before) : null,
      after:  after ? redact(after)  : null,
      diff:   diff ?? shallowDiff(before, after)
    },
    meta: { ...(ctx?.meta || {}), ...(meta || {}) }
  };
  if (notes) payload.meta.notes = notes;
  try {
    await ActivityLog.create(payload);
  } catch (err) {
    // Don’t crash the request on logging issues
    console.error('[ActivityLog] create error:', err?.message);
  }
}

module.exports = { logActivity, shallowDiff, redact };
