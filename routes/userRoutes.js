// routes/userRoutes.js

const express = require('express');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('../models/User');
const CompanyID = require('../models/CompanyID'); // Import CompanyID model
const sgMail = require('@sendgrid/mail');
const axios = require('axios');
const ipinfo = require('ipinfo');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const { sendFirmWelcomeEmail } = require('../utils/sendemails.js');
const { logError } = require('../utils/errorLogger');
const { pickSafeRedirect } = require('../middleware/returnTo'); // adjust path if needed


const router = express.Router();


// GET route for login page
// userRoutes.js

router.get('/login', (req, res) => {
  // 1) If user is authenticated, redirect to dashboard
  if (req.session && req.session.user) {
    const redirectUrl = req.session.returnTo || '/dashboard';
delete req.session.returnTo; // so it doesn't linger for future logins
return res.redirect(redirectUrl);

  }

  // 2) Otherwise, continue showing the login page
  const success = req.query.success;
  let successMessage = null;

  if (success === '1') {
    successMessage = 'Your password has been updated successfully. You may now sign in.';
  } else if (success === 'logout') {
    successMessage = 'You have been logged out successfully.';
  }

  res.render('login-signup', { 
    errors: {}, 
    companyId: '', 
    companyName: '', 
    email: '', 
    activeTab: 'login', 
    successMessage: successMessage 
  });
});


// GET route for the signup page
router.get('/signup', (req, res) => {
  // Grab prefilled email from query
  const prefilledEmail = req.query.email || ''; 
  // Pass it to the Pug template
  res.render('login-signup', { 
    errors: {}, 
    companyId: '', 
    companyName: '', 
    email: prefilledEmail,     // <--- pass it along
    activeTab: 'signup'
  });
});


