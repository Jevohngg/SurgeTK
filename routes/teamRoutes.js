// routes/teamRoutes.js

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const CompanyID = require('../models/CompanyID');
const sgMail = require('@sendgrid/mail');
const { ensureAdmin } = require('../middleware/roleMiddleware');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// POST /team/invite - super_admin invites a new user
// Body: { email, role, permissions (optional) }
router.post('/invite', ensureAdmin, async (req, res) => {
    try {
      const { email, role, permissions } = req.body;
      const inviter = req.session.user;
  
      // Fetch the firm's company info
      const firm = await CompanyID.findById(inviter.firmId);
      if (!firm) return res.status(400).send('Firm not found');
  
      // Check if user already exists in this firm
      const existingUser = await User.findOne({ email: email.toLowerCase(), firmId: firm._id });
      if (existingUser) {
        return res.status(400).send('User already exists in this firm.');
      }
  
      // Send the invite email using the provided dynamic template
      const msg = {
        to: email.toLowerCase(),
        from: 'invictuscfp@gmail.com', // Your verified sender email
        templateId: 'd-b083df4401c4434b972277c11caf582e', // Your dynamic SendGrid template ID
        dynamic_template_data: {
          companyName: firm.companyName || 'Your Firm',
          companyId: firm.companyId
        },
      };
  
      await sgMail.send(msg);
  
      // Store the invited user's role and permissions in the firm's invitedUsers array
      if (!firm.invitedUsers) {
        firm.invitedUsers = [];
      }
  
      firm.invitedUsers.push({ email: email.toLowerCase(), role: role, permissions: permissions || {} });
      await firm.save();
  
      res.json({ success: true, message: 'Invitation sent successfully' });
    } catch (error) {
      console.error(error);
      res.status(500).send('Server error');
    }
  });





  router.get('/users', async (req, res) => {
    try {
      const user = req.session.user;
      if (!user) return res.status(401).send('Not authenticated');
  
      const firm = await CompanyID.findById(user.firmId);
      if (!firm) return res.status(400).send('Firm not found');
  
      // Fetch actual registered users for this firm
      const actualUsers = await User.find({ firmId: user.firmId }, '-password -twoFASecret').lean();
  
      // Map actual users to a structure that includes status
      const actualUserMembers = actualUsers.map(u => ({
        email: u.email,
        avatar: u.avatar,
        role: u.role,
        permissions: u.permissions,
        status: 'active'
      }));
  
      // Determine which invited users haven't signed up yet
      const invited = firm.invitedUsers || [];
      const actualUserEmails = actualUsers.map(u => u.email.toLowerCase());
  
      // Filter invited users to those not in actual users
      const invitedMembers = invited
        .filter(i => !actualUserEmails.includes(i.email.toLowerCase()))
        .map(i => ({
          email: i.email,
          role: i.role,
          permissions: i.permissions,
          // Mark them as pending because they haven't signed up yet
          status: 'pending'
        }));
  
      // Combine actual users and invited pending users
      const members = [...actualUserMembers, ...invitedMembers];
  
      res.json({
        currentUserEmail: user.email,
        members
      });
    } catch (error) {
      console.error(error);
      res.status(500).send('Server error');
    }
  });
  
  

// PUT /team/user/:id - Update user role/permissions
router.put('/user/:id', ensureAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role, permissions } = req.body;
    const user = req.session.user;

    if (!['admin', 'advisor', 'assistant'].includes(role)) {
      return res.status(400).send('Invalid role');
    }

    const updatedUser = await User.findOneAndUpdate(
      { _id: id, firmId: user.firmId },
      { role: role, permissions: permissions || {} },
      { new: true }
    );

    if (!updatedUser) return res.status(404).send('User not found');
    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});

// DELETE /team/user/:id - Remove a user from the firm
router.delete('/user/:id', ensureAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.session.user;

    // Prevent removing the super_admin itself if you want (optional)
    const userToRemove = await User.findOne({ _id: id, firmId: user.firmId });
    if (!userToRemove) return res.status(404).send('User not found');
    if (userToRemove.role === 'super_admin') {
      return res.status(400).send('Cannot remove the super_admin.');
    }

    await User.deleteOne({ _id: id, firmId: user.firmId });
    res.json({ success: true, message: 'User removed' });
  } catch (error) {
    console.error(error);
    res.status(500).send('Server error');
  }
});


module.exports = router;
