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
function isAdvisorSeat(rolesArray, alsoAdvisor) {
  // If "leadAdvisor" is present, or user is "admin" + alsoAdvisor = true
  if (!Array.isArray(rolesArray)) return false;
  if (rolesArray.includes('leadAdvisor')) return true;

  // Check if roles includes 'admin' and alsoAdvisor is true
  if (rolesArray.includes('admin') && alsoAdvisor) {
    return true;
  }
  return false;
}

// ==============================
// POST /team/invite
// ==============================
router.post('/invite', ensureAdmin, async (req, res) => {
  try {
    // Gather everything from req.body
    const {
      email,
      roles,
      permission,
      alsoAdvisor,
      leadAdvisorPermission,
      assistantToLeadAdvisors,
      assistantPermission,
      teamMemberPermission
    } = req.body;

    // Debug logs
    console.log('[DEBUG] /team/invite request body =>', {
      email,
      roles,
      permission,
      alsoAdvisor,
      leadAdvisorPermission,
      assistantToLeadAdvisors,
      assistantPermission,
      teamMemberPermission
    });

    const inviter = req.session.user;
    const firm = await CompanyID.findById(inviter.firmId);
    if (!firm) {
      return res.status(400).json({ message: 'Firm not found.' });
    }

    // 1) Unify final roles & permission
    const finalRoles = Array.isArray(roles) ? roles : [];
    let finalPermission = permission || 'assistant';

    // If "leadAdvisor" is in roles, or "advisor" is in roles => permission becomes 'advisor'
    if (finalRoles.includes('leadAdvisor') || finalRoles.includes('advisor')) {
      finalPermission = 'advisor';
    }
    if (finalRoles.includes('admin')) {
      finalPermission = 'admin';
    }

    // Check if this new invite would be an advisor seat
    const isUserAdvisor = isAdvisorSeat(finalRoles);

    // Seat-limit checks:
    const existingUsers = await User.find({ firmId: firm._id });
    const existingAdvisorsCount = existingUsers.filter(u => isAdvisorSeat(u.roles)).length;
    const invitedAdvisorsCount = (firm.invitedUsers || []).filter(inv => isAdvisorSeat(inv.roles)).length;
    const totalAdvisors = existingAdvisorsCount + invitedAdvisorsCount;

    const totalUsers = existingUsers.length + (firm.invitedUsers || []).length;
    const totalNonAdvisors = totalUsers - totalAdvisors;

    const { maxAdvisors, maxNonAdvisors } = calculateSeatLimits(firm);

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

    // 7) Ensure user doesn’t already exist in the firm
    const existingUser = await User.findOne({ email: email.toLowerCase(), firmId: firm._id });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists in this firm.' });
    }

    // 8) Build the invited user object, store only fields relevant to the roles
    const invitedUserObj = {
      email: email.toLowerCase(),
      roles: finalRoles,
      permission: finalPermission,
      alsoAdvisor: !!alsoAdvisor // optional
    };

    // If they're a lead advisor, store leadAdvisorPermission (if you want):
    if (finalRoles.includes('leadAdvisor')) {
      // If leadAdvisorPermission is missing, store a fallback or skip
      if (leadAdvisorPermission) {
        invitedUserObj.leadAdvisorPermission = leadAdvisorPermission;
      }
    }

    // If they're an assistant, store the relevant fields
    if (finalRoles.includes('assistant')) {
      if (assistantPermission) {
        invitedUserObj.assistantPermission = assistantPermission;
      }
      if (Array.isArray(assistantToLeadAdvisors) && assistantToLeadAdvisors.length > 0) {
        invitedUserObj.assistantToLeadAdvisors = assistantToLeadAdvisors;
      }
    }

    // If they're a team member, store teamMemberPermission
    if (finalRoles.includes('teamMember')) {
      if (teamMemberPermission) {
        invitedUserObj.teamMemberPermission = teamMemberPermission;
      }
    }

    console.log('[DEBUG] invitedUserObj =>', invitedUserObj);

    // 9) Mark onboarding if needed
    if (!firm.onboardingProgress.inviteTeam) {
      firm.onboardingProgress.inviteTeam = true;
    }

    // 10) Push into invitedUsers
    firm.invitedUsers.push(invitedUserObj);
    await firm.save();

    console.log('[DEBUG] firm saved. firm.invitedUsers now =>', firm.invitedUsers);

    // 11) Send the SendGrid email invitation
    const msg = {
      to: email.toLowerCase(),
      from: 'SurgeTk <support@notifications.surgetk.com>', // Verified sender
      templateId: 'd-29c1b414fba24c34b5e91ebf8400b3cd',
      dynamic_template_data: {
        firm_name: firm.companyName || 'Your Company',
        first_name: '',
        inviter_name: inviter.firstName || '',
        invited_email: email.toLowerCase(),
        inviter_email: inviter.email,
        signup_url: `https://app.surgetk.com/signup?email=${encodeURIComponent(email.toLowerCase())}`
        // signup_url: `http://localhost:3000/signup?email=${encodeURIComponent(email.toLowerCase())}`

      },
    };
    try {
      await sgMail.send(msg);
    } catch (emailError) {
      console.error('Error sending invite email:', emailError);
      // decide if revert is needed
    }

    return res.json({ success: true, message: 'Invitation sent successfully' });
  } catch (error) {
    console.error('Error in /invite:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});




// ==============================
// GET /team/users
// ==============================
// teamRoutes.js (updated GET /team/users)
router.get('/users', async (req, res) => {
  try {
    const user = req.session.user;
    if (!user) return res.status(401).send('Not authenticated');

    const firm = await CompanyID.findById(user.firmId);
    if (!firm) return res.status(400).send('Firm not found');

    // 1) Fetch actual registered users for this firm
    //    We'll exclude password & twoFASecret, but we want sub-permissions:
    const actualUsers = await User.find(
      { firmId: user.firmId },
      '-password -twoFASecret'
    ).lean();



    console.log('[DEBUG] actualUsers =>', actualUsers.map(u => ({
      _id: u._id,
      email: u.email,
      roles: u.roles,
      assistantToLeadAdvisors: u.assistantToLeadAdvisors
    })));

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

        // Return sub-permission fields (added below!)
        leadAdvisorPermission: u.leadAdvisorPermission || '',
        assistantPermission: u.assistantPermission || '',
        assistantToLeadAdvisors: u.assistantToLeadAdvisors || [],
        teamMemberPermission: u.teamMemberPermission || '',

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
          // If you like, you can also store sub-permission fields for invites:
          leadAdvisorPermission: i.leadAdvisorPermission || '',
          assistantPermission: i.assistantPermission || '',
          assistantToLeadAdvisors: i.assistantToLeadAdvisors || [],
          teamMemberPermission: i.teamMemberPermission || '',

          status: 'pending',
          isFirmCreator: false // invited user cannot be creator
        };
      });

    // 4) Combine all
    const members = [...actualUserMembers, ...invitedMembers];

    // 5) Calculate seat usage for "Seats Remaining"
    const existingAdvisorsCount = actualUsers.filter(u =>
      isAdvisorSeat(u.roles)
    ).length;
    const invitedAdvisorsCount = invited.filter(inv =>
      isAdvisorSeat(inv.roles)
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
    const wasAdvisor = isAdvisorSeat(targetUser.roles);
    const isBecomingAdvisor = isAdvisorSeat(roles);

    if (isBecomingAdvisor && !wasAdvisor) {
      const firm = await CompanyID.findById(targetUser.firmId);
      if (!firm) {
        return res.status(400).json({ message: 'Associated firm not found.' });
      }

      const existingUsers = await User.find({ firmId: firm._id });
      const existingAdvisorsCount = existingUsers.filter(u =>
        isAdvisorSeat(u.roles)
      ).length;

      const invitedAdvisorsCount = (firm.invitedUsers || []).filter(inv =>
        isAdvisorSeat(inv.roles)
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
