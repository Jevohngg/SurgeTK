// models/ExportPreference.js
const mongoose = require('mongoose');

const exportPreferenceSchema = new mongoose.Schema({
  firmId:     { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyID', required: true, index: true },
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  exportType: { type: String, enum: ['accounts','contacts','insurance','liabilities','billing'], required: true },

  // UI state
  columns:    { type: [String], default: [] },
  pinned:     { type: [String], default: [] },
  order:      { type: [String], default: [] },
  widths:     { type: Object, default: {} },

  filters:    { type: Object, default: {} },
  sort:       { type: Object, default: {} },
  savedViews: [{
    name:    { type: String, required: true },
    columns: { type: [String], default: [] },
    filters: { type: Object, default: {} },
    sort:    { type: Object, default: {} },
    pinned:  { type: [String], default: [] },
    order:   { type: [String], default: [] }
  }]
}, { timestamps: true });

exportPreferenceSchema.index({ firmId: 1, user: 1, exportType: 1 }, { unique: true });
module.exports = mongoose.model('ExportPreference', exportPreferenceSchema);
