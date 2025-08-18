// models/CompanyID.js

const mongoose = require('mongoose');
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


const invitedUserSchema = new mongoose.Schema({
  email: String,
  // roles can be: 'admin','leadAdvisor','assistant','teamMember'
  roles: [{
    type: String,
    enum: ['admin', 'leadAdvisor', 'assistant', 'teamMember']
  }],
  // For Admin who is also an advisor
  alsoAdvisor: { type: Boolean, default: false },

  // Lead Advisor sub-permission
  leadAdvisorPermission: {
    type: String,
    enum: ['admin','all','limited','selfOnly'],
    default: 'all'
  },

  // Assistant
  assistantToLeadAdvisors: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  assistantPermission: {
    type: String,
    enum: ['admin','inherit'],
    default: 'inherit'
  },

  // Team Member
  teamMemberPermission: {
    type: String,
    enum: ['admin','viewEdit','viewOnly'],
    default: 'viewEdit'
  },

  // For backward compatibility if your old front-end references it:
  permission: {
    type: String,
    enum: ['admin','leadAdvisor','advisor','assistant','teamMember','unassigned'],
    default: 'unassigned'
  }
});

const companyIDSchema = new mongoose.Schema({
  companyId: { type: String, required: true, lowercase: true },
  companyName: { type: String, required: false },
  assignedEmail: { type: String, default: null },
  isUsed: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },

  

  invitedUsers: [ invitedUserSchema ],
  subscriptionTier: {
    type: String,
    enum: ['free', 'pro', 'enterprise'],
    default: 'free'
  },
  subscriptionStatus: {
    type: String,
    enum: ['active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'trialing', 'unpaid', 'none'],
    default: 'none'
  },
  stripeCustomerId: { type: String, default: '' },
  stripeSubscriptionId: { type: String, default: '' },
  seatsPurchased: { type: Number, default: 0 },
  paymentMethodLast4: { type: String, default: '' },
  paymentMethodBrand: { type: String, default: '' },
  nextBillDate: { type: Date, default: null },

  subscriptionInterval: { type: String, default: 'monthly' }, 
  redtail: {
    apiKey: { type: String },       // dev/prod Redtail key
    userKey: { type: String },      // returned by Redtail
    username: { type: String },
    // We remove the plain password field:
    // password: { type: String },  // (removed)
    encryptedPassword: { type: String }, // store ciphertext
    encryptionIV: { type: String },
    authTag: { type: String },
    environment: { type: String },  
    lastSync: { type: Date }
  },

  billingName: { type: String, default: '' },
  billingEmail: { type: String, default: '' },
  billingAddressLine1: { type: String, default: '' },
  billingAddressCity: { type: String, default: '' },
  billingAddressState: { type: String, default: '' },
  billingAddressPostal: { type: String, default: '' },
  billingAddressCountry: { type: String, default: '' },
  paymentMethodHolderName: { type: String, default: '' },
paymentMethodExpMonth: { type: Number, default: null },
paymentMethodExpYear: { type: Number, default: null },

  cancelAtPeriodEnd: { type: Boolean, default: false },
  companyWebsite: { type: String, default: '' },
  companyLogo: { type: String, default: '' },
  companyAddress: { type: String, default: '' },
  phoneNumber: { type: String, default: '' },
  industry: { type: String, default: '' },
  bucketsEnabled: { type: Boolean, default: true },
  bucketsTitle: { type: String, default: 'Buckets Strategy' },
  bucketsDisclaimer: {
    type: String,
    default: 'THIS BUCKETS REPORT IS NOT COMPLETE WITHOUT ALL THE ACCOMPANYING DISCLAIMERS!...'
  },
  guardrailsEnabled: { type: Boolean, default: true },
  guardrailsTitle: { type: String, default: 'Guardrails' },
  guardrailsDisclaimer: {
    type: String,
    default: 'THIS GUARDRAILS REPORT IS NOT COMPLETE WITHOUT ALL THE ACCOMPANYING DISCLAIMERS!...'
  },

// ‑‑‑‑ Buckets
bucketsAvailableRate : { type: Number, min: 0, max: 1, default: 0.054 },
bucketsUpperRate     : { type: Number, min: 0, max: 1, default: 0.060 },
bucketsLowerRate     : { type: Number, min: 0, max: 1, default: 0.048 },
// ‑‑‑‑ Guardrails
guardrailsAvailableRate : { type: Number, min: 0, max: 1, default: 0.054 },
guardrailsUpperRate     : { type: Number, min: 0, max: 1, default: 0.060 },
guardrailsLowerRate     : { type: Number, min: 0, max: 1, default: 0.048 },

// RMD LETTER
rmdLetterEnabled: { type: Boolean, default: true },
rmdLetterTitle: { type: String, default: 'RMD Letter' },
rmdLetterDisclaimer: {
  type: String,
  default: 'THIS RMD LETTER IS NOT COMPLETE WITHOUT ALL THE ACCOMPANYING DISCLAIMERS!...'
},

// Agenda
agendaEnabled: { type: Boolean, default: true },
agendaTitle: { type: String, default: 'Agenda' },
agendaDisclaimer: {
  type: String,
  default: 'THIS AGENDA IS NOT COMPLETE WITHOUT ALL THE ACCOMPANYING DISCLAIMERS!...'
},

  beneficiaryDisclaimer: {
    type: String,
    default: 'THIS BENEFICIARY REPORT IS NOT COMPLETE WITHOUT ALL THE ACCOMPANYING DISCLAIMERS!...'
  },
  beneficiaryEnabled: { type: Boolean, default: true },
  beneficiaryTitle: { type: String, default: 'Beneficiary Report' },

  netWorthDisclaimer: {
    type: String,
    default: 'THIS NET WORTH REPORT IS NOT COMPLETE WITHOUT ALL THE ACCOMPANYING DISCLAIMERS!...'
  },
  netWorthEnabled: { type: Boolean, default: true },
  netWorthTitle: { type: String, default: 'Net Worth Report' },

  homeworkEnabled:   { type: Boolean, default: true },
  homeworkTitle:     { type: String,  default: 'Homework Sheet' },
  homeworkDisclaimer:{ type: String,  default: 'THIS HOMEWORK SHEET IS NOT COMPLETE WITHOUT ALL THE ACCOMPANYING DISCLAIMERS!...' },


  companyBrandingColor: { type: String, default: '#282e38' },

  onboardingProgress: {
    // Step 1 flags (unchanged)
    uploadLogo: { type: Boolean, default: false },
    selectBrandColor: { type: Boolean, default: false },
    inviteTeam: { type: Boolean, default: false },

    // Legacy Step 2 flags (kept for backward compatibility)
    connectCRM: { type: Boolean, default: false },
    importHouseholds: { type: Boolean, default: false },
    importAssets: { type: Boolean, default: false },

    // New Step 2 flags used by the updated containers
    createHouseholds: { type: Boolean, default: false },
    createAccounts: { type: Boolean, default: false },
    assignAdvisors: { type: Boolean, default: false }
  },

  // ~~~~~~~~~~~~~~~~~~~~~~
  // NEW FIELDS (Step Two)
  // ~~~~~~~~~~~~~~~~~~~~~~
  custodian: { type: String, default: '' },
  brokerDealer: { type: Boolean, default: false },
  isRIA: { type: Boolean, default: false },          // RIA: Yes/No
  totalAUM: { type: String, default: '' },           // store as string
  totalHouseholds: { type: Number, default: 0 },
  numberOfTeamMembers: { type: Number, default: 0 },
  painPoint: { type: String, default: '' },          // "What pain point are you trying to solve?"
  successCriteria: { type: String, default: '' },     // "How do you know Surge Tech was a success?"
  areYouRunningSurges: { type: Boolean, default: false },

  cancellationFeedback: {
    
    reasons: [String],
    scheduledMeeting: Boolean,
    pricingFeedback: String,
    freeformFeedback: String,
    
  },
  finalCancellationDate: { type: Date },

  


});

companyIDSchema.plugin(auditPlugin, {
  entityType: 'CompanyID',   // ← match ActivityLog enum
  displayFrom: (doc) =>
    (doc?.companyName
      ? `${doc.companyName}${doc?.companyId ? ` (${doc.companyId})` : ''}`
      : (doc?.companyId || `Company #${doc?._id}`))
});


// ───────────────────────────────────────────────────────────
// COMPANY (Firm): rolling annual cache aggregated from households
// ───────────────────────────────────────────────────────────
const companyIDBillingCacheSchema = new mongoose.Schema({
  total: { type: Number, default: 0 },   // sum of all households' annual totals
  periodStart: { type: Date },
  periodEnd: { type: Date },
  computedAt: { type: Date },
}, { _id: false });

companyIDSchema.add({
  annualBillingCached: companyIDBillingCacheSchema
});



const CompanyID = mongoose.model('CompanyID', companyIDSchema);

module.exports = CompanyID;
