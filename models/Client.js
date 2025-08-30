// models/Client.js

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Normalize incoming dates to be DATE-ONLY at 00:00:00 UTC.
 * Prevents off-by-one errors caused by timezone shifts.
 * Accepts:
 *  - 'YYYY-MM-DD' strings
 *  - Date instances
 *  - other parsable date strings
 * Returns undefined if invalid or empty (so Mongoose won't set the field).
 */
function toUTCDateOnly(value) {
  if (value === null || value === undefined || value === '') return undefined;

  if (typeof value === 'string') {
    // Strict YYYY-MM-DD
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      return new Date(Date.UTC(y, mo - 1, d));
    }
  }

  const dt = new Date(value);
  if (isNaN(dt.getTime())) return undefined;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

// Helper function to format a date in MM-DD-YYYY using UTC parts (no TZ shifts)
function formatDOBWithoutTZ(date) {
  if (!date || isNaN(date.getTime())) return null;

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${month}-${day}-${year}`;
}

// Calculate age from a given date (uses UTC parts to stay consistent)
function calculateAge(dob) {
  if (!dob || isNaN(dob.getTime())) return null;

  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age--;
  }
  return age;
}



const clientSchema = new mongoose.Schema(
  {
    clientId: {
      type: String,
      default: () => uuidv4(),
      required: true,
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
      lowercase: true,
      trim: true
    },
    firmId: { type: mongoose.Schema.Types.ObjectId, ref: 'CompanyID', required: true },
    contactLevelServicingAdvisorId: { type: Number, default: null },
    contactLevelWritingAdvisorId: { type: Number, default: null },
    leadAdvisorFirstName: { type: String, required: false, default: '' },
    leadAdvisorLastName: { type: String, required: false, default: '' },

    household: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Household',
      required: false,
    },

    firstName: { type: String, required: true },
    middleName: { type: String },
    lastName: { type: String, required: true },

    // Dates are stored as date-only at UTC midnight via setters below
    dob: { type: Date, required: false, set: toUTCDateOnly },

    // NEW: Retirement Date (also date-only at UTC midnight)
    retirementDate: { type: Date, required: false, set: toUTCDateOnly },

    ssn: { type: String, required: false },
    taxFilingStatus: {
      type: String,
      default: '',
      required: false,
    },
    maritalStatus: {
      type: String,
      enum: ['Married', 'Single', 'Widowed', 'Divorced', 'Widow(er)', 'Widower', 'Domestic Partner', 'Other', 'Life Parter', 'Partner' , 'Unknown' , '', null],
      default: '',
      required: false,
    },
    mobileNumber: { type: String, required: false },
    homePhone: { type: String, required: false },
    email: { type: String, required: false },
    homeAddress: { type: String, required: false },

    // New fields:
    deceasedLiving: {
      type: String,
      enum: ['Living', 'Deceased'],
      default: 'Living',
    },
    monthlyIncome: {
      type: Number,
      default: 0,
    },
    occupation: {
      type: String,
      required: false,
      default: '',
      trim: true,
    },
    employer: {
      type: String,
      required: false,
      default: '',
      trim: true,
    },
    profilePhoto: {
      type: String, // store a URL or file path
      required: false,
    },

    redtailId: { type: Number, unique: false, sparse: true },
    createdAt: { type: Date, default: Date.now },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

const auditPlugin = require('../plugins/auditPlugin'); // ← correct file
clientSchema.plugin(auditPlugin, {
  entityType: 'Client',  // ← correct option name that your plugin reads
  // Optional: nice display name in the activity log
  displayFrom: (doc) => {
    const last  = (doc?.lastName || '').trim();
    const first = (doc?.firstName || '').trim();
    return [last, first].filter(Boolean).join(', ') || `Client #${doc?._id}`;
  }
});

// Virtual field for formatted DOB (MM-DD-YYYY)
clientSchema.virtual('formattedDOB').get(function () {
  if (!this.dob) return '---';
  const formatted = formatDOBWithoutTZ(this.dob);
  return formatted || '---';
});

// NEW: Virtual field for formatted Retirement Date (MM-DD-YYYY)
clientSchema.virtual('formattedRetirementDate').get(function () {
  if (!this.retirementDate) return '---';
  const formatted = formatDOBWithoutTZ(this.retirementDate);
  return formatted || '---';
});

// Virtual field for age
clientSchema.virtual('age').get(function () {
  if (!this.dob) return null;
  return calculateAge(this.dob);
});

// Keep your existing partial index for Redtail
clientSchema.index(
  { firmId: 1, redtailId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      redtailId: { $type: 'number' },
    },
  }
);

// NEW: Compound index on (firmId, clientId) to ensure per-firm uniqueness
clientSchema.index({ firmId: 1, clientId: 1 }, { unique: true });

const Client = mongoose.model('Client', clientSchema);
module.exports = Client;
