// services/billing.js
'use strict';

const mongoose  = require('mongoose');
const Account   = require('../models/Account');
const Household = require('../models/Household');

/**
 * Parse a period key into { periodType, periodKey }.
 * Supported:
 *   - 'YYYY-MM'     -> { periodType: 'month',   periodKey: 'YYYY-MM' }
 *   - 'YYYY-Q#'     -> { periodType: 'quarter', periodKey: 'YYYY-Q#' }
 *   - 'YYYY'        -> { periodType: 'year',    periodKey: 'YYYY' }
 */
function parsePeriodKey(input) {
  const raw = String(input || '').trim();
  if (!raw) throw Object.assign(new Error('billingPeriod is required'), { code: 'PERIOD_REQUIRED' });

  // YYYY-MM
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return { periodType: 'month', periodKey: raw };
  // YYYY-Q#
  if (/^\d{4}-Q[1-4]$/i.test(raw))        return { periodType: 'quarter', periodKey: raw.toUpperCase() };
  // YYYY
  if (/^\d{4}$/.test(raw))                return { periodType: 'year', periodKey: raw };

  throw Object.assign(new Error(`Unsupported billingPeriod format: ${raw}`), { code: 'PERIOD_INVALID' });
}

/**
 * Parse a date-like value with an optional format hint.
 * Returns a Date (UTC midnight where applicable) or throws.
 */
function parseDate(input, hint) {
  if (input == null || input === '') return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input;

  const s = String(input).trim();
  if (!s) return null;

  // ISO fast-path
  const iso = Date.parse(s);
  if (Number.isFinite(iso)) return new Date(iso);

  // Hints
  if (hint) {
    const h = String(hint).toUpperCase();
    if (h === 'MM/DD/YYYY') {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      if (m) {
        const mm = parseInt(m[1], 10) - 1, dd = parseInt(m[2], 10), yy = parseInt(m[3], 10);
        const d = new Date(Date.UTC(yy, mm, dd));
        if (!Number.isNaN(d.getTime())) return d;
      }
    }
    if (h === 'DD/MM/YYYY') {
      const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
      if (m) {
        const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10) - 1, yy = parseInt(m[3], 10);
        const d = new Date(Date.UTC(yy, mm, dd));
        if (!Number.isNaN(d.getTime())) return d;
      }
    }
  }

  // Common short forms: 8/15/2025, 8-15-25
  const m2 = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
  if (m2) {
    const mm = parseInt(m2[1], 10) - 1, dd = parseInt(m2[2], 10);
    const yy = m2[3].length === 2 ? 2000 + parseInt(m2[3], 10) : parseInt(m2[3], 10);
    const d  = new Date(Date.UTC(yy, mm, dd));
    if (!Number.isNaN(d.getTime())) return d;
  }

  // Fallback: invalid
  throw Object.assign(new Error(`Unparseable date: ${s}`), { code: 'DATE_INVALID' });
}

/**
 * Convert an amount to integer cents (non-negative).
 * Accepts numbers or currency-like strings (commas, $, parentheses, leading '-').
 */
function toCents(amount, currency = 'USD') {
  if (amount == null || amount === '') {
    throw Object.assign(new Error('amount is required'), { code: 'AMOUNT_REQUIRED' });
  }

  // Numbers: fail fast on negatives/NaN
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) {
      throw Object.assign(new Error('amount NaN'), { code: 'AMOUNT_INVALID' });
    }
    if (amount < 0) {
      throw Object.assign(new Error('amount < 0 not allowed'), { code: 'AMOUNT_NEGATIVE' });
    }
    return Math.round(amount * 100);
  }

  // Strings
  let s = String(amount).trim();
  if (!s) throw Object.assign(new Error('amount blank'), { code: 'AMOUNT_INVALID' });

  let neg = false;
  if (/^\(.+\)$/.test(s)) { neg = true; s = s.slice(1, -1); } // (xxx) → negative
  if (s.startsWith('-'))   { neg = true; s = s.slice(1); }     // -xxx  → negative

  s = s.replace(/[$,\s]/g, '');
  if (!s) throw Object.assign(new Error('amount empty'), { code: 'AMOUNT_INVALID' });

  const v = Number(s);
  if (!Number.isFinite(v)) throw Object.assign(new Error('amount NaN'), { code: 'AMOUNT_INVALID' });
  if (neg) throw Object.assign(new Error('amount < 0 not allowed'), { code: 'AMOUNT_NEGATIVE' });

  return Math.round(v * 100);
}

/* ──────────────────────────────────────────────────────────
 * Internal helpers
 * ────────────────────────────────────────────────────────── */

/** Ensure the root `billing` subdoc exists on a Mongoose document. */
function _ensureBillingRoot(doc) {
  if (!doc.billing || typeof doc.billing !== 'object') {
    // Use .set so Mongoose tracks the new nested path correctly.
    doc.set('billing', {}, { strict: false });
  }
}

