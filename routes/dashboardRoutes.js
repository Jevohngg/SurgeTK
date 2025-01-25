const express = require('express');
const { ensureAuthenticated } = require('../middleware/authMiddleware'); // Import middleware if you have one
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');

const router = express.Router(); // Create a router instance

// Protected dashboard route
router.get('/dashboard', ensureAuthenticated, ensureOnboarded,(req, res) => {
  const user = req.session.user;
  const sessionMaxAge = req.session.cookie.maxAge; // Get session expiry

  res.render('dashboard', { 
    title: 'Dashboard',
    user: user,
    avatar: user.avatar,
    sessionMaxAge: sessionMaxAge 
  });
});

module.exports = router; // Export the router instance
