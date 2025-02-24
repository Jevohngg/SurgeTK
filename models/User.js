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

  // Remove old "isAdmin", "role", "permissions" fields:
  // isAdmin: { type: Boolean, default: false },
  // role: { type: String, enum: ['admin','advisor','assistant','unassigned'], default: 'unassigned' },
  // permissions: { admin:{...}, advisor:{...}, assistant:{...} },

  // New approach: multiple roles in an array
  roles: [{
    type: String,
    enum: ['admin', 'advisor', 'assistant']
  }],

  // Single permission
  permission: {
    type: String,
    enum: ['admin', 'advisor', 'assistant'],
    default: 'assistant'
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
