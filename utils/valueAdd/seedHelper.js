// utils/valueAdd/seedHelper.js

const ValueAdd   = require('../../models/ValueAdd');
const { VALUE_ADD_TYPES } = require('../constants');
const DEFAULTS   = require('./defaultShapes');

const clone = (obj) => (obj ? JSON.parse(JSON.stringify(obj)) : {});

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
  // 2) Upsert any missing types (idempotent; safe under concurrency)
  const clone = (obj) => (obj ? JSON.parse(JSON.stringify(obj)) : {});
  const ops = types.map(t => ({
    updateOne: {
      filter: { household: householdId, type: t },
      update: {
        $setOnInsert: {
          currentData: clone(DEFAULTS[t]) || {},
          warnings: []
        }
      },
      upsert: true
    }
  }));
  await ValueAdd.bulkWrite(ops, { ordered: false });
  console.log(`[SeedVA] upserted ${types.length} ValueAdd placeholders for ${householdId}`);
};
