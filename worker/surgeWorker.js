// worker/surgeWorker.js
require('dotenv').config();
const mongoose           = require('mongoose');
const { Worker }         = require('bullmq');
const { surgeQueue }     = require('../utils/queue/surgeQueue');
const { buildPacketJob } = require('../utils/pdf/packetBuilder');
const Surge              = require('../models/Surge');

// 1) Connect to MongoDB exactly as your web dyno does
// 1) Use the very same rule as app.js
const mongoUri =
  process.env.NODE_ENV === 'production'
    ? process.env.MONGODB_URI_PROD
    : process.env.MONGODB_URI_DEV;

if (!mongoUri) {
  console.error('[Worker] No Mongo URI set – aborting.');
  process.exit(1);
}

mongoose.connect(mongoUri);           // modern Mongoose – no extra flags
mongoose.connection.once('open', () =>
  console.log('[Worker] Mongo =', mongoose.connection.host, mongoose.connection.name));

// 2) Spin up a BullMQ worker using the same TLS-relaxed connection
new Worker(
  surgeQueue.name,
  async job => {
    const { surgeId, householdId, host, cookieHeader } = job.data;

    // Fetch a fresh Surge doc
    const surge = await Surge.findById(surgeId).lean();

    if (!surge) {
      throw new Error(`Surge ${surgeId} not found in DB ${mongoose.connection.name}`);
    }

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
