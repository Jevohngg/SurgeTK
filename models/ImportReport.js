// models/ImportReport.js

const mongoose = require('mongoose');

const ImportReportSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    importType: { type: String, enum: ['Household Data Import'], default: 'Household Data Import' },
    createdRecords: [{ firstName: String, lastName: String }],
    updatedRecords: [{
        firstName: String,
        lastName: String,
        updatedFields: [String]
    }],
    failedRecords: [{
        firstName: String,
        lastName: String,
        reason: String
    }],
    duplicateRecords: [{
        firstName: String,
        lastName: String,
        reason: String
    }],
    originalFileKey: { type: String, required: true }, // New field to store S3 file key
    createdAt: { type: Date, default: Date.now }
});

const ImportReport = mongoose.model('ImportReport', ImportReportSchema);
module.exports = ImportReport;
