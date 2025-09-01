// models/ImportReport.js

'use strict';

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

/**
 * Legacy-compatible per-record echo used across existing import flows.
 * Extended with optional docRef/model/context to support all import types without breaking prior uses.
 */
const RecordSchema = new mongoose.Schema(
  {
    // ---- Generic context (optional, for broader support) ----
    model: { type: String, default: '' },                              // e.g., 'Client','Household','Account','Insurance','Liability','Asset','Beneficiary','Billing'
    docRef: { type: mongoose.Schema.Types.ObjectId, default: null },   // _id of the created/updated doc when available
    identifier: { type: String, default: '' },                         // any human-readable identifier we captured (e.g., householdId, ext key)
    externalKey: { type: String, default: '' },                        // CRM/custodian key if present
    meta: { type: mongoose.Schema.Types.Mixed },                       // optional, small structured context for UI

    // ---- Contact/Household-friendly fields (legacy) ----
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    updatedFields: { type: [String], default: [] },
    reason: { type: String, default: '' },

    // ---- Account/Liability/Asset-friendly fields (legacy) ----
    accountNumber: { type: String, default: '' },
    accountOwnerName: { type: String, default: '' },
    loanNumber: { type: String, default: '' },
    owners: { type: String, default: '' },
    assetNumber: { type: String, default: '' },
    assetName: { type: String, default: '' }
  },
  { _id: false }
);

/**
 * Precise change record for reliable undo.
 * Each import appends one entry per DB operation it performed, in order (opIndex asc).
 * Undo replays these in reverse order (desc).
 */
const ImportChangeSchema = new mongoose.Schema(
  {
    model: { type: String, required: true },                       // 'Client' | 'Household' | 'Account' | 'Insurance' | 'Liability' | 'Asset' | 'Beneficiary' | 'Billing' | ...
    op: { type: String, enum: ['create', 'update', 'delete'], required: true },
    opIndex: { type: Number, required: true },                     // global ordering within this import
    docId: { type: mongoose.Schema.Types.ObjectId, required: true },

    // Document snapshots
    before: mongoose.Schema.Types.Mixed,                           // present for 'update' & 'delete'
    after: mongoose.Schema.Types.Mixed,                            // present for 'create' & (optionally) 'update' (enables conflict checks)

    // Optional tiny refs to aid diagnostics / referential checks
    // (Keep light-weight; before/after hold full state)
    hints: {
      type: new mongoose.Schema(
        {
          companyId: { type: String },                             // firm guard (duplicated for safety; not required)
          parentModel: { type: String },                           // e.g., 'Household' for a Client, etc.
          parentId: { type: mongoose.Schema.Types.ObjectId }
        },
        { _id: false }
      ),
      default: undefined
    }
  },
  { _id: false }
);

/**
 * Optional event trail for undo lifecycle.
 * (Your auditPlugin will also capture changes, but this gives a concise, embedded view.)
 */
const UndoEventSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    byUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, enum: ['start', 'progress', 'done', 'failed'], required: true },
    message: { type: String, default: '' },
    progress: { type: Number, min: 0, max: 100 }
  },
  { _id: false }
);

