const mongoose = require('mongoose');

const trackedSchema = new mongoose.Schema({
  /** field name that changed (accountValue, cash …)   */ field:  { type: String, required: true },
  /** value before the change                           */ prev:   { type: mongoose.Schema.Types.Mixed },
  /** value after the change (for convenience)          */ next:   { type: mongoose.Schema.Types.Mixed },
}, { _id: false });

const accountHistorySchema = new mongoose.Schema({
  account:     { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
  changedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
  changedAt:   { type: Date,   default: () => new Date(),              index: true },
  asOfDate:    { type: Date,   required: true },   // copy of account.asOfDate at that moment
  changes:     { type: [trackedSchema], required: true },             // ≥1 element
});

module.exports = mongoose.model('AccountHistory', accountHistorySchema);
