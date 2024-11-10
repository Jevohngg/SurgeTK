// routes/adminRoutes.js

const express = require('express');
const router = express.Router();
const { ensureAdmin } = require('../middleware/authMiddleware');
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

module.exports = router;