router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, confirmPassword } = req.body;
  let errors = {};

  try {
    const emailLower = email.toLowerCase();

    // 1) Basic validation
    const existingUser = await User.findOne({ email: emailLower });
    if (existingUser) {
      await logError(req, 'This email is already registered', { severity: 'warning' });
      errors.emailError = 'This email is already registered.';
    }

    if (password.length < 8 || !/[^A-Za-z0-9]/.test(password)) {
      await logError(req, 'Password must be at least 8 characters and include a special character.', { severity: 'warning' });
      errors.passwordError = 'Password must be at least 8 characters and include a special character.';
    }
    if (password !== confirmPassword) {
      await logError(req, 'Passwords do not match.', { severity: 'warning' });
      errors.passwordMatchError = 'Passwords do not match.';
    }

    if (Object.keys(errors).length > 0) {
      return res.render('login-signup', {
        errors,
        email,
        activeTab: 'signup',
      });
    }

    // =========================
    // 2) Check for invite in "firm.invitedUsers"
    //    Gather roles/permissions but DO NOT send email yet
    // =========================
    let finalRoles = [];
    let finalPermission = 'assistant'; 
    let alsoAdvisor = false;
    let leadAdvisorPermission = '';
    let assistantPermission = '';
    let assistantToLeadAdvisors = [];
    let teamMemberPermission = '';

    const possibleFirm = await CompanyID.findOne({ 'invitedUsers.email': emailLower });
    let invitedObj = null;
    if (possibleFirm) {
      invitedObj = possibleFirm.invitedUsers.find(inv => inv.email.toLowerCase() === emailLower);
      if (invitedObj) {
        // Copy roles, sub-permissions
        finalRoles = invitedObj.roles || [];
        finalPermission = invitedObj.permission || 'assistant';
        alsoAdvisor = invitedObj.alsoAdvisor || false;
        if (invitedObj.leadAdvisorPermission) {
          leadAdvisorPermission = invitedObj.leadAdvisorPermission;
        }
        if (invitedObj.assistantPermission) {
          assistantPermission = invitedObj.assistantPermission;
        }
        if (Array.isArray(invitedObj.assistantToLeadAdvisors)) {
          assistantToLeadAdvisors = invitedObj.assistantToLeadAdvisors;
        }
        if (invitedObj.teamMemberPermission) {
          teamMemberPermission = invitedObj.teamMemberPermission;
        }

        // Remove the invite from the firm (but do NOT send the email yet)
        possibleFirm.invitedUsers = possibleFirm.invitedUsers.filter(
          inv => inv.email.toLowerCase() !== emailLower
        );
        await possibleFirm.save();
      }
    }

    // 3) Create verification code & hash password
    const verificationCode = crypto.randomBytes(2).toString('hex').toUpperCase();
    const hashedPw = await bcrypt.hash(password, 10);

    // 4) Create newUser
    const newUser = new User({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: emailLower,
      password: hashedPw,
      emailVerified: false,
      verificationCode
    });

    // 5) Assign roles & firm if we found an invite
    if (finalRoles.length > 0) {
      newUser.roles = finalRoles;
      newUser.permission = finalPermission;
      newUser.alsoAdvisor = alsoAdvisor;
      newUser.leadAdvisorPermission = leadAdvisorPermission;
      newUser.assistantPermission = assistantPermission;
      newUser.assistantToLeadAdvisors = assistantToLeadAdvisors;
      newUser.teamMemberPermission = teamMemberPermission;
    }

    if (possibleFirm) {
      newUser.firmId = possibleFirm._id;
      newUser.companyId = possibleFirm.companyId;
      newUser.companyName = possibleFirm.companyName;
    }

    // 6) Save the user
    await newUser.save();

    // 7) If this was an invited user, send the "Welcome to Firm" email
    if (invitedObj) {
      const roleName = getRoleName(newUser.roles);
      const roleDescription = (roleName === 'Admin')
        ? 'An Admin has full system access.'
        : 'Welcome aboard!';

      await sendFirmWelcomeEmail({
        user: newUser,
        firm: possibleFirm,
        roleName,
        roleDescription,
        roleLink: 'https://app.surgetk.com/help-center/user_role/'
      });
    }

    // 8) Send the verification email
    const msg = {
      to: emailLower,
      from: 'SurgeTk <support@notifications.surgetk.com>',
      templateId: 'd-198bd40ae9cd4ae9935cbd16a595cc3c',
      dynamic_template_data: {
        companyName: 'Your Company',
        verificationCode,
        userName: firstName,
      },
    };
    await sgMail.send(msg);

    // 9) Render the verification form
    return res.render('login-signup', {
      showVerifyForm: true,
      email: emailLower,
      errors: {},
    });
  } catch (err) {
    console.error('Error during signup:', err);
    let errors = {};
    // 11000 => Duplicate key error
    if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
      await logError(req, 'This email is already registered.', { severity: 'warning' });
      errors.emailError = 'This email is already registered.';
      return res.render('login-signup', {
        errors,
        email,
        activeTab: 'signup',
      });
    }
    return res.status(500).send('An error occurred during signup.');
  }
});



