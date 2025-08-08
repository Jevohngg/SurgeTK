// middleware/sessionHydrator.js
const { resolveFirm } = require('./firmResolver');

module.exports = async function sessionHydrator(req, res, next) {
  try {
    if (!req.session?.user) return next();
    const u = req.session.user;

    // Only hydrate if missing basics but we have some key to find firm
    const needsCompanyBits = !u.companyId || !u.companyName;
    const hasLookupKey = u.firmId || u.companyId;

    if (needsCompanyBits && hasLookupKey) {
      const firm = await resolveFirm(req);
      if (firm) {
        // Only write truthy values, never empty strings
        if (firm.companyId) u.companyId = firm.companyId;
        if (firm.companyName) u.companyName = firm.companyName;
        req.session.user = u;
      }
    }
  } catch (e) {
    console.error('[sessionHydrator] failed:', e);
    // swallow — we don’t want to break the request
  }
  next();
};
