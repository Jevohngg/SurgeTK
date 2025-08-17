// middleware/activityContext.js
const mongoose = require('mongoose');
const CompanyID = require('../models/CompanyID');

function looksLikeObjectId(v) { return typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v); }

module.exports = function activityContext() {
  return async (req, _res, next) => {
    try {
      const real   = req.originalUser || req.user || req.session?.user || null;
      const acting = req.user || req.session?.user || null;

      // Accept either companyId (string code) OR firmId (ObjectId) from session,
      // plus any firm attached on req.company.
      let cid =
        acting?.firmId ||
        real?.firmId ||
        acting?.companyId ||
        real?.companyId ||
        req.company?._id ||
        null;

      let firmObjectId = null;
      if (cid?.toHexString) {
        firmObjectId = cid; // already an ObjectId
      } else if (looksLikeObjectId(cid)) {
        firmObjectId = new mongoose.Types.ObjectId(cid);
      } else if (typeof cid === 'object' && cid?._id) {
        firmObjectId = cid._id;
      } else if (typeof cid === 'string' && cid.trim()) {
        // companyId short code → resolve to ObjectId
        const firm = await CompanyID.findOne({ companyId: cid.toLowerCase() })
          .select('_id')
          .lean();
        firmObjectId = firm?._id || null;
      }

      req.activityCtx = {
        // 🔑 Provide BOTH names so any consumer (logger/UI) works.
        firmId   : firmObjectId,
        companyId: firmObjectId,

        actor: real
          ? {
              _id  : real._id,
              email: real.email,
              name : [real.firstName, real.lastName].filter(Boolean).join(' ') || real.name || '',
              roles: real.roles || []
            }
          : { _id: null, email: 'system@surgetk', name: 'System', roles: [] },

        meta: {
          path       : req.originalUrl,
          ip         : req.ip,
          userAgent  : req.headers['user-agent'] || '',
          impersonating:
            req.originalUser &&
            acting &&
            String(acting._id) !== String(req.originalUser._id)
              ? {
                  _id  : acting._id,
                  email: acting.email,
                  name : [acting.firstName, acting.lastName].filter(Boolean).join(' ') || acting.name || ''
                }
              : null
        }
      };
    } catch (e) {
      console.error('[activityContext] resolve error:', e?.message);
      req.activityCtx = {
        firmId: null, companyId: null,
        actor: { _id: null, email: 'unknown', name: 'Unknown' },
        meta : {}
      };
    }
    next();
  };
};
