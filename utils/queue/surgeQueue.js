// utils/queue/surgeQueue.js

// Pick up concurrency from env (fallback to 3)
const concurrency = Number(process.env.SURGE_CONCURRENCY) || 3;

// Kick off your dynamic import right away
const queuePromise = import('p-queue')
  .then(({ default: PQueue }) => new PQueue({ concurrency }));

// Export the promise
module.exports = queuePromise;
