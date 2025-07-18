// utils/queue/surgeQueue.js
const { Queue, QueueEvents } = require('bullmq');
const queueName = process.env.SURGE_QUEUE_NAME || 'surge-builds';

// Decide which Redis URL to use
const redisUrl =
  process.env.REDIS_URL ||                // production / staging
  process.env.REDIS_URL_DEV ||            // optional dev override
  'redis://127.0.0.1:6379';               // final fallback

// Build BullMQ‑compatible connection opts
const isSecure = redisUrl.startsWith('rediss://');
const connection = isSecure
  ? {
      url: redisUrl,
      tls: { rejectUnauthorized: false }  // Heroku’s self‑signed chain
    }
  : { url: redisUrl };

const surgeQueue  = new Queue(queueName,      { connection });
const surgeEvents = new QueueEvents(queueName, { connection });

module.exports = { surgeQueue, surgeEvents };
