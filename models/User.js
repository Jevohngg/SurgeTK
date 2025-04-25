// models/User.js

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const signInSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  location: String,
  device: String,
});

const userSchema = new mongoose.Schema({
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  companyId: { type: String },
  companyName: { type: String },
  firmId: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyID' },

  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },

 /**
   * We replace the older [ 'admin','advisor','assistant' ] with
   * a broader set: [ 'admin','leadAdvisor','assistant','teamMember' ]
   */
 roles: [{
  type: String,
  enum: ['admin', 'leadAdvisor', 'assistant', 'teamMember'],
}],

/**
 * For backward compatibility, keep "permission" if your existing code
 * still references it. But you can treat it as "legacy" if you prefer.
 */
permission: {
  type: String,
  enum: ['admin','leadAdvisor', 'advisor','assistant','teamMember','unassigned'],
  default: 'unassigned'
},

// When roles includes "admin", alsoAdvisor indicates if they are also an Advisor seat
alsoAdvisor: { type: Boolean, default: false },

// If the user is a leadAdvisor, specify sub-permission
leadAdvisorPermission: {
  type: String,
  enum: ['admin','all','limited','selfOnly'],
  default: 'all'
},

// If the user is an assistant, store the lead advisors to whom they assist
assistantToLeadAdvisors: [{
  type: mongoose.Schema.Types.ObjectId,
  ref: 'User'
}],
assistantPermission: {
  type: String,
  enum: ['admin','inherit'],
  default: 'inherit'
},

// If user is a "teamMember", store sub-permission
teamMemberPermission: {
  type: String,
  enum: ['admin','viewEdit','viewOnly'],
  default: 'viewEdit'
},

  // Identify the user who originally created the firm
  isFirmCreator: { type: Boolean, default: false },
  hasSeenWelcomeModal: { type: Boolean, default: false },

  emailVerified: { type: Boolean, default: false },
  verificationCode: { type: String },
  avatar: { type: String },

  signInLogs: { type: [signInSchema], default: [] },
  is2FAEnabled: { type: Boolean, default: false },
  twoFASecret: { type: String }
});

// Capitalize first & last name
userSchema.pre('save', function(next) {
  if (this.firstName) {
    this.firstName = this.firstName.trim();
    this.firstName =
      this.firstName.charAt(0).toUpperCase() + this.firstName.slice(1).toLowerCase();
  }
  if (this.lastName) {
    this.lastName = this.lastName.trim();
    this.lastName =
      this.lastName.charAt(0).toUpperCase() + this.lastName.slice(1).toLowerCase();
  }
  next();
});

// No auto-sync needed, because we store roles & permission separately now

// Virtual: user.name => combines firstName + lastName
userSchema
  .virtual('name')
  .get(function() {
    return [this.firstName, this.lastName].filter(Boolean).join(' ');
  })
  .set(function(fullName) {
    const [first, ...rest] = fullName.split(' ');
    this.firstName = first;
    this.lastName = rest.join(' ');
  });

userSchema.set('toObject', { virtuals: true });
userSchema.set('toJSON', { virtuals: true });

userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);
