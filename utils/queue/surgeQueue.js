/* utils/queue/surgeQueue.js – shared BullMQ queue */
const { Queue, QueueEvents } = require('bullmq');
const queueName  = process.env.SURGE_QUEUE_NAME || 'surge-builds';
const connection = { url: process.env.REDIS_URL };

const surgeQueue  = new Queue(queueName,      { connection });
const surgeEvents = new QueueEvents(queueName, { connection });

module.exports = { surgeQueue, surgeEvents };
