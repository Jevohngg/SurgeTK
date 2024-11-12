// routes/adminRoutes.js

const express = require('express');
const router = express.Router();
const { ensureAdmin } = require('../middleware/authMiddleware');
const Notification = require('../models/Notification');
const User = require('../models/User');
const CompanyID = require('../models/CompanyID');
const sgMail = require('@sendgrid/mail');
const crypto = require('crypto');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// GET Admin Dashboard
router.get('/admin', ensureAdmin, async (req, res) => {
  try {
    const companyIds = await CompanyID.find({});
    res.render('admin-dashboard', {
        companyIds,
        user: req.session.user,
        avatar: req.session.user.avatar || '/images/defaultProfilePhoto.png',
      });
  } catch (err) {
    console.error('Error fetching company IDs:', err);
    res.status(500).send('An error occurred.');
  }
});

// POST Add User (Generate Company ID and Send Email)
router.post('/admin/add-user', ensureAdmin, async (req, res) => {
  const { email } = req.body;

  try {
    // Generate a 6-digit company ID
    const companyId = Math.floor(100000 + Math.random() * 900000).toString();

    // Create and save the new CompanyID
    const newCompanyID = new CompanyID({
      companyId,
      assignedEmail: email.toLowerCase(),
      isActive: true,
    });
    await newCompanyID.save();

    // Send the email using SendGrid
    const msg = {
      to: email.toLowerCase(),
      from: 'invictuscfp@gmail.com', // Replace with your email
      templateId: 'd-8dd16526608c41debbd3519e43e35e8d', // Replace with your SendGrid template ID
      dynamic_template_data: {
        companyId,
        // Include any other dynamic data required by your template
      },
    };
    await sgMail.send(msg);

    res.redirect('/admin');
  } catch (err) {
    console.error('Error adding user:', err);
    res.status(500).send('An error occurred.');
  }
});

// POST Toggle Company ID Status
router.post('/admin/toggle-company-id', ensureAdmin, async (req, res) => {
  const { companyId } = req.body;

  try {
    const companyIDEntry = await CompanyID.findOne({ companyId });
    if (!companyIDEntry) {
      return res.status(404).send('Company ID not found.');
    }

    // Toggle the isActive status
    companyIDEntry.isActive = !companyIDEntry.isActive;
    await companyIDEntry.save();

    res.redirect('/admin');
  } catch (err) {
    console.error('Error toggling company ID status:', err);
    res.status(500).send('An error occurred.');
  }
});

router.get('/admin/notifications', ensureAdmin, async (req, res) => {
  try {
    // Fetch all users to select recipients
    const users = await User.find({}, 'email _id companyName');

    res.render('admin-notifications', {
      users,
      user: req.session.user,
      avatar: req.session.user.avatar || '/images/defaultProfilePhoto.png',
    });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).send('An error occurred.');
  }
});

router.post('/admin/notifications', ensureAdmin, async (req, res) => {
  let { userIds, title, message, link } = req.body;

  try {
    if (userIds.includes('all')) {
      // Fetch all user IDs
      const users = await User.find({}, '_id');
      userIds = users.map(user => user._id);
    }

    // Ensure userIds is an array
    if (!Array.isArray(userIds)) {
      userIds = [userIds];
    }

    // Create notifications for each user
    const notifications = userIds.map(userId => ({
      userId,
      title,
      message,
      link,
    }));

    await Notification.insertMany(notifications);

    res.redirect('/admin/notifications');
  } catch (err) {
    console.error('Error creating notifications:', err);
    res.status(500).send('Server error');
  }
});

module.exports = router;
