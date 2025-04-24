const mongoose = require('mongoose');

const redtailAdvisorSchema = new mongoose.Schema({
  firmId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CompanyID',
    required: true
  },
  // The Redtail internal ID or reference
  redtailAdvisorId: {
    type: Number,
    required: false // sometimes Redtail might only provide a name or no numeric ID
  },
  advisorName: {
    type: String,
    default: ''
  },
  // Whether we've linked them to a user in SurgeTK
  linkedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Keep track of roles, types, etc. if needed
  type: {
    type: String,
    enum: ['servicing', 'writing', 'both', 'unknown'],
    default: 'unknown'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('RedtailAdvisor', redtailAdvisorSchema);
