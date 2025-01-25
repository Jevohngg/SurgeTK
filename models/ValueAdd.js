// models/ValueAdd.js

const mongoose = require('mongoose');

/**
 * ValueAdd schema
 * - type: "GUARDRAILS" or other future Value Add types
 * - household: reference to the Household
 * - currentData: the latest computed data object
 * - history: optional array of snapshots
 */
const valueAddSchema = new mongoose.Schema({
  household: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Household',
    required: true,
  },
  type: {
    type: String,
    enum: ['GUARDRAILS','BUCKETS'],
    required: true,
  },
  currentData: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  warnings: {
    type: [String],  // an array of strings
    default: []
  },
  history: [
    {
      date: { type: Date, default: Date.now },
      data: mongoose.Schema.Types.Mixed,
    },
  ],
}, { timestamps: true });

module.exports = mongoose.model('ValueAdd', valueAddSchema);
