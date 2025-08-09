// utils/valueAdd/updateBeneficiaryValueAdd.js

const ValueAdd   = require('../../models/ValueAdd');
const Household  = require('../../models/Household');

/** Re‑build currentData + warnings for a single Beneficiary VA */
module.exports = async function updateBeneficiaryValueAdd (vaId) {
  const va = await ValueAdd.findById(vaId).populate('household');
  if (!va || va.type !== 'BENEFICIARY') return;

  const hh = va.household;

  // --- build the table rows ------------------------------------------------
  const rows = [];
  for (const acct of hh.accounts) {
    for (const ben of acct.beneficiaries || []) {
      rows.push({
        accountNumber : acct.accountNumber,
        ownerName     : acct.accountOwnerName,
        beneficiary   : ben.name,
        relationship  : ben.relationship,
        percentage    : `${ben.share}%`
      });
    }
  }

  // --- persist the snapshot ------------------------------------------------
  va.currentData = { rows };
  va.warnings    = rows.length ? [] : ['No beneficiaries on file'];
  await va.save();
  return va;
};
