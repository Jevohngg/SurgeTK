// utils/queue/surgeQueue.js
const { Queue, QueueEvents } = require('bullmq');
const redisUrl   = process.env.REDIS_URL;
const queueName  = process.env.SURGE_QUEUE_NAME || 'surge-builds';

/**
 * Heroku Redis uses a self-signed cert by default, so we disable verification
 * here. This tells Node’s TLS stack to accept the cert chain.
 */
const connection = {
  url: redisUrl,
  tls: {
    // ← allow Heroku’s self-signed chain
    rejectUnauthorized: false
  }
};

const surgeQueue  = new Queue(queueName,      { connection });
const surgeEvents = new QueueEvents(queueName, { connection });

module.exports = { surgeQueue, surgeEvents };
