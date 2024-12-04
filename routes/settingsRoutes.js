// routes/settingsRoutes.js

const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const AWS = require('aws-sdk');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const User = require('../models/User');
const router = express.Router();

// Middleware to check if the user is authenticated
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}

// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();

// Set up multer for handling file uploads in memory
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Helper function to upload file to S3
async function uploadToS3(file, folder = 'avatars') {
  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: `${folder}/${Date.now()}_${file.originalname}`,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  const data = await s3.upload(params).promise();
  return data.Location;
}

// Utility function to verify 2FA token
function verifyToken(user, token) {
  return speakeasy.totp.verify({
    secret: user.twoFASecret, // Ensure you have stored the twoFASecret in the user model
    encoding: 'base32',
    token: token,
    window: 1 // Allows a 30-second window before and after
  });
}

// Settings page route
router.get('/settings', isAuthenticated, (req, res) => {
  const user = req.session.user;

  // Create a new user object with necessary properties
  const userData = {
    ...user,
    is2FAEnabled: Boolean(user.is2FAEnabled), // Ensure it's a boolean
    avatar: user.avatar || '/images/defaultProfilePhoto.png' // Set default avatar if none exists
  };

  res.render('settings', { 
    title: 'Settings',
    user: user,
    avatar: user.avatar,
    user: userData
  });
});

// Route to handle profile updates
router.post('/settings/update-profile', isAuthenticated, upload.single('avatar'), async (req, res) => {
  try {
    const { companyName, email } = req.body;
    const userId = req.session.user._id; // Use _id consistently

    const updateData = {
      companyName: companyName !== undefined ? companyName : req.session.user.companyName,
      email: email !== undefined ? email : req.session.user.email,
    };

    // Upload avatar to S3 if a file is provided
    if (req.file) {
      const avatarUrl = await uploadToS3(req.file, 'avatars'); // Specify folder
      updateData.avatar = avatarUrl;
    }

    // Update user data in database
    const user = await User.findByIdAndUpdate(userId, updateData, { new: true });

    req.session.user = {
      ...user.toObject(),
      is2FAEnabled: Boolean(user.is2FAEnabled),
      avatar: user.avatar || '/images/defaultProfilePhoto.png'
    }; // Update entire session user object

    res.json({ message: 'Profile updated successfully', user });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'An error occurred while updating the profile' });
  }
});

// Password change route
router.post('/settings/change-password', isAuthenticated, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const userId = req.session.user._id; // Use _id consistently

  try {
      // Retrieve the user from the database
      const user = await User.findById(userId);

      // Verify the current password
      const isMatch = await bcrypt.compare(oldPassword, user.password);
      if (!isMatch) {
          return res.status(400).json({ message: 'Current password is incorrect' });
      }

      // Validate the new password (at least 8 characters with a special character)
      if (newPassword.length < 8 || !/[^A-Za-z0-9]/.test(newPassword)) {
          return res.status(400).json({ message: 'New password must be at least 8 characters long and contain a special character.' });
      }

      // Hash and save the new password
      user.password = await bcrypt.hash(newPassword, 10);
      await user.save();

      // Optionally, update session user if needed
      req.session.user = {
        ...req.session.user,
        password: user.password // If you store password in session (not recommended)
      };

      res.json({ message: 'Password updated successfully' });
  } catch (error) {
      console.error('Error changing password:', error);
      res.status(500).json({ message: 'An error occurred while updating the password' });
  }
});

// Update Company Info Route with File Upload Handling
router.post('/settings/update-company-info', isAuthenticated, upload.single('company-logo'), async (req, res) => {
  const { companyInfoName, companyInfoEmail, companyInfoWebsite, companyAddress, companyPhone } = req.body;
  const userId = req.session.user._id; // Use _id consistently

  try {
    const updateData = {
      companyName: companyInfoName !== undefined ? companyInfoName : req.session.user.companyName,
      email: companyInfoEmail !== undefined ? companyInfoEmail : req.session.user.email,
      companyWebsite: companyInfoWebsite !== undefined ? companyInfoWebsite : req.session.user.companyWebsite,
      companyAddress: companyAddress !== undefined ? companyAddress : req.session.user.companyAddress,
      phoneNumber: companyPhone !== undefined ? companyPhone : req.session.user.phoneNumber,
    };

    // Handle company-logo upload
    if (req.file) {
      const companyLogoUrl = await uploadToS3(req.file, 'company-logos'); // Specify folder
      updateData.companyLogo = companyLogoUrl;
    }

    // Update user data in database
    const user = await User.findByIdAndUpdate(userId, updateData, { new: true });

    req.session.user = {
      ...user.toObject(),
      is2FAEnabled: Boolean(user.is2FAEnabled),
      avatar: user.avatar || '/images/defaultProfilePhoto.png'
    }; // Update entire session user object

    res.json({ message: 'Company information updated successfully', user });
  } catch (error) {
    console.error('Error updating company info:', error);
    res.status(500).json({ message: 'An error occurred while updating company information' });
  }
});

