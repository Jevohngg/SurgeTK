// models/ImportReport.js

const mongoose = require('mongoose');
const auditPlugin = require('../plugins/auditPlugin');

/**
 * Row-level error sample (first N only) captured during imports.
 * Keeps responses compact while remaining useful for troubleshooting.
 */
const RowErrorSchema = new mongoose.Schema(
  {
    rowIndex: { type: Number, required: true },
    code: { type: String, required: true },       // e.g., MISSING_ANCHOR, AMOUNT_INVALID, DATE_INVALID, TARGET_NOT_FOUND, DUPLICATE_ROW
    message: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed }    // small snapshot/context; keep light-weight
  },
  { _id: false }
);

// A sub-schema that can hold both contact fields and account/asset/liability fields.
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

    // Fields used for account/liability/asset imports
    accountNumber: { type: String, default: '' },
    accountOwnerName: { type: String, default: '' },
    loanNumber: { type: String, default: '' },
    owners: { type: String, default: '' },
    assetNumber: { type: String, default: '' },
    assetName: { type: String, default: '' }
  },
  { _id: false } // We don't need a separate _id for each record
);

const ImportReportSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // High-level import classification (kept broad for UI/Audit readability)
  importType: {
    type: String,
    enum: [
      'Household Data Import',
      'Account Data Import',
      'Contact Data Import',
      'Liability Import',
      'Asset Import',
      'Billing Import',
      'Beneficiary Import'
    ],
    default: 'Household Data Import'
  },

  // Legacy/compatible per-row arrays used across existing import flows
  createdRecords: [RecordSchema],
  updatedRecords: [RecordSchema],
  failedRecords: [RecordSchema],
  duplicateRecords: [RecordSchema],

  // NEW: Billing-specific metadata (used by CSV/XLS billing import endpoint)
  billingType: { type: String, enum: ['household', 'account'], index: true }, // who was billed
  periodType: { type: String, enum: ['month', 'quarter', 'year'] },           // granularity
  billingPeriod: { type: String },                                            // normalized key: 'YYYY-MM' | 'YYYY-Q#' | 'YYYY'

  // Options snapshot & idempotency (for safe replays and debugging)
  optionsSnapshot: {
    currency: { type: String },
    dateFormatHint: { type: String },
    dryRun: { type: Boolean },
    upsertStrategy: { type: String, enum: ['merge', 'replace'] },
    duplicatePolicy: { type: String, enum: ['skip', 'update', 'error'] }
  },
  idempotencyKey: { type: String, index: true, sparse: true },
  contentHash: { type: String }, // optional hash (e.g., SHA1) of normalized content for reference

  // Roll-up counts for summary in UI
  counts: {
    processed: { type: Number, default: 0 },
    created: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    failed: { type: Number, default: 0 }
  },

  // Row error samples (first ~50) for UI preview/troubleshooting
  errorsSample: { type: [RowErrorSchema], default: [] },

  // Timings
  startedAt: { type: Date },
  finishedAt: { type: Date },
  durationMs: { type: Number },

  // Source file (e.g., S3 key or temp path)
  originalFileKey: {
    type: String,
    required: false
  },

  // Optional compact echo of result data for quick inspection
  responsePreview: { type: mongoose.Schema.Types.Mixed },

  // Maintain compatibility with prior consumers that expect createdAt
  createdAt: { type: Date, default: Date.now }
});

// Enforce idempotency when a key is provided (partial unique prevents accidental double-commit)
ImportReportSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

// Attach audit plugin BEFORE model compilation
ImportReportSchema.plugin(auditPlugin, {
  entityType: 'ImportReport',
  displayFrom: (doc) =>
    `${doc.importType || 'Import'} • ${doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : ''}`
});

const ImportReport = mongoose.model('ImportReport', ImportReportSchema);
module.exports = ImportReport;
