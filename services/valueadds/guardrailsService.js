// services/valueAdds/guardrailsService.js
// ───────────────────────────────────────────────────────────────────────────
//  Guardrails – rates‑only implementation
// ───────────────────────────────────────────────────────────────────────────

function validateGuardrailsInputs(household) {
  const missing = [];
  if (!household || typeof household.totalAccountValue !== 'number') {
    missing.push('household.totalAccountValue');
  }
  return missing;
}

function calculateGuardrails(household, options = {}) {
  /* ── Current snapshot ──────────────────────────────────────────────── */
  const currentPortfolioValue = household.totalAccountValue || 0;
  const actualMonthly         = household.actualMonthlyDistribution || 0;

  /* ── Pull firm‑level defaults then honour any runtime overrides ────── */
  const firm           = household.firm || {};
  const availableRate  =
    options.distributionRate ??
    firm.guardrailsAvailableRate ??
    firm.guardrailsDistributionRate ??
    0.054;

  const upperRate =
    options.upperRate ??
    firm.guardrailsUpperRate ??
    availableRate + 0.006;

  const lowerRate =
    options.lowerRate ??
    firm.guardrailsLowerRate ??
    availableRate - 0.006;

  /* ── Portfolio value targets (upper > current > lower) ─────────────── */
  const upperPortfolioValue = currentPortfolioValue * (upperRate / availableRate);
  const lowerPortfolioValue = currentPortfolioValue * (lowerRate / availableRate);

  /* ── Current column ─────────────────────────────────────────────────── */
  let currentMonthlyIncome    = (currentPortfolioValue * availableRate) / 12;
  let currentDistributionRate = availableRate;

  if (actualMonthly > 0) {
    currentMonthlyIncome = actualMonthly;
    currentDistributionRate =
      currentPortfolioValue > 0
        ? (actualMonthly * 12) / currentPortfolioValue
        : 0;
  }

  /* ── Return canonical payload ──────────────────────────────────────── */
  return {
    current: {
      portfolioValue  : currentPortfolioValue,
      annualIncome    : currentMonthlyIncome * 12,
      monthlyIncome   : currentMonthlyIncome,
      distributionRate: currentDistributionRate,
    },

    available: {
      portfolioValue  : currentPortfolioValue,
      annualIncome    : currentPortfolioValue * availableRate,
      monthlyIncome   : (currentPortfolioValue * availableRate) / 12,
      distributionRate: availableRate,
    },

    upper: {
      portfolioValue  : upperPortfolioValue,
      annualIncome    : upperPortfolioValue * availableRate,        // income still based on *available* rate
      monthlyIncome   : (upperPortfolioValue * availableRate) / 12, // ← same rule as original spec
      distributionRate: upperRate,                                  // now shows real upper %
    },

    lower: {
      portfolioValue  : lowerPortfolioValue,
      annualIncome    : lowerPortfolioValue * availableRate,
      monthlyIncome   : (lowerPortfolioValue * availableRate) / 12,
      distributionRate: lowerRate,                                  // now shows real lower %
    },
  };
}

module.exports = {
  validateGuardrailsInputs,
  calculateGuardrails,
};
