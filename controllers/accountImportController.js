// controllers/accountImportController.js

const mongoose = require('mongoose');
const xlsx     = require('xlsx');
const axios    = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path'); 
const Account      = require('../models/Account');
const Client       = require('../models/Client');
const Household    = require('../models/Household');
const Insurance = require('../models/Insurance');


const ImportReport = require('../models/ImportReport');
const crypto       = require('crypto');

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
// ADD THESE (adjust paths to match your project)
const { resolveOwnersFromOwnerName } = require('../utils/resolveOwners'); // <- your new util
const { parsePeriodKey, parseDate, toCents, upsertBillingItem } = require('../services/billing');
 



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


// ─────────────────────────────────────────────────────────────
// Insurance helpers
// ─────────────────────────────────────────────────────────────
function normalizePolicyFamily(input, subtypeHint) {
    const s0 = toStr(input).trim().toLowerCase();
    const t0 = toStr(subtypeHint).trim().toLowerCase();
    const s  = s0.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
    const t  = t0.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
    const has = (str, w) => new RegExp(`(?:^|\\s)${w}(?:\\s|$)`).test(str);
  
    // Explicit family from user takes priority
    if (has(s, 'term')) return 'TERM';
    if (has(s, 'permanent') || has(s, 'perm') || has(s, 'whole') || has(s, 'universal') ||
        /\b(wl|ul|iul|vul|gul)\b/.test(s)) return 'PERMANENT';
  
    // Infer from subtype tokens
    if (has(t, 'term')) return 'TERM';
    if (has(t, 'whole') || has(t, 'universal') || /\b(wl|ul|iul|vul|gul)\b/.test(t) ||
        /indexed universal|variable universal|guaranteed universal/.test(t)) return 'PERMANENT';
  
    return '';
}

function normalizePolicySubtype(input) {
    const raw = toStr(input).trim().toLowerCase();
    if (!raw) return 'OTHER';
    const s = raw.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
  
    // TERM
    if (s === 'term') return 'LEVEL_TERM';
    if ((s.includes('level') && s.includes('term')) || /\b(lv|lvl)\b/.test(s)) return 'LEVEL_TERM';
    if (s.includes('decreas') && s.includes('term')) return 'DECREASING_TERM';
    if (s.includes('renew')   && s.includes('term')) return 'RENEWABLE_TERM';
    if (s.includes('convert') && s.includes('term')) return 'CONVERTIBLE_TERM';
  
    // PERMANENT
    if (s.includes('whole') || /\bwl\b/.test(s)) return 'WHOLE_LIFE';
    if (/\biul\b/.test(s) || s.includes('indexed universal')) return 'IUL';
    if (/\bvul\b/.test(s) || s.includes('variable universal')) return 'VUL';
    if (/\bgul\b/.test(s) || s.includes('guaranteed universal') || /\bguar/.test(s)) return 'GUL';
    if (/\bul\b/.test(s)  || s.includes('universal')) return 'UL';
  
    return 'OTHER';
}


function normalizePremiumMode(input) {
  const s = toStr(input).trim().toLowerCase();
  if (!s) return undefined;
  if (s.includes('month')) return 'MONTHLY';
  if (s.includes('quarter')) return 'QUARTERLY';
  if (s.includes('semi') || s.includes('biannual') || s.includes('bi-annual')) return 'SEMI_ANNUAL';
  if (s.includes('annual') || s.includes('year')) return 'ANNUAL';
  // numeric hints (12/4/2/1 per year)
  if (s === '12' || s === '12x') return 'MONTHLY';
  if (s === '4'  || s === '4x')  return 'QUARTERLY';
  if (s === '2'  || s === '2x')  return 'SEMI_ANNUAL';
  if (s === '1'  || s === '1x')  return 'ANNUAL';
  return undefined;
}

function normalizePolicyStatus(input) {
  const s = toStr(input).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!s) return undefined;
  if (/(in[_]?force|active|current)/.test(s)) return 'IN_FORCE';
  if (/lapse/.test(s)) return 'LAPSED';
  if (/expire/.test(s)) return 'EXPIRED';
  if (/surrend/.test(s)) return 'SURRENDERED';
  if (/claim/.test(s)) return 'CLAIM_PAID';
  return undefined;
}

function parseBoolLoose(v) {
  const s = toStr(v).trim().toLowerCase();
  if (!s) return undefined;
  if (['true','t','yes','y','1'].includes(s)) return true;
  if (['false','f','no','n','0'].includes(s)) return false;
  return undefined;
}

// read first available mapped value among aliases
function getAnyMapped(row, mapping, ...keys) {
  for (const k of keys) {
    if (mapping[k] != null) return row[mapping[k]];
  }
  return undefined;
}

function extractInsuranceRow(row, mapping) {
  const get = (key) => (mapping[key] != null ? row[mapping[key]] : undefined);

  const policyNumber = toStr(get('policyNumber')).trim();
  const carrierName  = toStr(get('carrierName')).trim();

  // Accept multiple alias keys from the mapping:
  const ownerClientId   = toStr(getAnyMapped(row, mapping,
                              'ownerClientId', 'clientId', 'ownerId', 'ownerExternalId', 'OwnerClientId')).trim();
  const insuredClientId = toStr(getAnyMapped(row, mapping,
                              'insuredClientId', 'insuredId', 'insuredExternalId', 'clientIdInsured', 'InsuredClientId')).trim();

  const productName = toStr(get('productName')).trim();
  // Accept common mapping labels/aliases for Type & Subtype
    const familyIn  = getAnyMapped(row, mapping,
                      'policyFamily','policyType','type','Type','Policy Type','policy_family','policy_type');
  const subtypeIn = getAnyMapped(row, mapping,
                      'policySubtype','policySubType','subtype','SubType','Policy Subtype','Policy Sub Type',
                        'policy_subtype','productType','Product Type','Plan Type');
  const faceAmount  = parseMoneyOrNumberCell(get('faceAmount'));
  const cashValue   = parseMoneyOrNumberCell(get('cashValue'));
  const premiumAmt  = parseMoneyOrNumberCell(get('premiumAmount'));
  const premiumMode = normalizePremiumMode(get('premiumMode'));
  const status      = normalizePolicyStatus(get('status'));
  const effective   = parseDateLoose(get('effectiveDate'));
  const expiration  = parseDateLoose(get('expirationDate'));
  const hasCashVal  = parseBoolLoose(get('hasCashValue'));

  // Beneficiary
  const benClientId = toStr(getAnyMapped(row, mapping, 'beneficiaryClientId', 'beneficiaryClientID', 'benClientId')).trim();
  const benName     = toStr(get('beneficiaryName')).trim();
  const benTypeIn   = get('beneficiaryType');
  const benType     = normalizeBeneficiaryType(benTypeIn);
  const benPct      = parsePercentCell(get('beneficiaryPercentage'));
  const benRev      = parseBoolLoose(get('beneficiaryRevocable'));
  const benRel      = toStr(get('beneficiaryRelationship')).trim();
  const normalizedFamily  = normalizePolicyFamily(familyIn, subtypeIn) || undefined;
  const normalizedSubtype = subtypeIn ? normalizePolicySubtype(subtypeIn) : undefined; // ← only when provided
  
  return {
    policyNumber, carrierName,
    ownerClientId, insuredClientId,
    productName,
    policyFamily:  normalizedFamily,
    policySubtype: normalizedSubtype,
    faceAmount, cashValue, premiumAmount: premiumAmt, premiumMode, status,
    effectiveDate: effective, expirationDate: expiration, hasCashValue: hasCashVal,
    notes: toStr(get('notes')).trim(),
    ben: {
      clientId: benClientId || undefined,
      name:     benName     || undefined,
      tier:     benType ? benType.toUpperCase() : undefined,
      pct:      benPct != null ? benPct : undefined,
      revocable: benRev,
      relationship: benRel || undefined
    }
  };
}

