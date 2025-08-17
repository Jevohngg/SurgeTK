// utils/resolveOwners.js
// Centralized logic to turn accountOwnerName (incl. "Joint") into a list of owner ids

/**
 * @param {Object} args
 * @param {String} args.accountOwnerName - Raw text from import ("Joint" or a name)
 * @param {String|ObjectId} args.primaryClientId - The "main" client for the row being imported
 * @param {String|ObjectId} args.householdId - Household id from the primary client
 * @param {Model} args.ClientModel - Your Client mongoose model (pass in to avoid path issues)
 * @returns {Promise<Array<ObjectId>>} - owners array (one or two ids)
 */
// utils/resolveOwners.js
async function resolveOwnersFromOwnerName({ accountOwnerName, primaryClientId, householdId, ClientModel }) {
    const solo = [primaryClientId].filter(Boolean);
    if (!primaryClientId) return [];               // nothing to anchor
    if (!accountOwnerName) return solo;
  
    const val = String(accountOwnerName).trim().toLowerCase();
    if (val !== 'joint') return solo;
  
    if (!householdId) return solo;
  
    const others = await ClientModel
      .find({ household: householdId, _id: { $ne: primaryClientId } })
      .select('_id relationship role')             // ok if these fields don't exist
      .lean();
  
    if (!others || others.length === 0) return solo;
  
    // Prefer “spouse/partner” if your model has that metadata; otherwise use the first
    const spouse = others.find(o => /spouse|partner/i.test(String(o.relationship || o.role || '')));
    if (spouse) return [primaryClientId, spouse._id];
  
    // If exactly one, use it; if many, pick the first deterministically.
    return [primaryClientId, others[0]._id];
  }
  
  module.exports = { resolveOwnersFromOwnerName };
  
  