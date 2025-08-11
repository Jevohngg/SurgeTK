// models/HomeworkSettings.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const ClientOverrideSchema = new Schema({
  client: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
  employer: { type: String, default: '' },
  retirementDate: { type: Date, default: null },
}, { _id: false });

const CashFlowSchema = new Schema({
  checking: { type: Number, default: 0 },
  savings: { type: Number, default: 0 },
  income: { type: Number, default: 0 },
  spending: { type: Number, default: 0 },
  debt: { type: Number, default: 0 }
}, { _id: false });

const OutsideInvestmentSchema = new Schema({
  label: { type: String, trim: true },
  amount: { type: Number, default: 0 }
}, { _id: false });

const HomeworkSettingsSchema = new Schema({
  household: { type: Schema.Types.ObjectId, ref: 'Household', unique: true, required: true },

  // Header / meeting
  meetingType: { type: String, default: '' },
  meetingDateTime: { type: Date, default: null },

  // Manual cash‑flow & outside investments (page 1)
  cashFlow: { type: CashFlowSchema, default: () => ({}) },
  outsideInvestments: { type: [OutsideInvestmentSchema], default: [] },
  debts: { type: [OutsideInvestmentSchema], default: [] },   // <— NEW

  // Free text areas
  notes: { type: String, default: '' },
  actionItems: { type: String, default: '' },
  homework: { type: String, default: '' },

  // Optional per‑client overrides for employer & retirement date on page 1
  clientOverrides: { type: [ClientOverrideSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('HomeworkSettings', HomeworkSettingsSchema);
