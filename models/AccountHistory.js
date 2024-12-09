const mongoose = require('mongoose');

const accountHistorySchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  changedAt: { type: Date, default: Date.now },
  accountValue: Number,
  // Add more fields if you want to track other changes
});

accountHistorySchema.index({ accountId: 1, changedAt: 1 });

const AccountHistory = mongoose.model('AccountHistory', accountHistorySchema);
module.exports = AccountHistory;