// routes/userRoutes.js

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  let errors = {};

  try {
    const emailLower = email.toLowerCase();
    const user = await User.findOne({ email: emailLower });

    if (!user) {
      await logError(req, 'Invalid email or password.', { severity: 'warning' });
      errors.loginEmailError = 'Invalid email or password.';
    } else {
      // Check password
      const isMatch = user ? await bcrypt.compare(password, user.password) : false;
      if (!isMatch) {
        await logError(req, 'Invalid email or password.', { severity: 'warning' });
        errors.loginPasswordError = 'Invalid email or password.';
      }

      // If any error so far, re-render login
      if (Object.keys(errors).length > 0) {
        return res.render('login-signup', {
          errors,
          email,
          activeTab: 'login',
        });
      }

      // Email verification check
      if (!user.emailVerified) {
        // Generate a new verification code
        const verificationCode = crypto.randomBytes(2).toString('hex').toUpperCase();
        user.verificationCode = verificationCode;
        await user.save();

        // Send verification email
        const msg = {
          to: emailLower,
          from: 'SurgeTk <support@notifications.surgetk.com>',
          templateId: 'd-198bd40ae9cd4ae9935cbd16a595cc3c',
          dynamic_template_data: {
            companyName: 'Your Company',
            verificationCode: verificationCode,
            userName: user.firstName || emailLower.split('@')[0],
          },
        };
        await sgMail.send(msg);
        console.log('here is the verification code', verificationCode);

        // Show verification form
        return res.render('login-signup', {
          showVerifyForm: true,
          email: emailLower,
          errors: {}
        });
      }

      // If user is verified, check 2FA
      if (user.is2FAEnabled) {
        // Temporarily store user ID in session until 2FA is verified
        req.session.temp_user = user._id;
        return res.render('login-signup', {
          errors: {},
          activeTab: 'login',
          show2FAModal: true
        });
      }

      // If user has no 2FA => proceed with normal flow
      req.session.user = user;
      await logSignIn(user, req);

      // ==============================
      // INVITATION CHECK (firmId)
      // ==============================
      if (!user.firmId) {
        const firm = await CompanyID.findOne({
          'invitedUsers.email': emailLower
        });

        if (firm) {
          // Find invitation entry
          const invitedUser = firm.invitedUsers.find(
            (inv) => inv.email.toLowerCase() === emailLower
          );

          if (invitedUser) {
            // 1) Assign user to that firm
            user.firmId     = firm._id;
            user.companyId  = firm.companyId;
            user.companyName= firm.companyName;

            // 2) Copy roles/permission from invited data
            user.roles      = invitedUser.roles;
            user.permission = invitedUser.permission;

            await user.save();

            // 3) Remove them from the invitedUsers list
            firm.invitedUsers = firm.invitedUsers.filter(
              (inv) => inv.email.toLowerCase() !== emailLower
            );
            await firm.save();

            const roleName = getRoleName(user.roles);
            const roleDescription = (roleName === 'Admin')
              ? 'An Admin has full system access.'
              : 'Welcome aboard!';

            await sendFirmWelcomeEmail({
              user,
              firm,
              roleName,
              roleDescription
            });
          }
        }

        // If user STILL has no firm => go to onboarding
        if (!user.firmId) {
          return res.redirect('/onboarding');
        }
      }

      // ==============================
      // SUBSCRIPTION STATUS CHECK
      // ==============================
      if (user.firmId) {
        const firm = await CompanyID.findById(user.firmId);
        if (firm) {
          const { subscriptionStatus } = firm;
          // Normalize 'unpaid' as 'past_due' if needed
          if (['canceled', 'past_due', 'unpaid'].includes(subscriptionStatus)) {
            // Check if user is admin
            const isAdminUser =
              (user.permission === 'admin') ||
              (Array.isArray(user.roles) && user.roles.includes('admin')) ||
              (user.permissions?.admin === true);

            if (isAdminUser) {
              // Admin => allow login, but limit access to billing
              // Mark a flag in session to restrict routes
              req.session.limitedAccess = true;
              // Redirect them to new billing-limited page
              return res.redirect('/billing-limited');
            } else {
              // Non-admin => block login entirely
              delete req.session.user; // Remove any partial session

              return res.render('login-signup', {
                errors: {},
                activeTab: 'login',
                showSubscriptionBlockedModal: true,
                email,
              });
            }
          }
        }
      }

      // ==============================
      // WELCOME MODAL CHECK
      // ==============================
      if (!user.hasSeenWelcomeModal) {
        req.session.showWelcomeModal = true;
        user.hasSeenWelcomeModal = true;
        await user.save();
      }

      // Normal flow: redirect to dashboard
// Normal flow: safe post-login redirect
const dest = pickSafeRedirect(req, '/dashboard');
return res.redirect(dest);

    }

    // If errors exist at this point (just in case)
    if (Object.keys(errors).length > 0) {
      return res.render('login-signup', {
        errors,
        email,
        activeTab: 'login',
      });
    }
  } catch (err) {
    console.error('Error during login:', err);
    return res.status(500).render('login-signup', {
      errors: { general: 'An error occurred during login.' },
      email,
      activeTab: 'login',
    });
  }
});


