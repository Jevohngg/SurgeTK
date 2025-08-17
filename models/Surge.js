// models/Surge.js
const mongoose = require('mongoose');
const { Schema, Types } = mongoose;
const auditPlugin = require('../plugins/auditPlugin');

const UploadSchema = new Schema({
  fileName:   { type: String, required: true },
  s3Key:      { type: String, required: true },
  pageCount:  { type: Number, default: null }   // populated by worker
}, { _id: true });                               // keep sub‑document _id

const ValueAddSchema = new Schema({
  type: {
    type: String,
    enum: ['BUCKETS', 'GUARDRAILS', 'BENEFICIARY', 'NET_WORTH', 'HOMEWORK'],
    required: true
  }
}, { _id: false });

const SurgeSchema = new Schema({
  firmId:    { type: Types.ObjectId, ref: 'CompanyID', index: true, required: true },
  name:      { type: String,  required: true, maxlength: 60 },
  startDate: { type: Date,    required: true },
  endDate:   { type: Date,    required: true },
  valueAdds: { type: [ValueAddSchema], default: [] },
  uploads:   { type: [UploadSchema],   default: [] },
  order:     { type: [String],         default: [] },
  createdBy: { type: Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

// Unique name per firm
SurgeSchema.index({ firmId: 1, name: 1 }, { unique: true });

// Audit logging (entity type must match ActivityLog enum)
SurgeSchema.plugin(auditPlugin, {
  entityType: 'Surge',
  displayFrom: (doc) => {
    try {
      const start = doc?.startDate ? new Date(doc.startDate).toISOString().slice(0, 10) : '';
      const end   = doc?.endDate   ? new Date(doc.endDate).toISOString().slice(0, 10) : '';
      return [doc?.name, start && end ? `(${start} → ${end})` : ''].filter(Boolean).join(' ');
    } catch {
      return doc?.name || `Surge #${doc?._id}`;
    }
  }
});

module.exports = mongoose.model('Surge', SurgeSchema);
