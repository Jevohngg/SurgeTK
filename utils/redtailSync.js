/************************************************
 * utils/redtailSync.js
 *
 * Expanded to:
 *  - Fetch client photos from Redtail.
 *  - Upload those photos to AWS S3.
 *  - Store the S3 URL in client.profilePhoto.
 *  - Handle missing account_number/balance by
 *    fetching account detail as needed.
 *  - Robustly fetch phone numbers & emails:
 *    * Use /contacts?include=phones,emails
 *    * Also separately call /contacts/:id/phones
 *      and /contacts/:id/emails to ensure completeness
 *  - NEW: Fetch and store beneficiaries for each account
 *  - NEW: Pull in monthly distribution / systematic withdrawal info
 ************************************************/

const axios = require('axios');
const AWS = require('aws-sdk');
const Client = require('../models/Client');
const Household = require('../models/Household');
const Account = require('../models/Account');
const { decryptString } = require('./encryption'); // Decrypt for Basic Auth
// If you have a Beneficiary model, import it too:
// const Beneficiary = require('../models/Beneficiary');

/************************************************
 * AWS S3 CONFIG / UPLOAD HELPER
 ************************************************/
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID, 
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();

/**
 * Upload a buffer to S3 and return the public URL
 * @param {Buffer} buffer - The binary data to upload
 * @param {String} contentType - e.g., 'image/jpeg'
 * @param {String} [folder='clientPhotos'] - Folder name in the S3 bucket
 * @returns {Promise<String>} The public URL of the uploaded file
 */
async function uploadBufferToS3(buffer, contentType, folder = 'clientPhotos') {
  const fileExtension = contentType.split('/')[1] || 'jpg';
  const fileName = `${folder}/${Date.now()}.${fileExtension}`;

  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: fileName,
    Body: buffer,
    ContentType: contentType,
  };

  const data = await s3.upload(params).promise();
  return data.Location; // S3 public URL
}

/************************************************
 * REDTAIL SYNC CORE
 ************************************************/

/**
 * Determine the correct base URL for Redtail, depending on environment
 */
function getRedtailBaseUrl(environment) {
  return environment === 'production'
    ? 'https://crm.redtailtechnology.com/api/public/v1'
    : 'https://review.crm.redtailtechnology.com/api/public/v1';
}

/**
 * Build the Basic Auth header using:
 *   base64( apiKey:username:passwordPlain )
 */
