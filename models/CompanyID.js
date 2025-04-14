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
    enum: ['admin','advisor','assistant','teamMember','unassigned'],
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
    default: 'THIS REPORT IS NOT COMPLETE WITHOUT ALL THE ACCOMPANYING DISCLAIMERS!...'
  },
  companyBrandingColor: { type: String, default: '#282e38' },

  onboardingProgress: {
    uploadLogo: { type: Boolean, default: false },
    selectBrandColor: { type: Boolean, default: false },
    inviteTeam: { type: Boolean, default: false },
    connectCRM: { type: Boolean, default: false },
    importHouseholds: { type: Boolean, default: false },
    importAssets: { type: Boolean, default: false }
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
