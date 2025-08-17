// controllers/accountImportController.js

const mongoose = require('mongoose');
const xlsx     = require('xlsx');
const axios    = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path'); 
const Account      = require('../models/Account');
const Client       = require('../models/Client');
const Household    = require('../models/Household');

const ImportReport = require('../models/ImportReport');
const { uploadFile } = require('../utils/s3');
const { logChanges, snapshot } = require('../utils/accountHistory');
const Liability              = require('../models/Liability');
const Asset                  = require('../models/Asset');
const liabAssetUtils         = require('../utils/liabilityAssetImport');
const { LIAB_FIELDS, ASSET_FIELDS,
        rowToLiabObj, rowToAssetObj,
        applyLiabilityRow, applyAssetRow } = liabAssetUtils;
const { recalculateMonthlyNetWorth } = require('../utils/netWorth');
const { logActivity } = require('../utils/activityLogger'); // ← NEW

function toStr(val) {
  return val == null ? '' : String(val);
}

// Accepts "24", "24%", " 24 % ", 24, 0.24
// Rule: If string has "%", parse the number before "%"
// If number/string <= 1 (and no "%"), treat as ratio and *convert to percent* (0.24 -> 24)
// Return null for invalid or out-of-range (>100 or <0)
function parsePercentCell(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    const hasPct = s.includes('%');
    const cleaned = s.replace(/[%\s]/g, '');
    const num = Number(cleaned);
    if (!Number.isFinite(num)) return null;
    const val = hasPct ? num : (num <= 1 && num >= 0 ? num * 100 : num);
    if (val < 0 || val > 100) return null;
    return val;
  }
  if (typeof raw === 'number') {
    const val = raw <= 1 && raw >= 0 ? raw * 100 : raw;
    if (!Number.isFinite(val) || val < 0 || val > 100) return null;
    return val;
  }
  return null;
}

// Accepts currency-like strings "$12,345.67", "12345.67", "(1,234.00)" (negatives)
// Returns number or null
function parseMoneyOrNumberCell(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    // Handle parentheses negatives, remove $ and commas
    const neg = /^\(.+\)$/.test(s);
    const cleaned = s.replace(/[,$]/g, '').replace(/^\(|\)$/g, '').replace(/^\$/,'');
    const num = Number(cleaned);
    if (!Number.isFinite(num)) return null;
    return neg ? -num : num;
  }
  return null;
}


// Normalize "primary/contingent" with common aliases
function normalizeBeneficiaryType(val) {
  if (!val && val !== 0) return null;
  const s = String(val).trim().toLowerCase();

  // Allow common aliases / sloppy inputs
  if (['p', 'prim', 'primary', '1', 'pri', 'prime'].includes(s)) return 'primary';
  if (['c', 'cont', 'contingent', 'secondary', '2', 'sec'].includes(s)) return 'contingent';

  // Strip non-letters and retry (handles "Primary ", " PRIMARY", etc.)
  const letters = s.replace(/[^a-z]/g, '');
  if (['p','prim','primary','pri','prime'].includes(letters)) return 'primary';
  if (['c','cont','contingent','secondary','sec'].includes(letters)) return 'contingent';

  return null;
}