function buildAuthHeader(apiKey, username, passwordPlain) {
  const raw = `${apiKey}:${username}:${passwordPlain}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

/**
 * Main sync function
 * @param {Object} company - The CompanyID doc
 * @param {String} currentUserId - Mongoose ObjectId of the user (owner) for new Households
 * @param {Object} io - The Socket.io server instance
 * @param {String} userRoom - The user’s room (their _id as a string)
 */
async function syncAll(company, currentUserId, io, userRoom) {
  const {
    apiKey,
    userKey,
    username,
    encryptedPassword,
    encryptionIV,
    authTag,
    environment,
    lastSync,
  } = company.redtail;

  console.log('[DEBUG] Starting syncAll...');
  console.log('[DEBUG] environment:', environment, 'lastSync:', lastSync);
  console.log('[DEBUG] currentUserId:', currentUserId);

  // 1) Decrypt the password
  const passwordPlain = decryptString(encryptedPassword, encryptionIV, authTag);

  // 2) Build Redtail base URL & headers
  const baseUrl = getRedtailBaseUrl(environment);
  const authHeader = buildAuthHeader(apiKey, username, passwordPlain);

  // Emit ~10% at start
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', { percent: 10 });
  }

  // 3) Sync Contacts
  await syncContacts(baseUrl, authHeader, userKey, lastSync);

  // Emit ~40% after Contacts
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', { percent: 40 });
  }

  // 4) Sync Families => upsert Households
  await syncFamilies(baseUrl, authHeader, userKey, company, currentUserId);

  // Emit ~60%
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', { percent: 60 });
  }

  // 4a) Create "solo" Households
  await createSoloHouseholdsForOrphanClients(company, currentUserId);

  // Emit ~75%
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', { percent: 75 });
  }

  // 5) Sync Accounts
  await syncAccounts(baseUrl, authHeader, userKey);

  // Emit ~90%
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', { percent: 90 });
  }

  // 6) Update lastSync
  company.redtail.lastSync = new Date();
  await company.save();
  console.log('[DEBUG] Finished syncAll. Updated lastSync to:', company.redtail.lastSync);

  // Finally ~100%
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', { percent: 100 });
  }
}

/* ─────────────────────────────────────────────────────────────────
   HELPER FUNCTIONS FOR PHONES & EMAILS
   ───────────────────────────────────────────────────────────────── */
async function fetchContactPhones(baseUrl, headers, contactId) {
  let page = 1;
  let allPhones = [];

  while (true) {
    const url = `${baseUrl}/contacts/${contactId}/phones?page=${page}`;
    const resp = await axios.get(url, { headers });
    const phones = resp.data.phones || [];
    const meta = resp.data.meta || {};

    allPhones = [...allPhones, ...phones];

    if (meta.total_pages && page < meta.total_pages) {
      page++;
    } else {
      break;
    }
  }

  return allPhones;
}

async function fetchContactEmails(baseUrl, headers, contactId) {
  let page = 1;
  let allEmails = [];

  while (true) {
    const url = `${baseUrl}/contacts/${contactId}/emails?page=${page}`;
    const resp = await axios.get(url, { headers });
    const emails = resp.data.emails || [];
    const meta = resp.data.meta || {};

    allEmails = [...allEmails, ...emails];

    if (meta.total_pages && page < meta.total_pages) {
      page++;
    } else {
      break;
    }
  }

  return allEmails;
}

/* ─────────────────────────────────────────────────────────────────
   A) CONTACTS (CLIENTS)
   ───────────────────────────────────────────────────────────────── */
async function syncContacts(baseUrl, authHeader, userKey, lastSync) {
  console.log('[RedtailSync] Starting Contacts Sync...');
  const headers = { Authorization: authHeader, userkey: userKey };

  let page = 1;
  let totalPages = 1;
  const updatedSince = lastSync
    ? `&updated_since=${encodeURIComponent(lastSync.toISOString())}`
    : '';

  // Include phones, emails, addresses, family, accounts
  do {
    const url = `${baseUrl}/contacts?page=${page}&page_size=200&include=phones,emails,addresses,family,accounts${updatedSince}`;
    console.log('[DEBUG] Fetching contacts from:', url);

    const resp = await axios.get(url, { headers });
    const contacts = resp.data.contacts || [];
    totalPages = resp.data.meta?.total_pages || 1;

    console.log(`[DEBUG] Page ${page}/${totalPages}, # of contacts:`, contacts.length);

    for (const contact of contacts) {
      await upsertClientFromRedtail(contact, baseUrl, headers);
    }

    page += 1;
  } while (page <= totalPages);

  console.log('[RedtailSync] Contacts Sync complete.');
}

