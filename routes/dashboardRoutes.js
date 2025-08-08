
const express = require('express');
const { ensureAuthenticated } = require('../middleware/authMiddleware'); // Import middleware if you have one
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');
const User = require('../models/User');
const CompanyID = require('../models/CompanyID'); 

const router = express.Router(); // Create a router instance

// Protected dashboard route
router.get('/dashboard', ensureAuthenticated, ensureOnboarded, async (req, res) => {
  try {
    const user = req.session.user;
    const sessionMaxAge = req.session.cookie?.maxAge;
    const showWelcome = req.session.showWelcomeModal || false;

    // Fetch company data (may be null if not found)
    const companyData = await CompanyID.findOne({ companyId: user?.companyId });

    // If we found a company name but user doesn't have one yet, copy it locally
    if (companyData?.companyName && !user.companyName) {
      user.companyName = companyData.companyName;
      // optional: persist back to session if you want it available next request
      req.session.user = user;
    }

    // Safe admin check
    const isAdminAccess =
      (Array.isArray(user?.roles) && user.roles.includes('admin')) ||
      user?.permission === 'admin';

    // ✅ Safe fallback if companyData is null or field missing
    const onboardingProgress = (companyData && companyData.onboardingProgress) ? companyData.onboardingProgress : {
      uploadLogo: false,
      selectBrandColor: false,
      inviteTeam: false,
      connectCRM: false,
      importHouseholds: false,
      importAccounts: false
    };

    // Prevent showing welcome again
    req.session.showWelcomeModal = false;

    // Render with safe values; pass an empty object if companyData is null to avoid template errors
    res.render('dashboard', {
      title: 'Dashboard',
      user,
      companyData: companyData || {},
      avatar: user?.avatar || null,
      sessionMaxAge,
      showWelcomeModal: showWelcome,
      isAdminAccess,
      onboardingProgress,
      videoId: process.env.YOUTUBE_VIDEO_ID || 'DEFAULT_VIDEO_ID'
    });
  } catch (err) {
    console.error('[dashboard] error:', err);
    res.status(500).send('Something went wrong');
  }
});



module.exports = router; 
