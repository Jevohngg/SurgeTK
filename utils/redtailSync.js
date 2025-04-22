/************************************************
 * utils/redtailSync.js
 * Fix for "missing account_number/account_balance" 
 * by actually parsing Redtail's `number` and `balance` fields
 ************************************************/
const axios = require('axios');
const Client = require('../models/Client');
const Household = require('../models/Household');
const Account = require('../models/Account');
const { decryptString } = require('./encryption'); // Decrypt for Basic Auth

function getRedtailBaseUrl(environment) {
  return environment === 'production'
    ? 'https://crm.redtailtechnology.com/api/public/v1'
    : 'https://review.crm.redtailtechnology.com/api/public/v1';
}

function buildAuthHeader(apiKey, username, passwordPlain) {
  const raw = `${apiKey}:${username}:${passwordPlain}`;
  const b64 = Buffer.from(raw).toString('base64');
  return `Basic ${b64}`;
}

/**
 * Main sync function
 * @param {Object} company - The CompanyID doc
 * @param {String} currentUserId - Mongoose ObjectId of the user (owner) for new Households
 */
async function syncAll(company, currentUserId) {
  const {
    apiKey,
    userKey,
    username,
    encryptedPassword,
    encryptionIV,
    authTag,
    environment,
    lastSync
  } = company.redtail;

  console.log('[DEBUG] Starting syncAll...');
  console.log('[DEBUG] environment:', environment, 'lastSync:', lastSync);
  console.log('[DEBUG] currentUserId:', currentUserId);

  // 1) Decrypt the password
  const passwordPlain = decryptString(encryptedPassword, encryptionIV, authTag);

  // 2) Build Redtail base URL & headers
  const baseUrl = getRedtailBaseUrl(environment);
  const authHeader = buildAuthHeader(apiKey, username, passwordPlain);

  // 3) Sync Contacts
  await syncContacts(baseUrl, authHeader, userKey, lastSync);

  // 4) Sync Families => upsert Households with firmId & owner
  await syncFamilies(baseUrl, authHeader, userKey, company, currentUserId);

  // 4a) Create "solo" Households for orphan clients
  await createSoloHouseholdsForOrphanClients(company, currentUserId);

  // 5) Sync Accounts (with second fetch if needed)
  await syncAccounts(baseUrl, authHeader, userKey);

  // 6) Update lastSync
  company.redtail.lastSync = new Date();
  await company.save();
  console.log('[DEBUG] Finished syncAll. Updated lastSync to:', company.redtail.lastSync);
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

  do {
    const url = `${baseUrl}/contacts?page=${page}&page_size=200&include=phones,emails,addresses,family,accounts${updatedSince}`;
    console.log('[DEBUG] Fetching contacts from:', url);

    const resp = await axios.get(url, { headers });
    const contacts = resp.data.contacts || [];
    totalPages = resp.data.meta?.total_pages || 1;

    console.log(`[DEBUG] Page ${page}/${totalPages}, # of contacts:`, contacts.length);

    for (const contact of contacts) {
      await upsertClientFromRedtail(contact);
    }
    page += 1;
  } while (page <= totalPages);

  console.log('[RedtailSync] Contacts Sync complete.');
}

