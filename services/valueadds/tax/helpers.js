// services/valueAdd/tax/helpers.js
const { getStandardDeduction } = require('./standardDeductions');

function priorYear(now=new Date()) {
  return now.getUTCFullYear() - 1;
}
function estimateTaxes(taxableIncome, marginalBracketPct) {
  const rate = (Number(marginalBracketPct) || 0) / 100;
  return Math.max(0, (Number(taxableIncome) || 0) * rate);
}
function computeTaxableIncome({ agi, year, filingStatus }) {
  const std = getStandardDeduction(year, filingStatus);
  return Math.max(0, (Number(agi)||0) - std);
}
module.exports = { priorYear, estimateTaxes, computeTaxableIncome };
