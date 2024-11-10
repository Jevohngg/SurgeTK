// middleware/authMiddleware.js
function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
      return next(); // User is authenticated, proceed
    } else {
      return res.redirect('/login'); // Redirect to login if the user is not authenticated
    }
  }
  
  module.exports = {
    ensureAuthenticated
  };
  