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

// Signup route
router.post('/signup', async (req, res) => {
  const { companyId, companyName, email, password, confirmPassword } = req.body;
  let errors = {};

  // Convert companyId and email to lowercase for case-insensitive comparison
  const companyIdLower = companyId.toLowerCase();
  const emailLower = email.toLowerCase();

  try {
    // Log company ID to check what was entered
    console.log(`Attempting to sign up with company ID: ${companyIdLower}`);

    // Validate the company ID from the database
    const validCompanyID = await CompanyID.findOne({ companyId: companyIdLower });

    // Check if the company ID exists and its status
    if (!validCompanyID) {
      console.log('Company ID not found in the database.');
      errors.companyIdError = 'Invalid Company ID.';
    } else if (!validCompanyID.isActive) {
      console.log('Company ID is deactivated.');
      errors.companyIdError = 'This Company ID is deactivated. Please contact support.';
    } else if (validCompanyID.isUsed) {
      console.log('Company ID has already been used.');
      errors.companyIdError = 'This Company ID has already been used.';
    }

    // Check if the email is already used by another user (case-insensitive)
    const existingUserByEmail = await User.findOne({ email: emailLower });
    if (existingUserByEmail) {
      console.log('Email already registered.');
      errors.emailError = 'This email is already registered.';
    }

    // Validate password length and special character
    if (password.length < 8 || !/[^A-Za-z0-9]/.test(password)) {
      errors.passwordError = 'Password must be at least 8 characters long and contain a special character.';
    }

    // Check if passwords match
    if (password !== confirmPassword) {
      errors.passwordMatchError = 'Passwords do not match.';
    }

    // If there are any errors, re-render the form with error messages
    if (Object.keys(errors).length > 0) {
      return res.render('login-signup', {
        errors,
        companyId,
        companyName,
        email,
        activeTab: 'signup',
      });
    }

    // Generate a 4-character verification code
    const verificationCode = crypto.randomBytes(2).toString('hex').toUpperCase();

    // Save the new user with the normalized (lowercase) companyId and email
    const newUser = new User({
      companyId: companyIdLower,
      companyName: companyName, // Use the companyName provided by the user
      email: emailLower,
      password: await bcrypt.hash(password, 10),
      emailVerified: false,
      verificationCode,
    });

    await newUser.save();

    // Mark the company ID as used and assign the user's email
    validCompanyID.isUsed = true;
    validCompanyID.assignedEmail = emailLower; // Update assignedEmail with the signup email
    await validCompanyID.save();

    // Send the verification email
    const msg = {
      to: emailLower,
      from: 'invictuscfp@gmail.com',
      templateId: 'd-1c91e638ca634c7487e6602606313bba', // Replace with your actual template ID
      dynamic_template_data: {
        companyName: companyName,
        verificationCode: verificationCode,
        userName: emailLower.split('@')[0], // Extract username from email
      },
    };
    await sgMail.send(msg);

    // Show the verification form after successful signup
    return res.render('login-signup', { showVerifyForm: true, email: emailLower, errors: {} });
  } catch (err) {
    console.error('Error during signup:', err);

    // Handle duplicate key error for email uniqueness
    if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
      errors.emailError = 'This email is already registered.';
      return res.render('login-signup', {
        errors,
        companyId,
        companyName,
        email,
        activeTab: 'signup',
      });
    }

    return res.status(500).send('An error occurred during signup.');
  }
});

