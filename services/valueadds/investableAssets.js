// services/valueAdd/investableAssets.js
const { categorizeAccountType } = require('./classifyAccounts');
const { sum } = require('./netWorth');

function computeInvestable(accounts=[]) {
  return sum(accounts.filter(a => categorizeAccountType(a) === 'INVESTABLE')
                     .map(a => a.accountValue || 0));
}
module.exports = { computeInvestable };
