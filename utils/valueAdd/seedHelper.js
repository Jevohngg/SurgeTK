// utils/valueAdd/seedHelper.js
const ValueAdd   = require('../../models/ValueAdd');
const { VALUE_ADD_TYPES } = require('../constants');
const DEFAULTS   = require('./defaultShapes');   // NEW

/**
 * Ensure that *every* VALUE_ADD_TYPES document exists for a household.
 * Returns a Promise that resolves when all inserts (if any) are done.
 *
 * @param {String|ObjectId} householdId
 */
module.exports.seedValueAdds = async function seedValueAdds (householdId) {
  // 1) Pull the existing types for the household
  const existing = await ValueAdd.find({ household: householdId })
                                 .select('type')
                                 .lean();
  const existingTypes = new Set(existing.map(v => v.type));

  // 2) Insert any missing types in bulk
  const toInsert = VALUE_ADD_TYPES
    .filter(t => !existingTypes.has(t))
    .map(t => ({
      household:  householdId,
      type:       t,
      currentData: DEFAULTS[t] || {},   // NEW
      warnings:   []
    }));

  if (toInsert.length) {
    await ValueAdd.insertMany(toInsert);
    console.log(`[SeedVA] Inserted ${toInsert.length} ValueAdd docs for ${householdId}`);
  }
};
