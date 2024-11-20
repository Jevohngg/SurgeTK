const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

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
    ],
    required: false,
  },
  maritalStatus: {
    type: String,
    enum: ['Married', 'Single', 'Widowed', 'Divorced'],
    required: false,
  },
  mobileNumber: { type: String, required: false },
  homePhone: { type: String },
  email: { type: String, required: false },
  homeAddress: { type: String },
  createdAt: { type: Date, default: Date.now },
});

const Client = mongoose.model('Client', clientSchema);
module.exports = Client;
