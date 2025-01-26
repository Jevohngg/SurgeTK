// routes/teamRoutes.js

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const CompanyID = require('../models/CompanyID');
const sgMail = require('@sendgrid/mail');
const { ensureAdmin } = require('../middleware/roleMiddleware');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Helper to build a boolean-permissions object { admin, advisor, assistant }
 * from a single permission string ('admin','advisor','assistant').
 */
function buildPermissionsObject(singlePermission) {
  const perms = { admin: false, advisor: false, assistant: false };
  if (!singlePermission) return perms;
  if (perms.hasOwnProperty(singlePermission)) {
    perms[singlePermission] = true; // e.g. perms['admin'] = true
  }
  return perms;
}

/**
 * Helper to pick a "primary" role to keep old front-end code happy.
 * If roles array includes 'admin', we pick 'admin';
 * else if includes 'advisor', we pick 'advisor';
 * else if includes 'assistant', we pick 'assistant';
 * else fallback 'unassigned'.
 */
function deriveSingleRole(rolesArray) {
  if (!Array.isArray(rolesArray)) return 'unassigned';
  if (rolesArray.includes('admin')) return 'admin';
  if (rolesArray.includes('advisor')) return 'advisor';
  if (rolesArray.includes('assistant')) return 'assistant';
  return 'unassigned';
}

// ==============================
// POST /team/invite
// ==============================
// routes/teamRoutes.js

router.post('/invite', ensureAdmin, async (req, res) => {
  try {
    const { email, roles, permission, companyId } = req.body;
    const inviter = req.session.user;

    const firm = await CompanyID.findById(inviter.firmId);
    if (!firm) {
      return res.status(400).json({ message: 'Firm not found.' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      email: email.toLowerCase(),
      firmId: firm._id
    });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists in this firm.' });
    }

    // Send the invite email via SendGrid...
    // (omitted for brevity)

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // STEP 1: Make sure we have a final roles array
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    const finalRoles = Array.isArray(roles) ? roles : [];

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // STEP 2: Derive a consistent single "permission"
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    let finalPermission = permission || 'assistant';
    
    // If "admin" is included => override to 'admin'
    if (finalRoles.includes('admin')) {
      finalPermission = 'admin';
    }
    // Else if "advisor" is included => override to 'advisor'
    else if (finalRoles.includes('advisor')) {
      finalPermission = 'advisor';
    }
    // Else fallback => 'assistant'

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // STEP 3: Push into invitedUsers with unified roles & permission
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    firm.invitedUsers.push({
      email: email.toLowerCase(),
      roles: finalRoles,                 // e.g. ['admin','advisor']
      permission: finalPermission        // e.g. 'admin'
    });
    
    await firm.save();

    res.json({ success: true, message: 'Invitation sent successfully' });
  } catch (error) {
    console.error('Error in /invite:', error);
    res.status(500).json({ message: 'Server error' });
  }
});



// ==============================
// GET /team/users
// ==============================
router.get('/users', async (req, res) => {
  try {
    const user = req.session.user;
    if (!user) return res.status(401).send('Not authenticated');

    const firm = await CompanyID.findById(user.firmId);
    if (!firm) return res.status(400).send('Firm not found');

    // Fetch actual registered users for this firm
    const actualUsers = await User.find(
      { firmId: user.firmId },
      '-password -twoFASecret'
    ).lean();

    // Convert actual users to a shape the old front-end expects:
    //   { role: string, permissions: { admin,advisor,assistant }, ... }
    const actualUserMembers = actualUsers.map(u => {
      // Build an old-style "role" from roles array
      const singleRole = deriveSingleRole(u.roles);
      const permsObj = buildPermissionsObject(u.permission);

      return {
        _id: u._id,
        email: u.email,
        avatar: u.avatar,
        // old front-end fields:
        role: singleRole,
        permissions: permsObj,

        // For display/tracking:
        roles: u.roles,          // new field if front-end wants it
        permission: u.permission,// new field if front-end wants it

        status: 'active',
        isFirmCreator: u.isFirmCreator
      };
    });

    // Invited users from firm.invitedUsers
    const invited = firm.invitedUsers || [];
    const actualUserEmails = actualUsers.map(u => u.email.toLowerCase());
    const invitedMembers = invited
      .filter(i => !actualUserEmails.includes(i.email.toLowerCase()))
      .map(i => {
        const singleRole = deriveSingleRole(i.roles || []);
        const permsObj = buildPermissionsObject(i.permission);

        return {
          email: i.email,
          // old front-end fields:
          role: singleRole,
          permissions: permsObj,

          // new fields
          roles: i.roles || [],
          permission: i.permission || 'assistant',

          status: 'pending',
          isFirmCreator: false // invited user cannot be the creator
        };
      });

    // Combine actual + invited
    const members = [...actualUserMembers, ...invitedMembers];

    res.json({
      currentUserEmail: user.email,
      currentUserId: user._id, // For front-end checks
      members
    });
  } catch (error) {
    console.error('/team/users error:', error);
    res.status(500).send('Server error');
  }
});

