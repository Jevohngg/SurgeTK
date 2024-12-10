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
  if (!dob || isNaN(dob)) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age--;
  }
  return age;
}

const clientSchema = new mongoose.Schema({
  clientId: {
    type: String,
    default: () => uuidv4(),
    unique: true,
    required: true,
  },
  household: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Household',
    required: true,
  },
  firstName: { type: String, required: true },
  middleName: { type: String },
  lastName: { type: String, required: true },
  dob: { type: Date, required: false },
  ssn: { type: String, required: false },
  taxFilingStatus: {
    type: String,
    enum: [
      'Married Filing Jointly',
      'Married Filing Separately',
      'Single',
      'Head of Household',
      'Qualifying Widower',
      '',
      null
    ],
    required: false,
  },
  maritalStatus: {
    type: String,
    enum: ['Married', 'Single', 'Widowed', 'Divorced', '', null],
    required: false,
  },
  mobileNumber: { type: String, required: false },
  homePhone: { type: String, required: false },
  email: { type: String, required: false },
  homeAddress: { type: String, required: false },
  createdAt: { type: Date, default: Date.now },
}, { 
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual field for formatted DOB
clientSchema.virtual('formattedDOB').get(function() {
  if (!this.dob) return '---';
  const formatted = formatDOBWithoutTZ(this.dob);
  return formatted || '---';
});

// Virtual field for age
clientSchema.virtual('age').get(function() {
  if (!this.dob) return null;
  const age = calculateAge(this.dob);
  return age !== null ? age : null;
});

const Client = mongoose.model('Client', clientSchema);
module.exports = Client;