async function upsertClientFromRedtail(contact, baseUrl, headers) {
  const redtailId = contact.id;
  console.log('[DEBUG] Upserting client from Redtail contact =>', redtailId);

  // Names
  let firstName = contact.first_name || '';
  let middleName = contact.middle_name || ''; 
  let lastName = contact.last_name || '';

  if (contact.type === 'Business' && contact.company_name) {
    firstName = contact.company_name;
    lastName = 'Business';
  } else if (!firstName && !lastName) {
    firstName = 'Unknown';
    lastName = 'Client';
  }

  // (A) Also parse marital_status if available
  let maritalStatus = '';
  if (contact.marital_status) {
    const redtailMs = contact.marital_status.toLowerCase();
    if (redtailMs.includes('married')) maritalStatus = 'Married';
    else if (redtailMs.includes('widowed')) maritalStatus = 'Widowed';
    else if (redtailMs.includes('divorced')) maritalStatus = 'Divorced';
    else maritalStatus = 'Single';
  }

  // (B) DOB & SSN
  const dob = contact.dob ? new Date(contact.dob) : null;
  const ssn = contact.tax_id || '';

  // (C) Emails from the main contact object (may be partial)
  let primaryEmail = '';
  if (Array.isArray(contact.emails) && contact.emails.length) {
    const primary = contact.emails.find(e => e.is_primary);
    primaryEmail = primary ? primary.address : contact.emails[0].address;
  }

  // (D) Phones from the main contact object (may be partial)
  let mobileNumber = '';
  let homePhone = '';
  if (Array.isArray(contact.phones) && contact.phones.length) {
    const mobile = contact.phones.find(p => 
      p.type === 'Mobile' || p.phone_type_description === 'Mobile'
    );
    if (mobile) mobileNumber = mobile.number;

    const home = contact.phones.find(p => 
      p.type === 'Home' || p.phone_type_description === 'Home'
    );
    if (home) homePhone = home.number;
  }

  // (E) Address (store in homeAddress)
  let homeAddress = '';
  if (Array.isArray(contact.addresses) && contact.addresses.length) {
    const addr = contact.addresses[0];
    let addrParts = [];
    if (addr.line_1) addrParts.push(addr.line_1);
    if (addr.line_2) addrParts.push(addr.line_2);
    if (addr.city) addrParts.push(addr.city);
    if (addr.state) addrParts.push(addr.state);
    if (addr.postal_code) addrParts.push(addr.postal_code);
    homeAddress = addrParts.join(', ');
  }

  // 1) Create or update the Client doc with initial data
  let updatedClient = await Client.findOneAndUpdate(
    { redtailId },
    {
      $set: {
        redtailId,
        firstName,
        middleName,
        lastName,
        dob,
        ssn,
        maritalStatus,
        email: primaryEmail,
        mobileNumber,
        homePhone,
        homeAddress,
      },
    },
    { upsert: true, new: true }
  );

  console.log('[DEBUG] Client upserted =>', updatedClient._id);

  // 2) For robust phone/email coverage, fetch them separately
  try {
    const allPhones = await fetchContactPhones(baseUrl, headers, redtailId);
    const allEmails = await fetchContactEmails(baseUrl, headers, redtailId);

    // a) Best mobile phone
    const mobileCandidate = allPhones.find(p => p.phone_type === 3 || (p.phone_type_description || '').toLowerCase() === 'mobile');
    if (mobileCandidate) {
      updatedClient.mobileNumber = mobileCandidate.number;
    }

    // b) Best home phone
    const homeCandidate = allPhones.find(p => p.phone_type === 1 || (p.phone_type_description || '').toLowerCase() === 'home');
    if (homeCandidate) {
      updatedClient.homePhone = homeCandidate.number;
    }

    // c) Primary or fallback email
    let primaryEmailObj = allEmails.find(e => e.is_primary);
    if (!primaryEmailObj && allEmails.length > 0) {
      primaryEmailObj = allEmails[0];
    }
    if (primaryEmailObj) {
      updatedClient.email = primaryEmailObj.address;
    }

    updatedClient = await updatedClient.save();
    console.log('[DEBUG] Updated phones/emails after separate fetch =>', updatedClient._id);

  } catch (err) {
    console.warn('[DEBUG] Error fetching separate phones/emails =>', err.message);
  }

  // 3) Attempt to fetch the contact photo
  try {
    const imageUrl = `${baseUrl}/contacts/${redtailId}/photo`;

    const photoResp = await axios.get(imageUrl, {
      headers,
      responseType: 'arraybuffer',
    });

    const contentType = photoResp.headers['content-type'] || 'image/jpeg';
    const buffer = Buffer.from(photoResp.data);

    // Upload to S3
    const s3Url = await uploadBufferToS3(buffer, contentType, 'clientPhotos');

    updatedClient.profilePhoto = s3Url;
    await updatedClient.save();

    console.log('[DEBUG] Successfully fetched & saved contact photo for client:', updatedClient._id);
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log('[DEBUG] No profile photo for contact =>', redtailId);
    } else {
      console.warn('[DEBUG] Error fetching contact photo:', error.message);
    }
  }
}

/* ─────────────────────────────────────────────────────────────────
   B) FAMILIES => HOUSEHOLDS
   ───────────────────────────────────────────────────────────────── */
