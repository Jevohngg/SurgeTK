// controllers/importEligibilityController.js
const CompanyID = require('../models/CompanyID');
const Client    = require('../models/Client');
const Household = require('../models/Household');
const Account   = require('../models/Account');

/**
 * GET /api/import/eligibility
 * Returns flags the front‑end needs to enable/disable import cards.
 */
exports.getEligibility = async (req, res) => {
  try {
    const firmId = req.session?.user?.firmId;
    if (!firmId) return res.status(401).json({ message: 'Not authenticated' });

    // ── 1.  Company‑level data
    const company = await CompanyID.findById(firmId, 'redtail').lean();
    const hasRedtail =
      company?.redtail &&
      Object.values(company.redtail).some(v => v !== null && v !== '');

    // ── 2.  Aggregates (cheap counts; use lean() for perf)
    const [clientCount, householdCount, accountCount] = await Promise.all([
      Client.countDocuments({ firmId }),
      Household.countDocuments({ firmId }),
      Account.countDocuments({ firmId }),
    ]);

    res.json({
      // first‑screen flags
      canImportClients : !hasRedtail,
      canImportAccounts: clientCount > 0 || householdCount > 0,

      // second‑screen (account‑options page) flags
      hasAnyAccounts   : accountCount > 0,

      // for completeness if you want totals later
      meta: { clientCount, householdCount, accountCount, hasRedtail }
    });
  } catch (err) {
    console.error('Eligibility error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};
