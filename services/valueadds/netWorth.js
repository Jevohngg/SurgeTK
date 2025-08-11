// services/valueAdd/netWorth.js
function sum(v=[]) { return v.reduce((a,b)=>a+(Number(b)||0),0); }

function computeNetWorth({ accounts=[], assets=[], liabilities=[] }) {
  const accountSum = sum(accounts.map(a => a.accountValue || 0));
  const assetSum   = sum(assets.map(a => a.assetValue || 0));
  const debtSum    = sum(liabilities.map(l => l.outstandingBalance || 0));
  return { accountSum, assetSum, debtSum, netWorth: accountSum + assetSum - debtSum };
}

module.exports = { computeNetWorth, sum };
