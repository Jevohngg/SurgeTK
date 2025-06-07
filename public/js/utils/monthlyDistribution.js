// /public/js/utils/monthlyDistribution.js
/**
 * Convert an array of {amount, frequency} withdrawals into
 * a monthly %-of-account-value distribution rate.
 *
 * @param   {Array<{amount:number,frequency:string}>} withdrawals
 * @param   {number} accountValue
 * @returns {number} percent (e.g. 2.5 === “2.5 %”)
 */
export function monthlyRateFromWithdrawals(withdrawals = [], accountValue = 0) {
    if (!Array.isArray(withdrawals) || withdrawals.length === 0 || !accountValue) return 0;
  
    const monthlyTotal = withdrawals.reduce((sum, w) => {
      const { amount = 0, frequency = '' } = w;
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
  
    return (monthlyTotal / accountValue) * 100;
  }

/**
* Annualised distribution rate = monthly rate × 12.
* Keeps all validation in the original helper.
*/
export function annualRateFromWithdrawals(withdrawals = [], accountValue = 0) {
      return monthlyRateFromWithdrawals(withdrawals, accountValue) * 12;
    }
  