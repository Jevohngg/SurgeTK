// models/Liability.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const auditPlugin = require('../plugins/auditPlugin');

const liabilitySchema = new mongoose.Schema(
  {
    liabilityId: {
      type: String,
      default: uuidv4,
      unique: true,
      required: true,
    },
    household: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Household',
      required: true
    },
    owners: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
      }],
    liabilityType: {
      type: String,
      required: false,
    },
    creditorName: {
      type: String,
      required: false,
    },
    accountLoanNumber: {
      type: String,
      required: true,
      unique: true,
    },
    outstandingBalance: {
      type: Number,
      required: false,
    },
    interestRate: {
      type: Number,
      required: false,
    },
    monthlyPayment: {
      type: Number,
      required: false,
    },
    estimatedPayoffDate: {
      type: Date,
      required: false,
    },
  },
  { timestamps: true }
);

liabilitySchema.plugin(auditPlugin, {
  entityType: 'Liability',
  displayFrom: (doc) => {
    const name = doc.creditorName ? `${doc.creditorName} ` : '';
    const num  = doc.accountLoanNumber ? `#${doc.accountLoanNumber}` : `#${doc._id}`;
    return `Liability ${name}${num}`;
  }
});

const Liability = mongoose.model('Liability', liabilitySchema);
module.exports = Liability;
