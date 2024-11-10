// models/User.js

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const signInSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  location: String,
  device: String,
});

const userSchema = new mongoose.Schema({
  companyId: { type: String, required: true },
  companyName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  emailVerified: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  verificationCode: { type: String },
  avatar: { type: String }, // Profile Avatar

  // New fields for Company Info
  companyWebsite: { type: String, default: '' },
  companyLogo: { type: String, default: '' }, // URL to company logo
  companyAddress: { type: String, default: '' },
  phoneNumber: { type: String, default: '' },
  industry: { type: String, default: '' }, // If needed

  // 2FA Fields
  is2FAEnabled: { type: Boolean, default: false },
  twoFASecret: { type: String },

  // Sign-In Logs
  signInLogs: { type: [signInSchema], default: [] },
});

// Password comparison
userSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.password);
};

const User = mongoose.model('User', userSchema);
module.exports = User;
