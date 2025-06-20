// models/Client.js

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Helper function to format the DOB in MM-DD-YYYY format without timezone shifts
function formatDOBWithoutTZ(date) {
  if (!date || isNaN(date)) return null;

  // Use UTC methods to avoid timezone issues
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${month}-${day}-${year}`;
}

// Calculate age from a given date
function calculateAge(dob) {
  // Check if no dob or an invalid date
  if (!dob || isNaN(dob.getTime())) {
    return null;
  }
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
      // Removed the old "unique: true" here
      required: true,
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
    dob: { type: Date, required: false },
    ssn: { type: String, required: false },
    taxFilingStatus: {
      type: String,
      default: '',
      required: false,
    },
    maritalStatus: {
      type: String,
      enum: ['Married', 'Single', 'Widowed', 'Divorced', '', null],
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

// Virtual field for formatted DOB
clientSchema.virtual('formattedDOB').get(function () {
  if (!this.dob) return '---';
  const formatted = formatDOBWithoutTZ(this.dob);
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
