// services/valueAdds/distributionTableService.js
// ───────────────────────────────────────────────────────────────────────────
//  Four‑column distribution table (Current, Available, Upper, Lower)
// ───────────────────────────────────────────────────────────────────────────

function calculateDistributionTable(household, opts = {}) {
  if (!household) throw new Error('Household object is required');

  /* ── Household figures ─────────────────────────────────────────────── */
  const totalPortfolio     = household.totalAccountValue || 0;
  // don’t coerce undefined→0 here, so we can detect “no data”
  const actualMonthlyRaw   = household.actualMonthlyDistribution;
  const hasActualMonthly  = actualMonthlyRaw != null;  

  /* ── Rates: accept long or short keys ──────────────────────────────── */
  const availableRate = (opts.availableRate ?? opts.avail) || 0.054;
  const upperRate     = (opts.upperRate     ?? opts.upper) || availableRate + 0.006;
  const lowerRate     = (opts.lowerRate     ?? opts.lower) || availableRate - 0.006;

  /* ── Current column ────────────────────────────────────────────────── */
    /* ── Current column ────────────────────────────────────────────────── */
    // default to the “available”‐rate scenario
    let currentMonthlyIncome    = (totalPortfolio * availableRate) / 12;
    let currentDistributionRate = availableRate;
  
    // if the household actually _has_ a withdrawal setting (even if 0), use it
    if (hasActualMonthly) {
      currentMonthlyIncome    = actualMonthlyRaw;
      currentDistributionRate = totalPortfolio > 0
        ? (actualMonthlyRaw * 12) / totalPortfolio
        : 0;
    }

  /* ── Portfolio targets ─────────────────────────────────────────────── */
  const upperPortfolioValue = totalPortfolio * (upperRate / availableRate);
  const lowerPortfolioValue = totalPortfolio * (lowerRate / availableRate);

  const monthlyFromPV = pv => (pv * availableRate) / 12; // income follows availableRate

  /* ── Final table ───────────────────────────────────────────────────── */
  return {
    current: {
      portfolioValue  : totalPortfolio,
      distributionRate: currentDistributionRate,
      monthlyIncome   : currentMonthlyIncome,
    },

    available: {
      portfolioValue  : totalPortfolio,
      distributionRate: availableRate,
      monthlyIncome   : monthlyFromPV(totalPortfolio),
    },

    upper: {
      portfolioValue  : upperPortfolioValue,
      distributionRate: upperRate,                // ← now displays true upper %
      monthlyIncome   : monthlyFromPV(upperPortfolioValue),
    },

    lower: {
      portfolioValue  : lowerPortfolioValue,
      distributionRate: lowerRate,                // ← now displays true lower %
      monthlyIncome   : monthlyFromPV(lowerPortfolioValue),
    },
  };
}

module.exports = { calculateDistributionTable };
