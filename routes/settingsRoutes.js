// routes/settingsRoutes.js

const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const AWS = require('aws-sdk');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const CompanyID = require('../models/CompanyID');
const User = require('../models/User');
const router = express.Router();
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');

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
  console.log("uploadToS3 called with:", file.originalname, file.mimetype, file.buffer.length);
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
    secret: user.twoFASecret,
    encoding: 'base32',
    token: token,
    window: 1
  });
}

router.get('/settings/signin-logs', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.user._id).select('signInLogs');
    const logs = user.signInLogs ? user.signInLogs.slice(-10).reverse() : [];
    res.json({ logs });
  } catch (error) {
    console.error('Error fetching sign-in logs:', error);
    res.status(500).json({ message: 'Failed to load sign-in logs.' });
  }
});



router.get('/settings/value-adds', isAuthenticated, async (req, res) => {
  try {
    const user = req.session.user;
    const firm = await CompanyID.findById(user.firmId).lean();

    if (!firm) {
      return res.status(404).json({ message: 'Firm not found.' });
    }

    const responseData = {
      bucketsEnabled: firm.bucketsEnabled,
      bucketsTitle: firm.bucketsTitle,
      bucketsDisclaimer: firm.bucketsDisclaimer
    };

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching value-add settings:', error);
    res.status(500).json({ message: 'Failed to fetch value-add settings.' });
  }
});

// The single correct route:
router.get('/settings/value-adds', isAuthenticated, async (req, res) => {
  try {
    const user = req.session.user;
    const firm = await CompanyID.findById(user.firmId).lean();
    if (!firm) {
      return res.status(404).json({ message: 'Firm not found.' });
    }

    // Fallback logic
    const finalTitle = firm.bucketsTitle || 'Buckets Strategy';
    const finalDisclaimer = firm.bucketsDisclaimer || 'Default disclaimers...';

    res.json({
      bucketsEnabled:
        typeof firm.bucketsEnabled === 'boolean'
          ? firm.bucketsEnabled
          : true,
      bucketsTitle: finalTitle,
      bucketsDisclaimer: finalDisclaimer
    });
  } catch (err) {
    console.error('Error fetching value-add settings:', err);
    res.status(500).json({ message: 'Failed to fetch value-add settings.' });
  }
});






// POST /settings/update-profile
router.post('/settings/update-profile', isAuthenticated, upload.single('avatar'), async (req, res) => {
  try {
    const { email, firstName, lastName } = req.body;
    const userId = req.session.user._id;

    // Build the update object. If a field is missing, fall back to existing session data:
    const updateData = {
      firstName: (typeof firstName !== 'undefined') ? firstName.trim() : req.session.user.firstName,
      lastName:  (typeof lastName  !== 'undefined') ? lastName.trim()  : req.session.user.lastName,
      email:     (typeof email     !== 'undefined') ? email.trim()     : req.session.user.email
    };

    // If an avatar file is uploaded, store it in S3
    if (req.file) {
      const avatarUrl = await uploadToS3(req.file, 'avatars');
      updateData.avatar = avatarUrl;
    }

    // Perform DB update
    const user = await User.findByIdAndUpdate(userId, updateData, { new: true });
    
    // Update the session user
    req.session.user = {
      ...user.toObject(),
      is2FAEnabled: Boolean(user.is2FAEnabled),
      avatar: user.avatar || '/images/defaultProfilePhoto.png'
    };

    res.json({ message: 'Profile updated successfully', user });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'An error occurred while updating the profile' });
  }
});



// POST /settings/change-password
router.post('/settings/change-password', isAuthenticated, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const userId = req.session.user._id;

  try {
    const user = await User.findById(userId);
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    if (newPassword.length < 8 || !/[^A-Za-z0-9]/.test(newPassword)) {
      return res.status(400).json({ message: 'New password must be at least 8 characters long and contain a special character.' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    req.session.user = {
      ...req.session.user,
      password: user.password
    };

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'An error occurred while updating the password' });
  }
});