/** Resolve the map/bucket name based on target and period. */
function _bucketName(targetType, periodType) {
  const isAcct = targetType === 'account';
  if (periodType === 'year')    return isAcct ? 'billingByYear'   : 'feeByYear';
  if (periodType === 'quarter') return isAcct ? 'billingByQuarter': 'feeByQuarter';
  return isAcct ? 'billingByMonth' : 'feeByMonth'; // periodType === 'month'
}

/** Read an existing numeric amount (in dollars) for a doc/period safely. */
function _readExistingAmount(doc, targetType, periodType, periodKey) {
  const bucket = _bucketName(targetType, periodType);
  const container = doc?.billing?.[bucket];
  if (!container) return 0;

  // Works whether it's a Map or a plain object
  const node = container instanceof Map ? container.get(periodKey) : container[periodKey];
  return Number(node?.amount || 0);
}

/* ──────────────────────────────────────────────────────────
 * Public: Upsert billing item for Account or Household
 * ────────────────────────────────────────────────────────── */
/**
 * Upsert one billing item to an Account or Household.
 *
 * @param {object} args
 *  - targetType: 'account' | 'household'
 *  - targetId:   ObjectId string
 *  - periodKey:  'YYYY'|'YYYY-Q#'|'YYYY-MM' OR {periodType,periodKey}
 *  - payload:    { amountCents, currency, description, dueDate }
 *  - strategy:   'merge'|'replace' (default: 'replace')
 * @param {object} ctx
 *  - session:    Mongoose ClientSession (optional)
 *
 * @returns {Promise<{action: 'created'|'updated', previousAmount: number, amount: number, targetId: string}>}
 *          amounts are in **dollars** here (since schema stores dollars)
 */
async function upsertBillingItem(args, ctx = {}) {
  const { targetType, targetId, periodKey, payload, strategy = 'replace' } = args;

  if (!['account','household'].includes(targetType)) {
    throw Object.assign(new Error(`Unsupported targetType: ${targetType}`), { code: 'TARGET_INVALID' });
  }
  if (!targetId)  throw Object.assign(new Error('targetId required'),  { code: 'TARGET_REQUIRED' });
  if (!periodKey) throw Object.assign(new Error('periodKey required'), { code: 'PERIOD_REQUIRED' });

  const { periodType, periodKey: normKey } =
    typeof periodKey === 'string' ? parsePeriodKey(periodKey) : periodKey;

  const { amountCents, currency = 'USD', description } = payload || {};
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw Object.assign(new Error('amountCents must be integer >= 0'), { code: 'AMOUNT_INVALID' });
  }
  if (currency !== 'USD') {
    throw Object.assign(new Error('Only USD is supported at this time.'), { code: 'CURRENCY_UNSUPPORTED' });
  }

  // Convert to dollars for storage (schemas store dollars in their maps)
  const dollars = Math.round(amountCents) / 100;

  let doc;
  if (targetType === 'account') {
    doc = await Account.findById(targetId).session(ctx.session || null);
    if (!doc) throw Object.assign(new Error('Account not found'), { code: 'TARGET_NOT_FOUND' });

    // Ensure the root exists so setBillingEntry doesn't try to read undefined.billingBy*
    _ensureBillingRoot(doc);

    const prev = _readExistingAmount(doc, 'account', periodType, normKey);
    const next = strategy === 'merge' ? (prev + dollars) : dollars;

    doc.setBillingEntry({
      billType: 'account',
      periodType,
      periodKey: normKey,
      amount: Number(next),
      source: 'import',
      note: (description || '').trim() || undefined
    });

    // Be explicit so Mongoose persists nested Map changes in all cases
    doc.markModified('billing');

    await doc.save({ session: ctx.session || null });
    return {
      action: prev > 0 ? 'updated' : 'created',
      previousAmount: prev,
      amount: next,
      targetId: String(doc._id)
    };
  }

  // Household
  doc = await Household.findById(targetId).session(ctx.session || null);
  if (!doc) throw Object.assign(new Error('Household not found'), { code: 'TARGET_NOT_FOUND' });

  _ensureBillingRoot(doc);

  const prev = _readExistingAmount(doc, 'household', periodType, normKey);
  const next = strategy === 'merge' ? (prev + dollars) : dollars;

  doc.setFeeEntry({
    periodType,
    periodKey: normKey,
    amount: Number(next),
    source: 'import',
    note: (description || '').trim() || undefined
  });

  doc.markModified('billing');

  await doc.save({ session: ctx.session || null });
  return {
    action: prev > 0 ? 'updated' : 'created',
    previousAmount: prev,
    amount: next,
    targetId: String(doc._id)
  };
}

module.exports = {
  parsePeriodKey,
  parseDate,
  toCents,
  upsertBillingItem
};
