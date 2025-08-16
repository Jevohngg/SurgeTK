// middleware/requireSuperSuperAdmin.js
const { isSuperSuperAdmin } = require('../config/superAdmins');

module.exports = function requireSuperSuperAdmin(req, res, next) {
  if (!req.user || !isSuperSuperAdmin(req.user)) {
    return res.status(403).send('Forbidden');
  }
  next();
};
