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
const { logError } = require('../utils/errorLogger');

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
    await logError(req, 'Error fetching sign-in logs:', { severity: 'warning' });
    console.error('Error fetching sign-in logs:', error);
    res.status(500).json({ message: 'Failed to load sign-in logs.' });
  }
});











// POST /settings/update-profile
router.post('/settings/update-profile', isAuthenticated, upload.single('avatar'), async (req, res) => {
  try {
    const { firstName, lastName } = req.body; // Omit email from destructuring

    const userId = req.session.user._id;

    // Build the update object. If a field is missing, fall back to existing session data:
    const updateData = {
      firstName: (typeof firstName !== 'undefined') ? firstName.trim() : req.session.user.firstName,
      lastName:  (typeof lastName  !== 'undefined') ? lastName.trim()  : req.session.user.lastName,
     
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
    await logError(req, 'Error updating profile:', { severity: 'warning' });
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
    await logError(req, 'Error changing password:', { severity: 'warning' });
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

    // NEW: parse the 3 fields from req.body
    // 1) Custodian (string, e.g. "Fidelity, Vanguard, MyOtherOne")
    const rawCustodian = req.body.custodian || '';
    firm.custodian = rawCustodian.trim();

    // 2) BrokerDealer => yes/no => boolean
    if (req.body.brokerDealer === 'yes') {
      firm.brokerDealer = true;
    } else if (req.body.brokerDealer === 'no') {
      firm.brokerDealer = false;
    }
    // If '' or undefined, we can skip or set a default

    // 3) isRIA => yes/no => boolean
    if (req.body.isRIA === 'yes') {
      firm.isRIA = true;
    } else if (req.body.isRIA === 'no') {
      firm.isRIA = false;
    }

    // Then save
    await firm.save();

    // Optionally update the session
    req.session.user.custodian    = firm.custodian;
    req.session.user.brokerDealer = firm.brokerDealer;
    req.session.user.isRIA        = firm.isRIA;

    return res.json({ 
      message: 'Company information updated successfully', 
      firm 
    });
  } catch (error) {
    await logError(req, 'Error updating company info:', { severity: 'warning' });
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
    issuer: 'SurgeTK',
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
    await logError(req, 'Error enabling 2FA:', { severity: 'warning' });
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
    await logError(req, 'Error disabling 2FA:', { severity: 'warning' });
    console.error('Error disabling 2FA:', error);
    res.status(500).json({ message: 'An error occurred while disabling 2FA.' });
  }
});

// GET /settings/value-adds
router.get('/settings/value-adds', isAuthenticated, async (req, res) => {
  try {
    console.log('[GET /settings/value-adds] Starting...'); // Debug

    const user = req.session.user;
    console.log('[GET /settings/value-adds] user =>', user ? user._id : 'No user'); // Debug

    const firm = await CompanyID.findById(user.firmId).lean();
    console.log('[GET /settings/value-adds] firm =>', firm); // Debug

    if (!firm) {
      return res.status(404).json({ message: 'Firm not found.' });
    }

    // Buckets fallback
    const finalBucketsTitle = firm.bucketsTitle || 'Buckets Strategy';
    const finalBucketsDisclaimer = firm.bucketsDisclaimer || 'Default disclaimers...';
    // If not set, default to 0.054 (5.4%)
   

    // Guardrails fallback
    const finalGuardrailsTitle = firm.guardrailsTitle || 'Guardrails Strategy';
    const finalGuardrailsDisclaimer = firm.guardrailsDisclaimer || 'Default disclaimers...';



    

    // ===== NEW Beneficiary fallback fields =====
    const finalBeneficiaryTitle = firm.beneficiaryTitle || 'Beneficiary Value Add';
    const finalBeneficiaryDisclaimer = firm.beneficiaryDisclaimer || 'Default disclaimer for Beneficiary Value Add...';
    const finalBeneficiaryEnabled =
    typeof firm.beneficiaryEnabled === 'boolean' ? firm.beneficiaryEnabled : false;

    // ===== NEW networth fallback fields =====
    const finalNetWorthTitle = firm.netWorthTitle || 'Net Worth Report';
    const finalNetWorthDisclaimer = firm.netWorthDisclaimer || 'Default disclaimer for Net Worth Value Add...';
    const finalNetWorthEnabled =
    typeof firm.netWorthEnabled === 'boolean' ? firm.netWorthEnabled : false;

    const responsePayload = {
      // Buckets
      bucketsEnabled: typeof firm.bucketsEnabled === 'boolean' ? firm.bucketsEnabled : true,
      bucketsTitle: finalBucketsTitle,
      bucketsDisclaimer: finalBucketsDisclaimer,
      bucketsAvailableRate: firm.bucketsAvailableRate ?? firm.bucketsDistributionRate ?? 0.054,
      bucketsUpperRate     : firm.bucketsUpperRate     ?? null,
      bucketsLowerRate     : firm.bucketsLowerRate     ?? null,

      // Guardrails
      guardrailsEnabled: typeof firm.guardrailsEnabled === 'boolean' ? firm.guardrailsEnabled : true,
      guardrailsTitle: finalGuardrailsTitle,
      guardrailsDisclaimer: finalGuardrailsDisclaimer,
      guardrailsAvailableRate: firm.guardrailsAvailableRate ?? firm.guardrailsDistributionRate ?? 0.054,
      guardrailsUpperRate     : firm.guardrailsUpperRate     ?? null,
      guardrailsLowerRate     : firm.guardrailsLowerRate     ?? null,


      // ===== NEW Beneficiary fields =====
      beneficiaryEnabled: finalBeneficiaryEnabled,
      beneficiaryTitle: finalBeneficiaryTitle,
      beneficiaryDisclaimer: finalBeneficiaryDisclaimer,

      // ===== NEW Net Worth fields =====
      netWorthEnabled: finalNetWorthEnabled,
      netWorthTitle: finalNetWorthTitle,
      netWorthDisclaimer: finalNetWorthDisclaimer,
      


    };

    console.log('[GET /settings/value-adds] returning =>', responsePayload); // Debug
    res.json(responsePayload);

  } catch (err) {
    await logError(req, 'Error fetching value-add settings:', { severity: 'warning' });
    console.error('[GET /settings/value-adds] Catch Error:', err);
    res.status(500).json({ message: 'Failed to fetch value-add settings.' });
  }
});

// POST /settings/value-adds
router.post('/settings/value-adds', isAuthenticated, async (req, res) => {
  try {
    console.log('[POST /settings/value-adds] Incoming body =>', req.body); // Debug

    const user = req.session.user;
    console.log('[POST /settings/value-adds] user =>', user ? user._id : 'No user'); // Debug

    const {
      // Buckets fields
      bucketsEnabled,
      bucketsTitle,
      bucketsDisclaimer,
      bucketsAvailableRate,
      bucketsUpperRate,
      bucketsLowerRate,

      // Guardrails fields
      guardrailsEnabled,
      guardrailsTitle,
      guardrailsDisclaimer,
      guardrailsAvailableRate,
      guardrailsUpperRate,
      guardrailsLowerRate,

      // ===== NEW Beneficiary fields =====
      beneficiaryEnabled,
      beneficiaryTitle,
      beneficiaryDisclaimer,

      // ===== NEW Net Worth fields =====
      netWorthEnabled,
      netWorthTitle,
      netWorthDisclaimer


    } = req.body;

    // Fetch the firm
    const firm = await CompanyID.findById(user.firmId);
    console.log('[POST /settings/value-adds] firm =>', firm); // Debug

    if (!firm) {
      return res.status(404).json({ message: 'Firm not found.' });
    }

    // ............................................................................
// BEGIN explicit‑rate sanitation & persistence
// ............................................................................

// helper → parseFloat that returns undefined for    '', null, NaN, etc.
const n = v => {
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : undefined;
};

/* ——— Buckets explicit rates ——— */
if (n(req.body.bucketsAvailableRate) !== undefined)
  firm.bucketsAvailableRate = n(req.body.bucketsAvailableRate);

if (n(req.body.bucketsUpperRate) !== undefined)
  firm.bucketsUpperRate = n(req.body.bucketsUpperRate);

if (n(req.body.bucketsLowerRate) !== undefined)
  firm.bucketsLowerRate = n(req.body.bucketsLowerRate);

/* ——— Guardrails explicit rates ——— */
if (n(req.body.guardrailsAvailableRate) !== undefined)
  firm.guardrailsAvailableRate = n(req.body.guardrailsAvailableRate);

if (n(req.body.guardrailsUpperRate) !== undefined)
  firm.guardrailsUpperRate = n(req.body.guardrailsUpperRate);

if (n(req.body.guardrailsLowerRate) !== undefined)
  firm.guardrailsLowerRate = n(req.body.guardrailsLowerRate);

// ............................................................................
// END explicit‑rate sanitation & persistence
// ............................................................................



    // ----- Buckets updates -----
    if (typeof bucketsEnabled === 'boolean' || typeof bucketsEnabled === 'string') {
      firm.bucketsEnabled = (bucketsEnabled === true || bucketsEnabled === 'true');
    }
    if (bucketsTitle !== undefined) {
      firm.bucketsTitle = bucketsTitle;
    }
    if (bucketsDisclaimer !== undefined) {
      firm.bucketsDisclaimer = bucketsDisclaimer;
    }



    

    // ----- Guardrails updates -----
    if (typeof guardrailsEnabled === 'boolean' || typeof guardrailsEnabled === 'string') {
      firm.guardrailsEnabled = (guardrailsEnabled === true || guardrailsEnabled === 'true');
    }
    if (guardrailsTitle !== undefined) {
      firm.guardrailsTitle = guardrailsTitle;
    }
    if (guardrailsDisclaimer !== undefined) {
      firm.guardrailsDisclaimer = guardrailsDisclaimer;
    }



    // ===== NEW Beneficiary updates =====
    if (typeof beneficiaryEnabled === 'boolean' || typeof beneficiaryEnabled === 'string') {
      firm.beneficiaryEnabled = (beneficiaryEnabled === true || beneficiaryEnabled === 'true');
    }
    if (beneficiaryTitle !== undefined) {
      firm.beneficiaryTitle = beneficiaryTitle;
    }
    if (beneficiaryDisclaimer !== undefined) {
      firm.beneficiaryDisclaimer = beneficiaryDisclaimer;
    }


    // ===== NEW Net Worth updates =====
    if (typeof netWorthEnabled === 'boolean' || typeof netWorthEnabled === 'string') {
      firm.netWorthEnabled = (netWorthEnabled === true || netWorthEnabled === 'true');
    }
    if (netWorthTitle !== undefined) {
      firm.netWorthTitle = netWorthTitle;
    }
    if (netWorthDisclaimer !== undefined) {
      firm.netWorthDisclaimer = netWorthDisclaimer;
    }

    // Save
    await firm.save();
    console.log('[POST /settings/value-adds] updated firm =>', firm); // Debug

    const responsePayload = {
      message: 'ValueAdd settings updated successfully',

      // Buckets
      bucketsEnabled: firm.bucketsEnabled,
      bucketsTitle: firm.bucketsTitle,
      bucketsDisclaimer: firm.bucketsDisclaimer,
      bucketsAvailableRate: firm.bucketsAvailableRate,
      bucketsUpperRate    : firm.bucketsUpperRate,
      bucketsLowerRate    : firm.bucketsLowerRate,

      // Guardrails
      guardrailsEnabled: firm.guardrailsEnabled,
      guardrailsTitle: firm.guardrailsTitle,
      guardrailsDisclaimer: firm.guardrailsDisclaimer,
      guardrailsAvailableRate: firm.guardrailsAvailableRate,
      guardrailsUpperRate    : firm.guardrailsUpperRate,
      guardrailsLowerRate    : firm.guardrailsLowerRate,

      // ===== NEW Beneficiary fields in response =====
      beneficiaryEnabled: firm.beneficiaryEnabled,
      beneficiaryTitle: firm.beneficiaryTitle,
      beneficiaryDisclaimer: firm.beneficiaryDisclaimer,

      // ===== NEW Net Worth fields in response =====
      netWorthEnabled: firm.netWorthEnabled,
      netWorthTitle: firm.netWorthTitle,
      netWorthDisclaimer: firm.netWorthDisclaimer


    };

    console.log('[POST /settings/value-adds] returning =>', responsePayload); // Debug
    return res.json(responsePayload);

  } catch (error) {
    await logError(req, 'Error updating ValueAdd settings:', { severity: 'warning' });
    console.error('[POST /settings/value-adds] Catch Error:', error);
    res.status(500).json({ message: 'Failed to update ValueAdd settings.' });
  }
});






// GET /settings
router.get('/settings/:subtab?', isAuthenticated, ensureOnboarded, async (req, res) => {
  try {
    const user = req.session.user;
    const firm = user?.firmId ? await CompanyID.findById(user.firmId) : null;
    const companyData = await CompanyID.findOne({ companyId: user.companyId });
    const subtab = req.params.subtab || 'account';

    console.log('[DEBUG] Server user =>', user);
    console.log('Session user =>', req.session.user?.custodian, req.session.user?.brokerDealer, req.session.user?.isRIA);

    // Mirror firm flags onto user (safe defaults if firm is null)
    user.brokerDealer = firm?.brokerDealer ?? false;
    user.isRIA        = firm?.isRIA ?? false;
    user.custodian    = firm?.custodian ?? '';

    const isAdminAccess =
      user?.role === 'admin' ||
      (user?.permissions && user.permissions.admin === true);

    console.log('[DEBUG] Server isAdminAccess =>', isAdminAccess);
    console.log('[DEBUG] firm.companyBrandingColor =>', firm?.companyBrandingColor ?? '(no firm or no color)');
    console.log(`Firm's current billingInterval: ${firm?.subscriptionInterval ?? '(none)'}`);

    // Prepare user data for the template
    const userData = {
      ...user,
      name: user.name || '',
      email: user.email || '',
      companyName: firm?.companyName || '',
      companyId: firm?.companyId || '',
      companyWebsite: firm?.companyWebsite || '',
      companyAddress: firm?.companyAddress || '',
      phoneNumber: firm?.phoneNumber || '',
      companyLogo: firm?.companyLogo || '',
      brokerDealer: typeof firm?.brokerDealer === 'boolean' ? firm.brokerDealer : false,
      isRIA: typeof firm?.isRIA === 'boolean' ? firm.isRIA : false,
      custodian: firm?.custodian || '',
      companyBrandingColor: firm?.companyBrandingColor || '',
      is2FAEnabled: Boolean(user.is2FAEnabled),
      avatar: user.avatar || '/images/defaultProfilePhoto.png',
    };

    // Buckets settings fallback
    const bucketsEnabled = typeof firm?.bucketsEnabled === 'boolean' ? firm.bucketsEnabled : true;
    const bucketsTitle = firm?.bucketsTitle || 'Buckets Strategy';
    const bucketsDisclaimer = firm?.bucketsDisclaimer || 'THIS REPORT IS NOT COMPLETE WITHOUT ALL THE ACCOMPANYING DISCLAIMERS! ...';

    // Subscription alert logic
    const subStatus = firm?.subscriptionStatus || 'active';
    const showSubAlert = ['canceled', 'past_due', 'unpaid'].includes(subStatus);
    const subAlertType = showSubAlert ? subStatus : '';

    console.log('[DEBUG] userData for Pug =>', userData);

    // Render "settings" template with safe defaults even if firm is null
    res.render('settings', {
      subtab,
      title: 'Settings',
      user: userData,
      avatar: userData.avatar,
      companyData,
      bucketsEnabled,
      bucketsTitle,
      bucketsDisclaimer,
      isAdminAccess,

      // Subscription details (null-safe)
      subscriptionTier: firm?.subscriptionTier || 'starter',
      subscriptionStatus: subStatus,
      billingInterval: firm?.subscriptionInterval || 'monthly',
      cancelAtPeriodEnd: Boolean(firm?.cancelAtPeriodEnd),

      // Fields for the sub alert banner
      showSubAlert,
      subAlertType,
    });
  } catch (err) {
    console.error('Error in GET /settings/:subtab =>', err);

    // Show a friendly message and stay on the previous page instead of a blank white screen
    req.session.flash = {
      type: 'danger',
      message: 'We hit a snag loading Settings. Please try again.'
    };
    return res.redirect(req.get('referer') || '/dashboard');
  }
});






module.exports = router;
