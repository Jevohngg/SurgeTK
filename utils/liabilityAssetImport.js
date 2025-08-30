// utils/liabilityAssetImport.js
// ------------------------------------------------------------------
// Shared helpers for Liability & Physical‑Asset spreadsheet imports
// ------------------------------------------------------------------
const Liability = require('../models/Liability');
const Asset     = require('../models/Asset');
const Client    = require('../models/Client');

const toStr = v => (v == null ? '' : String(v));
const hasVal = v => v !== undefined && v !== null && toStr(v).trim() !== '';

function parseMoney(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = toStr(raw).trim();
  if (!s) return null;
  const neg = /^\(.+\)$/.test(s);
  const cleaned = s.replace(/[,$]/g, '').replace(/^\(|\)$/g, '').replace(/^\$/,'');
  const n = Number(cleaned);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

function parsePercent(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return raw <= 1 && raw >= 0 ? raw * 100 : raw;
  const s = toStr(raw).trim();
  if (!s) return null;
  const hasPct = s.includes('%');
  const cleaned = s.replace(/[%\s]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  const val = hasPct ? n : (n <= 1 && n >= 0 ? n * 100 : n);
  return (val < 0 || val > 100) ? null : val;
}

function parseDateLoose(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === 'number') { // Excel serial date
    // Excel serial origin: 1899-12-30
    const t = Date.UTC(1899, 11, 30) + raw * 86400000;
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}


// ──────────────────────────────────────────────────────────────────
// FIELD LISTS  (front‑end mapping must use these exact keys)
// ──────────────────────────────────────────────────────────────────
exports.LIAB_FIELDS  = ['clientId','accountLoanNumber','liabilityType','creditorName', 'liabilityName',
                        'outstandingBalance','interestRate','monthlyPayment','estimatedPayoffDate'];

exports.ASSET_FIELDS = ['clientId','assetNumber','assetType','assetValue', 'assetName'];

// ──────────────────────────────────────────────────────────────────
function getVal(row, idx) {
  if (idx == null)  return null;
  const v = row[idx];
  return v === '' || v === undefined ? null : v;
}

// ------------------------------------------------------------------
// row → plain object  (mapping is column‑index map)
// ------------------------------------------------------------------
exports.rowToLiabObj = (row, mapping) => {
  const obj = {};
  for (const f of exports.LIAB_FIELDS) obj[f] = getVal(row, mapping[f]);
  return obj;
};

exports.rowToAssetObj = (row, mapping) => {
  const obj = {};
  for (const f of exports.ASSET_FIELDS) obj[f] = getVal(row, mapping[f]);
  return obj;
};

// ------------------------------------------------------------------
// Upsert helpers (mutate doc with rowObj)
// ------------------------------------------------------------------
exports.applyLiabilityRow = async (liabDoc, rowObj, firmId) => {
  // Link owners / household once
  if (rowObj.clientId) {
    const cli = await Client.findOne({ firmId, clientId: rowObj.clientId });
    if (cli) {
      liabDoc.owners    = [cli._id];
      liabDoc.household = cli.household;
    }
  }

  if (hasVal(rowObj.liabilityType))  liabDoc.liabilityType  = toStr(rowObj.liabilityType).trim();
  if (hasVal(rowObj.liabilityName))  liabDoc.liabilityName  = toStr(rowObj.liabilityName).trim();
  if (hasVal(rowObj.creditorName))   liabDoc.creditorName   = toStr(rowObj.creditorName).trim();
  
  if (rowObj.outstandingBalance !== undefined) {
    const n = parseMoney(rowObj.outstandingBalance);
    if (n !== null) liabDoc.outstandingBalance = n;
  }
  if (rowObj.interestRate !== undefined) {
    const p = parsePercent(rowObj.interestRate);
    if (p !== null) liabDoc.interestRate = p;
  }
   if (rowObj.monthlyPayment !== undefined) {
    const n = parseMoney(rowObj.monthlyPayment);
    if (n !== null) liabDoc.monthlyPayment = n;
  }
  if (rowObj.estimatedPayoffDate !== undefined) {
    const d = parseDateLoose(rowObj.estimatedPayoffDate);
    if (d) liabDoc.estimatedPayoffDate = d;
  }
};

exports.applyAssetRow = async (assetDoc, rowObj, firmId) => {
  if (rowObj.clientId) {
    const cli = await Client.findOne({ firmId, clientId: rowObj.clientId });
    if (cli) {
      assetDoc.owners    = [cli._id];
      assetDoc.household = cli.household;
    }
  }

  if (rowObj.assetType)  assetDoc.assetType = rowObj.assetType;
  if (rowObj.assetName)  assetDoc.assetName = rowObj.assetName;
  if (rowObj.assetValue) assetDoc.assetValue = +rowObj.assetValue || 0;
};
