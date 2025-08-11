// services/valueAdd/formatters.js
function fmtCurrency(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '$0';
    const rounded = Math.round(n); // display whole dollars
    return rounded.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  }
  
  function last4(str='') {
    return (str && str.length <= 4) ? str : (str ? str.slice(-4) : '');
  }
  
  function ownerLabel({ accountOwner=[], accountOwnerName }) {
    // If a trust/explicit name is present, use it
    if (accountOwnerName && accountOwnerName.trim()) return accountOwnerName;
  
    // Else, build "First & First" if two; else first client
    const names = (accountOwner || []).map(c => `${c.firstName || ''}`.trim()).filter(Boolean);
    if (names.length === 2) return `${names[0]} & ${names[1]}`;
    if (names.length >= 1) return names[0];
    return '—';
  }
  
  function normalizeRate(val) {
    // treat missing/null as 0%, >1 and <=100 as percent; >0 && <=1 as decimal
    if (val === null || val === undefined || isNaN(val)) return 0;
    if (val > 1 && val <= 100) return val / 100;
    if (val > 1) return 1;
    if (val < 0) return 0;
    return val;
  }
  
  module.exports = { fmtCurrency, last4, ownerLabel, normalizeRate };
  