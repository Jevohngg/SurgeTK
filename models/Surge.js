// models/Surge.js
const mongoose = require('mongoose');
const { Schema, Types } = mongoose;

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

module.exports = mongoose.model('Surge', SurgeSchema);
