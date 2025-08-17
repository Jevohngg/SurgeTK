// routes/activityViewRoutes.js
const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');
const User = require('../models/User');
const CompanyID = require('../models/CompanyID');
const Client = require('../models/Client');
const Household = require('../models/Household');

router.get('/activity-log', ensureAuthenticated, ensureOnboarded, async (req, res, next) => {
  try {
    const user = await User.findById(req.session.user._id);
    const firmObjectId = user.firmId;
    const firmId = firmObjectId.toString();
    const firm = await CompanyID.findById(firmId);
    const household = await Household.find({ firmId: firmObjectId });
    const clients = await Client.find({ firmId: firmObjectId });
    let companyData = null;
    if (user?.companyId) {
      companyData = await CompanyID.findOne({ companyId: user.companyId });
      if (companyData?.companyName && !user.companyName) {
        user.companyName = companyData.companyName;
      }
    }

    // We don’t need to fetch logs on the server; the page will load them via /api/activity
    res.render('activity-log', {
      title: 'Activity Log | SurgeTk',
      user,
      companyData,
      avatar: user?.avatar || null,
      isAuthenticated: true,
      household,
      clients,
      firm,
 
      
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
