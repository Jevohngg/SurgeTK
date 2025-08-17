// routes/apiActivityRoutes.js
const express = require('express');
const router = express.Router();
const ActivityLog = require('../models/ActivityLog');
const CompanyID = require('../models/CompanyID');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');

async function resolveFirmObjectId(companyIdFromCtx) {
  // If it's an ObjectId-like value, keep it
  if (companyIdFromCtx && typeof companyIdFromCtx === 'object') return companyIdFromCtx;
  // If it's a 24-char hex string, try casting
  if (typeof companyIdFromCtx === 'string' && /^[a-f0-9]{24}$/i.test(companyIdFromCtx)) return companyIdFromCtx;
  // Otherwise, treat it as your human/company code (e.g. "abc123") and look up the CompanyID doc
  if (typeof companyIdFromCtx === 'string' && companyIdFromCtx.trim()) {
    const firm = await CompanyID.findOne({ companyId: companyIdFromCtx.toLowerCase() }, { _id: 1 }).lean();
    return firm?._id || null;
  }
  return null;
}

// GET /api/activity
router.get('/activity', ensureAuthenticated, ensureOnboarded, async (req, res) => {
  try {
    const firmObjectId = await resolveFirmObjectId(req.activityCtx?.companyId);
    if (!firmObjectId) {
      return res.status(200).json({ success: true, items: [], total: 0, page: 1, pages: 0 });
    }

    const {
      page = 1,
      limit = 25,
      entityType,
      action,
      actorEmail,
      q,
      dateFrom,
      dateTo
    } = req.query;

    const find = { companyId: firmObjectId };

    if (entityType) find['entity.type'] = String(entityType);
    if (action) find.action = String(action);
    if (actorEmail) find['actor.email'] = new RegExp(String(actorEmail), 'i');

    if (q) {
      const rx = new RegExp(String(q), 'i');
      find.$or = [
        { 'entity.display': rx },
        { 'meta.notes': rx },
        { 'actor.email': rx }
      ];
    }

    if (dateFrom || dateTo) {
      find.createdAt = {};
      if (dateFrom) {
        const d = new Date(dateFrom);
        if (!Number.isNaN(d.getTime())) find.createdAt.$gte = d;
      }
      if (dateTo) {
        const d = new Date(dateTo);
        if (!Number.isNaN(d.getTime())) {
          d.setHours(23, 59, 59, 999);
          find.createdAt.$lte = d;
        }
      }
      if (Object.keys(find.createdAt).length === 0) delete find.createdAt;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      ActivityLog.find(find).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      ActivityLog.countDocuments(find)
    ]);

    return res.json({
      success: true,
      items,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit))
    });
  } catch (err) {
    console.error('[GET /api/activity] error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load activity.' });
  }
});

// GET /api/activity/:id
router.get('/activity/:id', ensureAuthenticated, ensureOnboarded, async (req, res) => {
  try {
    const firmObjectId = await resolveFirmObjectId(req.activityCtx?.companyId);
    if (!firmObjectId) return res.status(404).json({ success: false, message: 'Not found' });

    const { id } = req.params;
    const log = await ActivityLog.findOne({ _id: id, companyId: firmObjectId }).lean();
    if (!log) return res.status(404).json({ success: false, message: 'Not found' });

    return res.json({ success: true, item: log });
  } catch (err) {
    console.error('[GET /api/activity/:id] error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load activity item.' });
  }
});

module.exports = router;
