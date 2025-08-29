// services/valueAdd/flows/withdrawalsDeposits.js
const { monthKeyUTC } = require('../dateUtils');
const { normalizeRate } = require('../formatters');

function blank12() {
  return Array.from({length:12}, ()=>0);
}

// --- Cash-account exclusion helper ---
const CASH_KEYWORDS = ['checking', 'savings', 'saving', 'money market', 'cd', 'cash'];

function isCashAccount(acc = {}) {
  // Look across common type/name fields (normalize → lower-case)
  const type = (acc.accountType || acc.accountTypeRaw || acc.subType || acc.subtype || acc.type || acc.category || '')
    .toString().trim().toLowerCase();
  const name = (acc.accountName || acc.name || acc.displayName || '')
    .toString().trim().toLowerCase();

  // If either the type string or the account’s display/name looks cash-like
  return CASH_KEYWORDS.some(k => type.includes(k) || name.includes(k));
}



function monthsIndexMap(months) {
    // Map 'YYYY-MM' → index 0..11 (supports either Date objects OR {key} objects)
    const map = {};
    months.forEach((m, i) => {
    const key = (m && typeof m === 'object' && m.key)
        ? monthKeyUTC(new Date(m.key))
        : monthKeyUTC(m);
    map[key] = i;
    });
    return map;  
}

function frequencyToStep(freq) {
  const f = (freq||'').toLowerCase();
  if (f==='monthly') return 1;
  if (f==='quarterly') return 3;
  if (f==='semi-annual' || f==='semiannual') return 6;
  if (f==='annually' || f==='annual') return 12;
  return null;
}

/**
 * Build per-account 12-month arrays for gross and taxes for withdrawals, and gross for deposits.
 ** - systematic streams align to the anchor month (current) and repeat BACKWARD over the trailing window
 * - one-time transactions land in their month
 * - tax withholding: use account-level federal/state %, treat missing as 0%
 */
 function buildGrids({ accounts=[], oneTimeTxns=[], months, anchor }) {
  const keyToIndex = monthsIndexMap(months);
  const anchorIdx = keyToIndex[monthKeyUTC(anchor)] ?? (months.length - 1);

  const withdrawals = [];
  const deposits    = [];

  // ✅ Exclude cash-like accounts from both Withdrawals & Deposits tables
  const investAccounts = (accounts || []).filter(a => !isCashAccount(a));

  investAccounts.forEach(acct => {
    const label = `${acct.accountType || acct.accountTypeRaw || 'Account'} | ${acct.accountNumber || ''} | ${acct._ownerLabel || ''}`;
    const grossW = blank12(); const taxW = blank12();
    const grossD = blank12();

    const fed = normalizeRate(acct.federalTaxWithholding);
    const st  = normalizeRate(acct.stateTaxWithholding);
    const combined = fed + st;

    // Systematic withdrawals (align to anchor month, repeat backward over trailing window)
    (acct.systematicWithdrawals || []).forEach(sw => {
      const step = frequencyToStep(sw.frequency);
      if (!step) return;
      const amt = Number(sw.amount) || 0;

      for (let idx = 0; idx < months.length; idx++) {
        // fill only months up to (and including) the anchor column,
        // and only on indices that line up with the step when counting back from the anchor
        if (idx <= anchorIdx && ((anchorIdx - idx) % step) === 0) {
          grossW[idx] += amt;
          taxW[idx]   += amt * combined;
        }
      }


    });

    // One-time txns (both deposits/withdrawals)
    (oneTimeTxns || []).filter(t => String(t.account) === String(acct._id)).forEach(t => {
      const key = monthKeyUTC(t.occurredOn || anchor);
      const idx = keyToIndex[key];
      if (idx === undefined) return;
      const amt = Number(t.amount) || 0;
      if (t.kind === 'withdrawal') {
        grossW[idx] += amt;
        taxW[idx] += amt * combined;
      } else if (t.kind === 'deposit') {
        grossD[idx] += amt;
      }
    });

    withdrawals.push({
      label, acct, gross: grossW, tax: taxW,
      totalGross: grossW.reduce((a,b)=>a+b,0),
      totalTax:   taxW.reduce((a,b)=>a+b,0)
    });
    deposits.push({
      label, acct, gross: grossD,
      totalGross: grossD.reduce((a,b)=>a+b,0)
    });
  });

  return { withdrawals, deposits };
}

module.exports = { buildGrids };
