/**
 * Given a Household (with accounts), return:
 *  - totalAssets
 *  - monthlyDistribution
 *
 * We convert systematicWithdrawAmount to a monthly figure depending on frequency:
 *   - Monthly => x
 *   - Quarterly => x / 3
 *   - Annually => x / 12
 */
function getHouseholdTotals(household) {
    let totalAssets = 0;
    let monthlyDistribution = 0;
  
    if (!household || !Array.isArray(household.accounts)) {
      return { totalAssets, monthlyDistribution };
    }
  
    household.accounts.forEach((account) => {
      // Sum all account values
      totalAssets += account.accountValue || 0;
  
      // Convert systematicWithdrawAmount to monthly
      if (account.systematicWithdrawAmount && account.systematicWithdrawAmount > 0) {
        let monthlyAmount = 0;
        switch (account.systematicWithdrawFrequency) {
          case 'Quarterly':
            monthlyAmount = account.systematicWithdrawAmount / 3;
            break;
          case 'Annually':
            monthlyAmount = account.systematicWithdrawAmount / 12;
            break;
          // default or 'Monthly'
          default:
            monthlyAmount = account.systematicWithdrawAmount;
        }
        monthlyDistribution += monthlyAmount;
      }
    });
  
    return { totalAssets, monthlyDistribution };
  }
  
  module.exports = {
    getHouseholdTotals,
  };
  