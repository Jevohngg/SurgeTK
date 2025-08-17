// models/Asset.js
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const auditPlugin = require('../plugins/auditPlugin');

const assetSchema = new mongoose.Schema(
  {
    assetId: {
      type: String,
      default: uuidv4,
      unique: true,
      required: true,
    },
    accountOwnerName: { type: String, trim: true, default: '' },
    owners: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true
    }],
    assetType: {
      type: String,
      required: false,
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

assetSchema.plugin(auditPlugin, {
  entityType: 'Asset',
  displayFrom: (doc) => `Asset ${doc.assetNumber || doc.assetId || doc._id}`
});

const Asset = mongoose.model('Asset', assetSchema);
module.exports = Asset;