async function syncFamilies(baseUrl, authHeader, userKey, company, currentUserId) {
  console.log('[RedtailSync] Starting Families Sync...');
  const headers = { Authorization: authHeader, userkey: userKey };

  const url = `${baseUrl}/families?family_members=true`;
  console.log('[DEBUG] Fetching families from:', url);

  const resp = await axios.get(url, { headers });
  const families = resp.data.families || [];
  console.log('[DEBUG] Families returned:', families.length);

  for (const family of families) {
    console.log('[DEBUG] Upserting family =>', family.id, family.name);
    await upsertHouseholdFromRedtailFamily(family, company, currentUserId);
  }
  console.log('[RedtailSync] Families Sync complete.');
}

async function upsertHouseholdFromRedtailFamily(family, company, currentUserId) {
  const redtailFamilyId = family.id;
  const name = family.name || 'Unnamed Family';

  const household = await Household.findOneAndUpdate(
    { redtailFamilyId },
    {
      $set: {
        name,
        firmId: company._id,
        owner: currentUserId,
      },
      $setOnInsert: {
        redtailFamilyId,
      },
    },
    { upsert: true, new: true }
  );

  console.log('[DEBUG] Household upserted =>', household._id);

  const members = family.members || [];
  console.log(`[DEBUG] Family ${redtailFamilyId} has ${members.length} members`);

  for (const member of members) {
    const contactId = member.contact_id;
    if (!contactId) continue;

    const client = await Client.findOne({ redtailId: contactId });
    if (!client) {
      console.log(`[DEBUG] No local client found with redtailId=${contactId}, skipping.`);
      continue;
    }

    console.log(`[DEBUG] Assigning client ${client._id} to household ${household._id}`);
    client.household = household._id;

    if (member.hoh) {
      console.log(`[DEBUG] Setting headOfHousehold => ${client._id} for household ${household._id}`);
      household.headOfHousehold = client._id;
      await household.save();
    }
    await client.save();
  }
}

/**
 * If a client was never put into a Family => orphaned.
 * If "household" is required, create a "solo" household for them.
 */
async function createSoloHouseholdsForOrphanClients(company, currentUserId) {
  console.log('[DEBUG] Checking for orphan clients with no household...');
  const orphans = await Client.find({
    $or: [{ household: { $exists: false } }, { household: null }],
  });

  console.log('[DEBUG] Found orphans =>', orphans.length);

  for (const orphan of orphans) {
    const hhName = `Solo: ${orphan.firstName} ${orphan.lastName}`.trim();
    console.log(`[DEBUG] Creating a new solo household => ${hhName} for client => ${orphan._id}`);

    const newHousehold = await Household.create({
      name: hhName,
      firmId: company._id,
      owner: currentUserId,
      redtailFamilyId: null,
    });

    console.log('[DEBUG] Created solo household =>', newHousehold._id);

    orphan.household = newHousehold._id;
    await orphan.save();
    console.log(`[DEBUG] Assigned orphan client ${orphan._id} to new solo household => ${newHousehold._id}`);
  }
}

/* ─────────────────────────────────────────────────────────────────
   D) BENEFICIARIES HELPER
   ───────────────────────────────────────────────────────────────── */
/**
 * Fetch all beneficiaries for a given account.
 * (We'll assume no pagination is needed here, or adapt if the API supports it.)
 */
async function fetchAccountBeneficiaries(baseUrl, headers, accountId) {
  const url = `${baseUrl}/accounts/${accountId}/beneficiaries`;
  console.log('[DEBUG] Fetching beneficiaries from =>', url);

  const resp = await axios.get(url, { headers });
  // The real shape might differ! For example:
  // { beneficiaries: [ { id: 5, type: 'Primary', name: 'Jane Doe', share: 50 }, ... ] }
  const data = resp.data || {};

  // Return `data.beneficiaries` or adapt as needed
  return data.beneficiaries || [];
}

/* ─────────────────────────────────────────────────────────────────
   C) ACCOUNTS
   ───────────────────────────────────────────────────────────────── */