// Upload Company Logo Route (Optional if integrating)
router.post('/settings/upload-company-logo', isAuthenticated, upload.single('company-logo'), async (req, res) => {
  const userId = req.session.user._id; // Use _id consistently

  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  try {
    // Upload to S3
    const companyLogoUrl = await uploadToS3(req.file, 'company-logos'); // Specify folder

    // Update user with the new logo URL
    const user = await User.findByIdAndUpdate(userId, { companyLogo: companyLogoUrl }, { new: true });

    req.session.user = {
      ...user.toObject(),
      is2FAEnabled: Boolean(user.is2FAEnabled),
      avatar: user.avatar || '/images/defaultProfilePhoto.png'
    }; // Update entire session user object

    res.json({ message: 'Company logo uploaded successfully', companyLogo: companyLogoUrl });
  } catch (error) {
    console.error('Error uploading company logo:', error);
    res.status(500).json({ message: 'An error occurred while uploading the company logo' });
  }
});

// -----------------
// 2FA Routes
// -----------------


// Route to get 2FA setup details
router.get('/settings/2fa/setup', isAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.user._id);

  if (user.is2FAEnabled) {
    return res.json({ enabled: true });
  }

  // Generate a new secret without the otpauth_url
  const secret = speakeasy.generateSecret({
    length: 20
  });

  // Generate the otpauth URL with the issuer and label set correctly
  const otpauthURL = speakeasy.otpauthURL({
    secret: secret.base32,
    label: user.email,       // This will appear as the subtitle in the authenticator app
    issuer: 'Invictus',      // This will appear as the title in the authenticator app
    encoding: 'base32'
  });

  // Generate the QR code data URL
  const qrCodeDataURL = await qrcode.toDataURL(otpauthURL);

  // Save temporary secret in session
  req.session.temp_secret = secret.base32;

  res.json({ enabled: false, secret: secret.base32, qrCode: qrCodeDataURL });
});


// Route to enable 2FA
router.post('/settings/2fa/enable', isAuthenticated, async (req, res) => {
  const userId = req.session.user._id; // Use _id consistently
  const { token } = req.body;

  try {
      const user = await User.findById(userId);

      // Retrieve the temporary secret from session
      const tempSecret = req.session.temp_secret;

      if (!tempSecret) {
          return res.status(400).json({ message: 'No 2FA setup in progress.' });
      }

      // Verify the token
      const isValidToken = verifyToken({ twoFASecret: tempSecret }, token);

      if (!isValidToken) {
          return res.status(400).json({ message: 'Invalid 2FA token.' });
      }

      // Enable 2FA and save the secret
      user.is2FAEnabled = true;
      user.twoFASecret = tempSecret; // Save the secret to the user model
      await user.save();

      // Update session data
      req.session.user = {
        ...user.toObject(),
        is2FAEnabled: true,
        avatar: user.avatar || '/images/defaultProfilePhoto.png'
      };

      // Remove temporary secret from session
      delete req.session.temp_secret;

      res.json({ message: '2FA has been enabled successfully!', user });
  } catch (error) {
      console.error('Error enabling 2FA:', error);
      res.status(500).json({ message: 'An error occurred while enabling 2FA.' });
  }
});

// Route to disable 2FA
router.post('/settings/2fa/disable', isAuthenticated, async (req, res) => {
  const userId = req.session.user._id; // Use _id consistently
  const { token } = req.body;

  try {
      const user = await User.findById(userId);

      if (!user.is2FAEnabled) {
          return res.status(400).json({ message: '2FA is not enabled.' });
      }

      // Verify the token using the stored secret
      const isValidToken = verifyToken(user, token);

      if (!isValidToken) {
          return res.status(400).json({ message: 'Invalid 2FA token.' });
      }

      // Disable 2FA and remove the secret
      user.is2FAEnabled = false;
      user.twoFASecret = undefined; // Remove the secret from the user model
      await user.save();

      // Update session data
      req.session.user = {
        ...user.toObject(),
        is2FAEnabled: false,
        avatar: user.avatar || '/images/defaultProfilePhoto.png'
      };

      res.json({ message: '2FA has been disabled successfully!', user });
  } catch (error) {
      console.error('Error disabling 2FA:', error);
      res.status(500).json({ message: 'An error occurred while disabling 2FA.' });
  }
});

// Route to get last 10 sign-in logs
router.get('/settings/signin-logs', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.user._id).select('signInLogs');
    
    // Check if signInLogs exists and has entries
    const logs = user.signInLogs ? user.signInLogs.slice(-10).reverse() : [];
    res.json({ logs });
  } catch (error) {
    console.error('Error fetching sign-in logs:', error);
    res.status(500).json({ message: 'Failed to load sign-in logs.' });
  }
});


module.exports = router;