// "Last, First" or "First Last" -> [firstName,lastName]
function splitNameSmart(full) {
  if (!full) return ['', ''];
  const s = String(full).trim();
  if (!s) return ['', ''];
  if (s.includes(',')) {
    const [last, first] = s.split(',').map(x => x.trim());
    return [first || '', last || ''];
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return [parts[0], ''];
  const first = parts.shift();
  const last = parts.join(' ');
  return [first, last];
}




/**
 * Normalizes a user-supplied frequency to the recognized enum values:
 * ['', 'Monthly', 'Quarterly', 'Semi-annual', 'Annually']
 */
function normalizeSystematicWithdrawFrequency(input) {
  if (!input) return '';
  // const val = input.trim().toLowerCase();
  const val = toStr(input).trim().toLowerCase(); 

  // Check for keywords or partial words:
  if (val.includes('month')) return 'Monthly';
  if (val.includes('quarter')) return 'Quarterly';
  // This covers "bi-annual", "biannual", "semi-annual", "semi-yearly",
  // "bi-yearly", "biyearly", etc.
  if (
    val.includes('semi') ||
    val.includes('biannual') ||
    val.includes('bi-annual') ||
    val.includes('biyear') ||
    val.includes('bi-year') ||
    val.includes('semi-year') ||
    val.includes('semi year') ||
    val.includes('bi year')
  ) {
    return 'Semi-annual';
  }
  if (val.includes('annual') || val.includes('year')) return 'Annually';

  return '';
}

/**
 * Normalizes taxStatus to one of:
 * ['Taxable', 'Tax-Free', 'Tax-Deferred', 'Tax-Exempt', 'Non-Qualified']
 */
function normalizeTaxStatus(input) {
  if (!input) return '';
  // const val = input.trim().toLowerCase();
  const val = toStr(input).trim().toLowerCase();

  if (val.includes('taxable')) return 'Taxable';
  if (val.includes('tax free') || val.includes('tax-free')) return 'Tax-Free';
  if (val.includes('deferred')) return 'Tax-Deferred';
  if (val.includes('exempt')) return 'Tax-Exempt';
  if (val.includes('non-qualified') || val.includes('non qualified')) return 'Non-Qualified';

  // Fallback if not matched
  return '';
}

/**
 * Normalizes a user-supplied accountType string into one of the recognized enums.
 * Falls back to 'Other' if no match is found.
 */
function normalizeAccountType(input) {
  if (!input || typeof input !== 'string') return 'Other';
  // const val = input.trim().toLowerCase();
  const val = toStr(input).trim().toLowerCase();

  // Individual / Joint variants
  if (val === 'individual') return 'Individual';
  if (val.includes('joint') && val.includes('tenants')) return 'Joint Tenants';
  if (val.includes('joint')) return 'Joint';
  if (val.includes('tenants in common')) return 'Tenants in Common';
  if (val.includes('community property')) return 'Community Property';

  // Transfer On Death
  if (val === 'tod' || val.includes('transfer on death')) return 'Transfer on Death';

  // Custodial
  if (val.includes('custodial')) return 'Custodial';
  if (val.includes('utma')) return 'UTMA';
  if (val.includes('ugma')) return 'UGMA';

  // Brokerage / Cash
  if (val.includes('brokerage')) return 'Brokerage';
  if (val.includes('checking')) return 'Checking Account';
  if (val.includes('saving')) return 'Savings Account';
  if (val.includes('money market')) return 'Money Market Account';
  if (val.includes('certificate of deposit') || val.includes('cd')) return 'Certificate of Deposit (CD)';

  // Retirement Plans
  if (val.includes('401') && val.includes('solo')) return 'Solo 401(k)';
  if (val.includes('401')) return '401(k)';
  if (val.includes('403')) return '403(b)';
  if (val.includes('457')) return '457(b)';
  if (val.includes('ira') && val.includes('roth')) return 'Roth IRA';
  if (val.includes('inherited ira')) return 'Inherited IRA';
  if (val.includes('sep ira')) return 'SEP IRA';
  if (val.includes('simple ira')) return 'Simple IRA';
  if (val === 'ira') return 'IRA';
  if (val.includes('rollover ira')) return 'Rollover IRA';
  if (val.includes('beneficiary ira')) return 'Beneficiary IRA';
  if (val.includes('pension')) return 'Pension Plan';
  if (val.includes('profit sharing')) return 'Profit Sharing Plan';
  if (val.includes('keogh')) return 'Keogh Plan';

  // Education savings
  if (val.includes('529')) return '529 Plan';
  if (val.includes('coverdell') || val.includes('esa')) return 'Coverdell ESA';
  if (val.includes('health savings') || val.includes('hsa')) return 'Health Savings Account (HSA)';
  if (val.includes('flexible spending') || val.includes('fsa')) return 'Flexible Spending Account (FSA)';

  // Trusts & Estates
  if (val.includes('trust')) {
    if (val.includes('revocable')) return 'Revocable Trust';
    if (val.includes('irrevocable')) return 'Irrevocable Trust';
    if (val.includes('testamentary')) return 'Testamentary Trust';
    if (val.includes('charitable remainder')) return 'Charitable Remainder Trust';
    return 'Trust';
  }
  if (val.includes('estate')) return 'Estate';
  if (val.includes('conservatorship')) return 'Conservatorship';
  if (val.includes('guardianship')) return 'Guardianship';
  if (val.includes('charitable lead trust')) return 'Charitable Lead Trust';
  if (val.includes('donor-advised fund')) return 'Donor-Advised Fund';

  // Annuities
  if (val.includes('annuity')) {
    if (val.includes('variable')) return 'Variable Annuity';
    if (val.includes('fixed')) return 'Fixed Annuity';
    if (val.includes('deferred')) return 'Deferred Annuity';
    if (val.includes('immediate')) return 'Immediate Annuity';
    if (val.includes('equity-indexed')) return 'Equity-Indexed Annuity';
    if (val.includes('rila') || val.includes('registered index-linked')) return 'Registered Index-Linked Annuity (RILA)';
    return 'Annuity';
  }

  // Business/Entity
  if (val.includes('corporate')) return 'Corporate Account';
  if (val.includes('partnership')) return 'Partnership Account';
  if (val.includes('llc')) return 'LLC Account';
  if (val.includes('sole proprietorship')) return 'Sole Proprietorship';

  // Municipal / Foundation / Endowment
  if (val.includes('municipal')) return 'Municipal Account';
  if (val.includes('endowment')) return 'Endowment';
  if (val.includes('foundation')) return 'Foundation';

  // Health / Charitable
  if (val.includes('donor-advised fund')) return 'Donor-Advised Fund';
  if (val.includes('charitable lead trust')) return 'Charitable Lead Trust';

  // Fallback
  return 'Other';
}



function normalizeCustodian(input) {
  if (!input || !input.trim()) {
    // Return null or undefined when there's absolutely no actual input
    return null;
  }
  return input.trim(); // Or further normalization if needed
}

function extractAccountRowData(row, mapping) {
  function getValue(field) {
    const idx = mapping[field];
    if (idx === undefined || idx === null) return '';
    const cell = row[idx];
    return (cell === undefined || cell === null) ? '' : cell; // preserves 0
  }

  const rawFrequency = getValue('systematicWithdrawFrequency');
  const rawTaxStatus = getValue('taxStatus');

  // We'll read from "accountTypeRaw" in the UI. 
  // That way, if the user picks a column for "Account Type," 
  // it feeds into 'rawAccountType' here, which we can normalize.
  const rawAccountType = getValue('accountTypeRaw');
  const rawCustodian = getValue('custodianRaw');
  // NEW optional informational fields

  

  // Then we normalize as needed:
  const normalizedType = normalizeAccountType(rawAccountType);

  return {
    clientId: getValue('clientId'),
    accountNumber: getValue('accountNumber'),
    accountType: normalizedType,
    accountTypeRaw: rawAccountType,
    taxStatus: normalizeTaxStatus(rawTaxStatus),
    custodian: normalizeCustodian(rawCustodian),
    custodianRaw: getValue('custodianRaw'),
    accountValue: getValue('accountValue'),
    systematicWithdrawAmount: getValue('systematicWithdrawAmount'),
    systematicWithdrawFrequency: normalizeSystematicWithdrawFrequency(rawFrequency),
    federalTaxWithholding: getValue('federalTaxWithholding'),
    stateTaxWithholding: getValue('stateTaxWithholding'),
    externalAccountOwnerName: getValue('externalAccountOwnerName'),
    externalHouseholdId:      getValue('externalHouseholdId'),
  };
}

/**
 * Helper: parse spreadsheet from S3 or memory
 */
async function parseSpreadsheetFromUrl(fileUrl) {
  const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
  const data = response.data;
  const workbook = xlsx.read(data, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
  return sheetData;
}






// ─────────────────────────────────────────────────────────────
// JOINT DETECTION + OWNER ENFORCEMENT HELPERS
// ─────────────────────────────────────────────────────────────

const DEBUG_IMPORT = process.env.DEBUG_IMPORT_ACCOUNTS === 'true';
function debugImport(...args) {
  if (DEBUG_IMPORT) console.debug('[account-import]', ...args);
}

// Small Levenshtein for forgiving misspellings (e.g., "jiont", "joitn")
function levenshtein(a = '', b = '') {
  a = String(a); b = String(b);
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/**
 * Returns true if a string "looks like" it’s indicating joint ownership.
 * Covers:
 *  - “joint” (any case)
 *  - common typos within distance 1 (“jiont”, “joitn”, etc.)
 *  - securities abbreviations: JTWROS, JT WROS, JOINT TENANTS
 */
function looksLikeJoint(val) {
  if (val == null) return false;
  const s = String(val).toLowerCase();
  if (!s.trim()) return false;

  // Normalize to word tokens
  const collapsed = s.replace(/[^a-z0-9]+/g, ' ').trim();

  // Fast-path direct hits / common phrases
  if (/\bjoint\b/.test(collapsed)) return true;
  if (/\bjoint\s*tenants?\b/.test(collapsed)) return true;
  if (/\bjtwros\b/.test(collapsed)) return true;
  if (/\bjt\s*wros\b/.test(collapsed)) return true;

  // Fuzzy on tokens (distance ≤ 1 to "joint")
  for (const tok of collapsed.split(/\s+/)) {
    if (tok && levenshtein(tok, 'joint') <= 1) return true;
  }
  return false;
}

/**
 * Ensures an account ends up with BOTH household members as owners
 * when "joint" is indicated.
 *
 * - If `primaryClientDoc` is provided, we’ll use it as the anchor.
 * - Otherwise we try the current first owner on the account as anchor.
 * - We add “the other” member from the same household (if one exists).
 */
async function ensureJointOwners({ account, firmId, primaryClientDoc, reason }) {
  try {
    // Resolve a primary client
    let primary = primaryClientDoc || null;
    if (!primary && Array.isArray(account.accountOwner) && account.accountOwner.length > 0) {
      primary = await Client.findById(account.accountOwner[0]);
    }
    if (!primary) {
      debugImport('Joint:', reason, `→ No primary owner available for acct=${account.accountNumber}. Skipping.`);
      return;
    }
    if (!primary.household) {
      debugImport('Joint:', reason, `→ Client ${primary._id} has no household. Skipping.`);
      return;
    }

    // Fetch other members from the same household
    const members = await Client.find(
      { firmId, household: primary.household },
      '_id firstName lastName'
    ).lean();

    if (!members || members.length < 2) {
      debugImport('Joint:', reason, `→ Household ${primary.household} has <2 members. Skipping.`);
      return;
    }

    // Pick "the other" household member (first not equal to primary)
    const other = members.find(m => String(m._id) !== String(primary._id));
    if (!other) {
      debugImport('Joint:', reason, `→ Could not resolve "other" household member.`);
      return;
    }

    // Deduplicate owners (store as ObjectIds)
    const existing = (account.accountOwner || []).map(x => String(x));
    const nextSet = new Set(existing);
    nextSet.add(String(primary._id));
    nextSet.add(String(other._id));
    account.accountOwner = Array.from(nextSet).map(id => new mongoose.Types.ObjectId(id));

    // Ensure household linkage
    if (!account.household) account.household = primary.household;

    debugImport(
      'Joint owners applied:',
      { accountNumber: account.accountNumber, owners: account.accountOwner.map(String) }
    );

    // Note: we do NOT forcibly trim to exactly 2 to avoid destructive changes.
    // If you *must* enforce exactly two, you can prune here.
  } catch (e) {
    console.error('ensureJointOwners() failed for', account.accountNumber, e);
  }
}










/**
 * 1) Upload Account File
 */
exports.uploadAccountFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded.' });
    }
    const userId = req.session?.user?._id || 'anonymous';

    // 1) Upload to S3
    let s3Key;
    try {
      s3Key = await uploadFile(req.file.buffer, req.file.originalname, userId);
    } catch (err) {
      console.error('S3 upload error:', err);
      return res.status(500).json({ message: 'Failed to upload file to S3.' });
    }
    const s3Url = `https://${process.env.IMPORTS_S3_BUCKET_NAME}.s3.amazonaws.com/${s3Key}`;

    // 2) Parse headers from memory
    let rawData;
    try {
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      rawData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
    } catch (err) {
      return res.status(400).json({ message: 'Failed to parse spreadsheet file.' });
    }
    if (!rawData || rawData.length === 0) {
      return res.status(400).json({ message: 'The uploaded file is empty.' });
    }
    const headers = rawData[0];
    if (!headers || headers.length === 0) {
      return res.status(400).json({ message: 'No headers found in the file.' });
    }

    return res.json({
      message: 'Account file uploaded successfully.',
      headers,
      tempFile: s3Url,
      s3Key

    });
  } catch (err) {
    console.error('Error uploading account file:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

const Beneficiary = require('../models/Beneficiary');
// EXAMPLE name-split helper: "John Doe" => ["John","Doe"] 
// (Adjust or remove if your data already has separate first/last fields.)
/**
 * Splits a fullName string into [firstName, lastName].
 *
 * - If the string contains a comma (e.g. "Doe, John"),
 *   then we treat everything before the comma as lastName,
 *   and everything after as firstName.
 * - Otherwise, we fall back to a simpler approach: split by whitespace,
 *   the last chunk is lastName, and everything else is firstName.
 */
function splitName(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return ['', ''];
  }

  const trimmed = fullName.trim();
  
  // 1) If there's a comma, parse as "LastName, FirstName"
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',');
    // Safely handle if there's more than one comma (rare)
    const lastNamePart = parts[0].trim();
    const firstNamePart = parts.slice(1).join(',').trim();
    return [firstNamePart, lastNamePart];
  }

  // 2) Otherwise, split by spaces. The last token is lastName, the rest is firstName.
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 1) {
    // Only one token => treat it all as firstName
    return [tokens[0], ''];
  }

  const lastName = tokens.pop();
  const firstName = tokens.join(' ');
  return [firstName, lastName];
}


