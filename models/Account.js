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
 'Joint Tenants',
 'Joint',
 'Tenants in Common',
 'Community Property',
 'TOD',
 'Transfer on Death',
 'Custodial',
 'UTMA',
 'UGMA',
 'Corporate Account',
 'Partnership Account',
 'LLC Account',
 'Sole Proprietorship',
 'IRA',
 'Roth IRA',
 'Inherited IRA',
 'SEP IRA',
 'Simple IRA',
 '401(k)',
 'Solo 401(k)',
 '403(b)',
 '457(b)',
 'Pension Plan',
 'Profit Sharing Plan',
 'Keogh Plan',
 'Rollover IRA',
 'Beneficiary IRA',
 '529 Plan',
 'Coverdell ESA',
 'Trust',
 'Revocable Trust',
 'Irrevocable Trust',
 'Testamentary Trust',
 'Charitable Remainder Trust',
 'Estate',
 'Conservatorship',
 'Guardianship',
 'Annuity',
 'Variable Annuity',
 'Fixed Annuity',
 'Deferred Annuity',
 'Immediate Annuity',
 'Equity-Indexed Annuity',
 'Registered Index-Linked Annuity (RILA)',
 'Checking Account',
 'Savings Account',
 'Money Market Account',
 'Certificate of Deposit (CD)',
 'Health Savings Account (HSA)',
 'Flexible Spending Account (FSA)',
 'Donor-Advised Fund',
 'Charitable Lead Trust',
 'Municipal Account',
 'Endowment',
 'Foundation',
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
      required: false,
    },
    accountNumber: {
      type: String,
      required: true,
    },
    accountValue: {
      type: Number,
      required: false,
    },

    /**
     * (1) The "recognized" type for front-end forms.
     *     Must be one of the enum values, or defaults to "Other."
     */
    accountType: {
      type: String,
      required: false,
      enum: ['', ...ALLOWED_ACCOUNT_TYPES],
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

    /**
     * Each entry represents one withdrawal stream.
     * ─ amount: required positive number
     * ─ frequency: required enum
     *
     * Legacy fields systematicWithdrawAmount / systematicWithdrawFrequency are
     * left in place (but marked deprecated) so old documents still load.
     */
    systematicWithdrawals: [
      {
        amount: { type: Number, required: true, min: 0 },
        frequency: {
          type: String,
          enum: ['','Monthly', 'Quarterly', 'Semi-annual', 'Annually'],
          required: true,
        },
        _id: false,          // keeps sub-documents lean; we don’t need ids here
      },
    ],

    // ── DEPRECATED ───────────────────────────────────────────────────────────
    systematicWithdrawAmount: { type: Number, select: false },
    systematicWithdrawFrequency: { type: String, select: false },


    federalTaxWithholding: {
      type: Number,
    },
    stateTaxWithholding: {
      type: Number,
    },
    taxStatus: {
      type: String,
      enum: ['Taxable', 'Tax-Free', 'Tax-Deferred', 'Tax-Exempt', 'Non-Qualified', ''],
      required: false,
    },
    valueAsOf12_31: {
      type: Number,
    },
    quarterlyBilledAmount: {
      type: Number,
      default: 0
    },

    /**
     * (1) The "recognized" custodian for front-end usage.
     *     If you have a known list of custodians, you can set up an enum similarly.
     *     Otherwise, keep it as a string and default to "UnknownCustodian."
     */
    custodian: {
      type: String,
      required: false,
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

    asOfDate: { type: Date, default: () => new Date() },

    redtailAccountId: { type: Number, unique: false, sparse: true },
  },
  { timestamps: true }
);

/**
 * Pre-validate hook: if legacy scalar fields are present and the new array is
 * empty, convert the single entry automatically.  This avoids a data-migration
 * script and keeps existing documents valid.
 */
accountSchema.pre('validate', function (next) {
  if (
    this.systematicWithdrawals.length === 0 &&
    this.systematicWithdrawAmount != null &&
    this.systematicWithdrawFrequency
  ) {
    this.systematicWithdrawals.push({
      amount: this.systematicWithdrawAmount,
      frequency: this.systematicWithdrawFrequency,
    });
  }
  next();
});


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
  {
    unique: true,
    partialFilterExpression: {
      redtailAccountId: { $type: 'number' }
    }
    
  }
);


const Account = mongoose.model('Account', accountSchema);
module.exports = Account;