router.post('/remove', async (req, res) => {
  try {
    const sessionUser = req.session.user;
    if (!sessionUser) {
      return res.status(401).json({ message: 'No user in session, not authenticated.' });
    }

    const requestingUser = await User.findById(sessionUser._id);
    if (!requestingUser) {
      return res.status(401).json({ message: 'User not found or not authenticated.' });
    }

    // Check if requestingUser is an admin (by roles or permission)
    const isAdminAccess =
      (Array.isArray(requestingUser.roles) && requestingUser.roles.includes('admin')) ||
      requestingUser.permission === 'admin';
    if (!isAdminAccess) {
      return res.status(403).json({ message: 'Forbidden. Admin access required.' });
    }

    const { email } = req.body;
    const emailLower = email.toLowerCase();

    // 1) Attempt to find a REAL user in the User collection
    let userToRemove = await User.findOne({ email: emailLower, firmId: requestingUser.firmId });

    // If user is found, remove them from the firm
    if (userToRemove) {
      // Prevent removing the firm creator
      if (userToRemove.isFirmCreator) {
        return res.status(403).json({ message: 'Cannot remove the firm creator.' });
      }

      // "Remove" user from the firm by clearing firm/company associations
      userToRemove.companyId = null;
      userToRemove.companyName = null;
      userToRemove.firmId = null;
      await userToRemove.save();

      return res.status(200).json({ message: `Removed ${email} successfully.` });
    }

    // 2) If we reach here, user not found in "User" => must be in invitedUsers
    const firm = await CompanyID.findById(requestingUser.firmId);
    if (!firm) {
      return res.status(400).json({ message: 'Firm not found.' });
    }

    // Check if the email is in invitedUsers
    const invitedIndex = (firm.invitedUsers || []).findIndex(
      (inv) => inv.email.toLowerCase() === emailLower
    );

    if (invitedIndex === -1) {
      // Not found in invitedUsers either => nothing to remove
      return res.status(404).json({ message: 'Pending user not found in invited list.' });
    }

    // Remove from invitedUsers array
    firm.invitedUsers.splice(invitedIndex, 1);
    await firm.save();

    return res.status(200).json({ message: `Removed pending user ${email} successfully.` });
  } catch (err) {
    console.error('/team/remove error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});


// ==============================
// PATCH /team/users/:userId - Edit a user
// ==============================
router.patch('/users/:userId', async (req, res) => {
  try {
    const sessionUser = req.session.user;
    if (!sessionUser) {
      return res.status(401).json({ message: 'No user in session, not authenticated.' });
    }

    const requestingUser = await User.findById(sessionUser._id);
    if (!requestingUser) {
      return res.status(401).json({ message: 'User not found or not authenticated.' });
    }

    // Check admin rights
    const isAdminAccess =
      (requestingUser.roles && requestingUser.roles.includes('admin')) ||
      requestingUser.permission === 'admin';

    if (!isAdminAccess) {
      return res.status(403).json({ message: 'Forbidden. Admin access required.' });
    }

    const { userId } = req.params;
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Prevent editing the firm creator (unless it's the same user)
    if (
      targetUser.isFirmCreator &&
      targetUser._id.toString() !== requestingUser._id.toString()
    ) {
      return res.status(403).json({ message: 'Cannot edit the firm creator.' });
    }

    // We now expect { roles: [...], permission: '' }
    const { roles, permission } = req.body;
    if (Array.isArray(roles)) {
      targetUser.roles = roles;
    }
    if (permission) {
      targetUser.permission = permission;
    }

    await targetUser.save();

    // Return a shape consistent with front-end expectations
    return res.status(200).json({
      message: `User ${targetUser.email} updated successfully.`,
      user: {
        email: targetUser.email,
        // Single role for legacy front-end usage
        role: deriveSingleRole(targetUser.roles),
        // Old booleans for front-end usage
        permissions: buildPermissionsObject(targetUser.permission),
        // Full new data if needed
        roles: targetUser.roles,
        permission: targetUser.permission
      }
    });
  } catch (error) {
    console.error('Error updating user:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;