// Route to verify 2FA token
router.post('/login/2fa', express.json(), async (req, res) => {
  const { token } = req.body;
  const tempUserId = req.session.temp_user;

  if (!tempUserId) {
    return res.status(400).json({ message: 'No 2FA authentication in progress.' });
  }

  try {
    const user = await User.findById(tempUserId);
    if (!user) {
      return res.status(404).json({ message: 'User not found in 2FA process.' });
    }

    // Verify the TOTP token
    const verified = speakeasy.totp.verify({
      secret: user.twoFASecret,
      encoding: 'base32',
      token,
      window: 1 // small +/- step window if desired
    });

    if (!verified) {
      return res.status(400).json({ message: 'Invalid 2FA token.' });
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // 2FA is correct => check subscription
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    req.session.user = user; // tentatively log them in
    delete req.session.temp_user;

    await logSignIn(user, req); // log the sign-in event

    // Check the firm's subscription if user has a firm
    if (user.firmId) {
      const firm = await CompanyID.findById(user.firmId);
      if (firm) {
        const { subscriptionStatus } = firm;

        // If canceled, past due, or unpaid => block or redirect
        if (['canceled', 'past_due', 'unpaid'].includes(subscriptionStatus)) {
          const isAdminUser =
            user.permission === 'admin' ||
            (Array.isArray(user.roles) && user.roles.includes('admin')) ||
            (user.permissions && user.permissions.admin === true);

          if (isAdminUser) {
            // Admin => let them in but direct to /billing-limited
            req.session.limitedAccess = true;
            return res.json({ success: true, redirect: '/billing-limited' });
          } else {
            // Non-admin => show same "subscription blocked" modal
            // remove the session so they can't access the dashboard
            delete req.session.user;

            return res.json({
              success: false,
              showSubscriptionBlockedModal: true,
              message: 'Your firm’s subscription is inactive. Contact an admin to reactivate.'
            });
            
          }
        }
      }
      // Else subscription is valid => proceed
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Subscription good or no firm => normal flow
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Normal flow: safe post-login redirect
const dest = pickSafeRedirect(req, '/dashboard');
return res.redirect(dest);


    return res.json({ success: true, redirect: redirectUrl });

  } catch (err) {
    console.error('Error during 2FA verification:', err);
    return res.status(500).json({ message: 'An error occurred during 2FA verification.' });
  }
});


// Verify email route
router.post('/verify-email', async (req, res) => {
  const { email, verificationCode } = req.body;

  try {
    // 1. Fetch the user by exact email
    const user = await User.findOne({ email });
    if (!user) {
      return res.render('login-signup', {
        email,
        showVerifyForm: true,
        error: 'User not found.'
      });
    }

    // 2. Check verification code (case-insensitive)
    if ((user.verificationCode || '').toUpperCase() === verificationCode.toUpperCase()) {
      user.emailVerified = true;
      user.verificationCode = null;
      await user.save();  // Ensure user is now emailVerified

      // If user doesn't have a firm => check invites
      if (!user.firmId) {
        const firm = await CompanyID.findOne({
          'invitedUsers.email': user.email.toLowerCase()
        });

        if (firm) {
          // Find that invitation
          const invitedUser = firm.invitedUsers.find(
            (iu) => iu.email.toLowerCase() === user.email.toLowerCase()
          );

          if (invitedUser) {
            // 1) Assign user to that firm
            user.firmId = firm._id;
            user.companyId = firm.companyId;
            user.companyName = firm.companyName;
            user.roles = invitedUser.roles;          // e.g. ['admin','advisor']
            user.permission = invitedUser.permission; // e.g. 'admin'
            
            await user.save();

            // 2) Remove from invitedUsers
            firm.invitedUsers = firm.invitedUsers.filter(
              (iu) => iu.email.toLowerCase() !== user.email.toLowerCase()
            );
            await firm.save();

            const roleName = getRoleName(user.roles);
            await sendFirmWelcomeEmail({ user, firm, roleName });

            // 3) Set session
            req.session.user = user;
            await new Promise((resolve, reject) => {
              req.session.save(err => (err ? reject(err) : resolve()));
            });

            if (!user.hasSeenWelcomeModal) {
              req.session.showWelcomeModal = true;
              user.hasSeenWelcomeModal = true;
              await user.save();
            }

            // 4) Bypass onboarding
// Normal flow: safe post-login redirect
const dest = pickSafeRedirect(req, '/dashboard');
return res.redirect(dest);


          }
        }

        // If no invite found => go to onboarding
        req.session.user = user;
        return res.redirect('/onboarding');
      } else {

        // Already has a firm => normal flow
        req.session.user = user;

        if (!user.hasSeenWelcomeModal) {
          req.session.showWelcomeModal = true;
          user.hasSeenWelcomeModal = true;
          await user.save();
        }
        
        const redirectUrl = req.session.returnTo || '/dashboard';
delete req.session.returnTo; // so it doesn't linger for future logins
return res.redirect(redirectUrl);

      }

    } else {
      // Code mismatch
      return res.render('login-signup', {
        email,
        showVerifyForm: true,
        error: 'Invalid or expired verification code.'
      });
    }

  } catch (err) {
    console.error('Error during email verification:', err);
    return res.status(500).render('login-signup', {
      email,
      showVerifyForm: true,
      error: 'An error occurred during verification.'
    });
  }
});

// Route for creating company ID (accessible only to your team)
router.post('/create-company-id', async (req, res) => {
  const { companyId, companyName } = req.body;

  try {
    const newCompanyID = new CompanyID({ companyId, companyName });
    await newCompanyID.save();
    res.status(201).send('Company ID created successfully');
  } catch (err) {
    console.error('Error creating company ID:', err);
    res.status(500).send('Failed to create company ID');
  }
});

// Forgot password page
router.get('/forgot-password', (req, res) => {
  // Remove companyId references here. We don't pass it to the template anymore.
  res.render('forgot-password', { 
    errors: {}, 
    email: '', 
    showVerifyForm: false 
  });
});

router.post('/forgot-password', async (req, res) => {
  // Remove companyId from destructuring
  const { email } = req.body;
  let errors = {};

  const emailLower = email.toLowerCase();

  try {
    // Find by email only
    const user = await User.findOne({ email: emailLower });
    if (!user) {
      await logError(req, 'No account found for that email.', { severity: 'warning' });
      // Adjust error message
      errors.email = 'No account found for that email.';
      return res.render('forgot-password', {
        errors, 
        email: emailLower, 
        showVerifyForm: false 
      });
    }

    // Generate verification code
    const verificationCode = crypto.randomBytes(2).toString('hex').toUpperCase();
    user.verificationCode = verificationCode;
    await user.save();

    const msg = {
      to: emailLower,
      from: 'SurgeTk <support@notifications.surgetk.com>',
      templateId: 'd-dccdd9b60a5d4821aaecad8ec35c9615',
      dynamic_template_data: {
        userName: user.firstName || emailLower.split('@')[0],
        verificationCode: verificationCode,
      },
    };
    await sgMail.send(msg);

    // Render verify-email page
    res.render('verify-email', { 
      email: emailLower, 
      showVerifyForm: true, 
      errors: {} 
    });
  } catch (err) {
    console.error('Error during forgot password process:', err);
    return res.status(500).render('forgot-password', {
      email: emailLower,
      showVerifyForm: false,
      errors: { general: 'An error occurred.' }
    });
  }
});

router.post('/resend-verification-email', async (req, res) => {
  console.log('🔥 Resend verification endpoint hit:', req.body);
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required.' });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({ success: false, message: 'No user found for this email.' });
    }

    if (user.emailVerified) {
      return res.status(400).json({ success: false, message: 'Email already verified.' });
    }

    // Generate new verification code
    const verificationCode = crypto.randomBytes(2).toString('hex').toUpperCase();
    user.verificationCode = verificationCode;
    await user.save();

    const msg = {
      to: user.email,
      from: 'SurgeTk <support@notifications.surgetk.com>',
      templateId: 'd-198bd40ae9cd4ae9935cbd16a595cc3c',
      dynamic_template_data: {
        companyName: user.companyName || 'Your Company',
        verificationCode,
        userName: user.firstName || user.email.split('@')[0],
      },
    };

    await sgMail.send(msg);

    res.json({ success: true, message: 'Verification email resent.' });
  } catch (error) {
    console.error('Error resending verification email:', error);
    res.status(500).json({ success: false, message: 'Server error while resending.' });
  }
});