router.post('/login', async (req, res) => {
  const { companyId, email, password } = req.body;
  let errors = {};

  try {
    // Convert companyId and email to lowercase for case-insensitive comparison
    const companyIdLower = companyId.toLowerCase();
    const emailLower = email.toLowerCase();

    // Find the user by companyId and email
    const user = await User.findOne({ companyId: companyIdLower, email: emailLower });

    if (!user) {
      errors.loginCompanyIdError = 'Invalid company ID or email.';
    } else {
      // Check if the company ID is active
      const companyIDEntry = await CompanyID.findOne({ companyId: companyIdLower });
      if (!companyIDEntry || !companyIDEntry.isActive) {
        errors.loginCompanyIdError = 'Your Company ID is deactivated. Please contact support.';
      }

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        errors.loginPasswordError = 'Invalid email or password.';
      }

      if (Object.keys(errors).length > 0) {
        return res.status(400).json({ errors });
      }

      if (!user.emailVerified) {
        // Send verification email and respond with a status for frontend to handle
        const verificationCode = crypto.randomBytes(2).toString('hex').toUpperCase();
        user.verificationCode = verificationCode;
        await user.save();

        const msg = {
          to: emailLower,
          from: 'invictuscfp@gmail.com',
          templateId: 'd-1c91e638ca634c7487e6602606313bba',
          dynamic_template_data: {
            companyName: user.companyName,
            verificationCode: verificationCode,
            userName: emailLower.split('@')[0],
          },
        };
        await sgMail.send(msg);

        return res.status(200).json({ showVerifyForm: true, email: emailLower, errors: {} });
      }

      if (user.emailVerified) {
        if (user.is2FAEnabled) {
          req.session.temp_user = user._id;
          return res.status(200).json({ requires2FA: true });
        } else {
          req.session.user = user;

          // Fetch location based on IP address
          const ipAddress = req.ip === '::1' ? '127.0.0.1' : req.ip; // Handle localhost IP
          let location = 'Unknown';
          try {
            const response = await axios.get(`https://ipinfo.io/${ipAddress}/json?token=${process.env.IPINFO_TOKEN}`);
            location = response.data.city && response.data.region ? `${response.data.city}, ${response.data.region}` : 'Unknown';
          } catch (error) {
            console.error('Error fetching location:', error);
          }

          // Log the sign-in activity
          user.signInLogs.push({
            timestamp: new Date(),
            location: location,
            device: req.headers['user-agent'] || 'Unknown Device',
          });
          if (user.signInLogs.length > 10) {
            user.signInLogs.shift();
          }
          await user.save();

          return res.status(200).json({ success: true, redirect: '/dashboard' });
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ errors });
    }
  } catch (err) {
    console.error('Error during login:', err);
    return res.status(500).json({ message: 'An error occurred during login.' });
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

// Verification route
router.post('/verify-email', async (req, res) => {
  const { email, verificationCode } = req.body;

  // Log the received email and verification code
  console.log('Received Email:', email);
  console.log('Received Verification Code:', verificationCode.toUpperCase());

  try {
    const user = await User.findOne({ email });
    if (!user) {
      console.log('User not found');
      return res.render('login-signup', { email, showVerifyForm: true, error: 'User not found.' });
    }

    // Ensure case-insensitive comparison by converting both to uppercase
    if (user.verificationCode?.toUpperCase() === verificationCode.toUpperCase()) {
      user.emailVerified = true;
      user.verificationCode = null; // Clear the verification code
      await user.save();
      console.log('Email verified successfully');

      // Automatically log the user in by setting the session
      req.session.user = user;

      // Redirect to the dashboard after successful verification and login
      return res.redirect('/dashboard');
    } else {
      console.log('Invalid or expired verification code');
      return res.render('login-signup', { email, showVerifyForm: true, error: 'Invalid or expired verification code.' });
    }
  } catch (err) {
    console.error('Error during email verification:', err);
    return res.status(500).render('login-signup', { email, showVerifyForm: true, error: 'An error occurred during verification.' });
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

  // Convert companyId and email to lowercase for case-insensitive comparison
  const companyIdLower = companyId.toLowerCase();
  const emailLower = email.toLowerCase();

  try {
    const user = await User.findOne({ email: emailLower, companyId: companyIdLower });
    if (!user) {
      errors.email = 'Invalid email or company ID.';
      return res.render('forgot-password', { errors, email: emailLower, companyId, showVerifyForm: false });
    }

    // Generate a verification code
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
    return res.status(500).render('forgot-password', { email: emailLower, showVerifyForm: false, errors: { general: 'An error occurred.' } });
  }
});

// POST route to verify the code for password reset
router.post('/forgot-password/verify', async (req, res) => {
  const { email, verificationCode } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase() }); // Case-insensitive email
    if (!user || user.verificationCode !== verificationCode.toUpperCase()) {
      return res.render('verify-email', { email, error: 'Invalid or expired verification code.', showVerifyForm: true });
    }

    // Render the reset password form
    res.render('reset-password', { email });
  } catch (err) {
    console.error('Error during verification:', err);
    return res.status(500).render('verify-email', { email, error: 'An error occurred.', showVerifyForm: true });
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
    const user = await User.findOne({ email: email.toLowerCase() }); // Case-insensitive email
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
    return res.status(500).render('reset-password', { email, errors: { general: 'An error occurred.' } });
  }
});

router.post('/verify-reset-code', async (req, res) => {
  const { email, verificationCode } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase() }); // Case-insensitive email
    if (!user || user.verificationCode !== verificationCode.toUpperCase()) {
      return res.render('verify-email', { email, error: 'Invalid or expired verification code.', showVerifyForm: true });
    }

    // Render the reset password form
    res.render('reset-password', { email });
  } catch (err) {
    console.error('Error during verification process:', err);
    res.render('verify-email', { email, error: 'An error occurred.', showVerifyForm: true });
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


// Helper function to log sign-in

async function logSignIn(user, req) {
  const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '127.0.0.1';
  let location = 'Unknown';
  const device = req.headers['user-agent'] || 'Unknown';

  console.log(`Attempting to log sign-in with IP: ${ipAddress}`); // Log IP address being used

  try {
    // Make the request to IPinfo
    const response = await axios.get(`https://ipinfo.io/${ipAddress}/json?token=${process.env.IPINFO_TOKEN}`);
    console.log(`IPinfo response:`, response.data); // Log the full response from IPinfo
    
    // Process the location data
    location = response.data.city && response.data.region ? `${response.data.city}, ${response.data.region}` : 'Unknown';
  } catch (error) {
    console.error('Error fetching location from IPinfo:', error.message || error);
  }

  // Log the final determined location
  console.log(`Location determined: ${location}`);

  // Log and save the sign-in data
  user.signInLogs.push({ timestamp: new Date(), location, device });
  if (user.signInLogs.length > 10) {
    user.signInLogs.shift();
  }
  await user.save();
}


module.exports = router;