async function findClientByExternalId(firmId, extId) {
    const sRaw = String(extId ?? '').trim();
    if (!sRaw) return null;
  
    const variants = new Set([sRaw]);
    // strip leading zeros
    const noZeros = sRaw.replace(/^0+/, '');
    if (noZeros) variants.add(noZeros);
    // strip common prefix like CID-, CID_, cid
    const noPrefix = sRaw.replace(/^cid[-_\s]*/i, '');
    if (noPrefix && noPrefix !== sRaw) {
      variants.add(noPrefix);
      variants.add(noPrefix.replace(/^0+/, ''));
    }
  
    const or = [];
    for (const v of variants) {
      or.push({ clientId: v });
      const n = Number(v);
      if (Number.isFinite(n)) or.push({ clientId: n });
    }
    return await Client.findOne({ firmId, $or: or }).lean();
  }



// For deduping "exactly identical" rows inside one file
function makeInsuranceRowKey(obj) {
  const b = obj.ben || {};
  const ident = [
    obj.policyNumber,
    (obj.carrierName || '').toLowerCase(),
    obj.ownerClientId || '',
    obj.insuredClientId || '',
    (obj.productName || '').toLowerCase(),
    obj.policyFamily || '',
    obj.policySubtype || '',
    String(obj.faceAmount ?? ''),
    String(obj.cashValue ?? ''),
    String(obj.premiumAmount ?? ''),
    obj.premiumMode || '',
    obj.effectiveDate ? String(obj.effectiveDate) : '',
    obj.expirationDate ? String(obj.expirationDate) : '',
    (obj.notes || '').toLowerCase(),
    // beneficiary identity
    (b.clientId || '').toLowerCase(),
    (b.name || '').toLowerCase(),
    b.tier || '',
    String(b.pct ?? ''),
    String(b.revocable ?? ''),
    (b.relationship || '').toLowerCase()
  ].join('|');
  return ident;
}



 function excelSerialToDate(n) {
     if (!Number.isFinite(n)) return undefined;
     // Excel 1900 date system (handles the 1900-02-29 gap by using 1899-12-30 base)
     const EPOCH_1900 = Date.UTC(1899, 11, 30);
     const ms = Math.round(n * 86400000);
     return new Date(EPOCH_1900 + ms);
   }
  
   function parseDateLoose(raw) {
     if (raw == null || raw === '') return undefined;
  
     // Excel serial (number or numeric string)
     const asNum = Number(raw);
     if (Number.isFinite(asNum) && String(raw).trim() === String(asNum)) {
       // Plausible Excel day range
       if (asNum > 59 && asNum < 700000) {
         return excelSerialToDate(asNum);
       }
     }
  
     // Try common explicit formats
     try { return parseDate(String(raw), 'MM/DD/YYYY'); } catch (_) {}
     try { return parseDate(String(raw), 'M/D/YYYY'); } catch (_) {}
     try { return parseDate(String(raw), 'YYYY-MM-DD'); } catch (_) {}
     try { return parseDate(String(raw), 'YYYY/MM/DD'); } catch (_) {}
  
     // Last-resort: let JS parse it
     const dt = new Date(raw);
     if (!Number.isNaN(dt.getTime())) return dt;
     return undefined;
   }

// ⬇️ ADD THIS
function coerceDatesForPolicy(family, effective, expiration) {
  const isGoodDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
  if (isGoodDate(effective) && isGoodDate(expiration) && expiration < effective) {
    // Don’t fail import; auto-fix:
    if (family === 'PERMANENT') {
      return { effectiveDate: effective, expirationDate: null };       // permanent policies can have no expiration
    }
    return { effectiveDate: effective, expirationDate: effective };     // TERM/OTHER: make them equal (safe, passes validator)
  }
  return { effectiveDate: effective, expirationDate: expiration };
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
  const s = toStr(input).trim();
  return s || null;
}


