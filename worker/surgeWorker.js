// worker/surgeWorker.js
require('dotenv').config();
const mongoose           = require('mongoose');
const { Worker }         = require('bullmq');
const { surgeQueue }     = require('../utils/queue/surgeQueue');
const { buildPacketJob } = require('../utils/pdf/packetBuilder');
const Surge              = require('../models/Surge');
const SurgeSnapshot     = require('../models/SurgeSnapshot');

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
    const {
      surgeId,
      householdId,
      host,
      cookieHeader,
      regenerate = true      // ← default to “rebuild & replace”
    } = job.data;

    // Fetch a fresh Surge doc
    const surge = await Surge.findById(surgeId).lean();

    if (!surge) {
      throw new Error(`Surge ${surgeId} not found in DB ${mongoose.connection.name}`);
    }

    // If not regenerating and a snapshot already exists, skip work (optional)
    if (!regenerate) {
      const exists = await SurgeSnapshot.exists({ surgeId, household: householdId });
      if (exists) {
        await job.log(`[SurgeWorker] Skipping build for HH ${householdId} (already exists; regenerate=false)`);
        return { householdId, skipped: true };
      }
    }

    // If regenerating, remove any stale/duplicate snapshots before rebuild
    // (The builder will upsert the new single snapshot; S3 upload overwrites by key.)
    if (regenerate) {
      try {
        const del = await SurgeSnapshot.deleteMany({ surgeId, household: householdId });
        if (del.deletedCount) {
          await job.log(`[SurgeWorker] Cleared ${del.deletedCount} old snapshots for HH ${householdId}`);
        }
      } catch (e) {
        // Not fatal; continue to rebuild/replace
        await job.log(`[SurgeWorker] Snapshot cleanup error for HH ${householdId}: ${e.message}`);
      }
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
