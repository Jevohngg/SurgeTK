module.exports = function ghostMode() {
    return async function (req, res, next) {
      // Default: no banner
      res.locals.ghost = null;
  
      try {
        // If we saved your true identity when ghosting, expose it here
        if (req.session && req.session._realUser) {
          req.originalUser = req.session._realUser; // your real identity
        }
  
        // Banner info
        if (req.session && req.session.ghost) {
          const g = req.session.ghost;
          res.locals.ghost = {
            firmId: g.firmId,
            firmName: g.firmName || '(unknown firm)',
            startedAt: g.startedAt
          };
        }
      } catch (err) {
        console.error('ghostMode middleware error:', err);
        // If anything goes wrong, drop banner but don't break the request
        res.locals.ghost = null;
      }
  
      next();
    };
  };
  