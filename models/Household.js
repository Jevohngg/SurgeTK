// models/Household.js
// ===================
// This file defines the Household schema, now with an advisors field.
// The advisors field is an array of User references, not required by default.
// This change allows multiple advisors to be assigned to a single household.
// Ensure you have 'User' model accessible and that the User model references the correct schema.

// Note: No additional npm packages required.

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const auditPlugin = require('../plugins/auditPlugin');

// PERIOD TYPES your importer will use (UI offers rolling previous 12 months)
const BILLING_PERIOD_TYPES = ['month','quarter','year']; // Jan-2025, Q1-2025, 2025
const BILLING_TYPES = ['account','household']; // AUM commissions vs. household fees

// For values stored in the maps (month/quarter/year)
const BillingValueSchema = new mongoose.Schema({
  // What’s being stored
  amount: { type: Number, required: true, default: 0 },

  // Redundancy helps with audit + queries; UI/import will supply these
  billType: { type: String, enum: BILLING_TYPES, required: true },  // 'account' or 'household'
  periodType: { type: String, enum: BILLING_PERIOD_TYPES, required: true }, // 'month'|'quarter'|'year'
  periodKey: { type: String, required: true },  // e.g. '2025-01' | '2025-Q1' | '2025'

  // Optional metadata
  source: { type: String, default: 'import' },  // e.g. 'import', 'override'
  note: { type: String },

  // bookkeeping
  importedAt: { type: Date, default: Date.now },
}, { _id: false });

// Utility to normalize keys your importer will pass
// month: 'YYYY-MM' (e.g., '2025-01'), quarter: 'YYYY-Q#' (e.g., '2025-Q3'), year: 'YYYY'
function normalizePeriodKey(periodType, key) {
  if (periodType === 'year') return String(key).trim();
  if (periodType === 'quarter') return String(key).toUpperCase().replace(/\s+/g,'');
  if (periodType === 'month') return String(key).trim();
  return String(key).trim();
}


const householdSchema = new mongoose.Schema({
  householdId: {
    type: String,
    default: () => uuidv4(),
    unique: true,
    required: true,
  },
  userHouseholdId: {
    type: String,
    required: false,
  },
  headOfHousehold: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: false,
  },


   marginalTaxBracket: {
     type: Number,
     min: 0,
     max: 100,
     default: null
   },
  annualBilling: {
    type: Number,
    default: 0  // e.g., store a dollar amount or 0 by default
  },
  fees:{
    type: Number,
    default: 0  
  },
  totalAccountValue: {
    type: Number,
    default: 0,
  },
  firmId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CompanyID',
    required: true,
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // New advisors field: array of Users (advisors) that can manage this household.
  // Not required by default, can be empty.
  leadAdvisors: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false
    }
  ],
  servicingLeadAdvisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  writingLeadAdvisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  redtailCreated: { 
    type: Boolean, 
    default: false 
  },
  // Alternatively, store the raw Redtail ID for reference
  redtailServicingAdvisorId: { type: Number, default: null },
  redtailWritingAdvisorId: { type: Number, default: null },

  redtailFamilyId: { type: String, unique: false, sparse: true },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  totalAccountValue: { type: Number, default: 0 },
  actualMonthlyDistribution: { type: Number, default: 0 },
  accounts: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
    },
  ],
});

householdSchema.index(
  { firmId: 1, redtailFamilyId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      redtailFamilyId: { $type: 'number' }
    }
    
  }
);


// Audit plugin: logs create / update / delete for Households
// Display will show userHouseholdId or generated householdId.

householdSchema.plugin(auditPlugin, {
  entityType: 'Household',
  displayFrom: (doc) =>
    doc?.userHouseholdId ||
    doc?.householdId ||
     `Household #${doc?._id}`
});


// ───────────────────────────────────────────────────────────
// HOUSEHOLD: Fee billing storage (no estimation)
// ───────────────────────────────────────────────────────────
const householdBillingSchemaAddon = new mongoose.Schema({
  // Fees billed directly at household level (billType must be 'household')
  feeByMonth:   { type: Map, of: BillingValueSchema, default: undefined },
  feeByQuarter: { type: Map, of: BillingValueSchema, default: undefined },
  feeByYear:    { type: Map, of: BillingValueSchema, default: undefined },

  // Rollup cache: household annual = (sum child accounts annual totals) + (household fees)
  annualBillingCached: {
    total:         { type: Number, default: 0 },   // accounts + fees
    accountsPortion: { type: Number, default: 0 },
    feesPortion:   { type: Number, default: 0 },

    periodStart:   { type: Date },
    periodEnd:     { type: Date },
    computedAt:    { type: Date },
  }
}, { _id: false });

householdSchema.add({
  billing: householdBillingSchemaAddon
});

// ───────────────────────────────────────────────────────────
// HOUSEHOLD: Instance helper to set fee entry
// ───────────────────────────────────────────────────────────
householdSchema.methods.setFeeEntry = function ({ periodType, periodKey, amount, source='import', note }) {
  const billType = 'household';
  const normKey = normalizePeriodKey(periodType, periodKey);
  const payload = { billType, periodType, periodKey: normKey, amount, source, note };

  if (periodType === 'month') {
    if (!this.billing.feeByMonth) this.billing.feeByMonth = new Map();
    this.billing.feeByMonth.set(normKey, payload);
  } else if (periodType === 'quarter') {
    if (!this.billing.feeByQuarter) this.billing.feeByQuarter = new Map();
    this.billing.feeByQuarter.set(normKey, payload);
  } else if (periodType === 'year') {
    if (!this.billing.feeByYear) this.billing.feeByYear = new Map();
    this.billing.feeByYear.set(normKey, payload);
    // Year fee overrides lower granularities for that year
    const yearStr = normKey;
    if (this.billing.feeByQuarter) {
      for (const qKey of Array.from(this.billing.feeByQuarter.keys())) {
        if (qKey.startsWith(yearStr + '-Q') || qKey.startsWith(yearStr + 'Q')) {
          this.billing.feeByQuarter.delete(qKey);
        }
      }
    }
    if (this.billing.feeByMonth) {
      for (const mKey of Array.from(this.billing.feeByMonth.keys())) {
        if (mKey.startsWith(yearStr + '-')) this.billing.feeByMonth.delete(mKey);
      }
    }
  } else {
    throw new Error('Invalid periodType for Household fee');
  }
};




const Household = mongoose.model('Household', householdSchema);
module.exports = Household;