/**
 * 2) Process Account Import
 * Reads rows, upserts Accounts linked to correct firm + client,
 * and adds the Account _id to the Household (if it exists).
 */
exports.processAccountImport = async (req, res) => {
  try {
    // 1) Extract necessary data from req.body
    const { mapping, tempFile, importType, s3Key, asOfDate } = req.body;
    const batchId = uuidv4();
    const parsedAsOf = asOfDate ? new Date(asOfDate) : new Date();

    if (Number.isNaN(parsedAsOf.getTime())) {
      return res.status(400).json({ message: 'Invalid asOfDate' });
    }

    if (!tempFile || !mapping) {
      return res.status(400).json({ message: 'Missing file or mapping data.' });
    }

    // Build a consistent activity context that carries batchId + metadata
    const baseCtx = {
      ...(req.activityCtx || {}),
      meta: {
        ...((req.activityCtx && req.activityCtx.meta) || {}),
        path: req.originalUrl,
        batchId,
        extra: {
          importKind: importType || 'Account Data Import',
          fileKey: s3Key || null,
          asOfDate: parsedAsOf?.toISOString() || null
        }
      }
    };

    // (Optional) breadcrumb: mark "started" — skip if you don't want this noise
    try {
      await logActivity(baseCtx, {
        entity: { type: 'ImportReport', id: null, display: 'Account import • start' },
        action: 'import',
        before: null,
        after:  { status: 'started' },
        diff:   null
      });
    } catch {}

    // Helper to sum multiple columns for a single field
    function sumAllocationColumns(row, colIndexes) {
      let total = 0;
      if (!colIndexes || !Array.isArray(colIndexes)) return total;
      colIndexes.forEach(index => {
        const val = parseFloat(row[index] || '0');
        if (!isNaN(val)) {
          total += val;
        }
      });
      return total;
    }

    /**
 * Mutates an Account doc with data from one CSV row.
 * Handles scalar fields + allocation maths.
 */
    function updateAccountFromRow(account, rowObj, row, mapping) {
      // Treat undefined, null, or whitespace-only as "no value"
      const hasVal = (v) => v !== undefined && v !== null && toStr(v).trim() !== '';
    
      // ── Account type (only if a real value is provided)
      if (hasVal(rowObj.accountTypeRaw)) {
        const rawType = toStr(rowObj.accountTypeRaw).trim();
        account.accountTypeRaw = rawType;
        account.accountType    = normalizeAccountType(rawType);
      }
    
      // ── Informational fields (do not clear if blank)
      if (hasVal(rowObj.externalAccountOwnerName)) {
        account.externalAccountOwnerName = toStr(rowObj.externalAccountOwnerName).trim();
      }
      if (hasVal(rowObj.externalHouseholdId)) {
        account.externalHouseholdId = toStr(rowObj.externalHouseholdId).trim();
      }
    
      // ── Scalar strings (do not clear if blank)
      if (hasVal(rowObj.taxStatus)) {
        account.taxStatus = toStr(rowObj.taxStatus).trim();
      }
      if (hasVal(rowObj.custodian)) {
        account.custodian = toStr(rowObj.custodian).trim();
      }
      if (hasVal(rowObj.custodianRaw)) {
        account.custodianRaw = toStr(rowObj.custodianRaw).trim();
      }
    
      // ── Numeric values (only if provided)
      if (hasVal(rowObj.accountValue)) {
        const v = parseFloat(toStr(rowObj.accountValue));
        if (!Number.isNaN(v)) account.accountValue = v;
      }
    
      // ── Withholding percentages (only if mapped and parseable)
      if (mapping.federalTaxWithholding != null) {
        const rawFed = row[mapping.federalTaxWithholding];
        const fedPct = parsePercentCell(rawFed);
        if (fedPct !== null) account.federalTaxWithholding = fedPct; // 0–100 allowed
      }
      if (mapping.stateTaxWithholding != null) {
        const rawState = row[mapping.stateTaxWithholding];
        const statePct = parsePercentCell(rawState);
        if (statePct !== null) account.stateTaxWithholding = statePct; // 0–100 allowed
      }
    
      // ── 12/31 Value (only if mapped and parseable)
      if (mapping.valueAsOf12_31 != null) {
        const raw1231 = row[mapping.valueAsOf12_31];
        const val1231 = parseMoneyOrNumberCell(raw1231);
        if (val1231 !== null) account.valueAsOf12_31 = val1231;
      }
    
      // ── Allocation summation
      //     Only assign if at least one mapped cell in that group has a value.
      const anyPresent = (cols) =>
        Array.isArray(cols) &&
        cols.some((idx) => {
          const cell = row[idx];
          return cell !== undefined && cell !== null && String(cell).trim() !== '';
        });
    
      const sumCells = (cols) =>
        cols.reduce((t, idx) => {
          const n = parseFloat(String(row[idx]).replace(/,/g, ''));
          return t + (Number.isFinite(n) ? n : 0);
        }, 0);
    
      if (anyPresent(mapping.cash))      account.cash      = sumCells(mapping.cash);
      if (anyPresent(mapping.income))    account.income    = sumCells(mapping.income);
      if (anyPresent(mapping.annuities)) account.annuities = sumCells(mapping.annuities);
      if (anyPresent(mapping.growth))    account.growth    = sumCells(mapping.growth);
    
      // Withdrawals appended later when buckets are merged (unchanged)
    }
    


    // 2) Parse spreadsheet from S3 (or local buffer) using your existing helper
    const rawData = await parseSpreadsheetFromUrl(tempFile);
    if (!rawData || rawData.length <= 1) {
      return res.status(400).json({ message: 'No data rows found.' });
    }
    rawData.shift(); // remove header row

    // Prepare arrays for final results
    const createdRecords = [];
    const updatedRecords = [];
    const failedRecords = [];
    const duplicateRecords = [];

    // Track (accountNumber) used in this sheet to detect duplicates
    const usedAccountNumbers = new Set();

    // Socket info
    const io = req.app.locals.io;
    const userRoom = req.session.user._id;
    const totalRecords = rawData.length;
    // bucket rows that share the same accountNumber so we can merge withdraws
    let rowBuckets = {};                        // { [acctNum]: [rowObj,rowObj…] }


    // Time & chunk-based variables
    const startTime = Date.now();
    let processedCount = 0;
    let totalChunks = 0;
    let rollingAvgSecPerRow = 0.0;
    const CHUNK_SIZE = 50; // adjust as needed

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // (A) If importType === 'beneficiaries', handle beneficiary flow
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// (A) If importType === 'beneficiaries', handle beneficiary flow
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
if (importType === 'beneficiaries') {
  // Local helpers (scoped to this branch only)
  const getVal = (row, idx) => {
    if (idx == null) return null;
    const v = row[idx];
    return (v === undefined || v === '') ? null : v;
  };

  const normalizeBeneficiaryTypeLocal = (val) => {
    if (val === null || val === undefined) return null;
    const s = String(val).trim().toLowerCase();
    const letters = s.replace(/[^a-z0-9]/g, '');
    if (['p','prim','primary','pri','prime','1'].includes(letters)) return 'primary';
    if (['c','cont','contingent','secondary','sec','2'].includes(letters)) return 'contingent';
    return null;
  };

  // Accepts "24", "24%", 24, "0.24" -> 24; rejects <0 or >100
  const parsePct = (raw) => {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') {
      const v = raw <= 1 && raw >= 0 ? raw * 100 : raw;
      return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
    }
    if (typeof raw === 'string') {
      const s = raw.trim();
      if (!s) return null;
      const hasPct = s.includes('%');
      const cleaned = s.replace(/[%\s]/g, '');
      const num = Number(cleaned);
      if (!Number.isFinite(num)) return null;
      const val = hasPct ? num : (num <= 1 && num >= 0 ? num * 100 : num);
      return val >= 0 && val <= 100 ? val : null;
    }
    return null;
  };

  // "Last, First" or "First Last" -> [firstName,lastName]
  const splitNameSmartLocal = (full) => {
    if (!full) return ['', ''];
    const s = String(full).trim();
    if (!s) return ['', ''];
    if (s.includes(',')) {
      const [last, first] = s.split(',').map(x => x.trim());
      return [first || '', last || ''];
    }
    const parts = s.split(/\s+/);
    if (parts.length === 1) return [parts[0], ''];
    const first = parts.shift();
    const last = parts.join(' ');
    return [first, last];
  };

  for (let chunkStart = 0; chunkStart < totalRecords; chunkStart += CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalRecords);
    const chunkSize = chunkEnd - chunkStart;
    const chunkStartTime = Date.now();

    for (let i = chunkStart; i < chunkEnd; i++) {
      const row = rawData[i];
      try {
        // --- Required mappings
        const acctIdx = mapping.accountNumber;
        const nameIdx = mapping.beneficiaryName;
        const typeIdx = mapping.beneficiaryType;
        const pctIdx  = mapping.beneficiaryPercentage;

        if (acctIdx == null || nameIdx == null || typeIdx == null || pctIdx == null) {
          failedRecords.push({
            accountNumber: 'N/A',
            reason: 'Missing required mapping(s): accountNumber, beneficiaryName, beneficiaryType, beneficiaryPercentage',
            rowIndex: i
          });
          continue;
        }

        const accountNumber = getVal(row, acctIdx);
        const nameRaw       = getVal(row, nameIdx);
        const typeRaw       = getVal(row, typeIdx);
        const pctRaw        = getVal(row, pctIdx);

        if (!accountNumber) {
          failedRecords.push({ accountNumber: 'N/A', reason: 'Missing accountNumber', rowIndex: i });
          continue;
        }
        if (!nameRaw) {
          failedRecords.push({ accountNumber, reason: 'Missing beneficiary name', rowIndex: i });
          continue;
        }

        const typeNorm = normalizeBeneficiaryTypeLocal(typeRaw);
        if (!typeNorm) {
          failedRecords.push({
            accountNumber,
            reason: `Unrecognized beneficiary type "${typeRaw}". Use Primary/Contingent (any case/spacing).`,
            rowIndex: i
          });
          continue;
        }

        const pct = parsePct(pctRaw);
        if (pct === null) {
          failedRecords.push({
            accountNumber,
            reason: `Invalid beneficiary percentage "${pctRaw}"`,
            rowIndex: i
          });
          continue;
        }

        // Optional fields (not stored on Account; used only for Beneficiary creation/enrichment)
        const relIdx      = mapping.beneficiaryRelationship;
        const clientIdx   = mapping.clientId;
        const relVal      = relIdx != null ? getVal(row, relIdx) : null;
        const clientIdVal = clientIdx != null ? getVal(row, clientIdx) : null;

        // --- Find the Account
        let account = await Account.findOne({
          firmId: req.session.user.firmId,
          accountNumber
        });
        if (!account) {
          failedRecords.push({
            accountNumber,
            reason: `No matching account found for accountNumber=${accountNumber}`,
            rowIndex: i
          });
          continue;
        }

        // Ensure structure exists
        if (!account.beneficiaries) account.beneficiaries = { primary: [], contingent: [] };
        if (!Array.isArray(account.beneficiaries.primary)) account.beneficiaries.primary = [];
        if (!Array.isArray(account.beneficiaries.contingent)) account.beneficiaries.contingent = [];

        // --- Create or fetch Beneficiary doc
        const [firstName, lastName] = splitNameSmartLocal(nameRaw);

        // Prefer exact case-insensitive match on first/last
        const escRx = s => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let bDoc = await Beneficiary.findOne({
          firstName: new RegExp(`^${escRx(firstName)}$`, 'i'),
          lastName : new RegExp(`^${escRx(lastName)}$`,  'i')
        });

        // Create if missing; optionally enrich relationship on new/existing
        if (!bDoc) {
          bDoc = await Beneficiary.create({
            firstName: firstName || 'N/A',
            lastName : lastName  || 'N/A',
            relationship: relVal || ''
          });
        } else if (relVal && !bDoc.relationship) {
          bDoc.relationship = relVal;
          await bDoc.save();
        }

        // --- Put beneficiary into the correct list
        const list = (typeNorm === 'primary')
          ? account.beneficiaries.primary
          : account.beneficiaries.contingent;

        // Clean any prior placeholders
        for (let k = list.length - 1; k >= 0; k--) {
          if (!list[k] || !list[k].beneficiary) list.splice(k, 1);
        }

        const bId = bDoc._id;
        const idx = list.findIndex(e => e.beneficiary && String(e.beneficiary) === String(bId));

        if (idx >= 0) {
          // Update allocation only
          list[idx].percentageAllocation = pct;
        } else {
          // Push fully-formed (no mutate-after-push)
          list.push({ beneficiary: bId, percentageAllocation: pct });
        }

        // Ensure nested array changes are persisted
        account.markModified('beneficiaries');

        const changedFields = account.modifiedPaths();
        await account.save();

        updatedRecords.push({
          accountNumber,
          updatedFields: changedFields,
          beneficiaryType: typeNorm
        });
      } catch (err) {
        failedRecords.push({
          accountNumber: 'N/A',
          reason: err.message,
          rowIndex: i
        });
      }

      processedCount++;
    } // end row loop for this chunk

    // --- CHUNK COMPLETE: update rolling average & emit progress ---
    const chunkEndTime = Date.now();
    const chunkElapsedMs = chunkEndTime - chunkStartTime;
    const chunkSecPerRow = chunkElapsedMs / 1000 / chunkSize;

    totalChunks++;
    rollingAvgSecPerRow =
      ((rollingAvgSecPerRow * (totalChunks - 1)) + chunkSecPerRow) / totalChunks;

    // Estimate time left
    const rowsLeft = totalRecords - processedCount;
    const secLeft = Math.round(rowsLeft * rollingAvgSecPerRow);

    let estimatedTimeStr = '';
    if (secLeft >= 60) {
      const minutes = Math.floor(secLeft / 60);
      const seconds = secLeft % 60;
      estimatedTimeStr = `${minutes}m ${seconds}s`;
    } else {
      estimatedTimeStr = `${secLeft}s`;
    }

    const percentage = Math.round((processedCount / totalRecords) * 100);

    // Emit progress for this chunk
    io.to(userRoom).emit('importProgress', {
      status: 'processing',
      totalRecords,
      createdRecords: createdRecords.length,
      updatedRecords: updatedRecords.length,
      failedRecords: failedRecords.length,
      duplicateRecords: duplicateRecords.length,
      percentage,
      estimatedTime: processedCount === 0 ? 'Calculating...' : `${estimatedTimeStr} left`,
      createdRecordsData: createdRecords,
      updatedRecordsData: updatedRecords,
      failedRecordsData: failedRecords,
      duplicateRecordsData: duplicateRecords
    });
  } // end chunk loop

  // Emit final
  io.to(userRoom).emit('importComplete', {
    status: 'completed',
    totalRecords,
    createdRecords: createdRecords.length,
    updatedRecords: updatedRecords.length,
    failedRecords: failedRecords.length,
    duplicateRecords: duplicateRecords.length,
    createdRecordsData: createdRecords,
    updatedRecordsData: updatedRecords,
    failedRecordsData: failedRecords,
    duplicateRecordsData: duplicateRecords,
    importReportId: null 
  });

  // ================================
  // CREATE ImportReport for Beneficiary Import
  // ================================
  try {
    const newReport = new ImportReport({
      user: req.session.user._id,
      importType: 'Beneficiary Import',
      originalFileKey: s3Key, // from req.body
      createdRecords: createdRecords.map(r => ({
        firstName: r.firstName || '',
        lastName: r.lastName || '',
      })),
      updatedRecords: updatedRecords.map(r => ({
        firstName: r.firstName || '',
        lastName: r.lastName || '',
        updatedFields: Array.isArray(r.updatedFields) ? r.updatedFields : []
      })),
      failedRecords: failedRecords.map(r => ({
        firstName: 'N/A',
        lastName: 'N/A',
        reason: r.reason || ''
      })),
      duplicateRecords: duplicateRecords.map(r => ({
        firstName: 'N/A',
        lastName: 'N/A',
        reason: r.reason || ''
      })),
    });
    newReport.$locals = newReport.$locals || {};             // optional: plugin "create" log
    newReport.$locals.activityCtx = baseCtx;
    await newReport.save();
    // Optionally let the front-end know the newReport ID
    io.to(userRoom).emit('newImportReport', {
      _id: newReport._id,
      importType: newReport.importType,
      createdAt: newReport.createdAt
    });

    // Summary "import" log (counts only)
    try {
      await logActivity(
        {
          ...baseCtx,
          meta: {
            ...baseCtx.meta,
            extra: { ...(baseCtx.meta?.extra || {}), importReportId: newReport._id }
          }
        },
        {
          entity: { type: 'ImportReport', id: newReport._id, display: `Beneficiary import • ${s3Key ? path.basename(s3Key) : ''}` },
          action: 'import',
          before: null,
          after: {
            totalRecords,
            created:  createdRecords.length,
            updated:  updatedRecords.length,
            failed:   failedRecords.length,
            duplicates: duplicateRecords.length
          },
          diff: null
        }
      );
    } catch (actErr) {
      console.error('[account-import] activity log failed:', actErr);
    }
    return res.json({
      message: 'Beneficiary import complete',
      createdRecords,
      updatedRecords,
      failedRecords,
      duplicateRecords,
      importReportId: newReport._id
    });
  } catch (reportErr) {
    console.error('Error creating ImportReport:', reportErr);
    return res.json({
      message: 'Beneficiary import complete (report creation failed)',
      createdRecords,
      updatedRecords,
      failedRecords,
      duplicateRecords,
      error: reportErr.message
    });
  }
}

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // (B) If importType === 'billing', handle billing import flow
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    else if (importType === 'billing') {
      // Helper: Get cell value if mapped; return null if not mapped or empty
      const getVal = (row, idx) => {
        if (idx == null) return null;
        const val = row[idx];
        if (val === undefined || val === '') return null;
        return val;
      };

      // Process in chunks
      for (let chunkStart = 0; chunkStart < totalRecords; chunkStart += CHUNK_SIZE) {
        const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalRecords);
        const chunkSize = chunkEnd - chunkStart;
        const chunkStartTime = Date.now();

        for (let i = chunkStart; i < chunkEnd; i++) {
          const row = rawData[i];
          try {
            // 1) The only truly required field is accountNumber
            const accountNumberIndex = mapping.accountNumber;
            if (accountNumberIndex == null) {
              failedRecords.push({
                accountNumber: 'N/A',
                reason: 'No accountNumber mapping provided.'
              });
              continue;
            }

            const accountNumber = getVal(row, accountNumberIndex);
            if (!accountNumber) {
              failedRecords.push({
                accountNumber: 'N/A',
                reason: 'Missing required accountNumber'
              });
              continue;
            }

            // 2) Check for duplicates in the same spreadsheet
            if (usedAccountNumbers.has(accountNumber)) {
              duplicateRecords.push({
                accountNumber,
                reason: `Duplicate accountNumber in the same spreadsheet: ${accountNumber}`,
                rowIndex: i
              });
              continue;
            } else {
              usedAccountNumbers.add(accountNumber);
            }

            // 3) Find existing account by (firmId + accountNumber)
            let account = await Account.findOne({
              firmId: req.session.user.firmId,
              accountNumber
            });

            if (!account) {
              // If we do NOT want to create new accounts for billing alone:
              failedRecords.push({
                accountNumber,
                reason: `No matching account found for accountNumber=${accountNumber}`
              });
              continue;
            }

            // 4) Read the billing amount from the row
            const billedIdx = mapping.quarterlyBilledAmount;
            let quarterlyBilledVal = 0;
            if (billedIdx != null) {
              const rawBilledVal = getVal(row, billedIdx);
              const parsed = parseFloat(rawBilledVal);
              if (!isNaN(parsed)) {
                quarterlyBilledVal = parsed;
              }
            }

            // 5) Update the account
            account.quarterlyBilledAmount = quarterlyBilledVal;

            // Capture changes before save (modifiedPaths is cleared after save)
            const changedFields = account
              .modifiedPaths()
              .filter(p => !['__v', 'updatedAt', 'createdAt'].includes(p));

            await account.save();

            // 6) Mark as updated
            updatedRecords.push({
              accountNumber,
              updatedFields: changedFields,
              quarterlyBilledAmount: quarterlyBilledVal
            });
          } catch (err) {
            failedRecords.push({
              accountNumber: 'N/A',
              reason: err.message
            });
          }

          processedCount++;
        } // end row loop for this chunk




        // --- CHUNK COMPLETE: update rolling average & emit progress ---
        const chunkEndTime = Date.now();
        const chunkElapsedMs = chunkEndTime - chunkStartTime;
        const chunkSecPerRow = chunkElapsedMs / 1000 / chunkSize;

        totalChunks++;
        rollingAvgSecPerRow =
          ((rollingAvgSecPerRow * (totalChunks - 1)) + chunkSecPerRow) / totalChunks;

        // Estimate time left
        const rowsLeft = totalRecords - processedCount;
        const secLeft = Math.round(rowsLeft * rollingAvgSecPerRow);

        let estimatedTimeStr = '';
        if (secLeft >= 60) {
          const minutes = Math.floor(secLeft / 60);
          const seconds = secLeft % 60;
          estimatedTimeStr = `${minutes}m ${seconds}s`;
        } else {
          estimatedTimeStr = `${secLeft}s`;
        }

        const percentage = Math.round((processedCount / totalRecords) * 100);

        // Emit progress for this chunk
        io.to(userRoom).emit('importProgress', {
          status: 'processing',
          totalRecords,
          createdRecords: createdRecords.length,
          updatedRecords: updatedRecords.length,
          failedRecords: failedRecords.length,
          duplicateRecords: duplicateRecords.length,
          percentage,
          estimatedTime: processedCount === 0 ? 'Calculating...' : `${estimatedTimeStr} left`,
          createdRecordsData: createdRecords,
          updatedRecordsData: updatedRecords,
          failedRecordsData: failedRecords,
          duplicateRecordsData: duplicateRecords
        });
      } // end chunk loop

      // 7) Recalculate each affected Household's annualBilling
      // Summation approach: annual = sum(quarterlyBilledAmount) * 4
      try {
        // gather updated accountNumbers
        const updatedAccountNumbers = updatedRecords.map(r => r.accountNumber);
        if (updatedAccountNumbers.length > 0) {
          // find changed accounts
          const changedAccounts = await Account.find({
            firmId: req.session.user.firmId,
            accountNumber: { $in: updatedAccountNumbers },
          }).select('_id household quarterlyBilledAmount');

          // gather household IDs
          const householdIds = new Set(changedAccounts.map(a => a.household).filter(Boolean));

          // find households & populate accounts
          const affectedHouseholds = await Household.find({
            _id: { $in: Array.from(householdIds) },
          }).populate('accounts', 'quarterlyBilledAmount');

          // recalc for each household
          for (const hh of affectedHouseholds) {
            let sumQuarterly = 0;
            for (const acct of hh.accounts) {
              sumQuarterly += acct.quarterlyBilledAmount || 0;
            }
            hh.annualBilling = sumQuarterly * 4;
            await hh.save();
          }
        }
      } catch (err) {
        console.error('Failed to recalc household annual billing:', err);
      }

      // Emit final
      io.to(userRoom).emit('importComplete', {
        status: 'completed',
        totalRecords,
        createdRecords: createdRecords.length,
        updatedRecords: updatedRecords.length,
        failedRecords: failedRecords.length,
        duplicateRecords: duplicateRecords.length,
        createdRecordsData: createdRecords,
        updatedRecordsData: updatedRecords,
        failedRecordsData: failedRecords,
        duplicateRecordsData: duplicateRecords,
        importReportId: null
      });
     // =================================
     // CREATE ImportReport for Billing Import
     // =================================
     try {
       const newReport = new ImportReport({
         user: req.session.user._id,
         importType: 'Billing Import',
         originalFileKey: s3Key,
         createdRecords: [], // Because billing only updates records
         updatedRecords: updatedRecords.map(r => ({
           firstName: '', // No firstName/lastName in your billing logic
           lastName: '',
           updatedFields: r.updatedFields || []
         })),
         failedRecords: failedRecords.map(r => ({
           firstName: 'N/A',
           lastName: 'N/A',
           reason: r.reason || ''
         })),
         duplicateRecords: duplicateRecords.map(r => ({
           firstName: 'N/A',
           lastName: 'N/A',
           reason: r.reason || ''
         })),
       });
       await newReport.save();

       io.to(userRoom).emit('newImportReport', {
         _id: newReport._id,
         importType: newReport.importType,
         createdAt: newReport.createdAt
       });

       return res.json({
         message: 'Billing import complete',
         createdRecords,
         updatedRecords,
         failedRecords,
         duplicateRecords,
         importReportId: newReport._id
       });
     } catch (reportErr) {
       console.error('Error creating ImportReport:', reportErr);
       return res.json({
         message: 'Billing import complete (report creation failed)',
         createdRecords,
         updatedRecords,
         failedRecords,
         duplicateRecords,
         error: reportErr.message
       });
     }

      return res.json({
        message: 'Billing import complete',
        createdRecords,
        updatedRecords,
        failedRecords,
        duplicateRecords
      });
    }

