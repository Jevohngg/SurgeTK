const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Copy or import from a shared util to keep consistent with Client.js
function toUTCDateOnly(value) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
  }
  const dt = new Date(value);
  if (isNaN(dt.getTime())) return undefined;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

// --- Beneficiaries subdocument (embedded) ---
const beneficiarySchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: false },
  name: { type: String, trim: true, required: false },

  tier: { type: String, enum: ['PRIMARY', 'CONTINGENT'], required: true },
  allocationPct: { type: Number, min: 0.01, max: 100, required: true },
  revocable: { type: Boolean, default: true },
  relationshipToInsured: { type: String, trim: true }
}, { _id: true });

// Validators for beneficiaries array
function beneficiariesHaveIdentity(list) {
  if (!Array.isArray(list)) return true;
  return list.every(b => !!(b.client || (b.name && b.name.trim())));
}
function allocationSumsAre100(list) {
  if (!Array.isArray(list) || list.length === 0) return true;
  const sums = list.reduce((acc, b) => {
    acc[b.tier] = (acc[b.tier] || 0) + Number(b.allocationPct || 0);
    return acc;
  }, {});
  const eq100 = (x) => Math.abs((x || 0) - 100) < 0.01;
  const hasPrimary = list.some(b => b.tier === 'PRIMARY');
  const hasCont = list.some(b => b.tier === 'CONTINGENT');
  const primaryOk = !hasPrimary || eq100(sums.PRIMARY);
  const contOk = !hasCont || eq100(sums.CONTINGENT);
  return primaryOk && contOk;
}

// --- Main policy schema ---
const insuranceSchema = new mongoose.Schema({
  policyId: { type: String, default: () => uuidv4(), required: true },

  firmId: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyID', required: true },
  household: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: false },

  // Ownership & insured
  ownerClient:   { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  insuredClient: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: false },

  policyFamily:  { type: String, enum: ['TERM', 'PERMANENT'], required: true },
  policySubtype: { 
    type: String, 
    enum: ['LEVEL_TERM','DECREASING_TERM','RENEWABLE_TERM','CONVERTIBLE_TERM','WHOLE_LIFE','UL','IUL','VUL','GUL','OTHER'],
    default: 'OTHER'
  },

  // Carrier optional; policy number required
  carrierName:  { type: String, required: false, trim: true },
  policyNumber: { type: String, required: true, trim: true },
  productName:  { type: String, trim: true },

  status: { type: String, enum: ['IN_FORCE','LAPSED','EXPIRED','SURRENDERED','CLAIM_PAID'], default: 'IN_FORCE' },

  // Face amount optional
  faceAmount: { type: Number, min: 0, required: false },

  // Dates optional; still validate if both present
  effectiveDate:  { type: Date, required: false, set: toUTCDateOnly },
  expirationDate: { type: Date, set: toUTCDateOnly, default: null },

  hasCashValue: {
    type: Boolean,
    default: function () { return this.policyFamily === 'PERMANENT'; }
  },
  cashValue: {
    type: Number,
    min: 0,
    validate: {
      validator: function (v) { return !this.hasCashValue || v !== undefined && v !== null; },
      message: 'cashValue is required when hasCashValue is true.'
    }
  },

  premiumAmount: { type: Number, min: 0 },
  premiumMode:   { type: String, enum: ['ANNUAL','SEMI_ANNUAL','QUARTERLY','MONTHLY'] },

  beneficiaries: {
    type: [beneficiarySchema],
    default: [],
    validate: [
      { validator: beneficiariesHaveIdentity, message: 'Each beneficiary must have a linked client or a name.' },
      { validator: allocationSumsAre100, message: 'Primary and Contingent allocations must each sum to 100%.' }
    ]
  },

  notes: { type: String, trim: true }
}, { timestamps: true });

// Cross-field validation for dates before save
insuranceSchema.pre('validate', function (next) {
  // If both dates are present, ensure logical order
  if (this.effectiveDate && this.expirationDate && this.expirationDate < this.effectiveDate) {
    return next(new Error('expirationDate must be on/after effectiveDate.'));
  }
  // For PERMANENT, normalize expirationDate to null if unset/empty
  if (this.policyFamily === 'PERMANENT' && !this.expirationDate) {
    this.expirationDate = null;
  }
  next();
});

// Indexes
insuranceSchema.index({ firmId: 1, carrierName: 1, policyNumber: 1 }, { unique: true });
insuranceSchema.index({ firmId: 1, ownerClient: 1 });
insuranceSchema.index({ firmId: 1, insuredClient: 1 });
insuranceSchema.index({ household: 1 });

// (Optional) Audit plugin (same pattern as Client.js)
let auditPlugin = null;
try {
  auditPlugin = require('../plugins/auditPlugin');
} catch (e) { /* optional */ }
if (auditPlugin) {
  insuranceSchema.plugin(auditPlugin, {
    entityType: 'Insurance',
    displayFrom: (doc) => `${doc.carrierName || '(no carrier)'} — ${doc.policyNumber || '(no number)'}`
  });
}

module.exports = mongoose.model('Insurance', insuranceSchema);
