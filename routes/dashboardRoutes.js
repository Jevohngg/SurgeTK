
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
    const sessionMaxAge = req.session.cookie.maxAge;
    const showWelcome = req.session.showWelcomeModal || false;


    // IMPORTANT: Await the database result
    const companyData = await CompanyID.findOne({ companyId: user.companyId });
    const isAdminAccess = user.roles.includes('admin') || user.permission === 'admin';
    const onboardingProgress = companyData.onboardingProgress || {
      uploadLogo: false,
      selectBrandColor: false,
      inviteTeam: false,
      connectCRM: false,
      importHouseholds: false,
      importAssets: false
    };

    // Clear it from the session so we don’t show it again
    req.session.showWelcomeModal = false;

    console.log('[DEBUG] user =>', user);

    // Now companyData is the actual document, not a Promise
    res.render('dashboard', {
      title: 'Dashboard',
      user,
      companyData,
      avatar: user.avatar,
      sessionMaxAge,
      showWelcomeModal: showWelcome,
      isAdminAccess,
      onboardingProgress,
      videoId: process.env.YOUTUBE_VIDEO_ID || 'DEFAULT_VIDEO_ID'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong');
  }
});


module.exports = router; 
