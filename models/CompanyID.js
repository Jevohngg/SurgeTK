const mongoose = require('mongoose');

const companyIDSchema = new mongoose.Schema({
  companyId: { type: String, required: true, unique: true, lowercase: true }, // Always store in lowercase
  companyName: { type: String, required: false },
  isUsed: { type: Boolean, default: false }, // Flag to check if it's been used
});

const CompanyID = mongoose.model('CompanyID', companyIDSchema);

module.exports = CompanyID;



