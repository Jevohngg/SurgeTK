// models/ExportJob.js
const mongoose = require('mongoose');

const exportJobSchema = new mongoose.Schema({
  firmId: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyID', required: true, index: true },
  user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  exportType: { type: String, enum: ['accounts','contacts','insurance','liabilities','billing'], required: true },
  scope:      { type: String, enum: ['all','selected'], required: true },

  // Snapshot of the configuration used to produce the file
  format:      { type: String, enum: ['csv','xlsx'], required: true },
  options:     { type: Object, default: {} },       // delimiter, includeHeaders, timezone, dateFormat
  columns:     { type: [String], default: [] },     // column keys chosen by user
  filters:     { type: Object, default: {} },       // normalized filter payload
  sort:        { type: Object, default: {} },
  selectedIds: { type: [String], default: [] },     // only when scope === 'selected'

  // Progress
  status:      { type: String, enum: ['queued','running','complete','failed'], default: 'queued', index: true },
  rowCount:    { type: Number, default: 0 },
  bytes:       { type: Number, default: 0 },
  error:       { type: String, default: '' },

  // File
  filePath:    { type: String, default: '' },
  fileName:    { type: String, default: '' },

  // Timestamps
  startedAt:   { type: Date },
  completedAt: { type: Date }
}, { timestamps: true });

exportJobSchema.index({ firmId: 1, createdAt: -1 });

module.exports = mongoose.model('ExportJob', exportJobSchema);
