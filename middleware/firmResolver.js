// middleware/firmResolver.js
const CompanyID = require('../models/CompanyID');

/**
 * Resolve firm consistently:
 * 1) Try by req.session.user.firmId
 * 2) Fallback to req.session.user.companyId (short code)
 * Returns: firm document or null
 */
async function resolveFirm(req) {
  const u = req.session?.user || {};
  let firm = null;

  if (u.firmId) {
    try { firm = await CompanyID.findById(u.firmId); } catch (_) {}
  }
  if (!firm && u.companyId) {
    firm = await CompanyID.findOne({ companyId: u.companyId });
  }
  return firm;
}

module.exports = { resolveFirm };
