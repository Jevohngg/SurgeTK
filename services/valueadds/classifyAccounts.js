// services/valueAdd/classifyAccounts.js
function determineDisplayType(acc) {
    // choose the cleanest label available
    const raw = (acc.accountTypeRaw || acc.accountType || 'Other') + '';
    return raw.trim();
  }
  
  function categorizeAccountType(acc) {
    const finalType = determineDisplayType(acc).toLowerCase();
  
    const cashKeywords = ['checking','savings','money market','cd','cash'];
    const investKeywords = [
      'ira','roth','401(k)','403(b)','tsp','brokerage','sep ira','simple ira','annuity','joint','joint account','joint tenants'
    ];
  
    for (const ck of cashKeywords) if (finalType.includes(ck)) return 'CASH_EQUIVALENT';
    for (const ik of investKeywords) if (finalType.includes(ik)) return 'INVESTABLE';
    return 'OTHER';
  }
  
  module.exports = { determineDisplayType, categorizeAccountType };
  