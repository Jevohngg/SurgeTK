// models/Notification.js

const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true }, // Main text
  message: { type: String }, // Subtext
  timestamp: { type: Date, default: Date.now },
  isRead: { type: Boolean, default: false },
  link: { type: String }, // Optional: link to navigate when clicked
  isDeleted: { type: Boolean, default: false }, // Added field for soft delete
});

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
