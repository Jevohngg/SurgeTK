// --- controllers/clientController.js ---
const Client = require('../models/Client');

/**
 * GET /api/clients
 * Returns firm‑scoped clients.
 * Supports:
 *   ?fields=_id,firstName,lastName   (comma‑separated projection)
 *   ?q=smith                         (case‑insensitive name search)
 *   ?limit=20                        (defaults to 50)
 */
exports.listClients = async (req, res) => {
  try {
    const firmId = req.session.user.firmId;

    // ---- projection -------------------------------------------------------
    const raw      = (req.query.fields || '').split(',').map(f => f.trim()).filter(Boolean);
    const proj     = raw.length ? raw.reduce((o,f)=>(o[f]=1,o),{}) : { _id:1, firstName:1, lastName:1 };

    // ---- search / pagination ---------------------------------------------
    const q        = (req.query.q || '').trim();
    const limit    = Math.min(parseInt(req.query.limit,10)||50, 100);        // hard cap 100
    const criteria = { firmId };
    if (q) {
      criteria.$or = [
        { firstName: new RegExp(q,'i') },
        { lastName : new RegExp(q,'i') }
      ];
    }

    const clients = await Client
      .find(criteria, proj)
      .sort({ lastName:1, firstName:1 })
      .limit(limit)
      .lean();

    res.json({ clients });
  } catch (err) {
    console.error('listClients', err);
    res.status(500).json({ message:'Server error' });
  }
};
