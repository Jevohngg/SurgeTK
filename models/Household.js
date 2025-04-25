// models/Household.js
// ===================
// This file defines the Household schema, now with an advisors field.
// The advisors field is an array of User references, not required by default.
// This change allows multiple advisors to be assigned to a single household.
// Ensure you have 'User' model accessible and that the User model references the correct schema.

// Note: No additional npm packages required.

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const householdSchema = new mongoose.Schema({
  householdId: {
    type: String,
    default: () => uuidv4(),
    unique: true,
    required: true,
  },
  userHouseholdId: {
    type: String,
    required: false,
  },
  headOfHousehold: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: false,
  },
  marginalTaxBracket: {
    type: Number,
    default: 0  // e.g., 0.20 for 20%. Set 0 if you'll manually assign later.
  },
  annualBilling: {
    type: Number,
    default: 0  // e.g., store a dollar amount or 0 by default
  },
  totalAccountValue: {
    type: Number,
    default: 0,
  },
  firmId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CompanyID',
    required: true,
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // New advisors field: array of Users (advisors) that can manage this household.
  // Not required by default, can be empty.
  leadAdvisors: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false
    }
  ],
  servicingLeadAdvisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  writingLeadAdvisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Alternatively, store the raw Redtail ID for reference
  redtailServicingAdvisorId: { type: Number, default: null },
  redtailWritingAdvisorId: { type: Number, default: null },

  redtailFamilyId: { type: Number, unique: false, sparse: true },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  totalAccountValue: { type: Number, default: 0 },
  actualMonthlyDistribution: { type: Number, default: 0 },
  accounts: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
    },
  ],
});

householdSchema.index(
  { firmId: 1, redtailFamilyId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      redtailFamilyId: { $exists: true, $ne: null }
    }
  }
);


const Household = mongoose.model('Household', householdSchema);
module.exports = Household;
