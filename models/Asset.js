// models/Asset.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const assetSchema = new mongoose.Schema(
  {
    assetId: {
      type: String,
      default: uuidv4,
      unique: true,
      required: true,
    },
    owners: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true
    }],
    assetType: {
      type: String,
      required: true,
    },
    assetNumber: {
      type: String,
      required: true,
      unique: true,
    },
    assetValue: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true }
);

const Asset = mongoose.model('Asset', assetSchema);
module.exports = Asset;