// /forgot-password/verify
router.post('/forgot-password/verify', async (req, res) => {
  const { email, verificationCode } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.render('verify-email', {
        email,
        error: 'Invalid or expired verification code.',
        showVerifyForm: true
      });
    }

    // Compare codes
    if (user.verificationCode !== verificationCode.toUpperCase()) {
      return res.render('verify-email', {
        email,
        error: 'Invalid or expired verification code.',
        showVerifyForm: true
      });
    }

    // If code matches => store the user’s ID in session
    req.session.resetUserId = user._id;
    // Optionally clear their verificationCode so it can't be reused
    user.verificationCode = null;
    await user.save();

    // Render the reset-password page WITHOUT trusting the email
    // We can still pass the email for display if you want, but you
    // will ignore it on the server side anyway.
    return res.render('reset-password', {
      // email,  // optional. purely for display, not used on server
    });

  } catch (err) {
    console.error('Error during verification:', err);
    return res.status(500).render('verify-email', {
      email,
      showVerifyForm: true,
      error: 'An error occurred.'
    });
  }
});




// /reset-password
router.post('/reset-password', async (req, res) => {
  const { newPassword, confirmPassword } = req.body;
  let errors = {};

  // 1) Check that we have a valid user ID in the session
  if (!req.session.resetUserId) {
    // If there's no user in session, either they've timed out, or it's a hack attempt
    await logError(req, 'No valid reset session found. Potential tampering.', { severity: 'warning' });
    return res.status(403).send('Session expired or invalid. Please start over.');
  }

  // 2) Validate the new password
  if (newPassword.length < 8 || !/[^A-Za-z0-9]/.test(newPassword)) {
    await logError(req, 'Password must be at least 8 characters long and contain a special character.', { severity: 'warning' });
    errors.newPassword = 'Password must be at least 8 characters long and contain a special character.';
  }

  if (newPassword !== confirmPassword) {
    await logError(req, 'Passwords do not match.', { severity: 'warning' });
    errors.confirmPassword = 'Passwords do not match.';
  }

  if (Object.keys(errors).length > 0) {
    return res.render('reset-password', { 
      // email: '', // no need for email here, unless you want to display it
      errors 
    });
  }

  try {
    // 3) Fetch user from the session-based ID, not from the request body
    const user = await User.findById(req.session.resetUserId);

    if (!user) {
      // Very unlikely if they had just verified a code, but still:
      return res.render('reset-password', { 
        errors: { general: 'User not found or session expired.' } 
      });
    }

    // 4) Hash and save the new password
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    // 5) Clear the session
    delete req.session.resetUserId;

    // 6) Redirect to login page with a success message
    return res.redirect('/login?success=1');
  } catch (err) {
    console.error('Error during password reset:', err);
    return res.status(500).render('reset-password', {
      errors: { general: 'An error occurred.' }
    });
  }
});


