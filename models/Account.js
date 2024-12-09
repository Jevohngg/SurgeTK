const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Client = require('./Client'); // Ensure this path is correct

function calculateAge(dob) {
  const diffMs = Date.now() - dob.getTime();
  const ageDt = new Date(diffMs);
  return Math.abs(ageDt.getUTCFullYear() - 1970);
}

const accountSchema = new mongoose.Schema({
  accountId: {
    type: String,
    default: uuidv4,
    unique: true,
    required: true,
    immutable: true,
  },
  accountOwner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true,
  },
  household: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Household',
    required: true,
  },
  accountNumber: {
    type: String,
    required: true,
  },
  accountValue: {
    type: Number,
    required: true,
  },
  accountType: {
    type: String,
    required: true,
    enum: [
      'Individual',
      'TOD',
      'Joint Tenants',
      'Tenants in Common',
      'IRA',
      'Roth IRA',
      'Inherited IRA',
      'SEP IRA',
      'Simple IRA',
      '401(k)',
      '403(b)',
      '529 Plan',
      'UTMA',
      'Trust',
      'Custodial',
      'Annuity',
      'Variable Annuity',
      'Fixed Annuity',
      'Deferred Annuity',
      'Immediate Annuity',
      'Other',
    ],
  },
  systematicWithdrawAmount: {
    type: Number,
  },
  systematicWithdrawFrequency: {
    type: String,
    enum: ['Monthly', 'Quarterly', 'Annually'],
    required: false,
  },
  federalTaxWithholding: {
    type: Number,
  },
  stateTaxWithholding: {
    type: Number,
  },
  taxStatus: {
    type: String,
    enum: ['Taxable', 'Tax-Free', 'Tax-Deferred'],
    required: true,
  },
  valueAsOf12_31: {
    type: Number,
  },
  custodian: {
    type: String,
    required: true,
  },
  beneficiaries: {
    primary: [
      {
        beneficiary: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Beneficiary',
        },
        percentageAllocation: Number,
      },
    ],
    contingent: [
      {
        beneficiary: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Beneficiary',
        },
        percentageAllocation: Number,
      },
    ],
  },
  taxForms: [
    {
      type: String,
      enum: ['1099', 'Tax Report/1099', 'None'],
      default: [],
    },
  ],
  inheritedAccountDetails: {
    deceasedName: String,
    dateOfDeath: Date,
    relationshipToDeceased: {
      type: String,
      enum: [
        'Spouse',
        'Non-Spouse',
        'Minor Child',
        'Disabled Child',
        'Chronically Ill Individual',
        'Other',
      ],
    },
  },
  iraAccountDetails: [
    {
      year: Number,
      conversionAmount: Number,
    },
  ],
}, { timestamps: true });

// Pre-save middleware for validations
accountSchema.pre('save', function (next) {
  const account = this;

  // Validate 'valueAsOf12_31' for Tax-Deferred accounts and clients age 73 or older
  if (account.taxStatus === 'Tax-Deferred') {
    Client.findById(account.accountOwner)
      .then((client) => {
        if (client && client.dob) {
          const age = calculateAge(client.dob);
          if (age >= 73 && (account.valueAsOf12_31 === null || account.valueAsOf12_31 === undefined)) {
            return next(
              new Error(
                '12/31 Value is required for clients age 73 or older with Tax-Deferred accounts.'
              )
            );
          }
        }
        next();
      })
      .catch((err) => next(err));
  } else {
    next();
  }
});

// Index for faster queries by household
accountSchema.index({ household: 1 });

const Account = mongoose.model('Account', accountSchema);
module.exports = Account;
