// utils/exports/progress.js

/**
 * Emit export progress events to the user's private room (same pattern as imports).
 * @param {Express} app
 * @param {string} userId
 * @param {{jobId:string, status:string, processed:number, total?:number, message?:string}} payload
 */
function emitProgress(app, userId, payload) {
    const io = app.locals.io;
    if (!io) return;
    io.to(String(userId)).emit('exportProgress', payload);
  }
  
  module.exports = { emitProgress };
  