// routes/settingsRoutes.js

router.post('/settings/update-company-info', isAuthenticated, upload.single('company-logo'), async (req, res) => {
  const {
    companyInfoName,
    companyInfoWebsite,
    companyAddress,
    companyPhone,
    // NEW FIELD:
    companyBrandingColor
  } = req.body;

  const user = req.session.user;

  try {
    const firm = await CompanyID.findById(user.firmId);
    if (!firm) return res.status(400).json({ message: 'Firm not found.' });

    firm.companyName = companyInfoName !== undefined ? companyInfoName : firm.companyName;
    firm.companyWebsite = companyInfoWebsite !== undefined ? companyInfoWebsite : firm.companyWebsite;
    firm.companyAddress = companyAddress !== undefined ? companyAddress : firm.companyAddress;
    firm.phoneNumber = companyPhone !== undefined ? companyPhone : firm.phoneNumber;

    // 1) Handle Company Logo if uploaded
    if (req.file) {
      const companyLogoUrl = await uploadToS3(req.file, 'company-logos');
      firm.companyLogo = companyLogoUrl;
    }

    // 2) Save the new color field
    if (typeof companyBrandingColor === 'string') {
      firm.companyBrandingColor = companyBrandingColor.trim();
    }

    if (req.file) firm.onboardingProgress.uploadLogo = true;
    if (companyBrandingColor) firm.onboardingProgress.selectBrandColor = true;

    await firm.save();

    // Update session user if you prefer to store local copies:
    req.session.user.companyName = firm.companyName;
    // Additional session updates if needed ...

    return res.json({ message: 'Company information updated successfully', firm });
  } catch (error) {
    console.error('Error updating company info:', error);
    return res
      .status(500)
      .json({ message: 'An error occurred while updating company information' });
  }
});



// 2FA setup route
router.get('/settings/2fa/setup', isAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.user._id);

  if (user.is2FAEnabled) {
    return res.json({ enabled: true });
  }

  const secret = speakeasy.generateSecret({ length: 20 });
  const otpauthURL = speakeasy.otpauthURL({
    secret: secret.base32,
    label: user.email,
    issuer: 'Invictus',
    encoding: 'base32'
  });

  const qrCodeDataURL = await qrcode.toDataURL(otpauthURL);
  req.session.temp_secret = secret.base32;

  res.json({ enabled: false, secret: secret.base32, qrCode: qrCodeDataURL });
});

// POST /settings/2fa/enable
router.post('/settings/2fa/enable', isAuthenticated, async (req, res) => {
  const userId = req.session.user._id;
  const { token } = req.body;

  try {
    const user = await User.findById(userId);
    const tempSecret = req.session.temp_secret;

    if (!tempSecret) {
      return res.status(400).json({ message: 'No 2FA setup in progress.' });
    }

    const isValidToken = verifyToken({ twoFASecret: tempSecret }, token);

    if (!isValidToken) {
      return res.status(400).json({ message: 'Invalid 2FA token.' });
    }

    user.is2FAEnabled = true;
    user.twoFASecret = tempSecret;
    await user.save();

    req.session.user = {
      ...user.toObject(),
      is2FAEnabled: true,
      avatar: user.avatar || '/images/defaultProfilePhoto.png'
    };

    delete req.session.temp_secret;

    res.json({ message: '2FA has been enabled successfully!', user });
  } catch (error) {
    console.error('Error enabling 2FA:', error);
    res.status(500).json({ message: 'An error occurred while enabling 2FA.' });
  }
});

