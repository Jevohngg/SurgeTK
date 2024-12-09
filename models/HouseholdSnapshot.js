const mongoose = require('mongoose');

const householdSnapshotSchema = new mongoose.Schema({
  household: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
  year: { type: Number, required: true },
  month: { type: Number, required: true }, // 0-based month (0 = Jan, 11 = Dec)
  netWorth: { type: Number, default: 0 },
}, { timestamps: true });

// Ensure uniqueness for each household-year-month combo
householdSnapshotSchema.index({ household: 1, year: 1, month: 1 }, { unique: true });

const HouseholdSnapshot = mongoose.model('HouseholdSnapshot', householdSnapshotSchema);
module.exports = HouseholdSnapshot;
