// services/valueAdd/rmd.js
const { categorizeAccountType, determineDisplayType } = require('./classifyAccounts');

const UNIFORM_TABLE = {
  // Minimal slice; extend as needed with full IRS Uniform Lifetime Table
  70: 27.4, 71: 26.5, 72: 25.6, 73: 24.7, 74: 23.8, 75: 22.9, 76: 22.0,
  77: 21.2, 78: 20.3, 79: 19.5, 80: 18.7, 81: 17.9, 82: 17.1, 83: 16.3,
  84: 15.5, 85: 14.8, 86: 14.1, 87: 13.4, 88: 12.7, 89: 12.0, 90: 11.4,
  91: 10.8, 92: 10.2, 93:  9.6, 94:  9.1, 95:  8.6, 96:  8.1, 97:  7.6,
  98:  7.1, 99:  6.7, 100:  6.3, 101:  5.9, 102: 5.5, 103: 5.2, 104: 4.9,
  105: 4.6, 106: 4.3, 107: 4.1, 108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4,
  112: 3.3, 113: 3.1, 114: 3.0, 115: 2.9
};

function isRoth(acc) {
  const t = determineDisplayType(acc).toLowerCase();
  return t.includes('roth');
}
function isTraditionalOrQualified(acc) {
  const t = determineDisplayType(acc).toLowerCase();
  return t.includes('ira') || t.includes('401') || t.includes('403') || t.includes('tsp');
}

function computeRMDRows({ accounts=[], ownerAgesByAccount={}, yearEndValueFallback=true }) {
  const rows = [];

  for (const a of accounts) {
    // Exclude Roth unless inherited
    if (isRoth(a) && !a.inheritedAccountDetails) continue;
    // Only include qualified accounts
    if (!isRoth(a) && !isTraditionalOrQualified(a)) continue;

    const value = (typeof a.valueAsOf12_31 === 'number') ? a.valueAsOf12_31 : (yearEndValueFallback ? (a.accountValue || 0) : 0);
    const age = ownerAgesByAccount[a._id] ?? null;
    const factor = (age && UNIFORM_TABLE[age]) ? UNIFORM_TABLE[age] : null;
    const rmd = (factor && value) ? value / factor : 0;

    rows.push({
      label: `${a.accountType || a.accountTypeRaw || 'Account'} | ${a.accountNumber || ''} | ${a._ownerLabel || ''}`,
      totalValue: value,
      factor,
      rmd,
      remarks: a.inheritedAccountDetails ? 'Inherited – review rules' : 'Automatic withdrawals set up',
      notes: '',
      processed: ''
    });
  }
  return rows;
}

module.exports = { computeRMDRows };
