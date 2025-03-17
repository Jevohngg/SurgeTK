// routes/teamRoutes.js

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const CompanyID = require('../models/CompanyID');
const sgMail = require('@sendgrid/mail');
const { ensureAdmin } = require('../middleware/roleMiddleware');
const { calculateSeatLimits } = require('../utils/subscriptionUtils'); 

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

/**
 * Helper to determine if a user is effectively an "advisor" seat.
 * Now we IGNORE permission entirely. Only 'advisor' in roles matters.
 */
function isAdvisor(rolesArray) {
  return rolesArray.includes('advisor');
}

// ==============================
// POST /team/invite
// ==============================
router.post('/invite', ensureAdmin, async (req, res) => {
  try {
    const { email, roles, permission } = req.body;
    const inviter = req.session.user;

    const firm = await CompanyID.findById(inviter.firmId);
    if (!firm) {
      return res.status(400).json({ message: 'Firm not found.' });
    }

    // 1) unify final roles & permission
    const finalRoles = Array.isArray(roles) ? roles : [];
    let finalPermission = permission || 'assistant';

    // If roles includes 'advisor', set finalPermission = 'advisor'
    // else if roles includes 'admin', set finalPermission = 'admin'
    // else remain 'assistant'
    if (finalRoles.includes('advisor')) {
      finalPermission = 'advisor';
    } else if (finalRoles.includes('admin')) {
      finalPermission = 'admin';
    }

    // 2) Are they effectively an advisor seat (ignoring permission)?
    const isUserAdvisor = isAdvisor(finalRoles);

    // 3) Load all existing users
    const existingUsers = await User.find({ firmId: firm._id });

    // 4) Count how many existing advisors (IGNORE permission)
    const existingAdvisorsCount = existingUsers.filter(u =>
      isAdvisor(u.roles)
    ).length;

    // 5) Count invited advisors
    const invitedAdvisorsCount = (firm.invitedUsers || []).filter(inv =>
      isAdvisor(inv.roles)
    ).length;

    const totalAdvisors = existingAdvisorsCount + invitedAdvisorsCount;

    // 6) Calculate total & seat usage
    const totalUsers = existingUsers.length + (firm.invitedUsers || []).length;
    const totalNonAdvisors = totalUsers - totalAdvisors;

    const { maxAdvisors, maxNonAdvisors } = calculateSeatLimits(firm);

    // 7) Check seat usage
    if (isUserAdvisor) {
      if (totalAdvisors >= maxAdvisors) {
        return res.status(403).json({
          message: 'You have reached the maximum number of advisor seats. Upgrade your plan to invite more advisors.'
        });
      }
    } else {
      if (totalNonAdvisors >= maxNonAdvisors) {
        return res.status(403).json({
          message: 'You have reached the maximum number of non-advisor seats. Upgrade your plan to invite more members.'
        });
      }
    }

    // 8) Ensure user doesn’t exist already
    const existingUser = await User.findOne({
      email: email.toLowerCase(),
      firmId: firm._id
    });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists in this firm.' });
    }


    // 9) Push to invitedUsers
    firm.invitedUsers.push({
      email: email.toLowerCase(),
      roles: finalRoles,
      permission: finalPermission
    });

    if (!firm.onboardingProgress.inviteTeam) {
      firm.onboardingProgress.inviteTeam = true;
    }

    await firm.save();

    return res.json({ success: true, message: 'Invitation sent successfully' });
  } catch (error) {
    console.error('Error in /invite:', error);
    return res.status(500).json({ message: 'Server error' });
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
  
    // 1) Fetch actual registered users for this firm
    const actualUsers = await User.find(
      { firmId: user.firmId },
      '-password -twoFASecret'
    ).lean();

    // 2) Convert actual users for the front-end
    const actualUserMembers = actualUsers.map(u => {
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
        roles: u.roles,
        permission: u.permission,

        status: 'active',
        isFirmCreator: u.isFirmCreator
      };
    });

    // 3) Pending invites
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
          isFirmCreator: false // invited user cannot be creator
        };
      });

    // 4) Combine all
    const members = [...actualUserMembers, ...invitedMembers];

    // 5) Calculate seat usage for "Seats Remaining"
    //    IGNORE permission entirely, just check roles
    const existingAdvisorsCount = actualUsers.filter(u =>
      isAdvisor(u.roles)
    ).length;
    const invitedAdvisorsCount = invited.filter(inv =>
      isAdvisor(inv.roles)
    ).length;

    const totalAdvisors = existingAdvisorsCount + invitedAdvisorsCount;
    const totalUsers = actualUsers.length + invited.length;
    const totalNonAdvisors = totalUsers - totalAdvisors;

    const { maxAdvisors, maxNonAdvisors } = calculateSeatLimits(firm);

    const advisorSeatsRemaining = Math.max(0, maxAdvisors - totalAdvisors);
    const nonAdvisorSeatsRemaining = Math.max(0, maxNonAdvisors - totalNonAdvisors);

    // 6) Return
    res.json({
      currentUserEmail: user.email,
      currentUserId: user._id,
      members,
      advisorSeatsRemaining,
      nonAdvisorSeatsRemaining
    });
  } catch (error) {
    console.error('/team/users error:', error);
    res.status(500).send('Server error');
  }
});

