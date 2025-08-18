// models/Account.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Client = require('./Client'); // Ensure this path is correct
const OneTimeTransaction = require('./OneTimeTransaction');
const auditPlugin = require('../plugins/auditPlugin');

function calculateAge(dob) {
  const diffMs = Date.now() - dob.getTime();
  const ageDt = new Date(diffMs);
  return Math.abs(ageDt.getUTCFullYear() - 1970);
}

// PERIOD TYPES your importer will use (UI offers rolling previous 12 months)
const BILLING_PERIOD_TYPES = ['month','quarter','year']; // Jan-2025, Q1-2025, 2025
const BILLING_TYPES = ['account','household']; // AUM commissions vs. household fees

// For values stored in the maps (month/quarter/year)
const BillingValueSchema = new mongoose.Schema({
  // What’s being stored
  amount: { type: Number, required: true, default: 0 },

  // Redundancy helps with audit + queries; UI/import will supply these
  billType: { type: String, enum: BILLING_TYPES, required: true },  // 'account' or 'household'
  periodType: { type: String, enum: BILLING_PERIOD_TYPES, required: true }, // 'month'|'quarter'|'year'
  periodKey: { type: String, required: true },  // e.g. '2025-01' | '2025-Q1' | '2025'

  // Optional metadata
  source: { type: String, default: 'import' },  // e.g. 'import', 'override'
  note: { type: String },

  // bookkeeping
  importedAt: { type: Date, default: Date.now },
}, { _id: false });

// Utility to normalize keys your importer will pass
// month: 'YYYY-MM' (e.g., '2025-01'), quarter: 'YYYY-Q#' (e.g., '2025-Q3'), year: 'YYYY'
function normalizePeriodKey(periodType, key) {
  if (periodType === 'year') return String(key).trim();
  if (periodType === 'quarter') return String(key).toUpperCase().replace(/\s+/g,'');
  if (periodType === 'month') return String(key).trim();
  return String(key).trim();
}



/**
 * We keep this list as your "recognized" types for the front-end.
 * If Redtail sends a string not in this list, we'll store it as 'Other' in `accountType`,
 * but preserve the exact string in `accountTypeRaw`.
 */