// POST /settings/2fa/disable
router.post('/settings/2fa/disable', isAuthenticated, async (req, res) => {
  const userId = req.session.user._id;
  const { token } = req.body;

  try {
    const user = await User.findById(userId);

    if (!user.is2FAEnabled) {
      return res.status(400).json({ message: '2FA is not enabled.' });
    }

    const isValidToken = verifyToken(user, token);
    if (!isValidToken) {
      return res.status(400).json({ message: 'Invalid 2FA token.' });
    }

    user.is2FAEnabled = false;
    user.twoFASecret = undefined;
    await user.save();

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








// POST /settings/value-adds
router.post('/settings/value-adds', isAuthenticated, async (req, res) => {
  try {
    const user = req.session.user;
    const { bucketsEnabled, bucketsTitle, bucketsDisclaimer } = req.body;

    // Fetch the firm
    const firm = await CompanyID.findById(user.firmId);
    if (!firm) {
      return res.status(404).json({ message: 'Firm not found.' });
    }

    // Update fields
    if (typeof bucketsEnabled === 'boolean' || typeof bucketsEnabled === 'string') {
      // If you’re sending it as string "true"/"false", convert to boolean
      firm.bucketsEnabled = (bucketsEnabled === true || bucketsEnabled === 'true');
    }
    if (bucketsTitle !== undefined) {
      firm.bucketsTitle = bucketsTitle;
    }
    if (bucketsDisclaimer !== undefined) {
      firm.bucketsDisclaimer = bucketsDisclaimer;
    }

    await firm.save();

    return res.json({
      message: 'Buckets ValueAdd settings updated successfully',
      bucketsEnabled: firm.bucketsEnabled,
      bucketsTitle: firm.bucketsTitle,
      bucketsDisclaimer: firm.bucketsDisclaimer
    });
  } catch (error) {
    console.error('Error updating Buckets settings:', error);
    res.status(500).json({ message: 'Failed to update Buckets settings.' });
  }
});






// GET /settings
router.get('/settings/:subtab?', isAuthenticated, ensureOnboarded, async (req, res) => {
  const user = req.session.user;
  const firm = await CompanyID.findById(user.firmId);
  const companyData = await CompanyID.findOne({ companyId: user.companyId });
  const subtab = req.params.subtab || 'account';

  console.log('[DEBUG] Server user =>', user);

  const isAdminAccess = 
  user.role === 'admin' ||
  (user.permissions && user.permissions.admin === true);


  console.log('[DEBUG] Server isAdminAccess =>', isAdminAccess);
  console.log('[DEBUG] firm.companyBrandingColor =>', firm ? firm.companyBrandingColor : '(no firm or no color)');


    // userData is your existing logic
    const userData = {
      ...user,
      name: user.name || '',
      email: user.email || '',
      companyName: firm ? firm.companyName : '',
      companyId: firm ? firm.companyId : '',
      companyWebsite: firm ? firm.companyWebsite : '',
      companyAddress: firm ? firm.companyAddress : '',
      phoneNumber: firm ? firm.phoneNumber : '',
      companyLogo: firm ? firm.companyLogo : '',
      companyBrandingColor: firm ? firm.companyBrandingColor : '',
      is2FAEnabled: Boolean(user.is2FAEnabled),
      avatar: user.avatar || '/images/defaultProfilePhoto.png'
    };


    

    // Now define the Buckets settings with fallback
    const bucketsEnabled = (firm && typeof firm.bucketsEnabled === 'boolean')
      ? firm.bucketsEnabled
      : true; // default true
    const bucketsTitle = (firm && firm.bucketsTitle)
      ? firm.bucketsTitle
      : 'Buckets Strategy';
    const bucketsDisclaimer = (firm && firm.bucketsDisclaimer)
      ? firm.bucketsDisclaimer
      : 'THIS REPORT IS NOT COMPLETE WITHOUT ALL THE ACCOMPANYING DISCLAIMERS! ...';

      

      res.render('settings', {
        subtab,
        title: 'Settings',
        user: userData,
        avatar: userData.avatar,
        bucketsEnabled,
        bucketsTitle,
        companyData,
        bucketsDisclaimer,
        isAdminAccess,
        subscriptionTier: firm.subscriptionTier,
        subscriptionStatus: firm.subscriptionStatus
      });

   
      
});




module.exports = router;
