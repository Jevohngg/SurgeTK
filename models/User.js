// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

// SignIn Logs Schema (unchanged)
const signInSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  location: String,
  device: String,
});

const userSchema = new mongoose.Schema({
  // NEW FIELDS
  firstName: { type: String, required: false, default: '' },
  lastName: { type: String, required: false, default: '' },

  // No longer required fields for new signups
  companyId: { type: String, required: false },
  companyName: { type: String, required: false },

  // The user’s firm (null if not onboarded yet)
  firmId: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyID', required: false },

  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },

  // Backward-compat fields, but role is the new standard
  isAdmin: { type: Boolean, default: false },
  role: { 
    type: String, 
    enum: ['super_admin', 'admin', 'advisor', 'assistant', 'unassigned'], 
    default: 'unassigned' 
  },
  permissions: { type: mongoose.Schema.Types.Mixed, default: {} },

  emailVerified: { type: Boolean, default: false },
  verificationCode: { type: String },
  avatar: { type: String },
  signInLogs: { type: [signInSchema], default: [] },
  is2FAEnabled: { type: Boolean, default: false },
  twoFASecret: { type: String },

});

// Virtual: user.name => combines firstName + lastName
userSchema
  .virtual('name')
  .get(function() {
    // Return "FirstName LastName", trimmed to avoid double-spaces
    return [this.firstName, this.lastName].filter(Boolean).join(' ');
  })
  .set(function(fullName) {
    // If you ever want to set user.name = 'John Doe'
    // you can split it here:
    const [first, ...rest] = fullName.split(' ');
    this.firstName = first;
    this.lastName = rest.join(' ');
  });

// You must enable virtuals in toJSON/toObject if you want them to show up in plain objects
userSchema.set('toObject', { virtuals: true });
userSchema.set('toJSON', { virtuals: true });

// Password comparison
userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);
