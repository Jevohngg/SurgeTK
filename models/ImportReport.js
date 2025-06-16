// models/ImportReport.js

const mongoose = require('mongoose');

// A sub-schema that can hold both contact fields and account fields.
// This lets you store data for EITHER type of import in a single schema.
const RecordSchema = new mongoose.Schema(
  {
    // Fields used for contact imports
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    updatedFields: {
      type: [String],
      default: []
    },
    reason: { type: String, default: '' },

    // Fields used for account imports
    accountNumber: { type: String, default: '' },
    accountOwnerName: { type: String, default: '' },
    loanNumber     : { type: String, default: '' },
    owners         : { type: String, default: '' },
    assetNumber    : { type: String, default: '' },
    assetName      : { type: String, default: '' }

  },
  { _id: false } // We don't need a separate _id for each record
);

const ImportReportSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  importType: {
    type: String,
    enum: [
      'Household Data Import',
      'Account Data Import',
      'Contact Data Import',
      'Liability Import',
      'Asset Import'
    ],
    default: 'Household Data Import'
  },
  createdRecords: [RecordSchema],
  updatedRecords: [RecordSchema],
  failedRecords: [RecordSchema],
  duplicateRecords: [RecordSchema],
  originalFileKey: {
    type: String,
    required: false
  },
  createdAt: { type: Date, default: Date.now }
});

const ImportReport = mongoose.model('ImportReport', ImportReportSchema);
module.exports = ImportReport;
