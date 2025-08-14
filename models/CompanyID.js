// models/CompanyID.js

const mongoose = require('mongoose');

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

const CompanyID = mongoose.model('CompanyID', companyIDSchema);

module.exports = CompanyID;
