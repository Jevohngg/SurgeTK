// utils/household/nameHelper.js
const Client = require('../../models/Client');

/**
 * Returns a human‑readable household name identical to the one shown
 * in household tables (e.g. “Doe, John & Jane”).
 *
 * @param {String|ObjectId} householdId
 * @returns {Promise<String>}
 */
module.exports.getDisplayName = async function getDisplayName (householdId) {
  const clients = await Client
    .find({ household: householdId })
    .select('firstName lastName')
    .lean();

  if (!clients || clients.length === 0) return 'Unnamed_Household';

  const first = clients[0];
  const last1 = first.lastName || '';
  const first1 = first.firstName || '';

  if (clients.length === 1) {
    return `${last1}_${first1}`;
  }

  const second = clients[1];
  const last2  = second.lastName || '';
  const first2 = second.firstName || '';

  if (clients.length === 2) {
    return last2.toLowerCase() === last1.toLowerCase()
      ? `${last1}_${first1}&${first2}`
      : `${last1}_${first1}&${last2}_${first2}`;
  }

  // 3+ clients → fallback to head‑of‑household only
  return `${last1}_${first1}`;
};
