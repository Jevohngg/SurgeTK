// controllers/firmController.js
const CompanyID = require('../models/CompanyID');

/**
 * GET /api/firm/value-adds
 * Returns [ 'BUCKETS', 'GUARDRAILS', … ] for the current firm.
 * Front‑end uses this list to build the “Choose Value‑Adds” modal.
 */
exports.getEnabledValueAdds = async (req, res) => {
  try {
    const firmId = req.session.user?.firmId;
    if (!firmId) return res.status(403).json({ message: 'No firm in session' });

    const firm = await CompanyID.findById(firmId).lean();
    if (!firm)   return res.status(404).json({ message: 'Firm not found' });

    const enabled = [];
    // Treat missing/undefined flags as enabled (backward‑compatible default ON)
    const on = v => v === true || typeof v === 'undefined';
    if (on(firm.bucketsEnabled))     enabled.push('BUCKETS');
    if (on(firm.guardrailsEnabled))  enabled.push('GUARDRAILS');
    if (on(firm.beneficiaryEnabled)) enabled.push('BENEFICIARY');
    if (on(firm.netWorthEnabled))    enabled.push('NET_WORTH');
    if (on(firm.homeworkEnabled))    enabled.push('HOMEWORK');

    res.json(enabled);
  } catch (err) {
    console.error('[Firm] value‑adds error', err);
    res.status(500).json({ message: 'Server error' });
  }
};
