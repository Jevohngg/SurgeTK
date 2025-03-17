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
const router = express.Router();


// GET route for login page
router.get('/login', (req, res) => {

  const success = req.query.success;
  let successMessage = null;

  // If you want to clear any session (optional):
  req.session.destroy(err => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.status(500).send('An error occurred while logging out.');
    }

    // Set different success messages based on the query parameter
    if (success === '1') {
      successMessage = 'Your password has been updated successfully. You may now sign in.';
    } else if (success === 'logout') {
      successMessage = 'You have been logged out successfully.';
    }

    // Render the login page with the success message (if any)
    res.render('login-signup', { 
      errors: {}, 
      companyId: '', 
      companyName: '', 
      email: '', 
      activeTab: 'login', 
      successMessage: successMessage // Pass the success message to the template
    });
    
  });
});

// GET route for the signup page
router.get('/signup', (req, res) => {
  res.render('login-signup', { 
    errors: {}, // Clear any errors
    companyId: '', 
    companyName: '', 
    email: '', 
    activeTab: 'signup' // Set the signup tab as active
  });
});

// =========================
// SIGNUP (No Company ID)
// =========================
router.post('/signup', async (req, res) => {
  const { firstName, lastName, email, password, confirmPassword } = req.body;
  let errors = {};

  try {
    const emailLower = email.toLowerCase();

    // Check if email is already registered
    const existingUser = await User.findOne({ email: emailLower });
    if (existingUser) {
      errors.emailError = 'This email is already registered.';
    }

    // Validate password
    if (password.length < 8 || !/[^A-Za-z0-9]/.test(password)) {
      errors.passwordError = 'Password must be at least 8 characters long and contain a special character.';
    }
    if (password !== confirmPassword) {
      errors.passwordMatchError = 'Passwords do not match.';
    }

    // If errors, re-render
    if (Object.keys(errors).length > 0) {
      return res.render('login-signup', {
        errors,
        email,
        activeTab: 'signup',
      });
    }

    // Generate verification code
    const verificationCode = crypto.randomBytes(2).toString('hex').toUpperCase();

    // Create user
    const newUser = new User({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: emailLower,
      password: await bcrypt.hash(password, 10),
      emailVerified: false,
      verificationCode
      // roles => default: []
      // permission => default: 'assistant'
      // firmId => default: null
    });

    await newUser.save();

    // Send verification email
    const msg = {
      to: emailLower,
      from: 'invictuscfp@gmail.com',
      templateId: 'd-1c91e638ca634c7487e6602606313bba',
      dynamic_template_data: {
        companyName: 'Your Company', // or can remove the placeholder if your template requires it
        verificationCode: verificationCode,
        userName: firstName,
      },
    };
    await sgMail.send(msg);

    // Show verification form
    return res.render('login-signup', { showVerifyForm: true, email: emailLower, errors: {} });
  } catch (err) {
    console.error('Error during signup:', err);
    let errors = {};
    if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
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

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  let errors = {};

  try {
    const emailLower = email.toLowerCase();
    const user = await User.findOne({ email: emailLower });

    if (!user) {
      errors.loginEmailError = 'Invalid email or password.';
    } else {
      // Check password
      const isMatch = user ? await bcrypt.compare(password, user.password) : false;
      if (!isMatch) {
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
          from: 'invictuscfp@gmail.com',
          templateId: 'd-1c91e638ca634c7487e6602606313bba',
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
        req.session.temp_user = user._id;
        return res.render('login-signup', {
          errors: {},
          activeTab: 'login',
          show2FAModal: true
        });
      } else {
        // User is verified and has no 2FA => proceed
        req.session.user = user;
        await logSignIn(user, req);

        // ===============================================
        // INVITATION CHECK: If user doesn't have firmId yet
        // ===============================================
        if (!user.firmId) {
          const firm = await CompanyID.findOne({
            'invitedUsers.email': emailLower
          });

          if (firm) {
            // Find the invitation entry
            const invitedUser = firm.invitedUsers.find(
              (u) => u.email.toLowerCase() === emailLower
            );

            if (invitedUser) {
              // 1) Assign user to that firm
              user.firmId = firm._id;

              user.companyId = firm.companyId;
              user.companyName = firm.companyName;

              // 2) CRUCIAL: Assign the entire roles array & single permission
              user.roles = invitedUser.roles;            // e.g. ['admin','advisor']
              user.permission = invitedUser.permission;  // e.g. 'admin'
            

              await user.save();

              // 3) Remove them from the invitedUsers list
              firm.invitedUsers = firm.invitedUsers.filter(
                (u) => u.email.toLowerCase() !== emailLower
              );
              await firm.save();
            }
          }

          // If user STILL has no firm => go to onboarding
          if (!user.firmId) {
            return res.redirect('/onboarding');
          }
        }
        // If the user has never seen the welcome modal:
        if (!user.hasSeenWelcomeModal) {
          // 1) Set a session flag so we can show the modal on the dashboard
          req.session.showWelcomeModal = true;

          // 2) Mark them as having seen it in the future, so it won't show again
          user.hasSeenWelcomeModal = true;
          await user.save();
        }


        // Normal flow
        return res.redirect('/dashboard');
      }
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
    const verified = speakeasy.totp.verify({
      secret: user.twoFASecret,
      encoding: 'base32',
      token,
      window: 1 // Allows a window of 1 step before and after
    });

    if (verified) {
      // Log sign-in
      logSignIn(user, req);
      req.session.user = user;
      delete req.session.temp_user;
      res.json({ success: true, redirect: '/dashboard' });
    } else {
      res.status(400).json({ message: 'Invalid 2FA token.' });
    }
  } catch (err) {
    console.error('Error during 2FA verification:', err);
    res.status(500).json({ message: 'An error occurred during 2FA verification.' });
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
            return res.redirect('/dashboard');
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
        
        return res.redirect('/dashboard');
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
  res.render('forgot-password', { errors: {}, email: '', companyId: '', showVerifyForm: false });
});

router.post('/forgot-password', async (req, res) => {
  const { email, companyId } = req.body;
  let errors = {};

  const companyIdLower = companyId.toLowerCase();
  const emailLower = email.toLowerCase();

  try {
    const user = await User.findOne({ email: emailLower, companyId: companyIdLower });
    if (!user) {
      errors.email = 'Invalid email or company ID.';
      return res.render('forgot-password', {
        errors, email: emailLower, companyId, showVerifyForm: false
      });
    }

    // Generate verification code
    const verificationCode = crypto.randomBytes(2).toString('hex').toUpperCase();
    user.verificationCode = verificationCode;
    await user.save();

    const msg = {
      to: emailLower,
      from: 'invictuscfp@gmail.com',
      templateId: 'd-1c91e638ca634c7487e6602606313bba',
      dynamic_template_data: {
        userName: emailLower.split('@')[0],
        verificationCode: verificationCode,
      },
    };
    await sgMail.send(msg);

    res.render('verify-email', { email: emailLower, showVerifyForm: true, errors: {} });
  } catch (err) {
    console.error('Error during forgot password process:', err);
    return res.status(500).render('forgot-password', {
      email: emailLower,
      showVerifyForm: false,
      errors: { general: 'An error occurred.' }
    });
  }
});

// POST route to verify the code for password reset
router.post('/forgot-password/verify', async (req, res) => {
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
    console.error('Error during verification:', err);
    return res.status(500).render('verify-email', {
      email, error: 'An error occurred.', showVerifyForm: true
    });
  }
});

router.post('/reset-password', async (req, res) => {
  const { email, newPassword, confirmPassword } = req.body;
  let errors = {};

  // Validate the new password
  if (newPassword.length < 8 || !/[^A-Za-z0-9]/.test(newPassword)) {
    errors.newPassword = 'Password must be at least 8 characters long and contain a special character.';
  }
  if (newPassword !== confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  if (Object.keys(errors).length > 0) {
    return res.render('reset-password', { email, errors });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.render('reset-password', { email, errors: { general: 'User not found.' } });
    }

    // Hash and save the new password
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    // Redirect to login page with a success message
    res.redirect('/login?success=1');
  } catch (err) {
    console.error('Error during password reset:', err);
    return res.status(500).render('reset-password', {
      email, errors: { general: 'An error occurred.' }
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

module.exports = router;
