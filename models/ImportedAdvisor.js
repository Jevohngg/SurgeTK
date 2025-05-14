// models/ImportedAdvisor.js
const mongoose = require('mongoose');

const importedAdvisorSchema = new mongoose.Schema({
  firmId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'CompanyID', 
    required: true 
  },
  importedAdvisorName: {
    type: String,
    required: true
  },
  email: { 
    type: String 
  },
  linkedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Optional: a 'type' or 'source' field
  source: { 
    type: String, 
    default: 'import' 
  }
}, { timestamps: true });

const ImportedAdvisor = mongoose.model('ImportedAdvisor', importedAdvisorSchema);
module.exports = ImportedAdvisor;
