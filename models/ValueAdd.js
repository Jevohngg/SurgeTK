// models/ValueAdd.js

const mongoose = require('mongoose');

const valueAddSchema = new mongoose.Schema({
  household: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Household',
    required: true,
  },
  type: {
    type: String,
    enum: ['GUARDRAILS','BUCKETS', 'BENEFICIARY', 'NET_WORTH', 'HOMEWORK'],
    required: true,
  },
  currentData: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  warnings: {
    type: [String],
    default: []
  },
  history: [
    {
      date: { type: Date, default: Date.now },
      data: mongoose.Schema.Types.Mixed,
    },
  ],
  // NEW FIELD
  snapshots: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
      timestamp: { type: Date, default: Date.now },
      notes:    { type: String, default: '' }, // NEW FIELD
      snapshotData: mongoose.Schema.Types.Mixed,
    }
  ],

}, { timestamps: true });

valueAddSchema.index({ household: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('ValueAdd', valueAddSchema);
