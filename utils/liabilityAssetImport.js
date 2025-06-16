// utils/liabilityAssetImport.js
// ------------------------------------------------------------------
// Shared helpers for Liability & Physical‑Asset spreadsheet imports
// ------------------------------------------------------------------
const Liability = require('../models/Liability');
const Asset     = require('../models/Asset');
const Client    = require('../models/Client');

// ──────────────────────────────────────────────────────────────────
// FIELD LISTS  (front‑end mapping must use these exact keys)
// ──────────────────────────────────────────────────────────────────
exports.LIAB_FIELDS  = ['clientId','accountLoanNumber','liabilityType','creditorName',
                        'outstandingBalance','interestRate','monthlyPayment','estimatedPayoffDate'];

exports.ASSET_FIELDS = ['clientId','assetNumber','assetType','assetValue'];

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

  if (rowObj.liabilityType)      liabDoc.liabilityType   = rowObj.liabilityType;
  if (rowObj.creditorName)       liabDoc.creditorName    = rowObj.creditorName;
  if (rowObj.outstandingBalance) liabDoc.outstandingBalance = +rowObj.outstandingBalance || 0;
  if (rowObj.interestRate)       liabDoc.interestRate    = +rowObj.interestRate || 0;
  if (rowObj.monthlyPayment)     liabDoc.monthlyPayment  = +rowObj.monthlyPayment || 0;
  if (rowObj.estimatedPayoffDate) {
    const d = new Date(rowObj.estimatedPayoffDate);
    if (!Number.isNaN(d.getTime())) liabDoc.estimatedPayoffDate = d;
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
  if (rowObj.assetValue) assetDoc.assetValue = +rowObj.assetValue || 0;
};
