// routes/teamRoutes.js

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const CompanyID = require('../models/CompanyID');
const sgMail = require('@sendgrid/mail');
const { ensureAdmin } = require('../middleware/roleMiddleware');
const { calculateSeatLimits } = require('../utils/subscriptionUtils'); 
const { deriveSinglePermission } = require('../utils/roleUtils'); 
const { logError } = require('../utils/errorLogger');

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
    // Step 1: Parse expected fields from body
    const {
      email,
      role,
      alsoAdvisor,
      leadAdvisorPermission,
      assistantToLeadAdvisors,
      assistantPermission,
      teamMemberPermission
    } = req.body;

    // 2) Verify the inviter's firm
    const inviter = req.session.user;
    const firm = await CompanyID.findById(inviter.firmId);
    if (!firm) {
      return res.status(400).json({ message: 'Firm not found.' });
    }

    // 3) Build finalRoles from the primaryRole + alsoAdvisor
    let finalRoles = [];
    if (role === 'admin') {
      finalRoles.push('admin');
      if (alsoAdvisor) {
        finalRoles.push('leadAdvisor');
      }
    } else if (role === 'leadAdvisor') {
      finalRoles.push('leadAdvisor');
    } else if (role === 'assistant') {
      finalRoles.push('assistant');
    } else if (role === 'teamMember') {
      finalRoles.push('teamMember');
    }

    // 4) Derive single "permission" (legacy) using your helper
    const finalPermission = deriveSinglePermission(finalRoles);

    // 5) Determine if this user is considered an advisor seat
    const isUserAdvisor = isAdvisorSeat(finalRoles, alsoAdvisor);

    // 6) Seat-limit checks
    const existingUsers = await User.find({ firmId: firm._id });
    const existingAdvisorsCount = existingUsers.filter(u =>
      isAdvisorSeat(u.roles, u.alsoAdvisor)
    ).length;
    const invitedAdvisorsCount = (firm.invitedUsers || []).filter(inv =>
      isAdvisorSeat(inv.roles, inv.alsoAdvisor)
    ).length;
    const totalAdvisors = existingAdvisorsCount + invitedAdvisorsCount;
    const totalUsers = existingUsers.length + (firm.invitedUsers || []).length;
    const totalNonAdvisors = totalUsers - totalAdvisors;

    const { maxAdvisors, maxNonAdvisors } = calculateSeatLimits(firm);

    if (isUserAdvisor) {
      if (totalAdvisors >= maxAdvisors) {
        return res.status(403).json({
          message:
            'You have reached the maximum number of advisor seats. Upgrade your plan to invite more advisors.'
        });
      }
    } else {
      if (totalNonAdvisors >= maxNonAdvisors) {
        return res.status(403).json({
          message:
            'You have reached the maximum number of non-advisor seats. Upgrade your plan to invite more members.'
        });
      }
    }

    // 7) Check if there's a user with this email in the SAME firm
    const emailLower = email.toLowerCase();
    const existingUserSameFirm = await User.findOne({
      email: emailLower,
      firmId: firm._id
    });
    if (existingUserSameFirm) {
      return res.status(400).json({ message: 'User already exists in this firm.' });
    }

    // 8) Check if there's a user with this email at all (any firm)
    const userWithThatEmail = await User.findOne({ email: emailLower });
    const isNewUser = !userWithThatEmail;

    // 9) Build the invited user object
    const invitedUserObj = {
      email: emailLower,
      roles: finalRoles,
      permission: finalPermission,
      alsoAdvisor: !!alsoAdvisor
    };

    if (finalRoles.includes('leadAdvisor')) {
      invitedUserObj.leadAdvisorPermission = leadAdvisorPermission || 'all';
    }
    if (finalRoles.includes('assistant')) {
      invitedUserObj.assistantPermission = assistantPermission || 'inherit';
      if (Array.isArray(assistantToLeadAdvisors) && assistantToLeadAdvisors.length > 0) {
        invitedUserObj.assistantToLeadAdvisors = assistantToLeadAdvisors;
      }
    }
    if (finalRoles.includes('teamMember')) {
      invitedUserObj.teamMemberPermission = teamMemberPermission || 'viewEdit';
    }

    // 10) Mark onboarding if needed
    if (!firm.onboardingProgress.inviteTeam) {
      firm.onboardingProgress.inviteTeam = true;
    }

    // 11) Push into invitedUsers array
    firm.invitedUsers.push(invitedUserObj);
    await firm.save();

    // 12) Determine which SendGrid template to use based on new vs. existing user
    let templateId;
    let dynamicData = {};

    if (isNewUser) {
      // Use your original "new user" template
      templateId = 'd-29c1b414fba24c34b5e91ebf8400b3cd';
      dynamicData = {
        firm_name: firm.companyName || 'Your Company',
        first_name: '', // If you want to personalize further, adjust here
        inviter_name: inviter.firstName || '',
        invited_email: emailLower,
        inviter_email: inviter.email,
        signup_url: `https://app.surgetk.com/signup?email=${encodeURIComponent(emailLower)}`
      };
    } else {
      // Use your special "already has an account" template
      templateId = 'd-8ca827cfc1cc4e8c9ba1f5ef2d5c116e';
      dynamicData = {
        firm_name: firm.companyName || 'Your Company',
        inviter_name: inviter.firstName || '',
        invited_email: emailLower,
        // You can customize this however you'd like. For example:
        user_role_name: role
      };
    }

    // 13) Send the SendGrid email invitation
    const msg = {
      to: emailLower,
      from: 'SurgeTk <support@notifications.surgetk.com>',
      templateId: templateId,
      dynamic_template_data: dynamicData
    };

    try {
      await sgMail.send(msg);
    } catch (emailError) {
      await logError(req, 'Error sending invite email:', { severity: 'warning' });
      console.error('Error sending invite email:', emailError);
      // Typically no rollback; handle as needed
    }

    return res.json({ success: true, message: 'Invitation sent successfully' });
  } catch (error) {
    await logError(req, 'Error in /invite:', { severity: 'warning' });
    console.error('Error in /invite:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});






function deriveRoleAndPermission(userDoc) {
  const roles = Array.isArray(userDoc.roles) ? userDoc.roles : [];
  let displayRole = 'unassigned';

  // Priority: leadAdvisor > assistant > teamMember > admin
  if (roles.includes('leadAdvisor')) {
    displayRole = 'leadAdvisor';
  } else if (roles.includes('assistant')) {
    displayRole = 'assistant';
  } else if (roles.includes('teamMember')) {
    displayRole = 'teamMember';
  } else if (roles.includes('admin')) {
    displayRole = 'admin';
  }

  let displayPermission = 'unassigned';
  switch (displayRole) {
    case 'leadAdvisor':
      displayPermission = userDoc.leadAdvisorPermission || 'all';
      break;
    case 'assistant':
      displayPermission = userDoc.assistantPermission || 'inherit';
      break;
    case 'teamMember':
      displayPermission = userDoc.teamMemberPermission || 'viewEdit';
      break;
    case 'admin':
      // If user is purely admin with no other role
      displayPermission = 'admin';
      break;
    default:
      // fallback
      displayPermission = userDoc.permission || 'unassigned';
      break;
  }

  return { displayRole, displayPermission };
}


// ==============================
// GET /team/users
// ==============================
router.get('/users', async (req, res) => {
  try {
    const user = req.session.user;
    if (!user) return res.status(401).send('Not authenticated');

    const firm = await CompanyID.findById(user.firmId);
    if (!firm) return res.status(400).send('Firm not found');

    // 1) Fetch actual users
    const actualUsers = await User.find(
      { firmId: user.firmId },
      '-password -twoFASecret'
    ).lean();

    // Convert actual users
    const actualUserMembers = actualUsers.map(u => {
      const { displayRole, displayPermission } = deriveRoleAndPermission(u);

      return {
        _id: u._id,
        email: u.email,
        avatar: u.avatar,
        role: displayRole,             // e.g. 'admin', 'leadAdvisor', ...
        permissions: displayPermission, // e.g. 'admin', 'all', 'inherit', ...
        roles: u.roles, 
        permission: u.permission,
        leadAdvisorPermission: u.leadAdvisorPermission,
        assistantPermission: u.assistantPermission,
        assistantToLeadAdvisors: u.assistantToLeadAdvisors,
        teamMemberPermission: u.teamMemberPermission,
        status: 'active',
        isFirmCreator: !!u.isFirmCreator
      };
    });

    // 2) Pending invites in firm.invitedUsers
    const invited = firm.invitedUsers || [];
    const actualUserEmails = actualUsers.map(u => u.email.toLowerCase());

    // Convert invited
    const invitedMembers = invited
      .filter(i => !actualUserEmails.includes(i.email.toLowerCase()))
      .map(i => {
        // We'll treat i as a "pseudo userDoc"
        const pseudoUserDoc = {
          roles: i.roles,
          permission: i.permission,
          leadAdvisorPermission: i.leadAdvisorPermission,
          assistantPermission: i.assistantPermission,
          assistantToLeadAdvisors: i.assistantToLeadAdvisors,
          teamMemberPermission: i.teamMemberPermission,
        };
        const { displayRole, displayPermission } = deriveRoleAndPermission(pseudoUserDoc);

        return {
          email: i.email,
          role: displayRole,
          permissions: displayPermission,
          roles: i.roles,
          permission: i.permission,
          leadAdvisorPermission: i.leadAdvisorPermission,
          assistantPermission: i.assistantPermission,
          assistantToLeadAdvisors: i.assistantToLeadAdvisors,
          teamMemberPermission: i.teamMemberPermission,
          status: 'pending',
          isFirmCreator: false
        };
      });

    // 3) Combine active + invited
    const members = [...actualUserMembers, ...invitedMembers];

    // 4) Calculate seat usage
    const existingAdvisorsCount = actualUsers.filter(u => isAdvisorSeat(u.roles, u.alsoAdvisor)).length;
    const invitedAdvisorsCount = invited.filter(inv => isAdvisorSeat(inv.roles, inv.alsoAdvisor)).length;
    const totalAdvisors = existingAdvisorsCount + invitedAdvisorsCount;
    const totalUsers = actualUsers.length + invited.length;
    const totalNonAdvisors = totalUsers - totalAdvisors;

    const { maxAdvisors, maxNonAdvisors } = calculateSeatLimits(firm);
    const advisorSeatsRemaining = Math.max(0, maxAdvisors - totalAdvisors);
    const nonAdvisorSeatsRemaining = Math.max(0, maxNonAdvisors - totalNonAdvisors);

    // 5) Return data
    res.json({
      currentUserEmail: user.email,
      currentUserId: user._id,
      members,
      advisorSeatsRemaining,
      nonAdvisorSeatsRemaining
    });
  } catch (error) {
    await logError(req, '/team/users error:', { severity: 'warning' });
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
    await logError(req, '/team/remove error:', { severity: 'warning' });
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

    // Check if requestingUser is admin
    const isAdminAccess =
      requestingUser.permission === 'admin' ||
      (Array.isArray(requestingUser.roles) && requestingUser.roles.includes('admin'));

    if (!isAdminAccess) {
      return res.status(403).json({ message: 'Forbidden. Admin access required.' });
    }

    // Extract fields from body
    const {
      role,                      // "admin" | "leadAdvisor" | "assistant" | "teamMember"
      alsoAdvisor,               // boolean
      leadAdvisorPermission,     // "admin" | "all" | "limited" | "selfOnly"
      assistantToLeadAdvisors,   // array of userIds
      assistantPermission,       // "admin" | "inherit"
      teamMemberPermission       // "admin" | "viewEdit" | "viewOnly"
    } = req.body;

    // 1) Find the target user
    const { userId } = req.params;
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // 2) Prevent editing the firm creator unless it's themselves
    if (targetUser.isFirmCreator && targetUser._id.toString() !== requestingUser._id.toString()) {
      return res.status(403).json({ message: 'Cannot edit the firm creator.' });
    }

    // 3) Build new roles array from "role" + alsoAdvisor
    let newRoles = [];
    if (role === 'admin') {
      newRoles.push('admin');
      if (alsoAdvisor) {
        newRoles.push('leadAdvisor');
      }
    } else if (role === 'leadAdvisor') {
      newRoles.push('leadAdvisor');
    } else if (role === 'assistant') {
      newRoles.push('assistant');
    } else if (role === 'teamMember') {
      newRoles.push('teamMember');
    }

    // 4) Derive single permission from newRoles
    const newPermission = deriveSinglePermission(newRoles);

    // 5) Sub-permissions if relevant
    let finalLeadAdvisorPerm = undefined;
    let finalAssistantPerm = undefined;
    let finalAssistantTo = undefined;
    let finalTeamMemberPerm = undefined;

    if (newRoles.includes('leadAdvisor')) {
      finalLeadAdvisorPerm = leadAdvisorPermission || 'all';
    }
    if (newRoles.includes('assistant')) {
      finalAssistantPerm = assistantPermission || 'inherit';
      finalAssistantTo = Array.isArray(assistantToLeadAdvisors) ? assistantToLeadAdvisors : [];
    }
    if (newRoles.includes('teamMember')) {
      finalTeamMemberPerm = teamMemberPermission || 'viewEdit';
    }

    // 6) Check seat-limits if the user is newly becoming an advisor
    const wasAdvisor = isAdvisorSeat(targetUser.roles, targetUser.alsoAdvisor);
    const isBecomingAdvisor = isAdvisorSeat(newRoles, alsoAdvisor);

    if (isBecomingAdvisor && !wasAdvisor) {
      const firm = await CompanyID.findById(targetUser.firmId);
      if (!firm) {
        return res.status(400).json({ message: 'Associated firm not found.' });
      }

      const existingUsers = await User.find({ firmId: firm._id });
      const existingAdvisorsCount = existingUsers.filter(u => isAdvisorSeat(u.roles, u.alsoAdvisor)).length;
      const invitedAdvisorsCount = (firm.invitedUsers || []).filter(inv => isAdvisorSeat(inv.roles, inv.alsoAdvisor)).length;
      const totalAdvisors = existingAdvisorsCount + invitedAdvisorsCount;
      const { maxAdvisors } = calculateSeatLimits(firm);

      if (totalAdvisors >= maxAdvisors) {
        return res.status(403).json({
          message:
            'You have reached the maximum number of advisor seats. Upgrade your plan to convert more users into advisors.'
        });
      }
    }

    // 7) Save changes
    targetUser.roles = newRoles;
    targetUser.permission = newPermission;
    targetUser.alsoAdvisor = (role === 'admin') ? !!alsoAdvisor : false;
    targetUser.leadAdvisorPermission = finalLeadAdvisorPerm;
    targetUser.assistantPermission = finalAssistantPerm;
    targetUser.assistantToLeadAdvisors = finalAssistantTo;
    targetUser.teamMemberPermission = finalTeamMemberPerm;

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
    await logError(req, 'Error updating user:', { severity: 'warning' });
    
    console.error('Error updating user:', error);
    return res.status(500).json({ message: 'Server error.' });
  }
});


module.exports = router;
