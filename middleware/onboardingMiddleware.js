// middleware/onboardingMiddleware.js

function ensureOnboarded(req, res, next) {
    // 1. Must be authenticated first
    if (!req.session.user) {
      return res.redirect('/login');
    }
  
    // 2. Check if user has a firmId
    // If firmId is missing, the user hasn't joined or created a firm => must go to onboarding
    if (!req.session.user.firmId) {
      return res.redirect('/onboarding');
    }
  
    // 3. Otherwise, user is onboarded
    next();
  }
  
  module.exports = { ensureOnboarded };
  