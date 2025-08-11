// models/OneTimeTransaction.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const OneTimeTransactionSchema = new Schema(
  {
    account: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    kind: {
      type: String,
      enum: ['deposit', 'withdrawal'],
      required: true,
    },
    // Store as a positive number; sign is implied by `kind`
    amount: { type: Number, required: true, min: 0.01 },
    occurredOn: { type: Date, required: true },
    note: { type: String, trim: true },
    // Optional: attribution if you already have auth in the app
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Sort common query path
OneTimeTransactionSchema.index({ account: 1, occurredOn: -1, createdAt: -1 });

module.exports = mongoose.model('OneTimeTransaction', OneTimeTransactionSchema);
