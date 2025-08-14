const express = require('express');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');
const User = require('../models/User');
const CompanyID = require('../models/CompanyID');

// Try to require your data models (adjust paths/names as needed)
let Household, Account;
try { Household = require('../models/Household'); } catch (e) { console.warn('[onboarding] Household model not loaded:', e.message); }
try { Account   = require('../models/Account');   } catch (e) { console.warn('[onboarding] Account model not loaded:', e.message); }
const { getAddYourDataProgress } = require('../utils/onboardingState');

const router = express.Router();

// Toggle server-side logs with: DEBUG_ONBOARDING=1
const DBG = (...args) => { if (process.env.DEBUG_ONBOARDING) console.log('[onboarding]', ...args); };

/**
 * Build a filter that matches:
 *  - string-based tenancy fields using the companyId string (and its lowercase)
 *  - ObjectId-based tenancy fields using the firm's ObjectId (if available)
 * IMPORTANT: do NOT push string values to known ObjectId paths (e.g., firmId) to avoid CastError.
 */
function buildCompanyFilter(companyIdStr, companyObjectId) {
  const cid = (companyIdStr || '').toString();
  const cidLower = cid.toLowerCase();

  // These fields are typically stored as STRINGS
  const stringFields = [
    'companyId',       // your CompanyID key (lowercased at save)
    'organizationId',
    'orgId',
    'tenantId'
  ];

  // These fields are commonly stored as OBJECTIDs on sub-docs
  const objectIdFields = [
    'company',
    'companyRef',
    'firm',
    'firmId',
    'org',
    'tenant'
  ];

  const or = [];

  // Add string matches ONLY to string fields
  for (const f of stringFields) {
    or.push({ [f]: cid });
    if (cidLower !== cid) or.push({ [f]: cidLower });
  }

  // Add ObjectId matches ONLY if we have one
  if (companyObjectId) {
    for (const f of objectIdFields) {
      or.push({ [f]: companyObjectId });
    }
  }

  const filter = or.length ? { $or: or } : {};
  DBG('buildCompanyFilter →', filter);
  return filter;
}



// Protected dashboard route
router.get('/dashboard', ensureAuthenticated, ensureOnboarded, async (req, res) => {
  try {
    const user = req.session.user;
    const sessionMaxAge = req.session.cookie?.maxAge;
    const showWelcome = req.session.showWelcomeModal || false;

    // Normalize the companyId we read from the session
    const userCompanyId = (user?.companyId || '').toString();
    const userCompanyIdLower = userCompanyId.toLowerCase();

    // Find the firm's CompanyID record using the lowercased key (schema lowercases on save)
    const companyData = await CompanyID.findOne({ companyId: userCompanyIdLower });

    // If we found a company name but user doesn't have one yet, copy it locally
    if (companyData?.companyName && !user.companyName) {
      user.companyName = companyData.companyName;
      req.session.user = user;
    }

    const isAdminAccess =
      (Array.isArray(user?.roles) && user.roles.includes('admin')) ||
      user?.permission === 'admin';

    // Step 1 flags from CompanyID (unchanged)
    const baseProgress = (companyData && companyData.onboardingProgress) ? companyData.onboardingProgress : {
      uploadLogo: false,
      selectBrandColor: false,
      inviteTeam: false
    };

    // Step 2 (Add Your Data) computed from live data (robust tenancy matching)
    const { createHouseholds, createAccounts, assignAdvisors } =
      await getAddYourDataProgress({ companyIdStr: userCompanyId, companyObjectId: companyData?._id });

    // Compose a single object the template can use
    const onboardingProgress = {
      ...baseProgress,
      createHouseholds,
      createAccounts,
      assignAdvisors
    };

    // Step completeness
    const step1Complete =
      !!(onboardingProgress.uploadLogo && onboardingProgress.selectBrandColor && onboardingProgress.inviteTeam);

    const step2Complete =
      !!(onboardingProgress.createHouseholds && onboardingProgress.createAccounts && onboardingProgress.assignAdvisors);

    const isReady = step1Complete && step2Complete;

    // Optional breadcrumbs for debugging
    DBG('models:', { Household: !!Household, Account: !!Account });
    DBG('ids:', { userCompanyId, companyObjectId: companyData?._id });
    DBG('progress:', { step1Complete, step2Complete, isReady, onboardingProgress });

    // Prevent showing welcome again
    req.session.showWelcomeModal = false;

    // Render with safe values
    res.render('dashboard', {
      title: 'Dashboard',
      user,
      companyData: companyData || {},
      avatar: user?.avatar || null,
      sessionMaxAge,
      showWelcomeModal: showWelcome,
      isAdminAccess,
      onboardingProgress,
      step1Complete,
      step2Complete,
      isReady,
      videoId: process.env.YOUTUBE_VIDEO_ID || 'DEFAULT_VIDEO_ID'
    });
  } catch (err) {
    console.error('[dashboard] error:', err);
    res.status(500).send('Something went wrong');
  }
});

module.exports = router;
