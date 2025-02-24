// models/CompanyID.js

const mongoose = require('mongoose');

const companyIDSchema = new mongoose.Schema({
  companyId: { type: String, required: true, lowercase: true },
  companyName: { type: String, required: false },
  assignedEmail: { type: String, default: null },
  isUsed: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },

  // We store multiple roles + single permission in each invitedUser
  invitedUsers: [{
    email: String,
    // roles array
    roles: [{
      type: String,
      enum: ['admin', 'advisor', 'assistant']
    }],
    // single permission
    permission: {
      type: String,
      enum: ['admin', 'advisor', 'assistant'],
      default: 'assistant'
    }
  }],

    // Subscription fields
    subscriptionTier: {
      type: String,
      enum: ['free', 'pro', 'enterprise'],
      default: 'free'
    },
    subscriptionStatus: {
      type: String,
      enum: ['active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due', 'trialing', 'unpaid', 'none'],
      default: 'none' // or 'active' if free is considered "active"
    },
    stripeCustomerId: { type: String, default: '' },
    stripeSubscriptionId: { type: String, default: '' },
  
    // Number of seats purchased (for Pro tier)
    seatsPurchased: { type: Number, default: 0 },
  
    // Payment info (optional fields)
    paymentMethodLast4: { type: String, default: '' },
    paymentMethodBrand: { type: String, default: '' },
    nextBillDate: { type: Date, default: null },

      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // NEW: Billing address fields
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
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
  }
});

const CompanyID = mongoose.model('CompanyID', companyIDSchema);

module.exports = CompanyID;
