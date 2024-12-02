// models/Beneficiary.js

const mongoose = require('mongoose');

const beneficiarySchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  relationship: { type: String },
  dateOfBirth: { type: Date },
  ssn: { type: String },
});

const Beneficiary = mongoose.model('Beneficiary', beneficiarySchema);
module.exports = Beneficiary;
