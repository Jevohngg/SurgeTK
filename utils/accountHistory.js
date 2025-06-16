// utils/accountHistory.js
// -------------------------------------------------------
// Central place to define which Account fields we track
// and a helper that writes an AccountHistory doc.
// -------------------------------------------------------

const AccountHistory = require('../models/AccountHistory');

// ① —────  Fields we care about  ─────────────────────────
const TRACKED_FIELDS = exports.TRACKED_FIELDS = [
  'accountValue', 'systematicWithdrawals',   // cash-flow
  'cash', 'income', 'annuities', 'growth',   // asset allocation
  'accountType', 'taxStatus', 'custodian',   // misc.
];

// ② —────  Create a shallow snapshot of just those props
function snapshot(accountDoc) {
  const obj = {};
  for (const f of TRACKED_FIELDS) obj[f] = accountDoc.get(f);
  return obj;
}
// ←── Export snapshot so controllers can import it:
exports.snapshot = snapshot;

// ③ —────  Top-level helper used by controllers
/**
 * @param {import('../models/Account')} afterSaveDoc – Mongoose doc *after* save()
 * @param {Object}                      before       – plain-object snapshot from *before* save
 * @param {String}                      userId
 */
exports.logChanges = async function logChanges(afterSaveDoc, before, userId, { logAll = false } = {}) {
  const changes = [];

  for (const f of TRACKED_FIELDS) {
    const prev = before[f] ?? null;
    const next = afterSaveDoc.get(f) ?? null;

    if (logAll || afterSaveDoc.isModified(f) || prev !== next) {
      changes.push({ field: f, prev, next });
    }
  }
  if (!changes.length) return;

  await AccountHistory.create({
    account:   afterSaveDoc._id,
    changedBy: userId,
    asOfDate:  afterSaveDoc.asOfDate,
    changes,
  });
};

