// services/billingRollup.js
const Account = require('../models/Account');

function monthCountFromMaps(mapMonth, mapQuarter, mapYear, forYear) {
  let covered = 0;

  if (mapYear && (mapYear instanceof Map ? mapYear.has(String(forYear)) : mapYear[String(forYear)])) {
    return 12;
  }

  const qKeys = mapQuarter
    ? (mapQuarter instanceof Map ? Array.from(mapQuarter.keys()) : Object.keys(mapQuarter))
    : [];
  qKeys.forEach(k => { if (k.startsWith(`${forYear}-Q`)) covered += 3; });

  const mKeys = mapMonth
    ? (mapMonth instanceof Map ? Array.from(mapMonth.keys()) : Object.keys(mapMonth))
    : [];
  mKeys.forEach(k => { if (k.startsWith(`${forYear}-`)) covered += 1; });

  return Math.max(0, Math.min(12, covered));
}

function accountActualForYear(acct, year) {
  const start = new Date(Date.UTC(year, 0, 1));
  const end   = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
  return Number(acct.getActualForWindow(start, end) || 0);
}

function accountEstimateForYear(acct, year) {
  const est = acct.estimateAnnualFromActuals(year);
  return {
    actual: Number(est.actual || 0),
    estimated: Number(est.estimated || 0),
    total: Number(est.total || 0)
  };
}

function feesActualForYear(hh, year) {
  const b = (hh.billing || {});
  const yMap = b.feeByYear || new Map();
  const qMap = b.feeByQuarter || new Map();
  const mMap = b.feeByMonth || new Map();

  let actual = 0;
  const yKey = String(year);

  if (yMap instanceof Map ? yMap.has(yKey) : yMap[yKey]) {
    const v = yMap instanceof Map ? yMap.get(yKey) : yMap[yKey];
    actual += Number(v?.amount || 0);
  } else {
    const qEntries = qMap instanceof Map ? Array.from(qMap.entries()) : Object.entries(qMap);
    qEntries.forEach(([k, v]) => { if (k.startsWith(`${year}-Q`)) actual += Number(v?.amount || 0); });

    const mEntries = mMap instanceof Map ? Array.from(mMap.entries()) : Object.entries(mMap);
    mEntries.forEach(([k, v]) => { if (k.startsWith(`${year}-`)) actual += Number(v?.amount || 0); });
  }

  const monthsCovered = monthCountFromMaps(mMap, qMap, yMap, year);
  return { actual, monthsCovered };
}

/**
 * CURRENT CALENDAR YEAR rollup (as-of today).
 * Estimation rules:
 *  - Accounts with 0 months: excluded from estimates (no guessing).
 *  - Accounts with 1..11 months: estimated to full-year from observed months/quarters.
 *  - Accounts with 12 months (or a Year entry): use actuals only.
 *  - Household fees: actuals only; never estimated.
 *
 * Returns:
 * {
 *   periodStart, periodEnd,
 *   accounts: {
 *     actual, estimated, total,
 *     monthsCovered,                   // min months across billed accounts (12 only if all complete)
 *     withAnyData, fullAccounts, partialAccounts, noDataAccounts,
 *     hasPartialCoverage               // true if any account has 1..11 months
 *   },
 *   fees: { actual, monthsCovered },
 *   total
 * }
 */
async function computeHouseholdRollingBilling(householdDoc, asOf = new Date()) {
  const year = asOf.getUTCFullYear();

  const accounts = Array.isArray(householdDoc.accounts) ? householdDoc.accounts : [];
  const accountDocs = accounts.map(a =>
    (typeof a.getActualForWindow === 'function' ? a : new Account(a))
  );

  // Aggregates
  let acctActual = 0;
  let acctEstimated = 0;
  let acctTotal = 0;

  // Coverage stats (per-account basis)
  let stats = {
    totalAccounts: accountDocs.length,
    billedAccounts: 0,              // accounts with any data this year (>0 months)
    fullyCoveredAccounts: 0,        // accounts with complete data (12 months or Year value)
    partiallyCoveredAccounts: 0,    // accounts with 1..11 months
    zeroDataAccounts: 0             // accounts with 0 months (ignored in decision)
  };

  for (const acct of accountDocs) {
    // Amounts (uses robust model helpers now)
    const est = accountEstimateForYear(acct, year);
    acctActual    += est.actual;
    acctEstimated += est.estimated;
    acctTotal     += est.total;

    // Coverage classification for this account
    const b = acct.billing || {};
    const months = monthCountFromMaps(b.billingByMonth, b.billingByQuarter, b.billingByYear, year);

    if (months <= 0) {
      stats.zeroDataAccounts += 1;
    } else if (months >= 12) {
      stats.billedAccounts += 1;
      stats.fullyCoveredAccounts += 1;
    } else {
      stats.billedAccounts += 1;
      stats.partiallyCoveredAccounts += 1;
    }
  }

  // New decision rule:
  // - Show estimate iff at least one account has partial data (1..11 months).
  // - Ignore zero-data accounts in the decision.
  const shouldEstimate = stats.partiallyCoveredAccounts > 0;

  const fees = feesActualForYear(householdDoc, year);

  return {
    periodStart: new Date(Date.UTC(year, 0, 1)),
    periodEnd:   new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
    accounts: {
      actual: acctActual,
      estimated: shouldEstimate ? acctEstimated : 0,
      total: shouldEstimate ? (acctActual + acctEstimated) : acctActual,
      // keep stats for the modal
      stats,
      shouldEstimate
    },
    fees: {
      actual: fees.actual,
      monthsCovered: fees.monthsCovered
    },
    total: (shouldEstimate ? (acctActual + acctEstimated) : acctActual) + fees.actual
  };
}

module.exports = { computeHouseholdRollingBilling };
