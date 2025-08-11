// services/valueAdd/dateUtils.js
function startOfMonthUTC(d = new Date()) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }
  
  function addMonthsUTC(date, n) {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const d = new Date(Date.UTC(y, m + n, 1));
    return d;
  }
  
  function monthKeyUTC(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;
  }
  
  function monthLabelShort(date) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(-2)}`;
  }
  
  function buildNext12Months(anchor=new Date()) {
    const start = startOfMonthUTC(anchor);
    return Array.from({ length: 12 }, (_, i) => addMonthsUTC(start, i));
  }

  // NEW: trailing 12 months (oldest → current)
  function buildTrailingMonths(anchor = new Date(), count = 12) {
    const end = startOfMonthUTC(anchor); // current (anchor) month
    // produce: [anchor-(count-1), ..., anchor-1, anchor]
    return Array.from({ length: count }, (_, i) => addMonthsUTC(end, i - (count - 1)));
  }
  
  function calcAge(dob, asOf=new Date()) {
    if (!dob) return null;
    const d = new Date(dob);
    let age = asOf.getUTCFullYear() - d.getUTCFullYear();
    const m = asOf.getUTCMonth() - d.getUTCMonth();
    if (m < 0 || (m === 0 && asOf.getUTCDate() < d.getUTCDate())) age--;
    return age;
  }
  
  module.exports = {
    startOfMonthUTC, addMonthsUTC, monthKeyUTC, monthLabelShort,
    buildNext12Months, buildTrailingMonths, calcAge  
  };
  