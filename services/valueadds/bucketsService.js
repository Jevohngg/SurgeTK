// services/valueAdds/bucketsService.js

const { validateGuardrailsInputs, calculateGuardrails } = require('./guardrailsService');

/**
 * Validate that necessary data exists on the household to compute Buckets.
 * (Reuses the Guardrails validation, which checks household.totalAccountValue, etc.)
 */
function validateBucketsInputs(household) {
  return validateGuardrailsInputs(household);
}

/**
 * Parse a field value into a number. 
 * - If `val` is undefined, null, or '', we treat it as 0.
 * - If `val` is non-numeric, return null to indicate invalid.
 * @param {*} val
 * @returns {number|null} A finite number >= 0 if valid, or null if invalid
 */
function parseAllocationField(val) {
  if (val === undefined || val === null || val === '') {
    return 0; // blank => interpret as 0
  }
  const num = parseFloat(val);
  // If not a valid number or negative, treat as invalid:
  if (Number.isNaN(num) || num < 0) {
    return null;
  }
  return num;
}

/**
 * Returns true if the sum of (cash + income + annuities + growth) is ~100%.
 * We allow blank fields as 0. Only fails if any field is non-numeric (NaN) or sum != 100.
 * @param {Object} acc - The account object with .cash, .income, etc.
 * @returns {boolean} Whether sum is approx 100
 */
function allocationsSumTo100(acc) {
  const cashVal = parseAllocationField(acc.cash);
  const incVal = parseAllocationField(acc.income);
  const annVal = parseAllocationField(acc.annuities);
  const groVal = parseAllocationField(acc.growth);

  // If any field is invalid => skip
  if (cashVal === null || incVal === null || annVal === null || groVal === null) {
    return false;
  }

  const sum = cashVal + incVal + annVal + groVal;

  // Epsilon if you want to allow 100.0001 as 100, etc.
  const EPSILON = 1e-6;
  return Math.abs(sum - 100) < EPSILON;
}

/**
 * Calculate the Buckets data object, reusing Guardrails under the hood.
 *
 * Logic:
 *   - If sum(cash, income, annuities, growth) != ~100%, we skip that account
 *     and note it in `missingAllocations`.
 *   - If sum=100, we allocate the accountValue among the fields accordingly.
 */
function calculateBuckets(household, options = {}) {
  // 1) Reuse guardrails logic (provides portfolioValue & distribution rates)
  const guardrailsData = calculateGuardrails(household, options);

  // 2) Basic distribution rate used in "current" scenario
  const baseRate = options.distributionRate ||
  (household.firm?.bucketsDistributionRate) || 0.054;


  // 3) Current portfolio value (from guardrailsData)
  const totalPortfolio = guardrailsData.current.portfolioValue || 0;

  let sumCash = 0;
  let sumIncome = 0;
  let sumAnnuities = 0;
  let sumGrowth = 0;

  let missingAllocations = [];

  if (household.accounts && Array.isArray(household.accounts)) {
    household.accounts.forEach((acc) => {
      // If the sum of fields != 100 => skip
      if (!allocationsSumTo100(acc)) {
        missingAllocations.push(acc);
        return;
      }

      // Otherwise, parse each field as # or 0
      const cashVal = parseAllocationField(acc.cash) || 0;
      const incVal = parseAllocationField(acc.income) || 0;
      const annVal = parseAllocationField(acc.annuities) || 0;
      const groVal = parseAllocationField(acc.growth) || 0;

      const acctValue = acc.accountValue || 0;

      // Convert each field to a fraction of 100
      sumCash += (acctValue * cashVal) / 100;
      sumIncome += (acctValue * incVal) / 100;
      sumAnnuities += (acctValue * annVal) / 100;
      sumGrowth += (acctValue * groVal) / 100;
    });
  }

  // Determine largest bucket for bar height scaling
  const largestBucketValue = Math.max(sumCash, sumIncome, sumAnnuities, sumGrowth);
  const maxBarHeightPx = 220;

  function getBarHeight(bucketValue) {
    if (largestBucketValue === 0) return 0;
    return (bucketValue / largestBucketValue) * maxBarHeightPx;
  }

  const cashHeight = getBarHeight(sumCash);
  const incomeHeight = getBarHeight(sumIncome);
  const annuitiesHeight = getBarHeight(sumAnnuities);
  const growthHeight = getBarHeight(sumGrowth);

  return {
    // Guardrails-based fields
    portfolioValue: totalPortfolio,
    distributionRate: guardrailsData.current.distributionRate,
    monthlyIncome: guardrailsData.current.monthlyIncome,
    annualIncome: guardrailsData.current.annualIncome,

    upperPortfolioValue: guardrailsData.upper.portfolioValue,
    upperMonthlyIncome: guardrailsData.upper.monthlyIncome,
    upperDistributionRate: guardrailsData.upper.distributionRate,

    lowerPortfolioValue: guardrailsData.lower.portfolioValue,
    lowerMonthlyIncome: guardrailsData.lower.monthlyIncome,
    lowerDistributionRate: guardrailsData.lower.distributionRate,
    annuitiesPercent: totalPortfolio > 0 ? (sumAnnuities / totalPortfolio) * 100 : 0,


    // Bucket amounts & bar heights
    cashAmount: sumCash,
    incomeAmount: sumIncome,
    annuitiesAmount: sumAnnuities,
    growthAmount: sumGrowth,

    cashHeight,
    incomeHeight,
    annuitiesHeight,
    growthHeight,

    // If an account didn't sum to ~100 => missing
    missingAllocationsCount: missingAllocations.length,
    missingAllocations,
  };
}

module.exports = {
  validateBucketsInputs,
  calculateBuckets,
};
