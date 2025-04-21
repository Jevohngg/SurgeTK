// -------------------------------------
// middleware/limitedAccessMiddleware.js
// -------------------------------------

module.exports = function limitedAccess(req, res, next) {
    // If user is not logged in, just pass through; 
    //   your existing login check might handle that separately
    if (!req.session.user) {
      return next();
    }
  
    // If limitedAccess is not set or is false, let them continue
    //   This covers normal subscribers
    if (!req.session.limitedAccess) {
      return next();
    }
  
    // If the user is an admin but has limitedAccess = true,
    //   we only allow them to see /billing-limited or /logout or e.g. /login
// Example limitedAccessMiddleware excerpt
const allowedRoutes = [
    '/billing-limited',
    '/logout',
    '/login',
    // Reuse existing /settings/billing endpoints:
    '/settings/billing',          // if you're doing GET /settings/billing
    '/settings/billing/checkout', // for subscription updates
    '/settings/billing/cancel',   // for cancel
    '/settings/billing/update-card', // for card updates
  ];
  
  
    // Check if the requested route is exactly /billing-limited or starts with it
    // or if it’s one of the allowed ones above. 
    // Adjust logic if you have sub-paths.
    const currentPath = req.path;
    const isAllowed = allowedRoutes.some(allowedPath => 
      currentPath === allowedPath || currentPath.startsWith(allowedPath)
    );
  
    if (!isAllowed) {
      // Force them to the new billing-limited page
      return res.redirect('/billing-limited');
    }
  
    next();
  };
  