const ALLOWED_ACCOUNT_TYPES = [
 'Individual',
 'Brokerage',
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
 'Traditional IRA',
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

    externalAccountOwnerName: {   // Label: “Account Owner Name”
      type: String,
      default: '',
      trim: true
    },
    externalHouseholdId: {        // Label: “Household ID”
      type: String,
      default: '',
      trim: true
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
    isUnlinked: { type: Boolean, default: false },   
    importBatchId: { type: String, default: null }, 

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
  const emptyNew = !Array.isArray(this.systematicWithdrawals) || this.systematicWithdrawals.length === 0;
  const hasLegacy = this.systematicWithdrawAmount != null && !!this.systematicWithdrawFrequency;
  if (emptyNew && hasLegacy) {
    this.systematicWithdrawals = [{
      amount: this.systematicWithdrawAmount,
      frequency: this.systematicWithdrawFrequency,
    }];
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


accountSchema.plugin(auditPlugin, {
  entityType: 'Account',
  displayFrom: (doc) => doc?.accountNumber || `Account #${doc._id}`
});





// Covers: Account.deleteMany({ ... })
accountSchema.pre('deleteMany', { document: false, query: true }, async function(next) {
  try {
    // Get the IDs that match the delete filter
    const ids = await this.model.find(this.getFilter()).distinct('_id');
    if (ids.length) {
      await OneTimeTransaction.deleteMany({ account: { $in: ids } });
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Covers: Account.deleteOne({ ... })
accountSchema.pre('deleteOne', { document: false, query: true }, async function(next) {
  try {
    const ids = await this.model.find(this.getFilter()).distinct('_id');
    if (ids.length) {
      await OneTimeTransaction.deleteMany({ account: { $in: ids } });
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Covers: Account.findByIdAndDelete(...) / Account.findOneAndDelete(...)
accountSchema.post('findOneAndDelete', async function(doc) {
  if (doc) {
    await OneTimeTransaction.deleteMany({ account: doc._id });
  }
});

// (Optional) Covers legacy remove() on a document instance
accountSchema.pre('remove', { document: true, query: false }, async function(next) {
  try {
    await OneTimeTransaction.deleteMany({ account: this._id });
    next();
  } catch (err) {
    next(err);
  }
});

// (Optional) Also cover findOneAndRemove (if used anywhere)
accountSchema.post('findOneAndRemove', async function(doc) {
  if (doc) {
    await OneTimeTransaction.deleteMany({ account: doc._id });
  }
});

// ───────────────────────────────────────────────────────────
// ACCOUNT: Billing storage (AUM commissions) + estimation cache
// ───────────────────────────────────────────────────────────
const AccountBillingSchemaAddon = new mongoose.Schema({
  // Store exact imports in maps so “override vs add” is trivial:
  //  - Keys are normalized periodKeys (see normalizePeriodKey)
  billingByMonth:  { type: Map, of: BillingValueSchema, default: undefined },
  billingByQuarter:{ type: Map, of: BillingValueSchema, default: undefined },
  billingByYear:   { type: Map, of: BillingValueSchema, default: undefined },

  // Cache for annual rollup (actual + estimated) at the account level
  annualBillingCached: {
    total:         { type: Number, default: 0 },   // actual + estimated
    actualPortion: { type: Number, default: 0 },
    estimatedPortion: { type: Number, default: 0 },

    // Which rolling window this cache reflects (inclusive)
    periodStart:   { type: Date }, // e.g., first day of rolling 12 months
    periodEnd:     { type: Date }, // e.g., last day of rolling 12 months
    computedAt:    { type: Date },
  }
}, { _id: false });

// Attach fields to your existing Account schema:
accountSchema.add({
  billing: AccountBillingSchemaAddon
});

// ───────────────────────────────────────────────────────────
// ACCOUNT: Instance helpers (model-only; call from services/controllers)
// ───────────────────────────────────────────────────────────
accountSchema.methods.setBillingEntry = function ({ billType='account', periodType, periodKey, amount, source='import', note }) {
  if (billType !== 'account') throw new Error('Account billing must have billType="account"');
  const normKey = normalizePeriodKey(periodType, periodKey);
  const payload = { billType, periodType, periodKey: normKey, amount, source, note };

  if (periodType === 'month') {
    if (!this.billing.billingByMonth) this.billing.billingByMonth = new Map();
    this.billing.billingByMonth.set(normKey, payload);
  } else if (periodType === 'quarter') {
    if (!this.billing.billingByQuarter) this.billing.billingByQuarter = new Map();
    this.billing.billingByQuarter.set(normKey, payload);
  } else if (periodType === 'year') {
    if (!this.billing.billingByYear) this.billing.billingByYear = new Map();
    this.billing.billingByYear.set(normKey, payload);
    // YEAR import overrides Q1–Q4 + months for that year (authoritative total)
    // We only remove lower granularities for *that* year to avoid double-counting.
    const yearStr = normKey; // e.g. '2025'
    if (this.billing.billingByQuarter) {
      for (const qKey of Array.from(this.billing.billingByQuarter.keys())) {
        if (qKey.startsWith(yearStr + '-Q') || qKey.startsWith(yearStr + 'Q')) {
          this.billing.billingByQuarter.delete(qKey);
        }
      }
    }
    if (this.billing.billingByMonth) {
      for (const mKey of Array.from(this.billing.billingByMonth.keys())) {
        if (mKey.startsWith(yearStr + '-')) this.billing.billingByMonth.delete(mKey);
      }
    }
  } else {
    throw new Error('Invalid periodType for Account billing');
  }
};

// Get sum of actuals for a given rolling window by preferring the highest
// authoritative import available (Year > Quarter > Month).
accountSchema.methods.getActualForWindow = function (startDate, endDate) {
  const y = this.billing.billingByYear || new Map();
  const q = this.billing.billingByQuarter || new Map();
  const m = this.billing.billingByMonth || new Map();

  // Helpers to check membership
  const inYear = (key) => {
    const year = parseInt(key, 10);
    return year >= startDate.getUTCFullYear() && year <= endDate.getUTCFullYear();
  };
  const inQuarter = (key) => {
    // key: 'YYYY-Q#'
    const [yy] = key.split('-Q');
    const year = parseInt(yy, 10);
    return year >= startDate.getUTCFullYear() && year <= endDate.getUTCFullYear();
  };
  const inMonth = (key) => {
    // key: 'YYYY-MM'
    const [yy, mm] = key.split('-').map(v => parseInt(v, 10));
    const d = new Date(Date.UTC(yy, (mm-1), 1));
    return d >= startDate && d <= endDate;
  };

  // Collect covered periods (avoid double counting lower granularities where a year is present)
  let total = 0;

  // Years
  const coveredYears = new Set();
  for (const [key, val] of y.entries()) {
    if (inYear(key)) {
      total += val.amount || 0;
      coveredYears.add(key);
    }
  }

  // Quarters (skip those that belong to coveredYears)
  const coveredQuarters = new Set();
  for (const [key, val] of q.entries()) {
    const yearPart = key.split('-')[0];
    if (inQuarter(key) && !coveredYears.has(yearPart)) {
      total += val.amount || 0;
      coveredQuarters.add(key);
    }
  }

  // Months (skip months that live inside coveredYears or inside quarters already counted)
  for (const [key, val] of m.entries()) {
    if (!inMonth(key)) continue;
    const [yy, mm] = key.split('-');
    const yearStr = yy;
    if (coveredYears.has(yearStr)) continue;

    // If any quarter for that year is covered and includes this month, skip
    let coveredByQuarter = false;
    for (const qKey of coveredQuarters) {
      if (!qKey.startsWith(yearStr)) continue;
      const qNum = parseInt(qKey.split('-Q')[1], 10);
      const monthNum = parseInt(mm, 10);
      const bucket = Math.ceil(monthNum / 3); // 1..4
      if (bucket === qNum) { coveredByQuarter = true; break; }
    }
    if (!coveredByQuarter) total += val.amount || 0;
  }

  return total;
};

// Estimate annual total when only part of the year is present (Account-only rule).
// This applies the spec: monthly → ×12, quarterly → ×4. Mixed data prefers higher granularity.
// Estimation happens upstream; here we just expose a helper.
accountSchema.methods.estimateAnnualFromActuals = function (forYear) {
  // Prefer Year import if present (no estimation needed)
  const yMap = this.billing.billingByYear || new Map();
  if (yMap.has(String(forYear))) return { actual: yMap.get(String(forYear)).amount || 0, estimated: 0, total: yMap.get(String(forYear)).amount || 0 };

  const qMap = this.billing.billingByQuarter || new Map();
  const mMap = this.billing.billingByMonth || new Map();

  // Sum quarters/months for that year
  let qSum = 0, qCount = 0;
  for (const [key, val] of qMap.entries()) {
    if (key.startsWith(`${forYear}-Q`)) { qSum += (val.amount || 0); qCount += 1; }
  }
  let mSum = 0, mCount = 0;
  for (const [key, val] of mMap.entries()) {
    if (key.startsWith(`${forYear}-`)) { mSum += (val.amount || 0); mCount += 1; }
  }

  // If we have any quarters, estimate from quarter average
  if (qCount > 0) {
    const averageQuarter = qSum / qCount;
    const estimatedTotal = averageQuarter * 4;
    return {
      actual: qSum,
      estimated: Math.max(estimatedTotal - qSum, 0),
      total: estimatedTotal
    };
  }

  // Else if we have any months, estimate from month average
  if (mCount > 0) {
    const averageMonth = mSum / mCount;
    const estimatedTotal = averageMonth * 12;
    return {
      actual: mSum,
      estimated: Math.max(estimatedTotal - mSum, 0),
      total: estimatedTotal
    };
  }

  // No data → 0s
  return { actual: 0, estimated: 0, total: 0 };
};


const Account = mongoose.model('Account', accountSchema);
module.exports = Account;
