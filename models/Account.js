// models/Account.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Client = require('./Client'); // Ensure this path is correct

function calculateAge(dob) {
  const diffMs = Date.now() - dob.getTime();
  const ageDt = new Date(diffMs);
  return Math.abs(ageDt.getUTCFullYear() - 1970);
}

/**
 * We keep this list as your "recognized" types for the front-end.
 * If Redtail sends a string not in this list, we'll store it as 'Other' in `accountType`,
 * but preserve the exact string in `accountTypeRaw`.
 */
const ALLOWED_ACCOUNT_TYPES = [
  'Individual',
  'TOD',
  'Joint',
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
];

const accountSchema = new mongoose.Schema(
  {
    accountId: {
      type: String,
      default: uuidv4,
      unique: true,
      required: true,
      immutable: true,
    },
    firmId: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyID', required: true },
    accountOwner: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Client',
        required: true,
      },
    ],

    // Keep the old string field for minimal disruption
    accountOwnerName: { type: String },
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

    /**
     * (1) The "recognized" type for front-end forms.
     *     Must be one of the enum values, or defaults to "Other."
     */
    accountType: {
      type: String,
      required: true,
      enum: ALLOWED_ACCOUNT_TYPES,
      default: 'Other',
    },

    /**
     * (2) A "raw" field that can store ANY string from Redtail
     *     (e.g., "Brokerage Account", "Traditional IRA", etc.)
     */
    accountTypeRaw: {
      type: String,
      required: false,
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
      enum: ['Taxable', 'Tax-Free', 'Tax-Deferred', 'Tax-Exempt', 'Non-Qualified'],
      required: true,
    },
    valueAsOf12_31: {
      type: Number,
    },

    /**
     * (1) The "recognized" custodian for front-end usage.
     *     If you have a known list of custodians, you can set up an enum similarly.
     *     Otherwise, keep it as a string and default to "UnknownCustodian."
     */
    custodian: {
      type: String,
      required: true,
      default: 'UnknownCustodian',
    },

    /**
     * (2) A "raw" custodian field for storing any string Redtail provides.
     */
    custodianRaw: {
      type: String,
      required: false,
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

    // Added asset allocation fields
    cash: { type: Number, default: 0 },
    income: { type: Number, default: 0 },
    annuities: { type: Number, default: 0 },
    growth: { type: Number, default: 0 },
    redtailAccountId: { type: Number, unique: false, sparse: true },
  },
  { timestamps: true }
);

accountSchema.pre('save', async function (next) {
  try {
    const account = this;

    // 1) If needed, compute a combined name from the owners
    if (account.accountOwner?.length > 0) {
      const owners = await Client.find(
        { _id: { $in: account.accountOwner } },
        'firstName lastName'
      );
      const ownerNames = owners.map(o => `${o.firstName} ${o.lastName}`);
      account.accountOwnerName = ownerNames.join(' & ');
    } else {
      account.accountOwnerName = 'Unknown';
    }

    // 2) If taxStatus === 'Tax-Deferred', check the age logic.
    if (account.taxStatus === 'Tax-Deferred' && account.accountOwner.length > 0) {
      const firstOwnerId = account.accountOwner[0];
      const client = await Client.findById(firstOwnerId);
      if (client && client.dob) {
        const age = calculateAge(client.dob);
        if (age >= 73 && (account.valueAsOf12_31 === null || account.valueAsOf12_31 === undefined)) {
          console.warn(
            'WARNING: 12/31 Value is missing for clients age 73+ with Tax-Deferred accounts. Saving anyway.'
          );
        }
      }
    }

    next();
  } catch (err) {
    next(err);
  }
});

// Index for faster queries by household
accountSchema.index({ household: 1 });

// Index for (firmId, redtailAccountId):
accountSchema.index(
  { firmId: 1, redtailAccountId: 1 },
  { unique: true, sparse: true }
);

const Account = mongoose.model('Account', accountSchema);
module.exports = Account;
