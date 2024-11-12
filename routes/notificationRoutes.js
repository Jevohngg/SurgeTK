// routes/notificationRoutes.js

const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { ensureAuthenticated, ensureAdmin } = require('../middleware/authMiddleware');

// GET notifications for the logged-in user
router.get('/notifications', ensureAuthenticated, async (req, res) => {
  try {
    const notifications = await Notification.find({ userId: req.session.user._id })
      .sort({ timestamp: -1 })
      .limit(20); // Adjust limit as needed
    res.json(notifications);
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).send('Server error');
  }
});

// Mark a notification as read
router.post('/notifications/:id/read', ensureAuthenticated, async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.session.user._id },
      { isRead: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating notification:', err);
    res.status(500).send('Server error');
  }
});



router.post('/admin/notifications', ensureAdmin, async (req, res) => {
    let { userIds, title, message, link } = req.body;
  
    try {
      if (userIds.includes('all')) {
        const users = await User.find({}, '_id');
        userIds = users.map(user => user._id);
      }
  
      if (!Array.isArray(userIds)) {
        userIds = [userIds];
      }
  
      const notifications = userIds.map(userId => ({
        userId,
        title,
        message,
        link,
      }));
  
      const createdNotifications = await Notification.insertMany(notifications);
  
      // Emit notifications to users via Socket.io
      userIds.forEach(userId => {
        io.to(userId).emit('new_notification', createdNotifications.find(n => n.userId.toString() === userId.toString()));
      });
  
      res.redirect('/admin/notifications');
    } catch (err) {
      console.error('Error creating notifications:', err);
      res.status(500).send('Server error');
    }
  });

module.exports = router;
