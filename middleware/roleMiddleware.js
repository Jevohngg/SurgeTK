// middleware/roleMiddleware.js

// Ensure this file is placed at: middleware/roleMiddleware.js
// Usage:
// const { ensureSuperAdmin, ensureRole } = require('../middleware/roleMiddleware');
// router.get('/some-route', ensureSuperAdmin, (req, res) => { ... });
// router.get('/advisor-only', ensureRole('advisor'), (req, res) => { ... });

module.exports.ensureAdmin = function (req, res, next) {
    if (!req.session.user || req.session.user.role !== 'admin') {
      return res.status(403).send('Forbidden: Super Admin role required.');
    }
    next();
  };

  
  
  module.exports.ensureRole = function (requiredRole) {
    return function (req, res, next) {
      if (!req.session.user || req.session.user.role !== requiredRole) {
        return res.status(403).send(`Forbidden: ${requiredRole} role required.`);
      }
      next();
    };
  };
  
