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
  totalAccountValue: {
    type: Number,
    default: 0,
  },
  owner: { // New field added
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Ensure you have a User model
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  // Future: Associations with Accounts
  accounts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
  }],
});

const Household = mongoose.model('Household', householdSchema);
module.exports = Household;
