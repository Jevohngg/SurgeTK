// services/valueAdd/tax/standardDeductions.js
// Minimal table; extend annually as needed
const STD = {
    2024: {
      single: 14600, mfj: 29200, mfs: 14600, hoh: 21900, qw: 29200
    },
    2025: {
      single: 15000, mfj: 30000, mfs: 15000, hoh: 22500, qw: 30000
    }
  };
  function getStandardDeduction(year, filingStatus='single') {
    const table = STD[year] || {};
    return table[filingStatus?.toLowerCase()] || 0;
  }
  module.exports = { getStandardDeduction };
  