router.post('/verify-reset-code', async (req, res) => {
  const { email, verificationCode } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || user.verificationCode !== verificationCode.toUpperCase()) {
      return res.render('verify-email', {
        email, error: 'Invalid or expired verification code.', showVerifyForm: true
      });
    }
    // Render the reset password form
    res.render('reset-password', { email });
  } catch (err) {
    console.error('Error during verification process:', err);
    res.render('verify-email', {
      email, error: 'An error occurred.', showVerifyForm: true
    });
  }
});

// Logout route
router.post('/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(err => {
      if (err) {
        console.error('Error destroying session:', err);
        return res.status(500).send('Error logging out.');
      }
      // Redirect to login page with a success message after logout
      res.redirect('/login?success=logout');
    });
  } else {
    res.redirect('/login');
  }
});


// -----------------
// Helper Functions
// -----------------

// Helper function to log sign-ins with better IP handling and debugging
async function logSignIn(user, req) {
  const ipAddress = req.headers['x-forwarded-for']
    ? req.headers['x-forwarded-for'].split(',')[0].trim()
    : req.connection.remoteAddress || '127.0.0.1';

  let location = 'Unknown';
  const device = req.headers['user-agent'] || 'Unknown';

  try {
    const response = await axios.get(`https://ipinfo.io/${ipAddress}/json?token=${process.env.IPINFO_TOKEN}`);
    location = response.data.city && response.data.region
      ? `${response.data.city}, ${response.data.region}`
      : 'Unknown';
  } catch (error) {
    console.error("Error fetching location from IPinfo:", error.message || error);
    if (error.response) {
      console.error("Error status:", error.response.status);
      console.error("Error data:", error.response.data);
    }
  }

  user.signInLogs.push({ timestamp: new Date(), location, device });
  if (user.signInLogs.length > 10) {
    user.signInLogs.shift();
  }
  await user.save();
}



function getRoleName(rolesArray = []) {
  if (rolesArray.includes('admin')) return 'Admin';
  if (rolesArray.includes('leadAdvisor')) return 'Lead Advisor';
  if (rolesArray.includes('assistant')) return 'Assistant';
  if (rolesArray.includes('teamMember')) return 'Team Member';
  return 'User';
}


module.exports = router;
