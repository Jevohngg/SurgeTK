// services/exports/permissionScope.js
const Household = require('../../models/Household');

async function baseFirm(req) {
  const CompanyID = require('../../models/CompanyID');
  const company = await CompanyID
    .findOne({ companyId: req.session.user.companyId.toLowerCase() })
    .select('_id companyName');
  if (!company) throw new Error('Firm not found for user');
  return company;
}

/**
 * Firm-wide access for exports.
 * All users within a firm can export all firm data (no advisor/household scoping).
 *
 * @returns {Object} { firm, mode: 'all', householdIds: [] }
 */
async function resolveScope(req, exportType, leadAdvisorId = null) {
  const firm = await baseFirm(req);
  return { firm, mode: 'all', householdIds: [] };
}

module.exports = { resolveScope };
