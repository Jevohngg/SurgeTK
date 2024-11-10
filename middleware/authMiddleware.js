// middleware/authMiddleware.js

function ensureAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next(); // User is authenticated, proceed
  } else {
    return res.redirect('/login'); // Redirect to login if the user is not authenticated
  }
}

function ensureAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.isAdmin) {
    return next(); // User is admin, proceed
  } else {
    return res.redirect('/login'); // Redirect to login if the user is not admin
  }
}

module.exports = {
  ensureAuthenticated,
  ensureAdmin,
};
