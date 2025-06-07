// services/householdUtils.js
// ------------------------------------------------------------
// Centralised helpers for household‑level portfolio statistics:
//
//   • totalAccountValue         – sum of every account’s market value
//   • monthlyDistribution       – $/month leaving the household via all
//                                 “systematic withdrawals”, *including*
//                                 the new multi‑withdrawal array.
//
// Implementation notes
// --------------------
//  1.  We delegate to totalMonthlyDistribution(), a pure helper that
//      already understands BOTH the new
//          systematicWithdrawals: [ {amount,frequency}, … ]
//      and the legacy scalar pair
//          systematicWithdrawAmount / systematicWithdrawFrequency
//      so this function will keep returning correct figures until the
//      migration finishes and the scalars are removed.
//
//  2.  No other business logic is changed; callers still receive the
//      exact same two‑field object { totalAccountValue, monthlyDistribution }.
// ------------------------------------------------------------

const { totalMonthlyDistribution } = require('./monthlyDistribution');

/**
 * Given a Household mongoose doc (or lean object that contains an
 * `accounts` array), return:
 *
 *   { totalAccountValue, monthlyDistribution }
 *
 * - totalAccountValue is the simple dollar sum of accountValue.
 * - monthlyDistribution is the *aggregated* $/month produced by all
 *   standing withdrawals across every account.
 *
 * Both values are returned as raw numbers (no rounding/formatting).
 *
 * @param {Object} household  – expected to have an `.accounts` array
 * @returns {{ totalAccountValue:number, monthlyDistribution:number }}
 */
function getHouseholdTotals(household) {
  let totalAccountValue = 0;
  let monthlyDistribution = 0;

  if (!household || !Array.isArray(household.accounts)) {
    return { totalAccountValue, monthlyDistribution };
  }

  // ───────────────────────────────────────────────────────────
  // 1) Sum all account values
  // ───────────────────────────────────────────────────────────
  totalAccountValue = household.accounts.reduce(
    (sum, acc) => sum + (acc.accountValue || 0),
    0
  );

  // ───────────────────────────────────────────────────────────
  // 2) Aggregate *all* systematic withdrawals (new array or legacy)
  // ───────────────────────────────────────────────────────────
  monthlyDistribution = totalMonthlyDistribution(household.accounts);

  return { totalAccountValue, monthlyDistribution };
}

module.exports = {
  getHouseholdTotals,
};
