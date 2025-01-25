// services/valueAdds/distributionTableService.js

/**
 * Calculate the four columns (Current, Available, Upper, Lower)
 * all using the same portfolio value but different distribution rates.
 *
 * @param {Object} household - Must have .totalAccountValue and .actualMonthlyDistribution
 * @param {Object} options   - e.g. { availableRate, upperRate, lowerRate }
 *    - availableRate (default 0.054)
 *    - upperRate     (default 0.06)
 *    - lowerRate     (default 0.048)
 *
 * @returns {Object} {
 *   current: { portfolioValue, distributionRate, monthlyIncome },
 *   available: { ... },
 *   upper:     { ... },
 *   lower:     { ... }
 * }
 */
function calculateDistributionTable(household, options = {}) {
    if (!household) {
      throw new Error('Household is required');
    }
  
    const totalPortfolio = household.totalAccountValue || 0;
    const actualMonthly = household.actualMonthlyDistribution || 0;
  
    // Default rates
    const availableRate = options.availableRate ?? 0.054; // 5.4%
    const upperRate = options.upperRate ?? 0.06;          // 6.0%
    const lowerRate = options.lowerRate ?? 0.048;         // 4.8%
  
    // 1) CURRENT
    let currentMonthlyIncome = 0;
    let currentDistributionRate = 0;
    if (actualMonthly > 0) {
      currentMonthlyIncome = actualMonthly;
      if (totalPortfolio > 0) {
        currentDistributionRate = (currentMonthlyIncome * 12) / totalPortfolio; 
      }
    } else {
      // If user is not taking distributions, show 0% and $0 monthly
      currentMonthlyIncome = 0;
      currentDistributionRate = 0;
    }
  
    // 2) AVAILABLE
    const availableDistributionRate = availableRate;
    const availableMonthlyIncome = (totalPortfolio * availableDistributionRate) / 12;
  
    // 3) UPPER
    const upperDistributionRate = upperRate;
    const upperMonthlyIncome = (totalPortfolio * upperDistributionRate) / 12;
  
    // 4) LOWER
    const lowerDistributionRate = lowerRate;
    const lowerMonthlyIncome = (totalPortfolio * lowerDistributionRate) / 12;
  
    // Return the data for each column
    return {
      current: {
        portfolioValue: totalPortfolio,
        distributionRate: currentDistributionRate,
        monthlyIncome: currentMonthlyIncome,
      },
      available: {
        portfolioValue: totalPortfolio,
        distributionRate: availableDistributionRate,
        monthlyIncome: availableMonthlyIncome,
      },
      upper: {
        portfolioValue: totalPortfolio,
        distributionRate: upperDistributionRate,
        monthlyIncome: upperMonthlyIncome,
      },
      lower: {
        portfolioValue: totalPortfolio,
        distributionRate: lowerDistributionRate,
        monthlyIncome: lowerMonthlyIncome,
      },
    };
  }
  
  module.exports = { calculateDistributionTable };
  