const ImportReportSchema = new mongoose.Schema(
  {
    // ─────────────────────────────────────────────
    // Ownership & firm guardrails
    // ─────────────────────────────────────────────
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    companyId: { type: String, required: true, index: true, lowercase: true, trim: true }, // firm/tenant key (matches CompanyID.companyId)

    // ─────────────────────────────────────────────
    // High-level import classification (broad for UI/Audit readability)
    // Keep enum aligned with current UI filters; extend as needed.
    // ─────────────────────────────────────────────
    importType: {
      type: String,
      enum: [
        'Household Data Import',
        'Account Data Import',
        'Contact Data Import',
        'Liability Import',
        'Asset Import',
        'Billing Import',
        'Beneficiary Import',
        'Insurance Import'
      ],
      default: 'Household Data Import'
    },

    // Optional subtype/free-form label if you need a more granular grouping
    importSubType: { type: String, default: '' }, // e.g., "Annual Fees 2025", "Custodian XYZ Feed", etc.

    // ─────────────────────────────────────────────
    // Source descriptors (optional, non-breaking)
    // ─────────────────────────────────────────────
    source: {
      type: new mongoose.Schema(
        {
          channel: { type: String, enum: ['upload', 'api', 'integration', 'system'], default: 'upload' },
          integration: {
            provider: { type: String, default: '' },   // e.g., 'Redtail', 'Orion', 'Tamarac'
            externalBatchId: { type: String, default: '' }
          }
        },
        { _id: false }
      ),
      default: undefined
    },

    // ─────────────────────────────────────────────
    // Legacy/compatible per-row arrays used across existing import flows
    // ─────────────────────────────────────────────
    createdRecords: [RecordSchema],
    updatedRecords: [RecordSchema],
    failedRecords: [RecordSchema],
    duplicateRecords: [RecordSchema],

    // ─────────────────────────────────────────────
    // Billing-specific metadata (CSV/XLS billing import endpoint)
    // ─────────────────────────────────────────────
    billingType: { type: String, enum: ['household', 'account'], index: true }, // who was billed
    periodType: { type: String, enum: ['month', 'quarter', 'year'] },           // granularity
    billingPeriod: { type: String },                                            // normalized key: 'YYYY-MM' | 'YYYY-Q#' | 'YYYY'

    // ─────────────────────────────────────────────
    // Options & mapping snapshots (idempotency, debugging, reproducibility)
    // ─────────────────────────────────────────────
    optionsSnapshot: {
      currency: { type: String },
      dateFormatHint: { type: String },
      dryRun: { type: Boolean },
      upsertStrategy: { type: String, enum: ['merge', 'replace'] },
      duplicatePolicy: { type: String, enum: ['skip', 'update', 'error'] }
    },
    mappingSnapshot: { type: mongoose.Schema.Types.Mixed }, // column-to-field mapping as chosen in UI (optional)

    idempotencyKey: { type: String, index: true, sparse: true }, // protect against double-commit
    contentHash:   { type: String },                             // optional hash (e.g., SHA1) of normalized content

    // ─────────────────────────────────────────────
    // Summaries for UI
    // ─────────────────────────────────────────────
    counts: {
      processed: { type: Number, default: 0 },
      created:   { type: Number, default: 0 },
      updated:   { type: Number, default: 0 },
      skipped:   { type: Number, default: 0 },
      failed:    { type: Number, default: 0 }
    },

    // Row error samples (first ~50) for UI preview/troubleshooting
    errorsSample: { type: [RowErrorSchema], default: [] },

    // ─────────────────────────────────────────────
    // Timings
    // ─────────────────────────────────────────────
    startedAt:  { type: Date },
    finishedAt: { type: Date },
    durationMs: { type: Number },

    // ─────────────────────────────────────────────
    // Source file metadata (e.g., S3 key)
    // ─────────────────────────────────────────────
    originalFileKey:   { type: String }, // e.g., 's3://bucket/key' or '/tmp/...'
    originalFileName:  { type: String },
    originalMimeType:  { type: String },
    originalFileSize:  { type: Number }, // bytes

    // Optional compact echo of result data for quick inspection
    responsePreview: { type: mongoose.Schema.Types.Mixed },

    // ─────────────────────────────────────────────
    // Precise ChangeSet for reliable undo
    // ─────────────────────────────────────────────
    changes: { type: [ImportChangeSchema], default: [] },

    // ─────────────────────────────────────────────
    // Undo lifecycle & progress
    // ─────────────────────────────────────────────
    undo: {
      status: { type: String, enum: ['idle', 'running', 'done', 'failed'], default: 'idle' },
      progress: { type: Number, default: 0 }, // 0..100
      startedAt: { type: Date },
      finishedAt: { type: Date },
      error: { type: String },
      byUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      events: { type: [UndoEventSchema], default: [] } // optional embedded activity trail for UI
    },

    // Maintain compatibility with prior consumers that expect createdAt
    createdAt: { type: Date, default: Date.now }
  },
  {
    minimize: true,
    timestamps: false // we keep createdAt for compatibility; finishedAt/startedAt are explicit.
  }
);

// ─────────────────────────────────────────────
// Indexes
// ─────────────────────────────────────────────

// Enforce idempotency when a key is provided (partial unique prevents accidental double-commit)
ImportReportSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

// Fast "latest per firm" and common filters
ImportReportSchema.index({ companyId: 1, createdAt: -1 });
ImportReportSchema.index({ companyId: 1, importType: 1, createdAt: -1 });

// Optional: accelerate queries for running undos in a firm
ImportReportSchema.index({ companyId: 1, 'undo.status': 1 });

// ─────────────────────────────────────────────
// Plugins
// ─────────────────────────────────────────────
ImportReportSchema.plugin(auditPlugin, {
  entityType: 'ImportReport',
  displayFrom: (doc) =>
    `${doc.importType || 'Import'} • ${doc.createdAt ? new Date(doc.createdAt).toISOString().slice(0, 10) : ''}`
});

// ─────────────────────────────────────────────
// Model
// ─────────────────────────────────────────────
const ImportReport = mongoose.model('ImportReport', ImportReportSchema);
module.exports = ImportReport;
