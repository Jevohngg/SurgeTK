// services/valueAdds/distributionTableService.js

/**
 * Calculate the four columns (Current, Available, Upper, Lower).
 *
 * Logic:
 *   - Current:
 *       - Uses household.totalAccountValue as-is.
 *       - If household.actualMonthlyDistribution > 0, that becomes the monthlyIncome,
 *         and we derive the distributionRate from it. Otherwise 0.
 *
 *   - Available:
 *       - Same portfolio as Current, but forced to use 'availableRate' (e.g. 5.4%).
 *
 *   - Upper:
 *       - First scales the AVAILABLE monthlyIncome by (1 / upperFactor),
 *         then back-solves for a new portfolio at 'upperRate'.
 *
 *   - Lower:
 *       - First scales the AVAILABLE monthlyIncome by (1 / lowerFactor),
 *         then back-solves for a new portfolio at 'lowerRate'.
 *
 * @param {Object} household - Must have .totalAccountValue & .actualMonthlyDistribution
 * @param {Object} options   - e.g. {
 *   availableRate: 0.054,
 *   upperRate:     0.06,
 *   lowerRate:     0.048,
 *   upperFactor:   0.8,
 *   lowerFactor:   1.2
 * }
 *
 * @returns {Object} {
 *   current:   { portfolioValue, distributionRate, monthlyIncome },
 *   available: { portfolioValue, distributionRate, monthlyIncome },
 *   upper:     { portfolioValue, distributionRate, monthlyIncome },
 *   lower:     { portfolioValue, distributionRate, monthlyIncome }
 * }
 */
function calculateDistributionTable(household, options = {}) {
  if (!household) {
    throw new Error('Household is required');
  }

  // 1) Basic fields
  const totalPortfolio = household.totalAccountValue || 0;
  const actualMonthly = household.actualMonthlyDistribution || 0;

  // 2) Default rates
  const availableRate = (options.availableRate != null) ? options.availableRate : 0.054;
  const upperRate     = (options.upperRate     != null) ? options.upperRate     : availableRate;
  const lowerRate     = (options.lowerRate     != null) ? options.lowerRate     : availableRate;

  // 3) Default factors
  const upperFactor   = (options.upperFactor != null) ? options.upperFactor : 0.8;
  const lowerFactor   = (options.lowerFactor != null) ? options.lowerFactor : 1.2;

  // ───────────────────────────────────────────────────────────
  // CURRENT
  // ───────────────────────────────────────────────────────────
  let currentMonthlyIncome = 0;
  let currentDistributionRate = 0;

  // If user is actually taking distributions => reflect that
  if (actualMonthly > 0) {
    currentMonthlyIncome = actualMonthly;
    if (totalPortfolio > 0) {
      currentDistributionRate = (currentMonthlyIncome * 12) / totalPortfolio; 
    } else {
      currentDistributionRate = 0;
    }
  } else {
    // If not taking distributions, we show 0 monthly, 0% rate
    currentMonthlyIncome = 0;
    currentDistributionRate = 0;
  }

  // ───────────────────────────────────────────────────────────
  // AVAILABLE => uses same totalPortfolio, forced availableRate
  // ───────────────────────────────────────────────────────────
  const availableDistributionRate = availableRate;
  const availableMonthlyIncome = (totalPortfolio * availableDistributionRate) / 12;

  // ───────────────────────────────────────────────────────────
  // UPPER
  //   - Step 1: Scale the AVAILABLE monthly income by (1 / upperFactor),
  //             so if factor=0.8 => we get 1.25x the available monthly.
  //   - Step 2: Solve for new portfolioValue using upperRate.
  // ───────────────────────────────────────────────────────────
  const scaledUpperMonthlyIncome = (upperFactor !== 0)
    ? availableMonthlyIncome * (1 / upperFactor)
    : availableMonthlyIncome;

  const upperDistributionRate = upperRate;
  let upperPortfolioValue = 0;
  if (upperDistributionRate > 0) {
    upperPortfolioValue = (scaledUpperMonthlyIncome * 12) / upperDistributionRate;
  }
  const upperMonthlyIncome = scaledUpperMonthlyIncome;

  // ───────────────────────────────────────────────────────────
  // LOWER
  //   - Step 1: Scale the AVAILABLE monthly income by (1 / lowerFactor),
  //             so if factor=1.2 => we get ~0.83x the available monthly.
  //   - Step 2: Solve for new portfolioValue using lowerRate.
  // ───────────────────────────────────────────────────────────
  const scaledLowerMonthlyIncome = (lowerFactor !== 0)
    ? availableMonthlyIncome * (1 / lowerFactor)
    : availableMonthlyIncome;

  const lowerDistributionRate = lowerRate;
  let lowerPortfolioValue = 0;
  if (lowerDistributionRate > 0) {
    lowerPortfolioValue = (scaledLowerMonthlyIncome * 12) / lowerDistributionRate;
  }
  const lowerMonthlyIncome = scaledLowerMonthlyIncome;

  // ───────────────────────────────────────────────────────────
  // Return an object for each column
  // ───────────────────────────────────────────────────────────
  return {
    current: {
      portfolioValue:  totalPortfolio,
      distributionRate: currentDistributionRate,
      monthlyIncome:    currentMonthlyIncome,
    },
    available: {
      portfolioValue:   totalPortfolio,
      distributionRate: availableDistributionRate,
      monthlyIncome:    availableMonthlyIncome,
    },
    upper: {
      portfolioValue:   upperPortfolioValue,
      distributionRate: upperDistributionRate,
      monthlyIncome:    upperMonthlyIncome,
    },
    lower: {
      portfolioValue:   lowerPortfolioValue,
      distributionRate: lowerDistributionRate,
      monthlyIncome:    lowerMonthlyIncome,
    },
  };
}

module.exports = { calculateDistributionTable };
