// config/superAdmins.js
const list = (process.env.SUPER_SUPER_ADMINS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

function isSuperSuperAdmin(user) {
  if (!user || !user.email) return false;
  return list.includes(String(user.email).toLowerCase());
}

module.exports = { isSuperSuperAdmin, list };
