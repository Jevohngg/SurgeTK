const mongoose = require('mongoose');

const companyIDSchema = new mongoose.Schema({
  companyId: { type: String, required: true, lowercase: true },
  companyName: { type: String, required: false },
  assignedEmail: { type: String, default: null },
  isUsed: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  invitedUsers: [{
    email: String,
    role: { type: String, enum: ['admin', 'advisor', 'assistant'], default: 'advisor' },
    permissions: { type: mongoose.Schema.Types.Mixed, default: {} },
  }],
  companyWebsite: { type: String, default: '' },
  companyLogo: { type: String, default: '' }, // Add this field here
  companyAddress: { type: String, default: '' },
  phoneNumber: { type: String, default: '' },
  industry: { type: String, default: '' },

  bucketsEnabled: {
    type: Boolean,
    default: true
  },
  bucketsTitle: {
    type: String,
    default: 'Buckets Strategy'
  },
  bucketsDisclaimer: {
    type: String,
    default: 'THIS REPORT IS NOT COMPLETE WITHOUT ALL THE ACCOMPANYING DISCLAIMERS! Our attorneys would like us to remind you that this report is provided as a courtesy & is for informational purposes only. Advisory services offered through Shilanski & Associates, Inc., an Investment Adviser, is not employed by the United States Federal Government and does not represent the United States Federal Government. Investments in securities involves risks, including the potential for loss of principal. There is no guarantee that any investment plan or strategy will be successful.'
  }


});


const CompanyID = mongoose.model('CompanyID', companyIDSchema);

module.exports = CompanyID;