// ──────────────────────────────────────────────────────
// (C) If importType === 'liability', handle Liability import
// ──────────────────────────────────────────────────────
else if (importType === 'liability') {
  const created          = [];
  const updated          = [];
  const failed           = [];
  const duplicateRecords = [];
  const usedNumbers      = new Set();
  const totalRecords     = rawData.length;

  for (let i = 0; i < totalRecords; i++) {
    const row = rawData[i];
    let loanNumber;
    try {
      const rowObj    = rowToLiabObj(row, mapping);
      loanNumber      = rowObj.accountLoanNumber?.trim();

      // 1) Required
      if (!loanNumber) {
        failed.push({
          accountNumber:    'N/A',
          accountOwnerName: '',
          reason:           'Missing Account/Loan Number',
          rowIndex:         i
        });
        continue;
      }

      // 2) Dedupe
      if (usedNumbers.has(loanNumber)) {
        duplicateRecords.push({
          accountNumber:    loanNumber,
          accountOwnerName: '',
          reason:           'Duplicate in sheet',
          rowIndex:         i
        });
        continue;
      }
      usedNumbers.add(loanNumber);

      // 3) Find or create
      let liab       = await Liability.findOne({ accountLoanNumber: loanNumber });
      const isCreate = !liab;
      if (isCreate) liab = new Liability({ accountLoanNumber: loanNumber });

      // 4) Snapshot + apply
      const beforeSnap    = snapshot(liab);
      await applyLiabilityRow(liab, rowObj, req.session.user.firmId);

      // 5) Detect changes
      const changedFields = liab
        .modifiedPaths()
        .filter(p => p !== '__v');

      // 6) Save
      await liab.save();

      // 7) Build the record
      const record = {
        accountNumber:    liab.accountLoanNumber,
        accountOwnerName: '',
        updatedFields:    isCreate ? [] : changedFields
      };

      if (isCreate) created.push(record);
      else           updated.push(record);
    } catch (err) {
      failed.push({
        accountNumber:    loanNumber || 'N/A',
        accountOwnerName: '',
        reason:           err.message,
        rowIndex:         i
      });
    }
  }

  // Emit final progress
  io.to(userRoom).emit('importComplete', {
    status:               'completed',
    totalRecords,
    createdRecords:       created.length,
    updatedRecords:       updated.length,
    failedRecords:        failed.length,
    duplicateRecords:     duplicateRecords.length,
    createdRecordsData:   created,
    updatedRecordsData:   updated,
    failedRecordsData:    failed,
    duplicateRecordsData: duplicateRecords,
    importReportId:       null
  });

  // Persist ImportReport
  const report = await ImportReport.create({
    user:            req.session.user._id,
    importType:      'Liability Import',
    originalFileKey: s3Key,
    createdRecords:  created,
    updatedRecords:  updated,
    failedRecords:   failed,
    duplicateRecords
  });


  // Summary "import" log
  try {
    await logActivity(
      {
        ...baseCtx,
        meta: {
          ...baseCtx.meta,
          extra: { ...(baseCtx.meta?.extra || {}), importReportId: report._id }
        }
      },
      {
        entity: { type: 'ImportReport', id: report._id, display: `Liability import • ${s3Key ? path.basename(s3Key) : ''}` },
        action: 'import',
        before: null,
        after: {
          totalRecords,
          created:  created.length,
          updated:  updated.length,
          failed:   failed.length,
          duplicates: duplicateRecords.length
        },
        diff: null
      }
    );
  } catch (actErr) {
    console.error('[account-import] activity log failed:', actErr);
  }

  return res.json({
    message:        'Liability import complete',
    importReportId: report._id,
    createdRecords: created,
    updatedRecords: updated,
    failedRecords:  failed,
    duplicateRecords
  });
}



// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// (D) If importType === 'asset', handle Physical-Asset import
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
else if (importType === 'asset') {
  const created          = [];
  const updated          = [];
  const failed           = [];
  const duplicateRecords = [];
  const usedNumbers      = new Set();
  const totalRecords     = rawData.length;

  for (let i = 0; i < totalRecords; i++) {
    const row = rawData[i];
    try {
      const rowObj      = rowToAssetObj(row, mapping);
      const assetNumber = rowObj.assetNumber?.trim();

      // 1) Required
      if (!assetNumber) {
        failed.push({
          accountNumber:    'N/A',
          accountOwnerName: '',
          reason:           'Missing Asset Number',
          rowIndex:         i
        });
        continue;
      }

      // 2) Dedupe
      if (usedNumbers.has(assetNumber)) {
        duplicateRecords.push({
          accountNumber:    assetNumber,
          accountOwnerName: '',
          reason:           'Duplicate in sheet',
          rowIndex:         i
        });
        continue;
      }
      usedNumbers.add(assetNumber);

      // 3) Find or create
      let asset      = await Asset.findOne({ assetNumber });
      const isCreate = !asset;
      if (isCreate)  asset = new Asset({ assetNumber });

      // 4) Snapshot + apply
      const beforeSnap    = snapshot(asset);
      await applyAssetRow(asset, rowObj, req.session.user.firmId);

      // 5) Detect changes
      const changedFields = asset
        .modifiedPaths()
        .filter(p => p !== '__v');

      // 6) Save
      await asset.save();

      // 7) Build the record
      const record = {
        accountNumber:    asset.assetNumber,
        accountOwnerName: '',
        updatedFields:    isCreate ? [] : changedFields
      };

      if (isCreate) created.push(record);
      else           updated.push(record);
    } catch (err) {
      failed.push({
        accountNumber:    rowObj?.assetNumber || 'N/A',
        accountOwnerName: '',
        reason:           err.message,
        rowIndex:         i
      });
    }
  }

  // Emit final progress
  io.to(userRoom).emit('importComplete', {
    status:               'completed',
    totalRecords,
    createdRecords:       created.length,
    updatedRecords:       updated.length,
    failedRecords:        failed.length,
    duplicateRecords:     duplicateRecords.length,
    createdRecordsData:   created,
    updatedRecordsData:   updated,
    failedRecordsData:    failed,
    duplicateRecordsData: duplicateRecords,
    importReportId:       null
  });

  // Persist ImportReport
  const report = await ImportReport.create({
    user:            req.session.user._id,
    importType:      'Asset Import',
    originalFileKey: s3Key,
    createdRecords:  created,
    updatedRecords:  updated,
    failedRecords:   failed,
    duplicateRecords
  });

    try {
      await logActivity(
        {
          ...baseCtx,
          meta: {
            ...baseCtx.meta,
            extra: { ...(baseCtx.meta?.extra || {}), importReportId: report._id }
          }
        },
        {
          entity: { type: 'ImportReport', id: report._id, display: `Asset import • ${s3Key ? path.basename(s3Key) : ''}` },
          action: 'import',
          before: null,
          after: {
            totalRecords,
            created:  created.length,
            updated:  updated.length,
            failed:   failed.length,
            duplicates: duplicateRecords.length
          },
          diff: null
        }
      );
    } catch (actErr) {
      console.error('[account-import] activity log failed:', actErr);
      }

  return res.json({
    message:        'Asset import complete',
    importReportId: report._id,
    createdRecords: created,
    updatedRecords: updated,
    failedRecords:  failed,
    duplicateRecords
  });
}


// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// (C) Otherwise, handle standard account import
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// Process in chunks
for (let chunkStart = 0; chunkStart < totalRecords; chunkStart += CHUNK_SIZE) {
  const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalRecords);
  const chunkSize = chunkEnd - chunkStart;
  const chunkStartTime = Date.now();

  // A) Bucket rows by accountNumber
  for (let i = chunkStart; i < chunkEnd; i++) {
    const row = rawData[i];
    try {
      const rowObj = extractAccountRowData(row, mapping);

      // Require accountNumber
      if (!rowObj.accountNumber) {
        failedRecords.push({ accountNumber: 'N/A', reason: 'Missing accountNumber' });
        continue;
      }

      // Initialize bucket if needed
      if (!rowBuckets[rowObj.accountNumber]) {
        rowBuckets[rowObj.accountNumber] = [];
      }

      // Add this row to the bucket
      rowBuckets[rowObj.accountNumber].push({ rowObj, rawRow: row });
    } catch (err) {
      failedRecords.push({ accountNumber: 'N/A', reason: err.message });
    }

    processedCount++;
  } // end row loop for this chunk

  // B) Persist one Account per accountNumber bucket
  for (const [acctNum, arr] of Object.entries(rowBuckets)) {
    const first = arr[0].rowObj;

      // NEW: does any row in this bucket look "joint" based on Account Owner Name?
  const jointHint = arr.some(({ rowObj }) => looksLikeJoint(rowObj.externalAccountOwnerName));

  // NEW: we will keep the linked client doc here if clientId was mapped
  let linkedClientDoc = null;


    // 1) Find existing or create new Account
    let account = await Account.findOne({
      firmId:        req.session.user.firmId,
      accountNumber: acctNum
    });
    const isCreate = !account;
    if (isCreate) {
      account = new Account({
        firmId:        req.session.user.firmId,
        accountNumber: acctNum,
        importBatchId: batchId,
        asOfDate:      parsedAsOf
        // isUnlinked will be set after we attempt to link a valid clientId
      });
    } else {
      account.asOfDate = parsedAsOf;   // overwrite on updates
    }

    // 2) Snapshot tracked fields before mutation
    const beforeSnap = snapshot(account);

// 3) Try to link the supplied clientId (if any)
if (first.clientId) {
  const cli = await Client.findOne({
    firmId:   req.session.user.firmId,
    clientId: first.clientId
  });
  if (cli) {
    account.accountOwner = [cli._id];
    account.household    = cli.household;
    linkedClientDoc      = cli; // <— NEW: keep for joint-owner anchoring
  }
  else {
    debugImport('Mapped clientId did not resolve to Client', {
      accountNumber: acctNum,
      clientId: first.clientId
    });
  }
}



    // 4) Ensure systematicWithdrawals exists
    if (!Array.isArray(account.systematicWithdrawals)) {
      account.systematicWithdrawals = [];
    }

    // 5) Apply each row’s data
    for (const { rowObj, rawRow } of arr) {
      updateAccountFromRow(account, rowObj, rawRow, mapping);

      // Dedupe + append systematic withdrawals
      if (rowObj.systematicWithdrawAmount && rowObj.systematicWithdrawFrequency) {
        const amt  = parseFloat(rowObj.systematicWithdrawAmount);
        const freq = rowObj.systematicWithdrawFrequency;
        const exists = account.systematicWithdrawals.find(w =>
          w.amount === amt && w.frequency === freq
        );
        if (!exists) {
          account.systematicWithdrawals.push({ amount: amt, frequency: freq });
        }
      }
    }

    // ── NEW: If any row flagged "joint", ensure both household members are owners.
if (jointHint) {
  const reason =
    first.clientId ? 'row has clientId (anchor by mapped client)' :
    (account.accountOwner?.length ? 'no clientId; anchor by existing account owner' :
     'no clientId and no existing owner');

     debugImport('Joint hint detected for account', acctNum, {
      samples: arr
        .map(({ rowObj }) => rowObj.externalAccountOwnerName)
        .filter(Boolean)
        .slice(0, 3)
    });

  await ensureJointOwners({
    account,
    firmId: req.session.user.firmId,
    primaryClientDoc: linkedClientDoc,
    reason
  });
}



// 3b) **Finalise the linkage flag AFTER joint logic**
account.isUnlinked = !(Array.isArray(account.accountOwner) &&
                       account.accountOwner.length > 0);


     // Capture these **before** saving – `modifiedPaths()` is cleared
     // by Mongoose after a successful `save()`.
     const changedFields = account
       .modifiedPaths()
       .filter(p => !['__v', 'updatedAt', 'createdAt'].includes(p));

    // 6) Log any tracked-field changes (before save)
    await logChanges(account, beforeSnap, req.session.user._id);

// ─────────────────────────────────────────────
// 7) Persist the Account  +  link to Household
await account.save();

/* -------------------------------------------------
 * Guarantee the Account→Household linkage and
 * force‑update the Household cached totals so that
 * all UI pages (banner, /households list, detail page)
 * reflect the new balance immediately.
 * ------------------------------------------------*/
if (account.household) {
  // 1) push if not already present
  await Household.updateOne(
    { _id: account.household, accounts: { $ne: account._id } },
    { $push: { accounts: account._id } }
  );

  // 2) recalc the running total – no snapshots, just the real numbers
  const sum = await Account.aggregate([
    { $match: { household: account.household } },
    { $group: { _id: null, total: { $sum: '$accountValue' } } }
  ]);
  await Household.updateOne(
    { _id: account.household },
    { totalAccountValue: sum[0]?.total || 0 }
  );
}

// snapshot was taken earlier as `beforeSnap`
await logChanges(account, beforeSnap, req.session.user._id, { logAll: true });


    // 8) Record result for UI
    if (isCreate) {
      createdRecords.push({ accountNumber: acctNum, clientId: first.clientId || '' });
    } else {
      updatedRecords.push({ accountNumber: acctNum, updatedFields : changedFields });
    }
  }

  // Reset buckets for next chunk
  rowBuckets = {};

  // --- CHUNK COMPLETE: rolling average & progress emit ---
  const chunkEndTime   = Date.now();
  const chunkElapsedMs = chunkEndTime - chunkStartTime;
  const chunkSecPerRow = chunkElapsedMs / 1000 / chunkSize;

  totalChunks++;
  rollingAvgSecPerRow =
    ((rollingAvgSecPerRow * (totalChunks - 1)) + chunkSecPerRow) / totalChunks;

  // Estimate time left
  const rowsLeft = totalRecords - processedCount;
  const secLeft  = Math.round(rowsLeft * rollingAvgSecPerRow);
  let estimatedTimeStr = '';
  if (secLeft >= 60) {
    const minutes = Math.floor(secLeft / 60);
    const seconds = secLeft % 60;
    estimatedTimeStr = `${minutes}m ${seconds}s`;
  } else {
    estimatedTimeStr = `${secLeft}s`;
  }

  const percentage = Math.round((processedCount / totalRecords) * 100);

  // Emit progress for this chunk
  io.to(userRoom).emit('importProgress', {
    status:               'processing',
    totalRecords,
    createdRecords:       createdRecords.length,
    updatedRecords:       updatedRecords.length,
    failedRecords:        failedRecords.length,
    duplicateRecords:     duplicateRecords.length,
    percentage,
    estimatedTime:        processedCount === 0 ? 'Calculating...' : `${estimatedTimeStr} left`,
    createdRecordsData:   createdRecords,
    updatedRecordsData:   updatedRecords,
    failedRecordsData:    failedRecords,
    duplicateRecordsData: duplicateRecords
  });
} // end chunk loop

