// models/SurgeSnapshot.js
const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

const VASnapshotSchema = new Schema({
  type:     { type: String, required: true },
  data:     { type: Schema.Types.Mixed, required: true },
  warnings: { type: [String], default: [] }
}, { _id: false });

const SurgeSnapshotSchema = new Schema({
  surgeId:           { type: Types.ObjectId, ref: 'Surge', required: true },
  household:         { type: Types.ObjectId, ref: 'Household', required: true },
  packetKey:         { type: String, required: true },
  packetSize:        { type: Number, required: true },
  preparedAt:        { type: Date,   default: Date.now },
  valueAddSnapshots: { type: [VASnapshotSchema], default: [] },
  warnings:          { type: [String], default: [] }
});

// one snapshot per surge‑household
SurgeSnapshotSchema.index({ surgeId: 1, household: 1 }, { unique: true });

module.exports = mongoose.model('SurgeSnapshot', SurgeSnapshotSchema);