async function upsertClientFromRedtail(contact) {
  const redtailId = contact.id;
  console.log('[DEBUG] Upserting client from Redtail contact =>', redtailId);

  // ~~~~~~~~~~~~~~~~~~~~~
  // Fix for missing names
  // ~~~~~~~~~~~~~~~~~~~~~
  let firstName = contact.first_name || '';
  let lastName = contact.last_name || '';
  if (contact.type === 'Business' && contact.company_name) {
    firstName = contact.company_name;
    lastName = 'Business';
  } else if (!firstName && !lastName) {
    firstName = 'Unknown';
    lastName = 'Client';
  }

  const dob = contact.dob ? new Date(contact.dob) : null;
  const ssn = contact.tax_id || '';

  // Email, phone
  let primaryEmail = '';
  if (Array.isArray(contact.emails) && contact.emails.length) {
    const primary = contact.emails.find(e => e.is_primary);
    primaryEmail = primary ? primary.address : contact.emails[0].address;
  }

  let mobileNumber = '';
  if (Array.isArray(contact.phones) && contact.phones.length) {
    const mobile = contact.phones.find(p => p.type === 'Mobile');
    mobileNumber = mobile ? mobile.number : contact.phones[0].number;
  }

  let addressLine = '';
  if (Array.isArray(contact.addresses) && contact.addresses.length) {
    addressLine = contact.addresses[0].line_1 || '';
  }

  // Upsert
  const updatedClient = await Client.findOneAndUpdate(
    { redtailId },
    {
      $set: {
        redtailId,
        firstName,
        lastName,
        dob,
        ssn,
        email: primaryEmail,
        mobileNumber,
        homeAddress: addressLine
        // household set later
      }
    },
    { upsert: true, new: true }
  );

  console.log('[DEBUG] Client upserted =>', updatedClient._id);
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
        owner: currentUserId
      },
      $setOnInsert: {
        redtailFamilyId
      }
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
    $or: [
      { household: { $exists: false } },
      { household: null }
    ]
  });

  console.log('[DEBUG] Found orphans =>', orphans.length);

  for (const orphan of orphans) {
    const hhName = `Solo: ${orphan.firstName} ${orphan.lastName}`.trim();
    console.log(`[DEBUG] Creating a new solo household => ${hhName} for client => ${orphan._id}`);

    const newHousehold = await Household.create({
      name: hhName,
      firmId: company._id,
      owner: currentUserId,
      redtailFamilyId: null
    });

    console.log('[DEBUG] Created solo household =>', newHousehold._id);

    orphan.household = newHousehold._id;
    await orphan.save();
    console.log(`[DEBUG] Assigned orphan client ${orphan._id} to new solo household => ${newHousehold._id}`);
  }
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
 */
async function upsertAccountFromRedtail(baseUrl, headers, accountData, client) {
  console.log('[DEBUG] Upserting account => redtailId:', accountData.id, 'client:', client._id);
  console.log('[DEBUG] Original accountData =>', accountData);

  // "number" and "balance" might be missing => second fetch
  let redtailAccountId = accountData.id;

  // Redtail uses "number" for account_number, "balance" for account_balance
  let rawNumber = accountData.number;    // e.g. '358742076'
  let rawBalance = accountData.balance;  // e.g. '750000.0'
  let rawType = accountData.account_type; // e.g. 'Indexed Annuity'

  // If missing or undefined, do 2nd fetch /accounts/:id
  if (!rawNumber || typeof rawBalance === 'undefined') {
    console.log('[DEBUG] Missing `number` or `balance`; fetching /accounts/:id for detail...');
    try {
      const fullResp = await axios.get(`${baseUrl}/accounts/${redtailAccountId}`, { headers });
      console.log('[DEBUG] Full detail from /accounts/:id =>', fullResp.data);

      // The real data is under fullResp.data.account
      const detail = fullResp.data.account || {};
      rawNumber = detail.number || rawNumber;
      rawBalance = typeof detail.balance !== 'undefined'
        ? detail.balance
        : rawBalance;
      rawType = detail.account_type || rawType;
    } catch (err) {
      console.warn('[DEBUG] Could not fetch full account details =>', err.response?.data || err);
      // fallback if 2nd fetch fails
      rawNumber = rawNumber || 'Unknown Number';
      rawBalance = rawBalance || 0;
    }
  }

  // Now parse final fields
  // We store them as accountNumber + accountValue
  const accountNumber = rawNumber || 'Unknown Number';
  const accountValue = parseFloat(rawBalance) || 0; // convert "750000.0" -> 750000

  // Map type if it’s not in the enum
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
  // If Redtail has more info, parse it. For now, default to 'Taxable'
  const taxStatus = 'Taxable';

  // Ensure household
  let householdId = client.household;
  if (!householdId) {
    console.warn(`[DEBUG] Client ${client._id} had no household assigned? Creating fallback...`);
    const fallback = await Household.create({
      name: `Solo: ${client.firstName} ${client.lastName}`,
      firmId: null,
      owner: null
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
      taxStatus
    });
  } else {
    console.log('[DEBUG] Updating existing account doc =>', localAccount._id);
    localAccount.accountNumber = accountNumber;
    localAccount.accountValue = accountValue;
    localAccount.accountType = accountType;
    localAccount.custodian = custodian;
    localAccount.taxStatus = taxStatus;
    localAccount.household = householdId;

    if (!localAccount.accountOwner.includes(client._id)) {
      localAccount.accountOwner.push(client._id);
    }
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
  } catch (err) {
    console.error('[DEBUG] Error saving account =>', err);
    throw err;
  }
}

module.exports = {
  syncAll
};
