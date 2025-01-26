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
