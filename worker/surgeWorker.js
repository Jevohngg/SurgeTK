// worker/surgeWorker.js
require('dotenv').config();
const mongoose           = require('mongoose');
const { Worker }         = require('bullmq');
const { surgeQueue }     = require('../utils/queue/surgeQueue');
const { buildPacketJob } = require('../utils/pdf/packetBuilder');
const Surge              = require('../models/Surge');

// 1) Connect to MongoDB exactly as your web dyno does
mongoose.connect(
  process.env.MONGODB_URI_PROD || process.env.MONGODB_URI_DEV,
  { useNewUrlParser: true, useUnifiedTopology: true }
);

// 2) Spin up a BullMQ worker using the same TLS-relaxed connection
new Worker(
  surgeQueue.name,
  async job => {
    const { surgeId, householdId, host, cookieHeader } = job.data;

    // Fetch a fresh Surge doc
    const surge = await Surge.findById(surgeId).lean();

    // Delegate to your existing PDF builder
    await buildPacketJob({
      surge,
      householdId,
      host,
      cookieHeader,
      progressCb: inc => job.updateProgress((job.progress || 0) + inc)
    });

    return { householdId };
  },
  {
    // reuse the exact same connection options from surgeQueue
    connection: surgeQueue.opts.connection
  }
);
