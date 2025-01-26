// middleware/roleMiddleware.js


module.exports.ensureAdmin = function (req, res, next) {
  const user = req.session.user;

  // If there's no user in session
  if (!user) {
    return res.status(401).json({ message: 'Unauthorized: No user session found.' });
  }

  // Check if user is admin by role OR admin permission
  const hasAdminAccess =
    user.role === 'admin' ||
    (user.permissions && user.permissions.admin === true);

  if (!hasAdminAccess) {
    // Return JSON so front-end doesn't choke on plain text
    return res.status(403).json({ message: 'Forbidden: Admin access required.' });
  }

  // Otherwise, user is allowed
  next();
};

module.exports.ensureRole = function (requiredRole) {
  return function (req, res, next) {
    const user = req.session.user;

    if (!user) {
      return res.status(401).json({ message: 'Unauthorized: No user session found.' });
    }

    // Simple role check (does not consider permissions)
    if (user.role !== requiredRole) {
      return res.status(403).json({ message: `Forbidden: ${requiredRole} role required.` });
    }

    next();
  };
};
