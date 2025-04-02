// models/ErrorLog.js
const mongoose = require('mongoose');

const errorLogSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  username: { type: String },
  errorMessage: { type: String, required: true },
  stackTrace: { type: String },
  url: { type: String },
  method: { type: String },
  statusCode: { type: Number },
  requestBody: { type: Object },
  userAgent: { type: String },
  ipAddress: { type: String },
  severity: { 
    type: String, 
    enum: ['critical', 'warning', 'info'], 
    default: 'critical' 
  } // New field
}, {
  timestamps: true
});

module.exports = mongoose.model('ErrorLog', errorLogSchema);