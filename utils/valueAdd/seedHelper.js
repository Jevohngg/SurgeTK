// utils/valueAdd/seedHelper.js

const ValueAdd   = require('../../models/ValueAdd');
const { VALUE_ADD_TYPES } = require('../constants');
const DEFAULTS   = require('./defaultShapes');

module.exports.seedValueAdds = async function seedValueAdds (opts) {
  // allow either a raw ID or an object { householdId, types }
  const householdId = typeof opts === 'object' && opts.householdId
    ? opts.householdId
    : opts;

  const types = (typeof opts === 'object' && Array.isArray(opts.types))
    ? opts.types
    : VALUE_ADD_TYPES;

  // 1) Pull the existing types for the household
  const existing = await ValueAdd.find({ household: householdId })
                                 .select('type')
                                 .lean();
  const existingTypes = new Set(existing.map(v => v.type));

  // 2) Insert any missing types in bulk
  const toInsert = types
    .filter(t => !existingTypes.has(t))
    .map(t => ({
      household:   householdId,
      type:        t,
      currentData: DEFAULTS[t] || {},
      warnings:    []
    }));

  if (toInsert.length) {
    await ValueAdd.insertMany(toInsert);
    console.log(`[SeedVA] Inserted ${toInsert.length} ValueAdd docs for ${householdId}`);
  }
};
