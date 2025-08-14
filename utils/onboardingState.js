// utils/onboardingState.js
const CompanyID = require('../models/CompanyID');

let Household, Account;
try { Household = require('../models/Household'); } catch (e) { /* optional */ }
try { Account   = require('../models/Account');   } catch (e) { /* optional */ }

// Toggle with DEBUG_ONBOARDING=1
const DBG = (...args) => { if (process.env.DEBUG_ONBOARDING) console.log('[onboarding]', ...args); };

/**
 * IMPORTANT: Do NOT push string values to known ObjectId paths to avoid CastError.
 */
function buildCompanyFilter(companyIdStr, companyObjectId) {
  const cid = (companyIdStr || '').toString();
  const cidLower = cid.toLowerCase();

  const stringFields = ['companyId', 'organizationId', 'orgId', 'tenantId'];
  const objectIdFields = ['company', 'companyRef', 'firm', 'firmId', 'org', 'tenant'];

  const or = [];
  for (const f of stringFields) {
    or.push({ [f]: cid });
    if (cidLower !== cid) or.push({ [f]: cidLower });
  }
  if (companyObjectId) {
    for (const f of objectIdFields) {
      or.push({ [f]: companyObjectId });
    }
  }
  const filter = or.length ? { $or: or } : {};
  DBG('buildCompanyFilter →', filter);
  return filter;
}

/**
 * Step 2 progress (Add Your Data)
 */
async function getAddYourDataProgress({ companyIdStr, companyObjectId }) {
  // Prefer firmId:ObjectId for Household tenancy (safer than strings)
  const householdFilter = companyObjectId ? { firmId: companyObjectId } : buildCompanyFilter(companyIdStr, companyObjectId);
  const companyFilter   = buildCompanyFilter(companyIdStr, companyObjectId);

  // Create Households?
  let createHouseholds = false;
  if (Household) {
    try { createHouseholds = !!(await Household.exists(householdFilter)); }
    catch (e) { DBG('household exists error:', e.message); }
  }

  // Create Accounts?
  let createAccounts = false;
  if (Account) {
    try { createAccounts = !!(await Account.exists(companyFilter)); }
    catch (e) { DBG('account exists error:', e.message); }
  } else {
    DBG('Account model missing; will try embedded accounts on Household only');
  }

  // Accounts via household link
  if (!createAccounts && Account && Household) {
    try {
      const hhIds = await Household.find(householdFilter).select('_id').limit(1000).lean();
      const idList = hhIds.map(h => h._id);
      if (idList.length) {
        const viaHousehold = await Account.exists({
          $or: [
            { householdId: { $in: idList } },
            { household:   { $in: idList } },
            { householdRef:{ $in: idList } }
          ]
        });
        createAccounts = !!viaHousehold;
      }
    } catch (e) { DBG('account via household exists error:', e.message); }
  }

  // Embedded account refs on Household
  if (!createAccounts && Household) {
    try {
      const hhWithAccounts = await Household.exists({
        ...householdFilter,
        'accounts.0': { $exists: true }
      });
      createAccounts = !!hhWithAccounts;
    } catch (e) { DBG('embedded accounts exists error:', e.message); }
  }

  // Assign Advisors?
  let assignAdvisors = false;
  if (Household) {
    const advisorOr = [
      { 'leadAdvisors.0':          { $exists: true } },
      { servicingLeadAdvisor:      { $exists: true, $ne: null } },
      { writingLeadAdvisor:        { $exists: true, $ne: null } },
      { redtailServicingAdvisorId: { $exists: true, $ne: null } },
      { redtailWritingAdvisorId:   { $exists: true, $ne: null } }
    ];
    try { assignAdvisors = !!(await Household.exists({ ...householdFilter, $or: advisorOr })); }
    catch (e) { DBG('advisor exists error:', e.message); }
  }

  DBG('Step 2 computed:', { createHouseholds, createAccounts, assignAdvisors });
  return { createHouseholds, createAccounts, assignAdvisors };
}

/**
 * Returns { isReady, step1Complete, step2Complete, onboardingProgress, firm }
 */
async function computeFirmOnboardingState(user) {
  if (!user) return { isReady: false, step1Complete: false, step2Complete: false, onboardingProgress: {} };

  // Find firm by firmId (ObjectId) first; fallback to companyId string
  let firm = null;
  try {
    if (user.firmId) firm = await CompanyID.findById(user.firmId);
    if (!firm && user.companyId) firm = await CompanyID.findOne({ companyId: (user.companyId || '').toLowerCase() });
  } catch (e) {
    DBG('firm lookup error:', e.message);
  }

  const base = (firm && firm.onboardingProgress) ? firm.onboardingProgress : {
    uploadLogo: false,
    selectBrandColor: false,
    inviteTeam: false
  };

  let step2 = { createHouseholds: false, createAccounts: false, assignAdvisors: false };
  try {
    step2 = await getAddYourDataProgress({
      companyIdStr: user.companyId || '',
      companyObjectId: firm?._id
    });
  } catch (e) {
    DBG('getAddYourDataProgress error:', e.message);
  }

  const step1Complete = !!(base.uploadLogo && base.selectBrandColor && base.inviteTeam);
  const step2Complete = !!(step2.createHouseholds && step2.createAccounts && step2.assignAdvisors);
  const isReady = step1Complete && step2Complete;

  const onboardingProgress = { ...base, ...step2 };
  return { isReady, step1Complete, step2Complete, onboardingProgress, firm };
}

module.exports = {
  buildCompanyFilter,
  getAddYourDataProgress,
  computeFirmOnboardingState
};
