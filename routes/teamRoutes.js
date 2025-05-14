// routes/teamRoutes.js

const express = require('express');
const router = express.Router();
const CompanyID = require('../models/CompanyID');
const ImportedAdvisor = require('../models/ImportedAdvisor');
const User = require('../models/User');
const Client = require('../models/Client');
const Household = require('../models/Household');
const sgMail = require('@sendgrid/mail');
const { ensureAdmin } = require('../middleware/roleMiddleware');
const { calculateSeatLimits } = require('../utils/subscriptionUtils'); 
const { deriveSinglePermission } = require('../utils/roleUtils'); 
const { logError } = require('../utils/errorLogger');
const RedtailAdvisor = require('../models/RedtailAdvisor');




sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Helper to build a boolean-permissions object { admin, leadAdvisor, assistant }
 * from a single permission string ('admin','leadAdvisor','assistant').
 */
function buildPermissionsObject(singlePermission) {
  const perms = { admin: false, leadAdvisor: false, assistant: false };
  if (!singlePermission) return perms;
  if (perms.hasOwnProperty(singlePermission)) {
    perms[singlePermission] = true; // e.g. perms['admin'] = true
  }
  return perms;
}


function deriveSingleRole(rolesArray) {
  if (!Array.isArray(rolesArray)) return 'unassigned';
  if (rolesArray.includes('admin')) return 'admin';
  if (rolesArray.includes('advisor')) return 'leadAdvisor';
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



// routes/redtailRoutes.js (or integrations.js)
router.get('/unlinked-advisors', ensureAdmin, async (req, res) => {
  try {
    const firmId = req.session.user.firmId;
    if (!firmId) {
      return res.status(400).json({ message: 'No firm in session.' });
    }

    const unlinked = await RedtailAdvisor.find({ 
      firmId, 
      linkedUser: null 
    }).lean();

    res.json({ success: true, unlinkedAdvisors: unlinked });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /link-advisor
router.post('/link-advisor', ensureAdmin, async (req, res) => {
  try {
    const { redtailAdvisorId, userId } = req.body;
    const firmId = req.session.user?.firmId;

    console.log('[DEBUG] Incoming link request:', { redtailAdvisorId, userId, firmId });

    if (!firmId) {
      console.error('[DEBUG] No firm found in session. Cannot proceed.');
      return res.status(400).json({ message: 'No firm found in session' });
    }

    // 1) Validate user is indeed a leadAdvisor in this firm
    const targetUser = await User.findOne({
      _id: userId,
      firmId,
      roles: 'leadAdvisor'
    });
    if (!targetUser) {
      console.warn('[DEBUG] Target user not found or not a leadAdvisor:', { userId, firmId });
      return res
        .status(400)
        .json({ message: 'Target user is not a valid leadAdvisor in this firm.' });
    }
    console.log('[DEBUG] Found valid leadAdvisor user =>', {
      _id: targetUser._id,
      email: targetUser.email
    });

    // 2) Retrieve the RedtailAdvisor doc
    const rtAdvisor = await RedtailAdvisor.findOne({ firmId, redtailAdvisorId });
    if (!rtAdvisor) {
      console.warn('[DEBUG] No RedtailAdvisor doc found for:', { firmId, redtailAdvisorId });
      return res
        .status(404)
        .json({ message: 'No matching RedtailAdvisor found.' });
    }
    console.log('[DEBUG] Found RedtailAdvisor doc =>', {
      id: rtAdvisor._id,
      redtailAdvisorId: rtAdvisor.redtailAdvisorId,
      advisorName: rtAdvisor.advisorName
    });

    // 3) Link the SurgeTK user to this Redtail advisor
    rtAdvisor.linkedUser = targetUser._id;
    await rtAdvisor.save();
    console.log('[DEBUG] RedtailAdvisor updated with linkedUser:', rtAdvisor.linkedUser);

    // 4) Update all Households that reference this Redtail advisor in SERVICING only
    const queryServicing = {
      firmId,
      redtailServicingAdvisorId: rtAdvisor.redtailAdvisorId
    };

    console.log('[DEBUG] queryServicing =', queryServicing);

    // (A) Check how many households match
    const servicingCountBefore = await Household.countDocuments(queryServicing);
    console.log(`[DEBUG] Households matching servicing query: ${servicingCountBefore}`);

    // (B) For households where this advisor is servicing
    const servicingResult = await Household.updateMany(queryServicing, {
      $set: { servicingLeadAdvisor: targetUser._id },
      $addToSet: { leadAdvisors: targetUser._id }
    });

    console.log('[DEBUG] servicingResult =>', servicingResult);

    // (C) Check how many households match after (should be unchanged)
    const servicingCountAfter = await Household.countDocuments(queryServicing);
    console.log(`[DEBUG] Households still matching servicing query: ${servicingCountAfter}`);

    // 5) Return success
    console.log('[DEBUG] Link operation complete. Returning success.');
    return res.json({
      success: true,
      message: 'Lead Advisor (servicing) linked successfully!'
    });
  } catch (err) {
    console.error('[DEBUG] Error in POST /link-advisor:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});




router.get('/unlinked-imported-advisors', ensureAdmin, async (req, res) => {
  try {
    const firmId = req.session.user?.firmId;
    if (!firmId) {
      return res.status(400).json({ success: false, message: 'No firm in session.' });
    }

    // Find any ImportedAdvisor docs that do not have a linkedUser
    const unlinked = await ImportedAdvisor.find({
      firmId,
      linkedUser: { $eq: null }
    }).lean();

    // Return them to the frontend
    res.json({ success: true, unlinkedImportedAdvisors: unlinked });
  } catch (err) {
    console.error('[DEBUG] Error fetching unlinked imported advisors:', err);
    res.status(500).json({ success: false, message: 'Failed to load unlinked imported advisors.' });
  }
});


router.post('/link-imported-advisor', ensureAdmin, async (req, res) => {
  try {
    const { importedAdvisorId, userId } = req.body;
    const firmId = req.session.user?.firmId;

    if (!importedAdvisorId || !userId) {
      return res.status(400).json({ success: false, message: 'Missing data.' });
    }

    // 1) Find the ImportedAdvisor doc
    const impAdvisor = await ImportedAdvisor.findOne({ _id: importedAdvisorId, firmId });
    if (!impAdvisor) {
      return res.status(404).json({ success: false, message: 'Imported Advisor not found.' });
    }

    // 2) Link the doc to the real user
    impAdvisor.linkedUser = userId;
    await impAdvisor.save();

    // 3) Parse the name (e.g. "Marcus Black")
    const importedName = (impAdvisor.importedAdvisorName || '').trim();
    const [first, ...rest] = importedName.split(' ');
    const last = rest.join(' ');

    // 4) Find all Clients in the firm that have leadAdvisorFirstName / leadAdvisorLastName matching
    //    (Case-insensitive)
    const matchingClients = await Client.find({
      firmId,
      leadAdvisorFirstName: new RegExp(`^${escapeRegex(first)}$`, 'i'),
      leadAdvisorLastName:  new RegExp(`^${escapeRegex(last)}$`, 'i')
    });

    if (!matchingClients.length) {
      console.log('[DEBUG] No matching clients found for:', importedName);
      return res.json({
        success: true,
        message: `No matching Clients found for "${importedName}", but advisor doc linked.`
      });
    }

    // 5) For each client, update their Household doc
    let updatedHouseholdsCount = 0;
    for (const client of matchingClients) {
      if (!client.household) continue;
      const hh = await Household.findById(client.household);
      if (!hh) continue;

      // Add the user to leadAdvisors array
      hh.leadAdvisors.addToSet(userId);

      await hh.save();
      updatedHouseholdsCount++;
      console.log(`[DEBUG] Updated Household ${hh._id} => leadAdvisors:`, hh.leadAdvisors);
    }

    return res.json({
      success: true,
      message: `Imported Advisor linked; updated ${updatedHouseholdsCount} households.`
    });

  } catch (err) {
    console.error('[DEBUG] Error linking imported advisor:', err);
    return res.status(500).json({ success: false, message: 'Failed to link imported advisor.' });
  }
});

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}



/**
 * Helper function: findMatchingClientsByName
 * Tries to parse the imported name into (firstName, lastName).
 * If it fails to find a direct match, tries ignoring middle name, etc.
 */
async function findMatchingClientsByName(firmId, fullName) {
  // First, split tokens
  const tokens = fullName.split(/\s+/).filter(Boolean); // split by spaces
  if (!tokens.length) return [];

  // Basic approach:
  //  - If only 1 token => treat it as lastName
  //  - If 2 tokens => firstName = tokens[0], lastName = tokens[1]
  //  - If 3 or more => firstName = tokens[0], lastName = tokens[tokens.length-1]; middle is everything else
  // Then try exact match. If not found, try ignoring middle. 
  // (You can adjust logic as needed.)

  let first, middle, last;
  if (tokens.length === 1) {
    first = ''; 
    middle = '';
    last = tokens[0]; // e.g. "Cher" or "Madonna" style
  } else if (tokens.length === 2) {
    [first, last] = tokens;
    middle = '';
  } else {
    first = tokens[0];
    last  = tokens[tokens.length - 1];
    middle = tokens.slice(1, -1).join(' '); // everything in the middle
  }

  // 1) Try matching exactly on first + last
  let clients = await Client.find({
    firmId,
    leadAdvisorFirstName: new RegExp(`^${escapeRegex(first)}$`, 'i'),
    leadAdvisorLastName:  new RegExp(`^${escapeRegex(last)}$`, 'i')
  });

  if (clients.length) {
    return clients;
  }

  // 2) If no matches and there's a middle portion, try combining first + middle as the "firstName"
  //    e.g. "John B." => "John B."
  if (middle) {
    const combinedFirst = `${first} ${middle}`.trim();
    clients = await Client.find({
      firmId,
      leadAdvisorFirstName: new RegExp(`^${escapeRegex(combinedFirst)}$`, 'i'),
      leadAdvisorLastName:  new RegExp(`^${escapeRegex(last)}$`, 'i')
    });
  }

  return clients; // might be empty if still not found
}





module.exports = router;
