// models/CompanyID.js

const mongoose = require('mongoose');

const companyIDSchema = new mongoose.Schema({
  companyId: { type: String, required: true, lowercase: true },
  companyName: { type: String, required: false },
  assignedEmail: { type: String, default: null },
  isUsed: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  invitedUsers: [{
    email: String,
    roles: [{
      type: String,
      enum: ['admin', 'advisor', 'assistant']
    }],
    permission: {
      type: String,
      enum: ['admin', 'advisor', 'assistant'],
      default: 'assistant'
    }
  }],
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
  billingName: { type: String, default: '' },
  billingEmail: { type: String, default: '' },
  billingAddressLine1: { type: String, default: '' },
  billingAddressCity: { type: String, default: '' },
  billingAddressState: { type: String, default: '' },
  billingAddressPostal: { type: String, default: '' },
  billingAddressCountry: { type: String, default: '' },
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
  brokerDealer: { type: String, default: '' },
  isRIA: { type: Boolean, default: false },          // RIA: Yes/No
  totalAUM: { type: String, default: '' },           // store as string
  totalHouseholds: { type: Number, default: 0 },
  numberOfTeamMembers: { type: Number, default: 0 },
  painPoint: { type: String, default: '' },          // "What pain point are you trying to solve?"
  successCriteria: { type: String, default: '' }     // "How do you know Surge Tech was a success?"
});

const CompanyID = mongoose.model('CompanyID', companyIDSchema);

module.exports = CompanyID;
