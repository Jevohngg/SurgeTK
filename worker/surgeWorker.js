// worker/surgeWorker.js
require('dotenv').config();
const mongoose            = require('mongoose');
const { Worker }          = require('bullmq');
const { surgeQueue }      = require('../utils/queue/surgeQueue');
const { buildPacketJob }  = require('../utils/pdf/packetBuilder');
const Surge               = require('../models/Surge');

// Ensure mongoose is connected (reuse your MONGODB_URI from .env)
mongoose.connect(process.env.MONGODB_URI_PROD || process.env.MONGODB_URI_DEV, {
  useNewUrlParser:    true,
  useUnifiedTopology: true
});

new Worker(
  surgeQueue.name,
  async job => {
    const { surgeId, householdId, host, cookieHeader, userId } = job.data;

    // Fresh Surge doc
    const surge = await Surge.findById(surgeId).lean();
    // Delegate to your existing builder
    await buildPacketJob({
      surge,
      householdId,
      host,
      cookieHeader,
      progressCb: inc => {
        // increment global progress in Redis
        return job.updateProgress((job.progress || 0) + inc);
      }
    });
    return { householdId };
  },
  { connection: { url: process.env.REDIS_URL } }
);