// ─────────────────────────────────────────────────────────────
// NEW: Import Billing from JSON payload (CSV/XLS already parsed in the UI)
// Matches the "Frontend → Backend" contract in the spec.
// ─────────────────────────────────────────────────────────────
exports.importBillingFromUpload = async (req, res) => {
  const startedAt = new Date();
  const errors = [];
  const MAX_ERRORS_TO_STORE = 50;
  const addErr = (e) => { if (errors.length < MAX_ERRORS_TO_STORE) errors.push(e); };

  // Socket helpers (so the progress container doesn't spin forever)
  const io       = req.app?.locals?.io;
  const userRoom = req.session?.user?._id;
  const safeEmit = (event, payload) => { if (io && userRoom) io.to(userRoom).emit(event, payload); };
  const emitProgress = (payload = {}) => {
    const base = {
      status: 'processing',
      totalRecords: Array.isArray(payload.rows) ? payload.rows.length : (payload.totalRecords ?? 0),
      createdRecords: 0,
      updatedRecords: 0,
      failedRecords: 0,
      duplicateRecords: 0,
      percentage: 0,
      estimatedTime: 'Calculating...',
      createdRecordsData: [],
      updatedRecordsData: [],
      failedRecordsData: [],
      duplicateRecordsData: []
    };
    safeEmit('importProgress', { ...base, ...payload });
  };
  const emitErrorAndReturn = (status, message, extra = {}) => {
    safeEmit('importError', { message });
    return res.status(status).json({ ok: false, message, ...extra });
  };

  // Normalize/adapt input
  const body          = req.body || {};
  const billingType   = String(body.billingType || '').toLowerCase();
  const mappedColumns = body.mappedColumns || {};
  const rows          = Array.isArray(body.rows) ? body.rows : [];
  const options = Object.assign({
    currency: 'USD',
    dateFormatHint: 'MM/DD/YYYY',
    dryRun: false,
    upsertStrategy: 'merge',
    duplicatePolicy: 'skip' // 'skip' | 'update' | 'error'
  }, body.options || {});

  // Initial progress ping so the UI hides the spinner
  emitProgress({ rows });

  // Validate gate
  if (!['account', 'household'].includes(billingType)) {
    return emitErrorAndReturn(400, 'billingType must be "household" or "account"');
  }

  let period;
  try {
    period = parsePeriodKey(body.billingPeriod);
  } catch (e) {
    return emitErrorAndReturn(400, e.message, { code: e.code || 'PERIOD_INVALID' });
  }

  // Required mappings
  const hasAmountCol = !!mappedColumns.amount;
  const anchorCol = billingType === 'account'
    ? (mappedColumns.externalId || mappedColumns.accountNumber || 'Account ID')
    : (mappedColumns.householdId || 'Household ID');

  if (!hasAmountCol || !anchorCol) {
    return emitErrorAndReturn(400, 'mappedColumns must include at least "amount" and anchor id (Account ID or Household ID)');
  }

  // Build accessors
  const colNameFor = (key) => mappedColumns[key] || key; // header label
  const getCell = (rowObj, logicalKey) => {
    const header = colNameFor(logicalKey);
    return Object.prototype.hasOwnProperty.call(rowObj, header) ? rowObj[header] : undefined;
  };

  // Resolve targets (cache results)
  const firmId = req.session?.user?.firmId || null;
  const cache = { accounts: new Map(), households: new Map() }; // key: anchorId
  async function resolveTarget(anchor) {
    if (billingType === 'account') {
      if (cache.accounts.has(anchor)) return cache.accounts.get(anchor);
      let doc = await Account.findOne({ firmId, accountNumber: anchor }, { _id: 1 }).lean();
      if (!doc && /^[0-9a-fA-F]{24}$/.test(anchor)) {
        doc = await Account.findOne({ _id: anchor, firmId }, { _id: 1 }).lean();
      }
      const id = doc ? String(doc._id) : null;
      cache.accounts.set(anchor, id);
      return id;
    } else {
      if (cache.households.has(anchor)) return cache.households.get(anchor);
      let doc = await Household.findOne({ firmId, userHouseholdId: anchor }, { _id: 1 }).lean();
      if (!doc) doc = await Household.findOne({ firmId, householdId: anchor }, { _id: 1 }).lean();
      if (!doc && /^[0-9a-fA-F]{24}$/.test(anchor)) {
        doc = await Household.findOne({ _id: anchor, firmId }, { _id: 1 }).lean();
      }
      const id = doc ? String(doc._id) : null;
      cache.households.set(anchor, id);
      return id;
    }
  }

  // Row dedupe + label helpers
  const seenRowKeys = new Set();
  const makeRowKey = (targetType, anchor, periodKey, amountCents, dueDateISO, desc) =>
    [targetType, anchor, periodKey, amountCents, (dueDateISO || ''), (desc || '')].join('|');
  const asLabel = (type, anchor) => (type === 'account' ? { accountNumber: anchor } : { householdId: anchor });

  // Pre-aggregate by (targetId, periodKey)
  const buckets = new Map(); // key: `${targetId}|${period.periodType}:${period.periodKey}` => { amountCents, description, label }
  const counts = { processed: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
  let duplicatesCount = 0;

  // Arrays for UI
  const createdRecordsData = [];
  const updatedRecordsData = [];
  const failedRecordsData = [];
  const duplicateRecordsData = [];

  // Validate currency
  if (options.currency && options.currency !== 'USD') {
    return emitErrorAndReturn(400, 'Only USD is supported at this time.');
  }

  // 1) Normalize each row → aggregate
  for (let i = 0; i < rows.length; i++) {
    counts.processed++;
    const r = rows[i] || {};
    try {
      const anchor = String(
        getCell(r, 'externalId') ?? getCell(r, 'accountNumber') ?? getCell(r, 'householdId') ?? ''
      ).trim();

      if (!anchor) {
        counts.failed++;
        const reason = 'Missing Account/Household ID';
        addErr({ rowIndex: i, code: 'MISSING_ANCHOR', message: reason, data: {} });
        failedRecordsData.push({ ...asLabel(billingType, 'N/A'), reason, rowIndex: i });
        continue;
      }

      let amountCents;
      try {
        amountCents = toCents(getCell(r, 'amount'), options.currency);
      } catch (e) {
        counts.failed++;
        const reason = e.message || 'Invalid amount';
        addErr({ rowIndex: i, code: e.code || 'AMOUNT_INVALID', message: reason, data: { amount: getCell(r, 'amount') } });
        failedRecordsData.push({ ...asLabel(billingType, anchor), reason, rowIndex: i });
        continue;
      }

      let due = null;
      try {
        const rawDue = getCell(r, 'dueDate');
        due = rawDue ? parseDate(rawDue, options.dateFormatHint) : null;
      } catch (e) {
        counts.failed++;
        const reason = e.message || 'Invalid dueDate';
        addErr({ rowIndex: i, code: e.code || 'DATE_INVALID', message: reason, data: { dueDate: getCell(r, 'dueDate') } });
        failedRecordsData.push({ ...asLabel(billingType, anchor), reason, rowIndex: i });
        continue;
      }

      const desc = (getCell(r, 'description') || '').toString().trim();
      const rowKey = makeRowKey(
        billingType,
        anchor,
        period.periodKey,
        amountCents,
        due ? due.toISOString().slice(0, 10) : '',
        desc
      );

      if (seenRowKeys.has(rowKey)) {
        if (options.duplicatePolicy === 'error') {
          counts.failed++;
          const reason = 'Duplicate row in batch';
          addErr({ rowIndex: i, code: 'DUPLICATE_ROW', message: reason, data: { anchor } });
          failedRecordsData.push({ ...asLabel(billingType, anchor), reason, rowIndex: i });
          continue;
        }
        if (options.duplicatePolicy === 'skip') {
          counts.skipped++;
          duplicatesCount++;
          duplicateRecordsData.push({ ...asLabel(billingType, anchor), reason: 'Duplicate row in file (skipped)', rowIndex: i });
          continue;
        }
        // 'update' → keep processing; last wins in aggregation
      } else {
        seenRowKeys.add(rowKey);
      }

      const targetId = await resolveTarget(anchor);
      if (!targetId) {
        counts.failed++;
        const reason = `${billingType} not found for anchor "${anchor}"`;
        addErr({ rowIndex: i, code: 'TARGET_NOT_FOUND', message: reason, data: { anchor } });
        failedRecordsData.push({ ...asLabel(billingType, anchor), reason, rowIndex: i });
        continue;
      }

      const bucketKey = `${targetId}|${period.periodType}:${period.periodKey}`;
      const prev = buckets.get(bucketKey);
      if (!prev) {
        buckets.set(bucketKey, {
          targetId,
          periodType: period.periodType,
          periodKey: period.periodKey,
          amountCents,
          description: desc || undefined,
          label: asLabel(billingType, anchor)
        });
      } else {
        if (options.upsertStrategy === 'merge') {
          prev.amountCents += amountCents;
        } else { // 'replace'
          prev.amountCents = amountCents;
          prev.description = desc || prev.description;
        }
      }
    } catch (e) {
      counts.failed++;
      const reason = e.message || 'Unexpected error';
      addErr({ rowIndex: i, code: 'UNEXPECTED', message: reason, data: {} });
      failedRecordsData.push({ ...asLabel(billingType, 'N/A'), reason, rowIndex: i });
    }
  }

  // Idempotency key (best-effort)
  const crypto = require('crypto'); // ensure available in this scope
  const idempotencyKey = (body.idempotencyKey && String(body.idempotencyKey)) ||
    crypto.createHash('sha1').update(JSON.stringify({
      billingType, period, rowsLen: rows.length, headers: Object.keys(mappedColumns).sort()
    })).digest('hex');

  // 2) Transactional upsert
  const session = await mongoose.startSession();
  const withRetry = async (fn) => {
    let attempts = 0;
    while (true) {
      attempts++;
      try { return await fn(); }
      catch (err) {
        const transient = err?.errorLabels?.includes('TransientTransactionError') || ['WriteConflict'].includes(err?.codeName);
        if (transient && attempts < 3) continue;
        throw err;
      }
    }
  };

  let created = 0, updated = 0;
  const doWrites = async () => {
    if (options.dryRun) return;
    await session.withTransaction(async () => {
      for (const [, v] of buckets) {
        const res = await upsertBillingItem({
          targetType: billingType,
          targetId: v.targetId,
          periodKey: { periodType: v.periodType, periodKey: v.periodKey },
          payload: {
            amountCents: v.amountCents,
            currency: options.currency || 'USD',
            description: v.description
          },
          strategy: options.upsertStrategy
        }, { session });

        if (res.action === 'created') {
          created++;
          createdRecordsData.push({ ...v.label });
        } else {
          updated++;
          updatedRecordsData.push({ ...v.label });
        }
      }
    });
  };

  try {
    await withRetry(doWrites);
  } catch (e) {
    await session.endSession();
    safeEmit('importError', { message: `Import transaction failed: ${e.message}` });
    return res.status(500).json({ ok: false, message: `Import transaction failed: ${e.message}` });
  }
  await session.endSession();

  counts.created = created;
  counts.updated = updated;

  const finishedAt = new Date();
  const reportDoc = new ImportReport({
    user: req.session?.user?._id || null,
    importType: 'Billing Import',
    billingType,
    periodType: period.periodType,
    billingPeriod: period.periodKey,
    optionsSnapshot: {
      currency: options.currency,
      dateFormatHint: options.dateFormatHint,
      dryRun: !!options.dryRun,
      upsertStrategy: options.upsertStrategy,
      duplicatePolicy: options.duplicatePolicy
    },
    idempotencyKey,
    counts,
    errorsSample: errors,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    responsePreview: {
      buckets: buckets.size,
      created, updated,
      failed: counts.failed, skipped: counts.skipped
    }
  });
  try { await reportDoc.save(); } catch (_) { /* non-fatal */ }

  // Emit final "complete" event so the UI can finish cleanly
  safeEmit('importComplete', {
    status: 'completed',
    totalRecords: rows.length,
    createdRecords: created,
    updatedRecords: updated,
    failedRecords: counts.failed,
    duplicateRecords: duplicatesCount,
    createdRecordsData,
    updatedRecordsData,
    failedRecordsData,
    duplicateRecordsData,
    importReportId: reportDoc?._id || null
  });

  const status = (counts.failed === rows.length) ? 422 : 200;
  return res.status(status).json({
    ok: status === 200,
    reportId: reportDoc?._id || null,
    counts,
    warnings: (options.dryRun ? ['Dry run: no data was written.'] : []),
    errorsSample: errors
  });
};


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
// -- Shared helper: set owners for (account|asset|liability) from "accountOwnerName"
//    Uses mapped clientId if available; otherwise falls back to the doc's existing owner(s)
async function assignOwnersFromName({ doc, Model, ownerName, firmId, rowClientId }) {
  // 1) Always persist the raw ownerName string (even if it isn't "Joint")
  // Persist only if non-empty (don’t clear existing when blank)
  if (typeof ownerName === 'string' && ownerName.trim() !== '') {
    doc.accountOwnerName = ownerName.trim();
  }
  if (!ownerName || !String(ownerName).trim()) return;

  // 2) Anchor a primary client (prefer mapped clientId, else an existing owner on the doc)
  let primary = null;
  if (rowClientId) {
    primary = await Client.findOne({ firmId, clientId: rowClientId })
                          .select('_id household')
                          .lean();
  }
  if (!primary) {
    const existingOwnerId = Array.isArray(doc.owners) && doc.owners.length
      ? doc.owners[0]
      : doc.owner;
    if (existingOwnerId) {
      primary = await Client.findById(existingOwnerId).select('_id household').lean();
    }
  }
  if (!primary || !primary._id || !primary.household) return; // can't resolve household; bail safely

  // If this model has a household field and it's empty, set it from the primary
 if (Model?.schema?.paths?.household && !doc.household) {
   doc.household = primary.household;
 }

  // 3) Resolve owners (handles "Joint" and fallback to solo)
  const owners = await resolveOwnersFromOwnerName({
    accountOwnerName: ownerName,
    primaryClientId: primary._id,
    householdId: primary.household,
    ClientModel: Client
  });

  // 4) Persist owners (and keep legacy single `owner` field in sync if present)
  doc.owners = owners;
  if (Model?.schema?.paths?.owner && owners.length) {
    doc.owner = owners[0];
  }
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
// ─────────────────────────────────────────────────────────────
// (B) If importType === 'billing', delegate to the new importer
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// (B) If importType === 'billing', delegate to the new importer
// ─────────────────────────────────────────────────────────────
else if (importType === 'billing') {
  // Map legacy (index-based) mapping into the new JSON importer’s shape.
  const amountIdx =
    mapping.amount ??
    mapping.billingAmount ??
    mapping.quarterlyBilledAmount;

  const descIdx = mapping.description ?? mapping.memo ?? mapping.note;
  const dueIdx  = mapping.dueDate ?? mapping.due;

  // Pull meta from the UI (robust to missing)
  const meta = req.body.billingMeta || {};
  const uiBillingType = String(req.body.billingType || meta.billingType || '').toLowerCase(); // 'household' | 'account' | ''
  const g  = String(meta?.period?.granularity || '').toLowerCase();
  const yy = meta?.period?.year;
  const mm = meta?.period?.month;
  const qq = meta?.period?.quarter;

  // Canonical period key: prefer explicit billingPeriod, else rebuild from meta, else fallback to asOf month
  const billingPeriod =
    req.body.billingPeriod ||
    (g === 'quarter' && yy && qq ? `${yy}-Q${qq}` :
     g === 'month'   && yy && mm ? `${yy}-${String(mm).padStart(2,'0')}` :
     g === 'year'    && yy       ? String(yy) :
     parsedAsOf.toISOString().slice(0, 7));

  // Decide anchor type: prefer the explicit UI type; else infer from mapping
  const isHousehold =
    uiBillingType === 'household' ||
    mapping.householdId != null ||
    mapping.householdExternalId != null ||
    mapping.household != null;

  // Pick the right anchor column index
  const anchorIdx = isHousehold
    ? (mapping.householdId ?? mapping.householdExternalId ?? mapping.household)
    : (mapping.externalId ?? mapping.accountNumber ?? mapping.accountId ?? mapping.account);

  if (amountIdx == null || anchorIdx == null) {
    return res.status(400).json({
      ok: false,
      message: 'Billing import requires both an Amount column and an anchor (accountNumber or householdId).'
    });
  }

  // Build row objects the new importer expects
  const rows = rawData.map(r => ({
    amount: r[amountIdx],
    [isHousehold ? 'householdId' : 'externalId']: r[anchorIdx],
    description: descIdx != null ? r[descIdx] : undefined,
    dueDate:     dueIdx  != null ? r[dueIdx]  : undefined
  }));

  // Delegate to the new JSON-based billing importer
  req.body = {
    billingType: isHousehold ? 'household' : 'account',
    billingPeriod,
    mappedColumns: isHousehold
      ? { amount: 'amount', householdId: 'householdId', description: 'description', dueDate: 'dueDate' }
      : { amount: 'amount', externalId: 'externalId', description: 'description', dueDate: 'dueDate' },
    rows,
    options: {
      currency: 'USD',
      dateFormatHint: req.body.dateFormatHint || 'MM/DD/YYYY',
      dryRun: !!req.body.dryRun,
      upsertStrategy: req.body.upsertStrategy || 'merge',
      duplicatePolicy: req.body.duplicatePolicy || 'skip'
    },
    idempotencyKey: req.body.idempotencyKey
  };

  return exports.importBillingFromUpload(req, res);
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
      loanNumber      = toStr(rowObj.accountLoanNumber).trim();

      const liabOwnerIdx = (mapping.liabilityOwnerName ?? mapping.accountOwnerName);
rowObj.accountOwnerName = (liabOwnerIdx != null && row[liabOwnerIdx] != null)
  ? String(row[liabOwnerIdx]).trim()
  : '';

  const clientIdIdx = mapping.clientId;
rowObj.clientId = (clientIdIdx != null && row[clientIdIdx] != null)
  ? String(row[clientIdIdx]).trim()
  : '';


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



      // 5) Detect changes
// 4) Snapshot + apply
const beforeSnap = snapshot(liab);
await applyLiabilityRow(liab, rowObj, req.session.user.firmId);

// 4b) NEW: assign owners based on rowObj.accountOwnerName (supports "Joint")
await assignOwnersFromName({
  doc: liab,
  Model: Liability,
  ownerName: rowObj.accountOwnerName,  // comes from rowToLiabObj (see step 3)
  firmId: req.session.user.firmId,
  rowClientId: rowObj.clientId || null
});

// 5) Detect changes (AFTER owner assignment)
const changedFields = liab
  .modifiedPaths()
  .filter(p => p !== '__v');

// 6) Save
await liab.save();

// 7) Build the record (include owner name for your report)
const record = {
  accountNumber:    liab.accountLoanNumber,
  accountOwnerName: liab.accountOwnerName || rowObj.accountOwnerName || '',
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


// ─────────────────────────────────────────────────────────────
// (B2) If importType === 'insurance', handle Insurance import
// ─────────────────────────────────────────────────────────────
else if (importType === 'insurance') {
  const io       = req.app.locals.io;
  const userRoom = req.session.user._id;
  const firmId   = req.session.user.firmId;



  // Parse the spreadsheet
  const rawData = await parseSpreadsheetFromUrl(tempFile);
  if (!rawData || rawData.length <= 1) {
    return res.status(400).json({ message: 'No data rows found.' });
  }
  rawData.shift(); // drop headers
// Determine which insurance fields were actually mapped by the user.
// We will only mutate those fields on update, to avoid wiping existing data.
const mappedSet = new Set(Object.keys(mapping || {}).filter(k => mapping[k] != null));
const isMapped = {
  family: [
    'policyFamily','policyType','type','policy_family','policy_type','Policy Type'
  ].some(k => mappedSet.has(k)),
  subtype: [
    'policySubtype','policySubType','subtype','policy_subtype','SubType','Policy Subtype','Policy Sub Type','productType','Product Type','Plan Type'
  ].some(k => mappedSet.has(k)),
  cashValue: mappedSet.has('cashValue'),
  hasCashValue: mappedSet.has('hasCashValue') // (UI may not expose this; handled if present)
};


  const totalRecords = rawData.length;

  // Progress containers
  const createdRecords   = [];
  const updatedRecords   = [];
  const failedRecords    = [];
  const duplicateRecords = [];

  // Dedupe "exact duplicates" in the file only
  const seenRowKeys = new Set();

  // Bucket rows by (policyNumber + optional carrierName)
  const policyBuckets = {}; // { [policyKey]: { rows:[rowObj...], firstIndex, lastIndex } }
  const policyKeyOf = (obj) => `${obj.policyNumber}||${(obj.carrierName || '').toLowerCase()}`;

  // Chunking for smooth progress UI
  const CHUNK_SIZE = 50;
  let processedCount = 0;
  let rollingAvgSecPerRow = 0.0;
  let totalChunks = 0;

  for (let chunkStart = 0; chunkStart < totalRecords; chunkStart += CHUNK_SIZE) {
    const chunkEnd   = Math.min(chunkStart + CHUNK_SIZE, totalRecords);
    const chunkSize  = chunkEnd - chunkStart;
    const t0 = Date.now();

    for (let i = chunkStart; i < chunkEnd; i++) {
      const row = rawData[i];
      try {
        const rowObj = extractInsuranceRow(row, mapping);

        // — Required: policyNumber present in the file —
        if (!rowObj.policyNumber) {
          failedRecords.push({
            accountNumber: 'N/A',
            policyNumber: 'N/A',
            reason: 'Missing policyNumber',
            rowIndex: i
          });
          continue;
        }

        // File-level dedupe: only skip if the row is EXACTLY identical
        const rowKey = makeInsuranceRowKey(rowObj);
        if (seenRowKeys.has(rowKey)) {
          duplicateRecords.push({
            accountNumber: rowObj.policyNumber,
            policyNumber: rowObj.policyNumber,
            reason: 'Exact duplicate row in file (skipped)',
            rowIndex: i
          });
          continue;
        }
        seenRowKeys.add(rowKey);

        // Bucket by policy key
        const key = policyKeyOf(rowObj);
        if (!policyBuckets[key]) policyBuckets[key] = { rows: [], firstIndex: i, lastIndex: i };
        policyBuckets[key].rows.push(rowObj);
        policyBuckets[key].lastIndex = i;
      } catch (err) {
        failedRecords.push({
          policyNumber: 'N/A',
          reason: err.message,
          rowIndex: i
        });
      }
      processedCount++;
    }

    // After reading a chunk of rows, try to write policies for buckets we have so far
    // To keep memory bounded, flush buckets periodically (optional). For simplicity,
    // we will flush *all* buckets at the end. Here we just emit progress.
    const t1 = Date.now();
    const secPerRow = (t1 - t0) / 1000 / chunkSize;
    totalChunks++;
    rollingAvgSecPerRow = ((rollingAvgSecPerRow * (totalChunks - 1)) + secPerRow) / totalChunks;
    const rowsLeft = totalRecords - processedCount;
    const secLeft  = Math.max(0, Math.round(rowsLeft * rollingAvgSecPerRow));
    const eta = secLeft >= 60 ? `${Math.floor(secLeft/60)}m ${secLeft%60}s` : `${secLeft}s`;
    const percentage = Math.round((processedCount / totalRecords) * 100);

    io.to(userRoom).emit('importProgress', {
      status: 'processing',
      totalRecords,
      createdRecords: createdRecords.length,
      updatedRecords: updatedRecords.length,
      failedRecords: failedRecords.length,
      duplicateRecords: duplicateRecords.length,
      percentage,
      estimatedTime: processedCount === 0 ? 'Calculating...' : `${eta} left`,
      createdRecordsData: createdRecords,
      updatedRecordsData: updatedRecords,
      failedRecordsData: failedRecords,
      duplicateRecordsData: duplicateRecords
    });
  }

  // Combine + write each policy bucket
  const keys = Object.keys(policyBuckets);
  for (let b = 0; b < keys.length; b++) {
    const key = keys[b];
    const bucket = policyBuckets[key];
    const rows = bucket.rows;

    // Aggregate header fields (last non-blank wins), aggregate beneficiaries by identity
    const agg = {
      policyNumber : rows[0].policyNumber,
      carrierName  : '',
      ownerClientId: '',
      insuredClientId: '',
      productName  : '',
      policyFamily : '',
      policySubtype: '',
      faceAmount   : undefined,
      cashValue    : undefined,
      premiumAmount: undefined,
      premiumMode  : undefined,
      status       : undefined,
      effectiveDate: undefined,
      expirationDate: undefined,
      hasCashValue : undefined,
      notes        : '',
      beneficiaries: new Map() // key = `${tier}|${clientId||nameNormalized}`, value = { tier, client?, name?, allocationPct, ... }
    };
    let sawCashValue = false;


    for (const r of rows) {
      // Header/fields (only set when value present)
      if (r.carrierName)   agg.carrierName   = r.carrierName;
      if (r.ownerClientId) agg.ownerClientId = r.ownerClientId;
      if (r.insuredClientId) agg.insuredClientId = r.insuredClientId;
      if (r.productName)   agg.productName   = r.productName;
      if (r.policySubtype) agg.policySubtype = r.policySubtype;
      if (r.policyFamily)  agg.policyFamily  = r.policyFamily;
      if (r.faceAmount != null)    agg.faceAmount    = r.faceAmount;
      if (r.cashValue != null) {
        agg.cashValue = r.cashValue; // last non-blank wins
        sawCashValue = true;         // remember at least one row had a number (0 allowed)
      }
      
      if (r.premiumAmount != null) agg.premiumAmount = r.premiumAmount;
      if (r.premiumMode)   agg.premiumMode   = r.premiumMode;
      if (r.status)        agg.status        = r.status;
      if (r.effectiveDate) agg.effectiveDate = r.effectiveDate;
      if (r.expirationDate) agg.expirationDate = r.expirationDate;
      if (r.hasCashValue !== undefined) agg.hasCashValue = r.hasCashValue;
      if (r.notes)         agg.notes = r.notes;

      // Beneficiary aggregation (only if all identity pieces are usable)
      const b = r.ben || {};
      if ((b.clientId || b.name) && b.tier && (b.pct != null)) {
        const normName = (b.name || '').trim().toLowerCase();
        const idKey = `${b.tier}|${(b.clientId || normName)}`;
        agg.beneficiaries.set(idKey, {
          tier: b.tier,
          clientId: b.clientId || undefined,
          name: b.clientId ? undefined : (b.name || undefined),
          allocationPct: b.pct,
          revocable: b.revocable,
          relationshipToInsured: b.relationship
        }); // last row wins for duplicates of same beneficiary identity
      }
    }

    // Resolve/derive required fields for creation/update
// ── IMPORTANT: only derive values from columns the user actually mapped
// and only when the mapped cell is NON-BLANK for at least one row in the bucket.
let family = undefined;

// Only set family if:
//   - a policyFamily column was mapped & provided (non-blank), or
//   - a policySubtype column was mapped & provided (non-blank) and we can infer family from it.
// NEVER default family from cash value or anything else on update.
if (isMapped.family && agg.policyFamily) {
  family = agg.policyFamily; // 'TERM' | 'PERMANENT'
} else if (isMapped.subtype && agg.policySubtype) {
  family = normalizePolicyFamily('', agg.policySubtype);
} // else leave 'family' undefined → we won't touch policy.policyFamily on update.

// Only consider a "hasCash" intent if the user mapped hasCashValue OR cashValue.
// If they didn’t map either, we do not touch hasCashValue or cashValue on update.
const hasCashByValue = (isMapped.cashValue && sawCashValue);

let hasCash = undefined;
if (isMapped.hasCashValue && agg.hasCashValue !== undefined) {
  hasCash = !!agg.hasCashValue;        // explicit user intent via mapped boolean column
} else if (hasCashByValue) {
  hasCash = true;                      // user mapped a numeric cash value (including 0)
}
// If neither column was mapped (or all cells blank), hasCash stays undefined → no change on update.

// Dates: coerce only based on values present (will be undefined if not mapped / blank)
const { effectiveDate: effFixed, expirationDate: expFixed } =
  coerceDatesForPolicy(family, agg.effectiveDate, agg.expirationDate);


    // Find existing policy by (firmId, policyNumber[, carrierName])
    let policy = await Insurance.findOne({
      firmId,
      policyNumber: agg.policyNumber,
      ...(agg.carrierName ? { carrierName: agg.carrierName } : {})
    });
    if (!policy) {
      // fallback search by policyNumber only (when carrier omitted in DB)
      policy = await Insurance.findOne({ firmId, policyNumber: agg.policyNumber });
    }

    const isCreate = !policy;

    try {
      if (isCreate) {
        // Need an owner client to create
        // Prefer explicit owner; else fall back to insured (common single-owner case):
const ownerCandidateExtId = agg.ownerClientId || agg.insuredClientId;
if (!ownerCandidateExtId) {
  failedRecords.push({
    policyNumber: agg.policyNumber || 'N/A',
    reason: 'Policy not found and no owner/insured clientId provided to create it.',
    rowIndex: bucket.firstIndex
  });
  continue;
}

const ownerDoc = await findClientByExternalId(firmId, ownerCandidateExtId);
if (!ownerDoc) {
  failedRecords.push({
    policyNumber: agg.policyNumber || 'N/A',
    reason: `Owner clientId "${ownerCandidateExtId}" not found (by string, number, or no-leading-zeros).`,
    rowIndex: bucket.firstIndex
  });
  continue;
}

// Optional insured: use provided one if it resolves; otherwise default to owner
let insuredId = ownerDoc._id;
if (agg.insuredClientId) {
  const ins = await findClientByExternalId(firmId, agg.insuredClientId);
  if (ins) insuredId = ins._id;
}

policy = new Insurance({
  firmId,
  household: ownerDoc.household || undefined,

  ownerClient: ownerDoc._id,
  insuredClient: insuredId,

  policyFamily: family,
  policySubtype: agg.policySubtype || undefined, 

  carrierName: agg.carrierName || undefined,
  policyNumber: agg.policyNumber,
  productName: agg.productName || undefined,

  status: agg.status || 'IN_FORCE',
  faceAmount: agg.faceAmount != null ? agg.faceAmount : undefined,

  hasCashValue: hasCash,
  cashValue: (hasCash
            ? (sawCashValue ? agg.cashValue /* could be 0 */ : 0 /* validator fallback */)
            : undefined),

  premiumAmount: agg.premiumAmount != null ? agg.premiumAmount : undefined,
  premiumMode: agg.premiumMode,

  effectiveDate: effFixed,
  expirationDate: expFixed,
  notes: agg.notes || undefined,

  beneficiaries: []
});

} else {
  // ─────────────────────────────────────────────
  // Update only fields that were mapped AND provided (non-blank)
  // ─────────────────────────────────────────────
  if (agg.carrierName)            policy.carrierName   = agg.carrierName;
  if (agg.productName)            policy.productName   = agg.productName;
   if (typeof family === 'string' && family.trim() !== '') {
       policy.policyFamily = family;                                         // only when non-blank
    }
  if (agg.policySubtype)          policy.policySubtype = agg.policySubtype;
  if (agg.status)                 policy.status        = agg.status;
  if (agg.faceAmount != null)     policy.faceAmount    = agg.faceAmount;
  if (agg.premiumAmount != null)  policy.premiumAmount = agg.premiumAmount;
  if (agg.premiumMode)            policy.premiumMode   = agg.premiumMode;
  if (effFixed !== undefined)     policy.effectiveDate = effFixed;
  if (expFixed !== undefined)     policy.expirationDate = expFixed;

// ─────────────────────────────────────────────
// Cash fields — NEVER clear on blank.
// Behavior:
//  • If user mapped a numeric cashValue (including 0), write it and set hasCashValue=true.
//  • Only set hasCashValue=false if the user explicitly mapped that column and set it false.
//  • Never clear existing cashValue on blanks.
// ─────────────────────────────────────────────
if (isMapped.hasCashValue || isMapped.cashValue) {
  // 1) Numeric cashValue provided → write it and ensure flag is true so UI shows it
  if (isMapped.cashValue && agg.cashValue != null) {
    policy.cashValue = agg.cashValue;              // includes explicit 0
    if (policy.hasCashValue !== true) {
      policy.hasCashValue = true;                  // promote flag when a number is supplied
    }
  }

  // 2) Apply explicit hasCashValue only if that column was mapped & provided
  if (isMapped.hasCashValue && hasCash !== undefined) {
    policy.hasCashValue = hasCash;                 // honor explicit true/false
    if (hasCash === true && policy.cashValue == null) {
      policy.cashValue = 0;                        // minimal value to satisfy validators
    }
    // NOTE: if hasCash === false and cashValue wasn't explicitly mapped,
    // do NOT clear policy.cashValue (preserve existing data).
  }
}
// else: neither column was mapped → do nothing (preserve everything)




      }

      // Merge beneficiaries (do NOT remove existing ones)
      if (agg.beneficiaries.size > 0) {
        // Build a lookup of existing beneficiaries by identity
        const existIdx = new Map(); // key `${tier}|${clientId||nameNorm}` -> index
        (policy.beneficiaries || []).forEach((b, idx) => {
          const nm = (b.name || '').trim().toLowerCase();
          const idKey = `${b.tier}|${(b.client ? String(b.client) : nm)}`;
          existIdx.set(idKey, idx);
        });

        for (const [, ben] of agg.beneficiaries) {
          // Resolve beneficiary client if provided by clientId (string external id)
          let benClientObjId = undefined;
          if (ben.clientId) {
            const c = await Client.findOne({ firmId, clientId: ben.clientId }, { _id: 1 }).lean();
            if (c) benClientObjId = c._id;
          }
          const nmNorm = (ben.name || '').trim().toLowerCase();
          const keyId  = `${ben.tier}|${(benClientObjId ? String(benClientObjId) : nmNorm)}`;

          const payload = {
            tier: ben.tier, // PRIMARY | CONTINGENT
            allocationPct: ben.allocationPct,
            revocable: ben.revocable !== undefined ? !!ben.revocable : true,
            relationshipToInsured: ben.relationshipToInsured
          };
          if (benClientObjId) payload.client = benClientObjId;
          else payload.name = ben.name || 'N/A';

          if (existIdx.has(keyId)) {
            // Update allocation/attrs
            const at = existIdx.get(keyId);
            Object.assign(policy.beneficiaries[at], payload);
          } else {
            policy.beneficiaries.push(payload);
          }
        }
      }

      // capture changed fields BEFORE saving (save() resets modifiedPaths)
      const changedFields = policy
        .modifiedPaths()
        .filter(p => !['__v','updatedAt','createdAt'].includes(p));

      // Save and report
      await policy.save();

      const display = `${policy.carrierName || 'N/A'} — ${policy.policyNumber}`;
      if (isCreate) {
         createdRecords.push({
           policyNumber: policy.policyNumber,
           carrierName:  policy.carrierName || '',
           ownerClientId: rows[0].ownerClientId || '',
           accountNumber: policy.policyNumber, // <- generic renderer expects this
           display                          // <- nice label for the UI list
         });
      } else {
         updatedRecords.push({
           policyNumber:  policy.policyNumber,
           carrierName:   policy.carrierName || '',
           updatedFields: changedFields,
           accountNumber: policy.policyNumber,
           display
         });
       }
 
          } catch (err) {
              const reason = (err && err.message) ? err.message : 'Unexpected error while creating/updating policy';
              failedRecords.push({
                accountNumber: policy.policyNumber || 'N/A',
                policyNumber: agg.policyNumber || 'N/A',
                reason,
                rowIndex: bucket.firstIndex
              });
              console.error(`[account-import] Error creating/updating insurance policy for ${agg.policyNumber}:`, err);
            }
  } // end bucket loop

  // Final socket emit


  // Persist ImportReport (consistent with your other imports)
  try {
    const report = await ImportReport.create({
      user: req.session.user._id,
      importType: 'Insurance Import',
      originalFileKey: s3Key,
     createdRecords: createdRecords.map(r => ({
       firstName: '',
       lastName:  '',
       accountNumber: r.accountNumber || r.policyNumber || '',
       carrierName:  r.carrierName || ''
     })),
     updatedRecords: updatedRecords.map(r => ({
       firstName: '',
       lastName:  '',
       accountNumber: r.accountNumber || r.policyNumber || '',
       updatedFields: Array.isArray(r.updatedFields) ? r.updatedFields : []
     })),
     failedRecords: failedRecords.map(r => ({
       firstName: 'N/A',
       lastName:  'N/A',
       reason:    r.reason || '',
       accountNumber: r.accountNumber || r.policyNumber || 'N/A'
     })),
     duplicateRecords: duplicateRecords.map(r => ({
       firstName: 'N/A',
       lastName:  'N/A',
       reason:    r.reason || '',
       accountNumber: r.accountNumber || r.policyNumber || 'N/A'
     }))
    });
    

      // Let the UI know a new report exists (same pattern as other imports)
    io.to(userRoom).emit('newImportReport', {
      _id: report._id,
      importType: report.importType,
      createdAt: report.createdAt
    });

    // Now that we have the report id, emit the final progress with it
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
      importReportId: report._id
    });



    // Optional activity log
    try {
      await logActivity(
        {
          ...(req.activityCtx || {}),
          meta: {
            ...((req.activityCtx && req.activityCtx.meta) || {}),
            path: req.originalUrl,
            extra: { importReportId: report._id, fileKey: s3Key || null }
          }
        },
        {
          entity: { type: 'ImportReport', id: report._id, display: `Insurance import • ${s3Key ? path.basename(s3Key) : ''}` },
          action: 'import',
          before: null,
          after: {
            totalRecords,
            created: createdRecords.length,
            updated: updatedRecords.length,
            failed: failedRecords.length,
            duplicates: duplicateRecords.length
          },
          diff: null
        }
      );
    } catch (actErr) { /* non-fatal */ }

    return res.json({
      message: 'Insurance import complete',
      importReportId: report._id,
      createdRecords,
      updatedRecords,
      failedRecords,
      duplicateRecords
    });
  } catch (reportErr) {
    // Non-fatal report failure
    return res.json({
      message: 'Insurance import complete (report creation failed)',
      createdRecords,
      updatedRecords,
      failedRecords,
      duplicateRecords,
      error: reportErr.message
    });
  }
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
    let rowObj;
    let assetNumber;
       try {
      rowObj      = rowToAssetObj(row, mapping);
      assetNumber = toStr(rowObj.assetNumber).trim();
      const assetOwnerIdx = (mapping.assetOwnerName ?? mapping.accountOwnerName);
      rowObj.accountOwnerName = (assetOwnerIdx != null && row[assetOwnerIdx] != null)
        ? String(row[assetOwnerIdx]).trim()
        : '';
        const clientIdIdx = mapping.clientId;
        rowObj.clientId = (clientIdIdx != null && row[clientIdIdx] != null)
          ? String(row[clientIdIdx]).trim()
          : '';
        

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

      await assignOwnersFromName({
        doc: asset,
        Model: Asset,
        ownerName: rowObj.accountOwnerName, // comes from rowToAssetObj (see step 3)
        firmId: req.session.user.firmId,
        rowClientId: rowObj.clientId || null
      });

      // 5) Detect changes
      const changedFields = asset
        .modifiedPaths()
        .filter(p => p !== '__v');

      // 6) Save
      await asset.save();

      // 7) Build the record
      const record = {
        accountNumber:    asset.assetNumber,
        accountOwnerName: asset.accountOwnerName || rowObj.accountOwnerName || '',
        updatedFields:    isCreate ? [] : changedFields
      };

      if (isCreate) created.push(record);
      else           updated.push(record);
    } catch (err) {
      failed.push({
        accountNumber:    assetNumber || 'N/A',
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
    



      // 4a) Decide whether to override existing withdrawals for this account.
  //     Rule: ONLY if the account already has withdrawals AND the file
  //     provides at least one explicit withdrawal row (amount + frequency).
  //     Blank cells do NOT count. Amount '0' DOES count (explicit override).
  const hadExistingWithdrawals =
  Array.isArray(account.systematicWithdrawals) &&
  account.systematicWithdrawals.length > 0;

// Collect incoming withdrawals from this bucket (dedup by freq+amount).
const incomingWithdrawals = [];
const seenPairs = new Set();
for (const { rowObj } of arr) {
  const freq = rowObj.systematicWithdrawFrequency; // already normalized
  const rawAmt = rowObj.systematicWithdrawAmount;

  const hasFreq = typeof freq === 'string' && freq.trim() !== '';
  const hasAmtCell =
    rawAmt !== undefined && rawAmt !== null && String(rawAmt).trim() !== '';

  if (!hasFreq || !hasAmtCell) continue;

  // Accept money-like strings, allow explicit 0
  const amtParsed = parseMoneyOrNumberCell(rawAmt);
  if (amtParsed === null) continue;

  const pairKey = `${freq}|${amtParsed}`;
  if (!seenPairs.has(pairKey)) {
    seenPairs.add(pairKey);
    incomingWithdrawals.push({ amount: amtParsed, frequency: freq });
  }
}

let didOverrideWithdrawals = false;
if (hadExistingWithdrawals && incomingWithdrawals.length > 0) {
  // Override: replace existing with exactly what's in the file
  account.systematicWithdrawals = incomingWithdrawals;
  didOverrideWithdrawals = true;
}


    // 5) Apply each row’s data
    for (const { rowObj, rawRow } of arr) {
      updateAccountFromRow(account, rowObj, rawRow, mapping);

      // Dedupe + append systematic withdrawals
// Dedupe + append systematic withdrawals (only if we did NOT override)
if (!didOverrideWithdrawals) {
  if (rowObj.systematicWithdrawAmount && rowObj.systematicWithdrawFrequency) {
    const amtParsed = parseMoneyOrNumberCell(rowObj.systematicWithdrawAmount);
if (amtParsed === null) {
  // skip malformed amounts on append to avoid NaN writes
  continue;
}
const amt = amtParsed;

    const freq = rowObj.systematicWithdrawFrequency;
    const exists = account.systematicWithdrawals.find(w =>
      w.amount === amt && w.frequency === freq
    );
    if (!exists) {
      account.systematicWithdrawals.push({ amount: amt, frequency: freq });
    }
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
