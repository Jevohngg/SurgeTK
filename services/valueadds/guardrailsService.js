// services/valueAdds/guardrailsService.js

/**
 * Validate that necessary data exists on the household to compute Guardrails.
 * Returns an array of missing field names, or empty if OK.
 */
function validateGuardrailsInputs(household) {
  const missing = [];
  // We need a numeric totalAccountValue
  if (!household || typeof household.totalAccountValue !== 'number') {
    missing.push('household.totalAccountValue');
  }
  return missing;
}

/**
 * Calculate the Guardrails data object.
 * @param {Object} household - The household doc (with totalAccountValue, etc.)
 * @param {Object} options - e.g. { distributionRate, upperFactor, lowerFactor }
 * @returns {Object} - Guardrails data for rendering
 */
function calculateGuardrails(household, options = {}) {
  // 1) Current total portfolio value
  const currentPortfolioValue = household.totalAccountValue || 0;

  // 2) Base distribution rate (e.g. 5.4% if not provided)
  const firm = household.firm || {};
  const baseDistributionRate = options.distributionRate || firm.guardrailsDistributionRate || 0.054;

  // 3) Actual monthly distribution (sum of systematic withdrawals monthly)
  const actualMonthlyDistribution = household.actualMonthlyDistribution || 0;

  // 4) Guardrail multipliers
  const upperFactor = options.upperFactor || firm.guardrailsUpperFactor || 0.8;
  const lowerFactor = options.lowerFactor || firm.guardrailsLowerFactor || 1.2;

  // 5) Compute guardrail portfolio values
  const upperPortValue = currentPortfolioValue * (1 / upperFactor);
  const lowerPortValue = currentPortfolioValue * (1 / lowerFactor);

  // 6) Current scenario:
  //    - If we have an actual monthly distribution, use it for monthly income
  //    - Then figure out the "real" distribution rate from that actual monthly income
  let currentMonthlyIncome = (currentPortfolioValue * baseDistributionRate) / 12;
  let currentDistributionRate = baseDistributionRate;

  if (actualMonthlyDistribution > 0) {
    currentMonthlyIncome = actualMonthlyDistribution;
    // Derive the distribution rate from actual monthly distribution
    if (currentPortfolioValue > 0) {
      currentDistributionRate = (actualMonthlyDistribution * 12) / currentPortfolioValue;
    } else {
      currentDistributionRate = 0; // avoid division by zero
    }
  }

  const currentAnnualIncome = currentMonthlyIncome * 12;

  // 7) Upper scenario
  const upperAnnualIncome = upperPortValue * baseDistributionRate;
  const upperMonthly = upperAnnualIncome / 12;

  // 8) Lower scenario
  const lowerAnnualIncome = lowerPortValue * baseDistributionRate;
  const lowerMonthly = lowerAnnualIncome / 12;

  // 9) Return the final data structure, including distributionRates for each scenario
  return {
    current: {
      portfolioValue: currentPortfolioValue,
      annualIncome: currentAnnualIncome,
      monthlyIncome: currentMonthlyIncome,
      distributionRate: currentDistributionRate,
    },
    upper: {
      portfolioValue: upperPortValue,
      annualIncome: upperAnnualIncome,
      monthlyIncome: upperMonthly,
      distributionRate: baseDistributionRate, // typically same "base" rate
    },
    lower: {
      portfolioValue: lowerPortValue,
      annualIncome: lowerAnnualIncome,
      monthlyIncome: lowerMonthly,
      distributionRate: baseDistributionRate, // typically same "base" rate
    },
  };
}

module.exports = {
  validateGuardrailsInputs,
  calculateGuardrails,
};