// Emit final completion
io.to(userRoom).emit('importComplete', {
  status:               'completed',
  totalRecords,
  createdRecords:       createdRecords.length,
  updatedRecords:       updatedRecords.length,
  failedRecords:        failedRecords.length,
  duplicateRecords:     duplicateRecords.length,
  createdRecordsData:   createdRecords,
  updatedRecordsData:   updatedRecords,
  failedRecordsData:    failedRecords,
  duplicateRecordsData: duplicateRecords,
  importReportId:       null
});

   // =====================================
   // CREATE ImportReport for Standard Account Import
   // =====================================
   try {
     const newReport = new ImportReport({
       user: req.session.user._id,
       importType: 'Account Data Import',
       originalFileKey: s3Key,
       createdRecords: createdRecords.map(r => ({
         firstName: '', // or you could store clientId as the "lastName" if you like
         lastName: '',
         accountNumber: r.accountNumber || '',
         accountOwnerName: r.accountOwnerName || '',
       })),
       updatedRecords: updatedRecords.map(r => ({
         firstName: '', // or accountNumber
         lastName: '',
         accountNumber: r.accountNumber || '',
         accountOwnerName: r.accountOwnerName || '',
         updatedFields : Array.isArray(r.updatedFields) ? r.updatedFields : []
       })),
       failedRecords: failedRecords.map(r => ({
         firstName: 'N/A',
         lastName: 'N/A',
         reason: r.reason || '',
         accountNumber: r.accountNumber || '',
         accountOwnerName: r.accountOwnerName || '',
       })),

     });
     newReport.$locals = newReport.$locals || {};
     newReport.$locals.activityCtx = baseCtx;
     await newReport.save();

     io.to(userRoom).emit('newImportReport', {
       _id: newReport._id,
       importType: newReport.importType,
       createdAt: newReport.createdAt
     });


    try {
      await logActivity(
        {
          ...baseCtx,
          meta: {
            ...baseCtx.meta,
            extra: { ...(baseCtx.meta?.extra || {}), importReportId: newReport._id }
          }
        },
        {
          entity: { type: 'ImportReport', id: newReport._id, display: `Account import • ${s3Key ? path.basename(s3Key) : ''}` },
          action: 'import',
          before: null,
          after: {
            totalRecords,
            created:  createdRecords.length,
            updated:  updatedRecords.length,
            failed:   failedRecords.length,
            duplicates: duplicateRecords.length
          },
          diff: null
        }
      );
    } catch (actErr) {
      console.error('[account-import] activity log failed:', actErr);
    }

     return res.json({
       message: 'Account import complete',
       createdRecords,
       updatedRecords,
       failedRecords,
       importReportId: newReport._id
     });
   } catch (reportErr) {
     console.error('Error creating ImportReport:', reportErr);
     return res.json({
       message: 'Account import complete (report creation failed)',
       createdRecords,
       updatedRecords,
       failedRecords,
       error: reportErr.message
     });
   }


    return res.json({
      message: 'Account import complete',
      createdRecords,
      updatedRecords,
      failedRecords,

    });
  } catch (err) {
    console.error('Error processing account import:', err);
       // Notify the front-end via socket
   try {
     const io = req.app.locals.io;
     const userRoom = req.session.user._id;
     io.to(userRoom).emit('importError', {
       message: err.message || 'An unexpected error occurred during import.'
     });
   } catch (socketErr) {
     console.error('Failed to emit importError event:', socketErr);
   }
    return res.status(500).json({
      message: 'Server error while processing account import',
      error: err.message
    });
  }
};
