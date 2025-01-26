// routes/onboardingRoutes.js
const express = require('express');
const mongoose = require('mongoose');
const CompanyID = require('../models/CompanyID');
const User = require('../models/User');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const crypto = require('crypto');

const router = express.Router();

// GET /onboarding
// Shows options to set up a new firm or join an existing one
router.get('/', ensureAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.user._id);

  // If user already has a firmId or a role != unassigned, skip
  if (user.firmId) {
    return res.redirect('/dashboard');
  }

  res.render('onboarding', {
    user,
  });
});



router.post('/create-firm', ensureAuthenticated, async (req, res) => {
  try {
    console.log('--- createFirm route triggered ---');
    console.log('Incoming form fields:', req.body);

    const { companyName, companyEmail, phoneNumber, companyAddress } = req.body;
    const user = await User.findById(req.session.user._id);

    if (!user) {
      console.log('User not found in session. Something is wrong.');
      return res.redirect('/dashboard');
    }
    if (user.firmId) {
      console.log('User already has a firmId. Redirecting to dashboard.');
      return res.redirect('/dashboard');
    }

    // Generate the random ID
    const generatedCompanyId = crypto.randomBytes(3).toString('hex').toLowerCase();
    console.log('Generated random Company ID =>', generatedCompanyId);

    const newFirm = new CompanyID({
      companyId: generatedCompanyId,
      companyName,
      assignedEmail: companyEmail,
      phoneNumber,
      companyAddress,
      isUsed: true,
      companyLogo: '',
      invitedUsers: [
        {
          email: user.email,
          role: 'admin',
          permissions: {}
        }
      ]
    });

    const savedFirm = await newFirm.save();
    console.log('Saved new firm =>', savedFirm);

    user.firmId = savedFirm._id;
    user.roles = ['admin'];    // ADDED
    user.permission = 'admin'; // ADDED
 
    // For backward-compat
    user.companyId = generatedCompanyId;
    user.companyName = companyName;

    // ADDED: Mark this user as the firm creator
    user.isFirmCreator = true;

    // Save the updated user
    const savedUser = await user.save();
    console.log('Updated user =>', savedUser);

    // Update session data with the newest user info
    req.session.user = savedUser;

    // Wait for session to be fully saved
    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return res.redirect('/dashboard');
  } catch (error) {
    console.error('Error creating firm:', error);
    return res.status(500).send('Error creating new firm');
  }
});


  
  
  

// POST /onboarding/join-firm
// This can just show a message or logic to confirm if the user is invited
router.post('/join-firm', ensureAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.user._id);

  if (!user) return res.redirect('/login');

  // If the user is invited to a firm (the existing logic in userRoutes or admin invite)
  // their firmId should already be set. So just check if firmId is set:
  if (user.firmId) {
    return res.redirect('/dashboard');
  } else {
    // Show a message instructing them to wait for an invitation
    // or redirect back to onboarding with a flash message
    return res.render('onboarding', {
      user,
      errorMessage: 'You are not yet invited to a firm. Please request an invitation.'
    });
  }
});

module.exports = router;
