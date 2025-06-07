// /services/monthlyDistribution.js
// ------------------------------------------------------------
// Centralised helpers for anything related to “systematic
// withdrawals” ­– both percentage‑based and dollar totals.
//
//  • monthlyAmountFromWithdrawals  →  $/month produced
//  • monthlyRateFromWithdrawals    →  %/month of account value
//  • annualRateFromWithdrawals     →  %/year  (view‑layer helper)
//  • totalMonthlyDistribution      →  $/month aggregated per‑household
//
// These helpers are *pure functions* and contain **no** I/O,
// making them safe for unit testing.
// ------------------------------------------------------------

/**
 * Given an array of {amount, frequency} objects, return the
 * *dollar amount* that leaves the account every month.
 *
 * @param {Array<{amount:number,frequency:string}>} withdrawals
 * @returns {number} monthly dollar flow (precision: raw float)
 */
function monthlyAmountFromWithdrawals(withdrawals = []) {
    if (!Array.isArray(withdrawals) || withdrawals.length === 0) return 0;
  
    return withdrawals.reduce((sum, w) => {
      const { amount = 0, frequency = '' } = w || {};
      switch (frequency) {
        case 'Monthly':
          return sum + amount;
        case 'Quarterly':
          return sum + amount / 3;
        case 'Semi-annual':
          return sum + amount / 6;
        case 'Annually':
          return sum + amount / 12;
        default:
          return sum;
      }
    }, 0);
  }
  
  /**
   * Percentage **per month** of account value distributed.
   *
   * @param {Array<{amount:number,frequency:string}>} withdrawals
   * @param {number} accountValue
   * @returns {number} monthly percentage (0‑100 scale)
   */
  function monthlyRateFromWithdrawals(withdrawals = [], accountValue = 0) {
    if (!Array.isArray(withdrawals) || withdrawals.length === 0 || !accountValue) return 0;
  
    const monthlyTotal = monthlyAmountFromWithdrawals(withdrawals);
    return (monthlyTotal / accountValue) * 100;
  }
  
  /**
   * Convenience helper: annualise the monthly rate for UI display.
   *
   * @param {Array<{amount:number,frequency:string}>} withdrawals
   * @param {number} accountValue
   * @returns {number} annual percentage (0‑100 scale)
   */
  function annualRateFromWithdrawals(withdrawals = [], accountValue = 0) {
    return monthlyRateFromWithdrawals(withdrawals, accountValue) * 12;
  }
  
  /**
   * Sum the *dollar* amounts across all accounts in a household.
   * Supports both the new array field and the legacy scalar pair
   * for documents not yet migrated.
   *
   * @param {Array<Object>} accounts ‑ mongoose docs or lean objects
   * @returns {number} total monthly distribution ($)
   */
  function totalMonthlyDistribution(accounts = []) {
    if (!Array.isArray(accounts) || accounts.length === 0) return 0;
  
    return accounts.reduce((tot, acc) => {
      // Preferred: array field
      if (Array.isArray(acc.systematicWithdrawals) && acc.systematicWithdrawals.length) {
        return tot + monthlyAmountFromWithdrawals(acc.systematicWithdrawals);
      }
  
      // Fallback: legacy scalar fields (to be removed after migration)
      if (acc.systematicWithdrawAmount && acc.systematicWithdrawFrequency) {
        return (
          tot +
          monthlyAmountFromWithdrawals([
            {
              amount: acc.systematicWithdrawAmount,
              frequency: acc.systematicWithdrawFrequency,
            },
          ])
        );
      }
  
      return tot;
    }, 0);
  }
  
  module.exports = {
    monthlyAmountFromWithdrawals,
    monthlyRateFromWithdrawals,
    annualRateFromWithdrawals,
    totalMonthlyDistribution,
  };
  