async function syncAccounts(baseUrl, authHeader, userKey) {
  console.log('[RedtailSync] Starting Accounts Sync...');
  const headers = { Authorization: authHeader, userkey: userKey };

  // We'll do a per-contact approach
  const allClients = await Client.find(
    { redtailId: { $exists: true, $ne: null } },
    '_id redtailId household firstName lastName'
  );

  console.log('[DEBUG] total clients for account sync =>', allClients.length);

  for (const client of allClients) {
    const contactId = client.redtailId;
    const url = `${baseUrl}/contacts/${contactId}/accounts`;
    console.log('[DEBUG] Fetching accounts for contactId =>', contactId);

    try {
      const resp = await axios.get(url, { headers });
      const accounts = resp.data.accounts || [];
      console.log(`[DEBUG] Found ${accounts.length} accounts for client => ${client._id}`);

      for (const acc of accounts) {
        await upsertAccountFromRedtail(baseUrl, headers, acc, client);
      }
    } catch (err) {
      console.error(`Failed to fetch accounts for Contact ${contactId}`, err.response?.data || err);
    }
  }

  console.log('[RedtailSync] Accounts Sync complete.');
}

/**
 * upsertAccountFromRedtail tries to get `number` + `balance` from the account.
 * If missing, does a 2nd fetch: GET /accounts/:id => { account: { number, balance } }
 * Then attempts to fetch beneficiary info & store monthly distribution fields.
 */
