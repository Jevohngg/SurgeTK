// services/valueAdd/renderMeetingWorksheet.js
const { fmtCurrency } = require('./formatters');

function esc(s) { return (s == null) ? '' : String(s); }

function mmYYYYshort(dIso) {
  const d = new Date(dIso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(-2)}`;
}
// ---- Birthday helpers (add/replace this block) ----
const BIRTHDAY_WINDOW_DAYS_DEFAULT = 7;

function isLeapYear(y) {
  return (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
}

// Fallback: compute age from a DOB Date (UTC parts to avoid TZ drift)
function ageFromDobDate(dobDate) {
    if (!dobDate || isNaN(dobDate)) return null;
    const now = new Date();
    let age = now.getUTCFullYear() - dobDate.getUTCFullYear();
    const m = now.getUTCMonth() - dobDate.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < dobDate.getUTCDate())) age--;
    return age;
  }
  

/** Local date compare: within ±windowDays of refDate */
function isBirthdayWithinWindow(dobIso, refDate = new Date(), windowDays = BIRTHDAY_WINDOW_DAYS_DEFAULT) {
  if (!dobIso) return false;
  const dob = new Date(dobIso);
  if (isNaN(dob)) return false;

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const refLocal = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());

  const month = dob.getMonth();
  const day   = dob.getDate();
  const adjDay = (y) => (month === 1 && day === 29 && !isLeapYear(y)) ? 28 : day;

  const y   = refLocal.getFullYear();
  const prev = new Date(y - 1, month, adjDay(y - 1));
  const curr = new Date(y,     month, adjDay(y));
  const next = new Date(y + 1, month, adjDay(y + 1));

  const minAbsDays = Math.min(
    Math.abs((prev - refLocal) / MS_PER_DAY),
    Math.abs((curr - refLocal) / MS_PER_DAY),
    Math.abs((next - refLocal) / MS_PER_DAY),
  );
  return minAbsDays <= Number(windowDays || BIRTHDAY_WINDOW_DAYS_DEFAULT);
}

/** Robust DOB finder. Looks shallow + one level deep, plus split fields. */
function getClientDobDate(c) {
  if (!c || typeof c !== 'object') return null;

  const KNOWN_KEYS = [
    'dob', 'birthDate', 'dateOfBirth', 'birthday', 'DOB', 'BirthDate', 'DateOfBirth'
  ];

  const tryParse = (val) => {
    if (!val) return null;

    // Split fields support: {birthMonth: 1-12, birthDay: 1-31, birthYear: 4-digit}
    if (typeof val === 'object' && ('birthMonth' in val || 'birthDay' in val || 'birthYear' in val)) {
      const m = Number(val.birthMonth);
      const d = Number(val.birthDay);
      const y = Number(val.birthYear);
      if (y >= 1900 && y <= 3000 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        const dt = new Date(y, m - 1, d);
        return isNaN(dt) ? null : dt;
      }
    }

    if (val instanceof Date && !isNaN(val)) return val;

    if (typeof val === 'number') {
      const dt = new Date(val);
      return isNaN(dt) ? null : dt;
    }

    if (typeof val === 'string') {
      // Avoid parsing strings that don’t contain a 4-digit year (e.g. "Jan 10")
      if (!/\d{4}/.test(val)) return null;
      const dt = new Date(val);
      return isNaN(dt) ? null : dt;
    }

    return null;
  };

  // 1) direct known keys
  for (const k of KNOWN_KEYS) {
    if (k in c) {
      const dt = tryParse(c[k]);
      if (dt) return dt;
    }
  }

  // 2) split fields at top level
  if ('birthMonth' in c || 'birthDay' in c || 'birthYear' in c) {
    const dt = tryParse({ birthMonth: c.birthMonth, birthDay: c.birthDay, birthYear: c.birthYear });
    if (dt) return dt;
  }

  // 3) one level deep (profile, client, details, etc.)
  for (const key of Object.keys(c)) {
    const val = c[key];
    if (!val || typeof val !== 'object') continue;

    // known nested keys
    for (const k of KNOWN_KEYS) {
      if (k in val) {
        const dt = tryParse(val[k]);
        if (dt) return dt;
      }
    }
    // split fields nested
    if ('birthMonth' in val || 'birthDay' in val || 'birthYear' in val) {
      const dt = tryParse({ birthMonth: val.birthMonth, birthDay: val.birthDay, birthYear: val.birthYear });
      if (dt) return dt;
    }
  }

  // 4) heuristic: any key that *looks* like DOB-ish with a 4-digit year value
  for (const [k, v] of Object.entries(c)) {
    const lk = k.toLowerCase();
    if (lk.includes('dob') || (lk.includes('birth') && (lk.includes('date') || lk.includes('day') || lk.includes('dob')))) {
      const dt = tryParse(v);
      if (dt) return dt;
    }
  }

  return null;
}

/** Month + Year (no day). Use LOCAL parts to match rendering expectations. */
function dobMonthYear(c) {
  const d = getClientDobDate(c);
  if (!d) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}


// ---- Household data helpers ----
function toNumber(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }
  
  function getAccountType(acc = {}) {
    return (acc.accountType || acc.subType || acc.subtype || acc.type || acc.category || '')
      .toString()
      .trim()
      .toLowerCase();
  }
  
  
// ---- replace getAccountValue with this version ----
function getAccountValue(acc = {}) {
    // 1) direct top-level candidates (strings like "$1,234.56" are OK)
    const directKeys = [
      'currentBalance','balance','availableBalance',
      'marketValue','currentValue','value','total','totalValue','cash','amount',
      // common vendor-specific flat fields
      'balanceAmount','ledgerBalance','presentBalance','postedBalance'
    ];
    for (const k of directKeys) {
      if (acc[k] != null && acc[k] !== '') {
        const v = parseMoney(acc[k]);
        if (v !== 0) return v;
      }
    }
  
    // 2) common nested vendor shapes
    // Plaid
    if (acc.plaid?.balances) {
      const v = parseMoney(acc.plaid.balances.current ?? acc.plaid.balances.available);
      if (v) return v;
    }
    // Yodlee-ish
    if (acc.yodlee?.balance) {
      const y = acc.yodlee.balance;
      const v = parseMoney(y.amount ?? y.current ?? y.available ?? y.balance);
      if (v) return v;
    }
    // MX-ish
    if (acc.mx) {
      const v = parseMoney(acc.mx.balance ?? acc.mx.available_balance ?? acc.mx.current_balance);
      if (v) return v;
    }
    // Generic `balances` object: balances.current / balances.available
    if (acc.balances && typeof acc.balances === 'object') {
      const v = parseMoney(acc.balances.current ?? acc.balances.available ?? acc.balances.ledger);
      if (v) return v;
    }
    // Generic `totals` object (already tried some in your code)
    if (acc.totals && typeof acc.totals === 'object') {
      // try a few common names first
      const named = parseMoney(acc.totals.current ?? acc.totals.cash ?? acc.totals.value);
      if (named) return named;
      // then scan everything
      for (const [k, raw] of Object.entries(acc.totals)) {
        const v = parseMoney(raw);
        if (v) return v;
      }
    }
  
    // 3) deep heuristic scan (depth-limited) for any key that *looks* like money
    const MONEY_KEY = /(balance|value|amount|cash|current|available|ledger|present|posted)/i;
    const seen = new Set();
    const stack = [acc];
    let depth = 0;
    while (stack.length && depth < 4) {
      const node = stack.pop();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      for (const [k, v] of Object.entries(node)) {
        if (v && typeof v === 'object') stack.push(v);
        if (MONEY_KEY.test(k) && (typeof v === 'number' || typeof v === 'string')) {
          const n = parseMoney(v);
          if (n) return n;
        }
      }
      depth++;
    }
  
    // 4) last resort: if we saw only zeros, return 0
    return 0;
  }
  
  
  function sumAccountsByType(accounts = [], typeName /* 'checking' | 'saving' */) {
    const want = String(typeName || '').toLowerCase();
    return accounts.reduce((sum, a) => {
      const t = getAccountType(a);
      const isChecking = t.includes('checking');
      const isSavings  = t.includes('saving'); // matches "saving" + "savings"
      const matches =
        (want === 'checking' && isChecking) ||
        (want === 'saving'   && isSavings);
      return matches ? sum + getAccountValue(a) : sum;
    }, 0);
  }
  
  
  
// Put this near the other helpers in renderMeetingWorksheet.js

function parseMoney(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      // handles "$1,234.56", "1,234.56", etc.
      const n = Number(v.replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }
  
  function buildDebtLines(liabilities = []) {
    return (liabilities || [])
      .filter(Boolean)
      // ⬇️ exclude anything with type including "Primary Residence"
      .filter(l => {
        const typeStr = (l.liabilityType || l.type || l.name || l.description || '')
          .toString()
          .toLowerCase();
        return !typeStr.includes('primary residence');
      })
      .map(l => {
        // label = just the type (fallbacks), no last-4 or creditor
        const label =
          l.liabilityType || l.type || l.name || l.description || l.creditorName || 'Liability';
  
        // amount = outstandingBalance first, then common fallbacks
        const val = parseMoney(
          (l.outstandingBalance ?? l.balance ?? l.currentBalance ?? l.principal ?? l.amount ?? 0)
        );
  
        return `${esc(label)}: ${fmtCurrency(val)}`;
      })
      .join('<br>');
  }
  
  
  
  

  


function dateOnlyUTC(dIso) {
    if (!dIso) return '';
    const d = new Date(dIso);
    return d.toLocaleDateString(undefined, { timeZone: 'UTC' });
  }
  

function meetingLine(header) {
  if (!header?.meetingDateTime && !header?.meetingType) return '';
  const dt = header.meetingDateTime ? new Date(header.meetingDateTime) : null;
  const datePart = dt ? dt.toLocaleDateString() : '';
  const timePart = dt ? dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const typePart = header.meetingType || 'Meeting';
  return `<div class="h113" style="margin-bottom:7px;">${esc(typePart)}: ${esc(datePart)} &nbsp;&nbsp;|&nbsp;&nbsp; ${esc(timePart)}</div>`;
}

function renderMeetingNotesSizingScript () {
    return `
    <script>
    (function () {
      function resetMeetingNotesHeight() {
        var container = document.getElementById('hwsheetContainer');
        var cell = document.getElementById('meetingNotesCell');
        if (!container || !cell) return;
  
        var getHeight = container.offsetHeight;
        var targetHeight = 842;        // your A4-ish target height in px
        var difference = 0;
        var meetingNotesHeight = 400;  // starting point
  
        if (getHeight === targetHeight) return;
  
        if (getHeight > targetHeight) {
          difference = getHeight - targetHeight;
          meetingNotesHeight = meetingNotesHeight - (difference + 3);
        } else {
          difference = targetHeight - getHeight;
          meetingNotesHeight = meetingNotesHeight + difference;
        }
  
        // safety floor so it never collapses too small
        if (meetingNotesHeight < 120) meetingNotesHeight = 120;
  
        cell.style.height = meetingNotesHeight + 'px';
      }
  
      // expose for manual re-runs if you need
      window.resetMeetingNotesHeight = resetMeetingNotesHeight;
  
      // run after DOM is ready and once layout has settled
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
          requestAnimationFrame(resetMeetingNotesHeight);
        });
      } else {
        requestAnimationFrame(resetMeetingNotesHeight);
      }
  
      // optional: re-run on resize
      window.addEventListener('resize', function () {
        requestAnimationFrame(resetMeetingNotesHeight);
      });
    })();
    </script>`;
  }
  

function renderClientsRow(clients = [], refDateIso, windowDays = BIRTHDAY_WINDOW_DAYS_DEFAULT) {
    const a = clients[0] || {};
    const b = clients[1] || {};
  
    // Normalize DOBs once (used for both age + birthday)
    const aDob = getClientDobDate(a);
    const bDob = getClientDobDate(b);
  
    // Compute age: prefer provided age; fall back to DOB-derived age
    const aComputedAge = (a.age != null) ? a.age : ageFromDobDate(aDob);
    const bComputedAge = (b.age != null) ? b.age : ageFromDobDate(bDob);
  
    const aAge = (aComputedAge != null) ? ` &nbsp;&nbsp;|&nbsp;&nbsp; ${aComputedAge}` : '';
    const bAge = (bComputedAge != null) ? ` &nbsp;&nbsp;|&nbsp;&nbsp; ${bComputedAge}` : '';
  
    // Month + full year (no day) — from normalized DOB
    const dobMonthYear = (c) => {
      const d = getClientDobDate(c);
      if (!d) return '';
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    };
  
    const refDate = refDateIso ? new Date(refDateIso) : new Date();
    const win = Number(windowDays || BIRTHDAY_WINDOW_DAYS_DEFAULT);
  

    const aBirthdaySoon = aDob ? isBirthdayWithinWindow(aDob.toISOString(), refDate, win) : false;
    const bBirthdaySoon = bDob ? isBirthdayWithinWindow(bDob.toISOString(), refDate, win) : false;
  
    const aBirthdayHtml = aBirthdaySoon
      ? `<div class="cellTextRight"><span class="material-symbols-outlined">cake</span> ${esc(dobMonthYear(a))}</div>`
      : '';
  
    const bBirthdayHtml = bBirthdaySoon
      ? `<div class="cellTextRight"><span class="material-symbols-outlined">cake</span> ${esc(dobMonthYear(b))}</div>`
      : '';
  
    return `
      <div class="valueAddTable small">
        <table><tbody>
          <tr>
            <td class="tableCellWidth20p boldCell700">Clients:</td>
  
            <td class="tableCellWidth40p relative boldCell700 boyBackground15P">
              ${esc(a.firstName ? `${a.firstName} ${a.lastName ? a.lastName : ''}` : '')}${aAge}
              ${aBirthdayHtml}
            </td>
  
            <td class="relative boldCell700 girlBackground15P">
              ${esc(b.firstName ? `${b.firstName} ${b.lastName || ''}` : '')}${bAge}
              ${bBirthdayHtml}
            </td>
          </tr>
          <tr>
            <td class="tableCellWidth20p boldCell700">Job &nbsp;&nbsp;/&nbsp;&nbsp; Employer</td>
            <td>${esc(a.occupation || '')}  &nbsp;&nbsp;/&nbsp;&nbsp;  ${esc(a.employer || '')}</td>
            <td>${esc(b.occupation || '')}  &nbsp;&nbsp;/&nbsp;&nbsp;  ${esc(b.employer || '')}</td>
          </tr>
          <tr>
            <td class="tableCellWidth20p boldCell700">Retirement Date</td>
            <td>${a.retirementDate ? dateOnlyUTC(a.retirementDate) : '- -'}</td>
            <td>${b.retirementDate ? dateOnlyUTC(b.retirementDate) : '- -'}</td>
          </tr>
        </tbody></table>
      </div>`;
  }
  
  
    

  function renderTopGrid(page1, settings = {}, accounts = [], liabilities = []) {
    // Outside Investments from settings (fallback to legacy page1.outsideInv if present)
    const outside = Array.isArray(settings.outsideInvestments)
      ? settings.outsideInvestments
      : (page1?.outsideInv || []);
    const outsideLines = outside
      .map(o => `${esc(o.label)}: ${fmtCurrency(o.amount)}`)
      .join('<br>') || '';
  
    // ✅ Auto tax year (no user input required)
    // Use prior tax year since the section is "AGI / Taxable Income <year>"
    const taxYearLabel = String(new Date().getFullYear() - 1);
  
    // ✅ Manual tax fields ONLY (no fallbacks). null means "not set" → show "- -"
    const agiVal        = (typeof settings?.agi === 'number') ? settings.agi : null;
    const taxableVal    = (typeof settings?.taxableIncome === 'number') ? settings.taxableIncome : null;
    const taxesVal      = (typeof settings?.totalTaxes === 'number') ? settings.totalTaxes : null;
    const bracketPctVal = (typeof settings?.taxBracketPct === 'number') ? settings.taxBracketPct : null;
  
    // Debt + Checking/Savings logic unchanged...
    const derivedDebtLines = buildDebtLines(liabilities);
    const fallbackDebtLines = (page1.debts || [])
      .map(d => `${esc(d.label)}: ${fmtCurrency(d.amount)}`)
      .join('<br>');
    const debtLines = derivedDebtLines || fallbackDebtLines || '';
  
    const checkingSum = accounts.length ? sumAccountsByType(accounts, 'checking') : null;
    const savingsSum  = accounts.length ? sumAccountsByType(accounts, 'saving')   : null;
    const checkingDisplay = (checkingSum != null) ? fmtCurrency(checkingSum)
                                                  : fmtCurrency(page1.cashFlow?.checking || 0);
    const savingsDisplay  = (savingsSum  != null) ? fmtCurrency(savingsSum)
                                                  : fmtCurrency(page1.cashFlow?.savings  || 0);
  
    let primaryCell = '- -';
    if (page1.primaryResidence || page1.mortgage) {
      const val  = page1.primaryResidence ? fmtCurrency(page1.primaryResidence.value) : '- -';
      const bal  = page1.mortgage ? fmtCurrency(page1.mortgage.balance || 0) : '- -';
      const rate = page1.mortgage && (page1.mortgage.rate || page1.mortgage.rate === 0) ? `${page1.mortgage.rate}%` : '';
      const pmt  = page1.mortgage ? fmtCurrency(page1.mortgage.monthlyPayment || 0) : '';
      primaryCell = `${val} ${page1.mortgage ? `(${bal} @${rate})` : ''}<br>${pmt}`;
    }
  
    return `
    <div class="valueAddTable small" style="margin-top:-1px;">
      <table><tbody>
  
        <tr>
          <td class="noBorderRight tableCellWidth20p boldCell700 blueBackground15P">
            <div class="h111" style="padding:5px;padding-left:0px;margin-bottom:0px">Financials</div>
          </td>
          <td class="noBorderLeft tableCellWidth20p blueBackground15P"></td>
          <td class="noBorderRight tableCellWidth20p boldCell700 greenBackground15P">
            <div class="h111" style="padding:5px;padding-left:0px;margin-bottom:0px">Cash Flow</div>
          </td>
          <td class="noBorderLeft tableCellWidth20p boldCell700 greenBackground15P"></td>
          <td class="tableCellWidth20p boldCell700 yellowBackground15P">
            <div class="h111" style="padding:5px;padding-left:0px;margin-bottom:0px">Agenda</div>
          </td>
        </tr>
  
        <tr>
          <td class="boldCell700 blueBackground15P">Net Worth / Invest Assets</td>
          <td class="blueBackground15P">${fmtCurrency(page1.netWorth)} / ${fmtCurrency(page1.investAssets)}</td>
  
          <td class="noBorderRight tableCellWidth20p greenBackground15P">
            <span class="boldCell700">Checking</span>: ${checkingDisplay}
          </td>
          <td class="tableCellWidth20p greenBackground15P"></td>
  
          <td class="tableCellWidth20p yellowBackground15P noBorderBottom"></td>
        </tr>
  
        <tr>
          <td class="boldCell700 blueBackground15P">Distributions Gross / Net</td>
          <td class="blueBackground15P">${fmtCurrency(page1.distributions?.gross || 0)} / ${fmtCurrency(page1.distributions?.net || 0)}</td>
  
          <td class="noBorderRight tableCellWidth20p greenBackground15P">
            <span class="boldCell700">Savings</span>: ${savingsDisplay}
          </td>
          <td class="tableCellWidth20p greenBackground15P"></td>
  
          <td class="tableCellWidth20p yellowBackground15P noBorderTopBottom"></td>
        </tr>
  
        <tr>
          <td class="boldCell700 blueBackground15P">AGI / Taxable Income ${esc(taxYearLabel)}</td>
          <td class="blueBackground15P">
            ${agiVal != null ? fmtCurrency(agiVal) : '- -'} / ${taxableVal != null ? fmtCurrency(taxableVal) : '- -'}
          </td>
  
          <td class="noBorderRight tableCellWidth20p greenBackground15P">
            <span class="boldCell700">Income</span>: ${fmtCurrency(page1.cashFlow.income)}
          </td>
          <td class="tableCellWidth20p greenBackground15P"></td>
  
          <td class="tableCellWidth20p yellowBackground15P noBorderTopBottom"></td>
        </tr>
  
        <tr>
          <td class="boldCell700 blueBackground15P">Total Taxes  / Tax Bracket</td>
          <td class="blueBackground15P">
            ${taxesVal != null ? fmtCurrency(taxesVal) : '- -'} / ${bracketPctVal != null ? esc(bracketPctVal) + '%' : '- -'}
          </td>
  
          <td class="noBorderRight tableCellWidth20p greenBackground15P">
            <span class="boldCell700">Spending</span>: ${fmtCurrency(page1.cashFlow.spending)}/month
          </td>
          <td class="tableCellWidth20p greenBackground15P"></td>
  
          <td class="tableCellWidth20p yellowBackground15P noBorderTopBottom"></td>
        </tr>
  
        <tr>
          <td class="boldCell700 blueBackground15P" style="vertical-align: top;padding-top: 4px;">Primary Residence</td>
          <td class="blueBackground15P" style="vertical-align: top;padding-top: 4px;padding-bottom:4px">${primaryCell}</td>
  
          <td rowspan="2" class="noBorderRight tableCellWidth20p greenBackground15P" style="vertical-align: top;padding-top: 4px;">
            <span class="boldCell700">Debt</span>:
            <div style="margin-top:-13px;margin-left:25px;">${debtLines || '- -'}</div>
          </td>
          <td rowspan="2" class="tableCellWidth20p greenBackground15P"></td>
  
          <td class="tableCellWidth20p yellowBackground15P noBorderTopBottom"></td>
        </tr>
  
        <tr>
          <td class="boldCell700 blueBackground15P" style="vertical-align: top;padding-top: 4px;">Outside Investments</td>
          <td class="blueBackground15P" style="vertical-align: top;padding-top: 4px;padding-bottom:4px">${outsideLines || '- -'}</td>
          <td class="tableCellWidth20p yellowBackground15P noBorderTop"></td>
        </tr>
  
      </tbody></table>
    </div>`;
  }
  
  

function renderNotesAndActions(settings, clients=[], header = {}) {
  const names = clients.filter(c=>c && c.firstName).map(c=>c.firstName).join(' & ') || 'Clients';
  const firmName = header.firmName || '---';
  return `
  <div class="valueAddTable small" style="margin-top:-1px">
    <table><tbody>
      <tr>
        <td id="meetingNotesCell" class="tableCellWidth20p boldCell700" style="height:400px;vertical-align:top;"><div class="h111" style="padding-top:10px;margin-left:5px;">Meeting Notes</div></td>
          
          <div>${esc(settings?.notes || '')}</div>
        </td>
      </tr>
    </tbody></table>
  </div>

  <div class="valueAddTable small" style="margin-top:-1px">
    <table><tbody>
      <tr>
        <td class="boldCell700" style="color:#fff;background-color:#263d87">
          <div class="h19" style="margin-bottom:0px;padding:5px;padding-left:3px;">${esc(firmName)} Action Items</div>
        </td>
        <td class="tableCellWidth40p boldCell700">
          <div class="h19" style="margin-bottom:0px;padding:5px;padding-left:3px;">${esc(names)} Homework</div>
        </td>
      </tr>
    </tbody></table>
  </div>

  <div class="valueAddTable small" style="margin-top:-1px">
    <table><tbody>
      <tr>
        <td class="tableCellWidth12p boldCell700">Department</td>
        <td class="boldCell700">Task</td>
        <td rowspan="6" class="tableCellWidth40p">${esc(settings?.homework || '')}</td>
      </tr>
      <tr><td class="tableCellWidth12p boldCell700"></td><td class="boldCell700">${esc(settings?.actionItems || '')}</td></tr>
      <tr><td class="tableCellWidth12p boldCell700"></td><td class="boldCell700"></td></tr>
      <tr><td class="tableCellWidth12p boldCell700"></td><td class="boldCell700"></td></tr>
      <tr><td class="tableCellWidth12p boldCell700"></td><td class="boldCell700"></td></tr>
      <tr><td class="tableCellWidth12p boldCell700"></td><td class="boldCell700"></td></tr>
    </tbody></table>
    <div class="filler30"></div>
  </div>
  `;
}

function renderWithdrawals(months, rows) {
  const headCells = months.map(m => `<th>${esc(mmYYYYshort(m.key))}</th>`).join('');
  const header = `<thead><tr><th>ACCOUNT</th>${headCells}<th>Total</th></tr></thead>`;

  const bodyRows = rows.map(r => {
    // Net = gross - tax (per month)
    const netCellsHtml = r.gross
      .map((gv, i) => {
        const tv = r.tax?.[i] || 0;
        const net = (gv || 0) - tv;
        return `<td class="curencyCell">${fmtCurrency(net)}</td>`;
      })
      .join('');
    const taxCellsHtml = (r.tax || [])
      .map(v => `<td class="curencyCell">${fmtCurrency(v)}</td>`)
      .join('');
    const totalNet = (r.totalGross || 0) - (r.totalTax || 0);

    return `
      <tr>
        <td class="boldCell700">${esc(r.label)}</td>
        ${netCellsHtml}
        <td class="curencyCell boldCell700">${fmtCurrency(totalNet)}</td>
      </tr>
      <tr>
        <td class="boldCell700">Taxes</td>
        ${taxCellsHtml}
        <td class="curencyCell boldCell700">${fmtCurrency(r.totalTax || 0)}</td>
      </tr>
    `;
  }).join('');

  const grandTotalNet = rows.reduce((s, r) => s + ((r.totalGross || 0) - (r.totalTax || 0)), 0);

  // Totals per month (sum of NETS)
  const monthTotals = months.map((_, i) => {
    const sumNet = rows.reduce((s, r) => {
      const g = r.gross?.[i] || 0;
      const t = r.tax?.[i] || 0;
      return s + (g - t);
    }, 0);
    return `<th class="curencyCell">${fmtCurrency(sumNet)}</th>`;
  }).join('');
  const grandTotal = rows.reduce((s, r) => s + ((r.totalGross || 0) - (r.totalTax || 0)), 0);

  const footer = `<thead><tr><th class="curencyCell">Total</th>${monthTotals}<th class="curencyCell">${fmtCurrency(grandTotalNet)}</th></tr></thead>`;

  return `
  <div class="h113" style="margin-bottom:7px;">Withdrawals</div>
  <div class="valueAddTable small">
    <table class="coloredTable">
      ${header}
      <tbody>${bodyRows}</tbody>
      ${footer}
    </table>
  </div>`;
}

function renderDeposits(months, rows) {
  const headCells = months.map(m => `<th>${esc(mmYYYYshort(m.key))}</th>`).join('');
  const header = `<thead><tr><th>ACCOUNT</th>${headCells}<th>Total</th></tr></thead>`;

  const bodyRows = rows.map(r => {
    const grossCells = r.gross.map(v => `<td class="curencyCell">${fmtCurrency(v)}</td>`).join('');
    return `
      <tr>
        <td class="boldCell700">${esc(r.label)}</td>
        ${grossCells}
        <td class="curencyCell boldCell700">${fmtCurrency(r.totalGross)}</td>
      </tr>
    `;
  }).join('');

  const monthTotals = months.map((_, i) => {
    const sumGross = rows.reduce((s, r) => s + (r.gross[i] || 0), 0);
    return `<th class="curencyCell">${fmtCurrency(sumGross)}</th>`;
  }).join('');
  const grandTotal = rows.reduce((s, r) => s + (r.totalGross || 0), 0);
  const footer = `<thead><tr><th class="curencyCell">Total</th>${monthTotals}<th class="curencyCell">${fmtCurrency(grandTotal)}</th></tr></thead>`;

  return `
  <div class="filler30"></div>
  <div class="h113" style="margin-bottom:7px;">Deposits</div>
  <div class="valueAddTable small">
    <table class="coloredTable">
      ${header}
      <tbody>${bodyRows}</tbody>
      ${footer}
    </table>
  </div>`;
}

function renderRMD(rows) {
  const header = `
    <thead>
      <tr>
        <th>ACCOUNT</th>
        <th>Total Value</th>
        <th>RMD</th>
        <th>Remarks</th>
        <th>Notes</th>
        <th>Processed</th>
      </tr>
    </thead>`;

  const body = rows.map(r => `
    <tr>
      <td class="boldCell700">${esc(r.label)}</td>
      <td class="curencyCell">${fmtCurrency(r.totalValue)}</td>
      <td class="curencyCell">${fmtCurrency(r.rmd)}</td>
      <td>${esc(r.remarks || '')}</td>
      <td class="curencyCell">${esc(r.notes || '- -')}</td>
      <td class="curencyCell">${esc(r.processed || '- -')}</td>
    </tr>
  `).join('');

  const totals = rows.reduce((a,b)=>({ value:a.value+(b.totalValue||0), rmd:a.rmd+(b.rmd||0)}),{value:0,rmd:0});
  const footer = `
    <thead>
      <tr>
        <th class="curencyCell">Total</th>
        <th class="curencyCell">${fmtCurrency(totals.value)}</th>
        <th class="curencyCell">${fmtCurrency(totals.rmd)}</th>
      </tr>
    </thead>`;

  return `
  <div class="filler30"></div>
  <div class="h113" style="margin-bottom:7px;">Required Minimum Distribution (RMD)</div>
  <div class="valueAddTable small">
    <table class="coloredTable">
      ${header}
      <tbody>${body}</tbody>
      ${footer}
    </table>
  </div>

  <div class="filler30"></div>
  <div class="h113" style="margin-bottom:7px;">Client Questions</div>
  <div contenteditable="true" style="border-radius:3px;border: 1px solid #ccc; padding: 10px; min-height: 100px;width:100%"></div>
  `;
}

/**
 * Return two strings so they can be injected into:
 *   {{HOMEWORK_PAGE1}} and {{HOMEWORK_PAGE2}}
 * NOTE: page2 string intentionally has NO outer `.page2` wrapper,
 * because your HTML template already wraps it in <div class="page2">…</div>.
 */
function renderMeetingWorksheetPages(data) {
    const refDateIso = undefined;
    const birthdayWindowDays = (data?.settings && typeof data.settings.birthdayWindowDays === 'number')
      ? data.settings.birthdayWindowDays
      : BIRTHDAY_WINDOW_DAYS_DEFAULT;
  
    // NEW: pull from either `data.accounts` / `data.liabilities` or nested under `data.household`
    const householdAccounts   = data.accounts || data.household?.accounts || [];
    const householdLiabilities = data.liabilities || data.household?.liabilities || [];
  
    const page1 = [
      meetingLine(data.header),
      renderClientsRow(data.clients, refDateIso, birthdayWindowDays),
      // ⬇️ pass accounts + liabilities here
      renderTopGrid(
        data.page1,
        data.settings,                // <= pass the whole HomeworkSettings object
        householdAccounts,
        householdLiabilities
      ),
      renderNotesAndActions(data.settings, data.clients, data.header),
      renderMeetingNotesSizingScript()
    ].join('\n');
  
    const page2 = [
      renderWithdrawals(data.page2.months, data.page2.withdrawals),
      renderDeposits(data.page2.months, data.page2.deposits),
      renderRMD(data.page2.rmdRows)
    ].join('\n');
  
    return { page1, page2 };
  }
  
  

module.exports = { renderMeetingWorksheetPages };