// ==============================
// POST /team/remove
// ==============================
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

    // Check admin
    const isAdminAccess =
      (Array.isArray(requestingUser.roles) && requestingUser.roles.includes('admin')) ||
      requestingUser.permission === 'admin';
    if (!isAdminAccess) {
      return res.status(403).json({ message: 'Forbidden. Admin access required.' });
    }

    const { email } = req.body;
    const emailLower = email.toLowerCase();

    // 1) Real user check
    let userToRemove = await User.findOne({ email: emailLower, firmId: requestingUser.firmId });
    if (userToRemove) {
      // Prevent removing the firm creator
      if (userToRemove.isFirmCreator) {
        return res.status(403).json({ message: 'Cannot remove the firm creator.' });
      }

      // "Remove" user by clearing references
      userToRemove.companyId = null;
      userToRemove.companyName = null;
      userToRemove.firmId = null;
      await userToRemove.save();

      return res.status(200).json({ message: `Removed ${email} successfully.` });
    }

    // 2) Must be in invitedUsers
    const firm = await CompanyID.findById(requestingUser.firmId);
    if (!firm) {
      return res.status(400).json({ message: 'Firm not found.' });
    }

    const invitedIndex = (firm.invitedUsers || []).findIndex(
      inv => inv.email.toLowerCase() === emailLower
    );
    if (invitedIndex === -1) {
      return res.status(404).json({ message: 'Pending user not found in invited list.' });
    }

    firm.invitedUsers.splice(invitedIndex, 1);
    await firm.save();

    return res.status(200).json({ message: `Removed pending user ${email} successfully.` });
  } catch (err) {
    console.error('/team/remove error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
});

// ==============================
// PATCH /team/users/:userId
// ==============================
router.patch('/users/:userId', async (req, res) => {
  try {
    const sessionUser = req.session.user;
    if (!sessionUser) {
      return res.status(401).json({ message: 'Not authenticated.' });
    }
    const requestingUser = await User.findById(sessionUser._id);
    if (!requestingUser) {
      return res.status(401).json({ message: 'Requesting user not found.' });
    }

    // Check admin
    const isAdminAccess =
      requestingUser.permission === 'admin' || requestingUser.roles.includes('admin');
    if (!isAdminAccess) {
      return res.status(403).json({ message: 'Forbidden. Admin access required.' });
    }

    // 1) Find the target user
    const { userId } = req.params;
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // 2) Optional: prevent editing the firm creator
    if (
      targetUser.isFirmCreator &&
      targetUser._id.toString() !== requestingUser._id.toString()
    ) {
      return res.status(403).json({ message: 'Cannot edit the firm creator.' });
    }

    // 3) Roles & permission from body
    let { roles, permission } = req.body;
    if (!Array.isArray(roles)) roles = [];

    let finalPermission = permission || 'assistant';
    if (roles.includes('advisor')) {
      finalPermission = 'advisor';
    } else if (roles.includes('admin')) {
      finalPermission = 'admin';
    }

    // 4) If newly becoming an advisor, seat check
    const wasAdvisor = isAdvisor(targetUser.roles);
    const isBecomingAdvisor = isAdvisor(roles);

    if (isBecomingAdvisor && !wasAdvisor) {
      const firm = await CompanyID.findById(targetUser.firmId);
      if (!firm) {
        return res.status(400).json({ message: 'Associated firm not found.' });
      }

      const existingUsers = await User.find({ firmId: firm._id });
      const existingAdvisorsCount = existingUsers.filter(u =>
        isAdvisor(u.roles)
      ).length;

      const invitedAdvisorsCount = (firm.invitedUsers || []).filter(inv =>
        isAdvisor(inv.roles)
      ).length;

      const totalAdvisors = existingAdvisorsCount + invitedAdvisorsCount;
      const { maxAdvisors } = calculateSeatLimits(firm);

      if (totalAdvisors >= maxAdvisors) {
        return res.status(403).json({
          message:
            'You have reached the maximum number of advisor seats. Upgrade your plan to convert more users into advisors.'
        });
      }
    }

    // 5) Save changes
    targetUser.roles = roles;
    targetUser.permission = finalPermission;
    await targetUser.save();

    return res.status(200).json({
      message: `User ${targetUser.email} updated successfully.`,
      user: {
        _id: targetUser._id,
        email: targetUser.email,
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
