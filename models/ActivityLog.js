// models/ActivityLog.js
const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyID', index: true, required: true },

  // who did it
  actor: {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    email: String,
    name: String,
    roles: [String],
  },

  // what changed
  entity: {
    type: { type: String, required: true, enum: [
      'CompanyID','Household','Client','Account','ValueAdd','Surge','SurgeSnapshot','HouseholdSnapshot','ImportReport','Homework','Asset','Liability','Insurance','Beneficiary','Other'
    ]},
    id: { type: mongoose.Schema.Types.ObjectId, required: false }, // optional for system-wide events
    display: String // human label (e.g., "Smith Household", account nickname, etc.)
  },

  action: { type: String, required: true, enum: ['create','update','delete','run','import','snapshot','login','logout','other'] },

  // granular change set for updates (or payload summary for run/import)
  changes: {
    before: mongoose.Schema.Types.Mixed, // keep small & relevant
    after:  mongoose.Schema.Types.Mixed,
    diff:   mongoose.Schema.Types.Mixed  // normalized diff (see helper)
  },

  meta: {
    path: String,        // controller/route path
    ip: String,
    userAgent: String,
    jobId: String,       // for background jobs
    batchId: String,     // e.g. import run id, surge id
    notes: String,       // anything else
    extra: mongoose.Schema.Types.Mixed
  }
}, { timestamps: true });

activityLogSchema.index({ companyId: 1, createdAt: -1 });
activityLogSchema.index({ 'entity.type': 1, 'entity.id': 1, createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