async function upsertAccountFromRedtail(baseUrl, headers, accountData, client) {
  console.log('[DEBUG] Upserting account => redtailId:', accountData.id, 'client:', client._id);
  console.log('[DEBUG] Original accountData =>', accountData);

  // "number" and "balance" might be missing => second fetch
  let redtailAccountId = accountData.id;

  let rawNumber = accountData.number;
  let rawBalance = accountData.balance;
  let rawType = accountData.account_type;

  // We'll store monthly distribution fields in these placeholders
  let rawSystematicWithdrawAmount;
  let rawSystematicWithdrawFrequency;
  let rawFederalWithholding;
  let rawStateWithholding;

  if (!rawNumber || typeof rawBalance === 'undefined') {
    console.log('[DEBUG] Missing `number` or `balance`; fetching /accounts/:id for detail...');
    try {
      const fullResp = await axios.get(`${baseUrl}/accounts/${redtailAccountId}`, { headers });
      console.log('[DEBUG] Full detail from /accounts/:id =>', fullResp.data);

      const detail = fullResp.data.account || {};
      rawNumber = detail.number || rawNumber;
      rawBalance = typeof detail.balance !== 'undefined' ? detail.balance : rawBalance;
      rawType = detail.account_type || rawType;

      // Hypothetical fields in Redtail (adjust if actual fields differ):
      rawSystematicWithdrawAmount = detail.systematic_withdraw_amount; 
      rawSystematicWithdrawFrequency = detail.systematic_withdraw_frequency;
      rawFederalWithholding = detail.federal_tax_withholding;
      rawStateWithholding = detail.state_tax_withholding;
    } catch (err) {
      console.warn('[DEBUG] Could not fetch full account details =>', err.response?.data || err);
      rawNumber = rawNumber || 'Unknown Number';
      rawBalance = rawBalance || 0;
    }
  }

  const accountNumber = rawNumber || 'Unknown Number';
  const accountValue = parseFloat(rawBalance) || 0;

  // Map type if it’s not in our local enum
  const validAccountTypes = [
    'Individual','TOD','Joint','Joint Tenants','Tenants in Common','IRA','Roth IRA','Inherited IRA',
    'SEP IRA','Simple IRA','401(k)','403(b)','529 Plan','UTMA','Trust','Custodial','Annuity',
    'Variable Annuity','Fixed Annuity','Deferred Annuity','Immediate Annuity','Other'
  ];
  let accountType = rawType || 'Other';
  if (!validAccountTypes.includes(accountType)) {
    console.warn(`[DEBUG] account_type "${accountType}" not in enum, using "Other".`);
    accountType = 'Other';
  }

  // Some placeholders for custodian & taxStatus if Redtail doesn't provide them
  const custodian = accountData.company || 'UnknownCustodian';
  const taxStatus = 'Taxable'; // default if not provided

  // Ensure household
  let householdId = client.household;
  if (!householdId) {
    console.warn(`[DEBUG] Client ${client._id} had no household assigned? Creating fallback...`);
    const fallback = await Household.create({
      name: `Solo: ${client.firstName} ${client.lastName}`,
      firmId: null,
      owner: null,
    });
    householdId = fallback._id;
    client.household = fallback._id;
    await client.save();
  }

  // Upsert the local Account
  let localAccount = await Account.findOne({ redtailAccountId });
  if (!localAccount) {
    console.log('[DEBUG] Creating new account doc...');
    localAccount = new Account({
      redtailAccountId,
      accountNumber,
      accountValue,
      accountType,
      accountOwner: [client._id],
      household: householdId,
      custodian,
      taxStatus,
    });
  } else {
    console.log('[DEBUG] Updating existing account doc =>', localAccount._id);
    localAccount.accountNumber = accountNumber;
    localAccount.accountValue = accountValue;
    localAccount.accountType = accountType;
    localAccount.custodian = custodian;
    localAccount.taxStatus = taxStatus;
    localAccount.household = householdId;

    // Make sure this client is in the accountOwner array
    if (!localAccount.accountOwner.includes(client._id)) {
      localAccount.accountOwner.push(client._id);
    }
  }

  // Store the newly fetched monthly distribution fields
  if (typeof rawSystematicWithdrawAmount !== 'undefined') {
    localAccount.systematicWithdrawAmount = rawSystematicWithdrawAmount;
  }
  if (typeof rawSystematicWithdrawFrequency !== 'undefined') {
    // Must match your local enum: ['Monthly','Quarterly','Annually']
    // If Redtail has different strings, map them or store directly
    localAccount.systematicWithdrawFrequency = rawSystematicWithdrawFrequency;
  }
  if (typeof rawFederalWithholding !== 'undefined') {
    localAccount.federalTaxWithholding = rawFederalWithholding;
  }
  if (typeof rawStateWithholding !== 'undefined') {
    localAccount.stateTaxWithholding = rawStateWithholding;
  }

  try {
    const saved = await localAccount.save();
    console.log(
      '[DEBUG] Account saved =>',
      saved._id,
      'Number:',
      saved.accountNumber,
      'Value:',
      saved.accountValue
    );

    // Also push this account into Household.accounts if it's not already there
    await Household.findByIdAndUpdate(householdId, {
      $addToSet: { accounts: saved._id },
    });
    console.log(`[DEBUG] Added account ${saved._id} to Household ${householdId}.`);

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // FETCH AND SAVE BENEFICIARIES
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    try {
      // 1) Get beneficiary data from Redtail
      const redtailBenefs = await fetchAccountBeneficiaries(baseUrl, headers, redtailAccountId);
      console.log(`[DEBUG] Found ${redtailBenefs.length} beneficiary records for account => ${redtailAccountId}`);

      // 2) Convert them into local 'primary' / 'contingent' arrays as needed
      const primaryBenefs = [];
      const contingentBenefs = [];

      for (const b of redtailBenefs) {
        // Example logic: if `b.type` is "Primary", we push to primary; if "Contingent", push to contingent
        // If Redtail uses different fields, adapt accordingly.
        if ((b.type || '').toLowerCase() === 'primary') {
          primaryBenefs.push({
            beneficiary: null, // or the `_id` of a local Beneficiary doc if you upsert
            percentageAllocation: b.share || 0,
          });
        } else {
          contingentBenefs.push({
            beneficiary: null,
            percentageAllocation: b.share || 0,
          });
        }

        // If you have a local Beneficiary model, you might do something like:
        // const localBen = await Beneficiary.findOneAndUpdate(
        //   { redtailBeneficiaryId: b.id },
        //   { $set: { name: b.name } },
        //   { upsert: true, new: true }
        // );
        // Then link it:
        // primaryBenefs.push({ beneficiary: localBen._id, percentageAllocation: b.share || 0 });
      }

      // 3) Assign to localAccount.beneficiaries and save
      localAccount.beneficiaries = {
        primary: primaryBenefs,
        contingent: contingentBenefs,
      };

      await localAccount.save();
      console.log(`[DEBUG] Successfully updated beneficiaries for account => ${saved._id}`);
    } catch (bErr) {
      console.warn('[DEBUG] Failed to fetch or save beneficiaries:', bErr.message);
    }

  } catch (err) {
    console.error('[DEBUG] Error saving account =>', err);
    throw err;
  }
}

/************************************************
 * EXPORT
 ************************************************/
module.exports = {
  syncAll,
};
