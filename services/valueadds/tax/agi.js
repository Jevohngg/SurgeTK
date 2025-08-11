// services/valueAdd/tax/agi.js
// AGI (prior year) = (sum monthlyIncome across clients) * 12 + taxable withdrawals (prior year)
const { sum } = require('../netWorth');

function isPreTax(account) {
  const s = (account.taxStatus || '').toLowerCase();
  // treat "tax-deferred" / "tax-exempt?" as pre-tax for withdrawals being taxable
  return s.includes('tax-deferred') || s.includes('non-qualified') || s.includes('taxable');
}

function estimatePriorYearTaxableWithdrawals({ accounts=[], oneTimesByYear={}, year }) {
  // oneTimesByYear: map 'YYYY' -> [{account, kind, amount, occurredOn}]
  const fromOneTimes = sum((oneTimesByYear[year] || [])
    .filter(t => t.kind === 'withdrawal' && isPreTax(t.account))
    .map(t => t.amount || 0));

  // Heuristic: if systematic withdrawals exist, assume they were active the whole prior year
  const fromSystematic = sum(accounts
    .filter(isPreTax)
    .flatMap(a => (a.systematicWithdrawals || []).map(sw => {
      const amt = Number(sw.amount)||0;
      const freq = (sw.frequency||'').toLowerCase();
      const mult = (freq==='monthly')?12:(freq==='quarterly')?4:(freq==='semi-annual'||freq==='semiannual')?2:(freq==='annually'||freq==='annual')?1:0;
      return amt * mult;
    })));
  return fromOneTimes + fromSystematic;
}

function computeAGI({ clients=[], accounts=[], oneTimesByYear={}, year }) {
  const monthlyIncome = sum(clients.map(c => c.monthlyIncome || 0));
  const taxableW = estimatePriorYearTaxableWithdrawals({ accounts, oneTimesByYear, year });
  return monthlyIncome * 12 + taxableW;
}

module.exports = { computeAGI, estimatePriorYearTaxableWithdrawals, isPreTax };
