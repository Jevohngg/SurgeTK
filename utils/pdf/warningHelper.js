// utils/pdf/warningHelper.js

const Account   = require('../../models/Account');
const Household = require('../../models/Household');
const CompanyID = require('../../models/CompanyID');

/**
 * Returns an array of warning IDs (§4.4) for one household+surge.
 */
async function generateHouseholdWarnings({ householdId, surge }) {
  const warnings = [];

  // 1) Load household + firm
  const hh   = await Household.findById(householdId).populate('firmId');
  const firm = hh.firmId;

  // 2) Fetch all accounts for this household
  const accounts = await Account.find({ household: householdId });

  // 3) No accounts?
  if (accounts.length === 0) {
    warnings.push('NO_ACCTS');
  }

  // 4) No firm logo?
  if (!firm.companyLogo) {
    warnings.push('NO_FIRM_LOGO');
  }

  // 5) No advisor?
  if (!hh.leadAdvisors || hh.leadAdvisors.length === 0) {
    warnings.push('NO_ADVISOR');
  }

  const wantsBuckets    = surge.valueAdds.some(v => v.type === 'BUCKETS');
  const wantsGuardrails = surge.valueAdds.some(v => v.type === 'GUARDRAILS');

  // 6) Systematic withdrawals required for Buckets/Guardrails
  if (wantsBuckets || wantsGuardrails) {
    const hasSW = accounts.some(a =>
      Array.isArray(a.systematicWithdrawals) &&
      a.systematicWithdrawals.length > 0
    );
    if (!hasSW) {
      warnings.push('NO_SW');
    }
  }

  // 7) Missing allocation (only for Buckets)
  if (wantsBuckets) {
    const missingAlloc = accounts.some(a => {
      // pull the four new fields (default to 0)
      const c = Number(a.cash    || 0);
      const i = Number(a.income  || 0);
      const an= Number(a.annuities|| 0);
      const g = Number(a.growth  || 0);

      // if ALL four are zero or NaN, we consider allocation missing
      return (c === 0 && i === 0 && an === 0 && g === 0);
    });

    if (missingAlloc) {
      warnings.push('MISSING_ALLOCATION');
    }
  }

  return warnings;
}

module.exports = { generateHouseholdWarnings };
