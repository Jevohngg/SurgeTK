/************************************************
 * utils/redtailSync.js
 *
 * Expanded to:
 *  - Fetch client photos from Redtail.
 *  - Upload those photos to AWS S3.
 *  - Store the S3 URL in client.profilePhoto.
 *  - Handle missing account_number/balance by fetching account detail as needed.
 *  - Robustly fetch phone numbers & emails:
 *      * Use /contacts?include=phones,emails
 *      * Also separately call /contacts/:id/phones
 *        and /contacts/:id/emails to ensure completeness
 *  - Fetch and store beneficiaries for each account
 *  - Pull in monthly distribution / systematic withdrawal info
 *  - Removed “skip if zero accounts” to stabilize
 *  - **Now includes** an in-memory diff of Redtail vs. local accounts
 *  - **Stores** Redtail’s account_type and company in `accountTypeRaw` / `custodianRaw`
 *  - **Unifies** references to “leadAdvisor” and adds logic to sync
 *    servicing/writing advisors from Redtail
 *  - **FIXED** to read `servicing_advisor_id` / `writing_advisor_id` from Families
 *    *and* from the **Contact** level, in case Redtail sets them there
 *  - **Ensures** `redtailId` on Client, `redtailFamilyId` on Household
 *  - **Enhancement**: If the contact-level advisor is set, we store it on the Client
 *    (e.g. `contactLevelServicingAdvisorId`), then when we create/upsert the Household in
 *    `upsertHouseholdFromRedtailFamily()`, we check each client’s stored contact-level IDs
 *    and apply them if the family-level didn’t provide an advisor.
 ************************************************/

const axios = require('axios');
const AWS = require('aws-sdk');
const Client = require('../models/Client');
const Household = require('../models/Household');
const Account = require('../models/Account');
const RedtailAdvisor = require('../models/RedtailAdvisor'); // Tracks unlinked/linked Redtail advisors
const Beneficiary = require('../models/Beneficiary');       // For beneficiaries
const { decryptString } = require('./encryption');          // For basic auth password

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
function getRedtailBaseUrl(environment) {
  return environment === 'production'
    ? 'https://crm.redtailtechnology.com/api/public/v1'
    : 'https://review.crm.redtailtechnology.com/api/public/v1';
}

function buildAuthHeader(apiKey, username, passwordPlain) {
  const raw = `${apiKey}:${username}:${passwordPlain}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

/**
 * Main sync function
 * @param {Object} company - The CompanyID doc
 * @param {String} currentUserId - Mongoose ObjectId of the user (owner) for new Households
 * @param {Object} io - Socket.io server instance
 * @param {String} userRoom - The user’s room (their _id)
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

  // 1) Decrypt password
  const passwordPlain = decryptString(encryptedPassword, encryptionIV, authTag);

  // 2) Build Redtail base URL & headers
  const baseUrl = getRedtailBaseUrl(environment);
  const authHeader = buildAuthHeader(apiKey, username, passwordPlain);

  // Emit ~10%
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', { percent: 10 });
  }

  // 3) Sync Contacts (including contact-level advisor IDs)
  await syncContacts(baseUrl, authHeader, userKey, lastSync);

  // Emit ~40%
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', { percent: 40 });
  }

  // 4) Sync Families => upsert Households (including family-level advisor IDs)
  await syncFamilies(baseUrl, authHeader, userKey, company, currentUserId);

  // Emit ~60%
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', { percent: 60 });
  }

  // 4a) Create "solo" Households for orphan clients
  await createSoloHouseholdsForOrphanClients(company, currentUserId);

  // Emit ~75%
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', { percent: 75 });
  }

  // 5) Sync Accounts (with an in-memory diff)
  await syncAccounts(baseUrl, authHeader, userKey);

  // Emit ~90%
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', { percent: 90 });
  }

  // 6) Update lastSync
  company.redtail.lastSync = new Date();
  await company.save();

  // ~100%
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', { percent: 100 });
  }
}

/* ─────────────────────────────────────────────────────────────────
   HELPER: fetchContactPhones & fetchContactEmails
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
   A) CONTACTS (including contact-level advisors)
   ───────────────────────────────────────────────────────────────── */
async function syncContacts(baseUrl, authHeader, userKey, lastSync) {
  const headers = { Authorization: authHeader, userkey: userKey };

  let page = 1;
  let totalPages = 1;
  const updatedSince = lastSync
    ? `&updated_since=${encodeURIComponent(lastSync.toISOString())}`
    : '';

  // Include phones, emails, addresses, family, accounts
  do {
    const url = `${baseUrl}/contacts?page=${page}&page_size=200&include=phones,emails,addresses,family,accounts${updatedSince}`;
    try {
      const resp = await axios.get(url, { headers });
      const contacts = resp.data.contacts || [];
      totalPages = resp.data.meta?.total_pages || 1;

      for (const contact of contacts) {
        await upsertClientFromRedtail(contact, baseUrl, headers);
      }
    } catch (err) {
      console.error(`Failed to fetch contacts on page ${page}`, err.response?.data || err);
    }

    page += 1;
  } while (page <= totalPages);
}

/**
 * Upsert a Client from contact data
 *   - Also reads contact.servicing_advisor_id / contact.writing_advisor_id
 *     and applies it to that client’s Household (if any).
 *   - Additionally: store these IDs in the client doc, so if the Household
 *     is assigned later, we can re-check and update the Household’s advisors.
 */
async function upsertClientFromRedtail(contact, baseUrl, headers) {
  const redtailId = contact.id;

  let firstName = contact.first_name || '';
  let middleName = contact.middle_name || '';
  let lastName = contact.last_name || '';

  // If it's a business
  if (contact.type === 'Business' && contact.company_name) {
    firstName = contact.company_name;
    lastName = 'Business';
  } else if (!firstName && !lastName) {
    firstName = 'Unknown';
    lastName = 'Client';
  }

  // Marital status
  let maritalStatus = '';
  if (contact.marital_status) {
    const ms = contact.marital_status.toLowerCase();
    if (ms.includes('married')) maritalStatus = 'Married';
    else if (ms.includes('widowed')) maritalStatus = 'Widowed';
    else if (ms.includes('divorced')) maritalStatus = 'Divorced';
    else maritalStatus = 'Single';
  }

  // DOB, SSN
  const dob = contact.dob ? new Date(contact.dob) : null;
  const ssn = contact.tax_id || '';

  // Partial Emails
  let primaryEmail = '';
  if (Array.isArray(contact.emails) && contact.emails.length) {
    const primary = contact.emails.find(e => e.is_primary);
    primaryEmail = primary ? primary.address : contact.emails[0].address;
  }

  // Partial Phones
  let mobileNumber = '';
  let homePhone = '';
  if (Array.isArray(contact.phones) && contact.phones.length) {
    const mobile = contact.phones.find(
      p => p.type === 'Mobile' || (p.phone_type_description || '').toLowerCase() === 'mobile'
    );
    if (mobile) mobileNumber = mobile.number;

    const home = contact.phones.find(
      p => p.type === 'Home' || (p.phone_type_description || '').toLowerCase() === 'home'
    );
    if (home) homePhone = home.number;
  }

  // Address
  let homeAddress = '';
  if (Array.isArray(contact.addresses) && contact.addresses.length) {
    const addr = contact.addresses[0];
    let parts = [];
    if (addr.line_1) parts.push(addr.line_1);
    if (addr.line_2) parts.push(addr.line_2);
    if (addr.city) parts.push(addr.city);
    if (addr.state) parts.push(addr.state);
    if (addr.postal_code) parts.push(addr.postal_code);
    homeAddress = parts.join(', ');
  }

  // Attempt upsert
  let updatedClient;
  try {
    updatedClient = await Client.findOneAndUpdate(
      { redtailId },
      {
        $set: {
          redtailId, // ensure we store the contact's Redtail ID
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
  } catch (err) {
    console.error(`Failed to upsert client (RedtailID=${redtailId}):`, err);
    return;
  }

  // More robust phone/email fetch
  try {
    const allPhones = await fetchContactPhones(baseUrl, headers, redtailId);
    const allEmails = await fetchContactEmails(baseUrl, headers, redtailId);

    const mobileCandidate = allPhones.find(
      p => p.phone_type === 3 || (p.phone_type_description || '').toLowerCase() === 'mobile'
    );
    if (mobileCandidate) {
      updatedClient.mobileNumber = mobileCandidate.number;
    }
    const homeCandidate = allPhones.find(
      p => p.phone_type === 1 || (p.phone_type_description || '').toLowerCase() === 'home'
    );
    if (homeCandidate) {
      updatedClient.homePhone = homeCandidate.number;
    }

    let primaryEmailObj = allEmails.find(e => e.is_primary);
    if (!primaryEmailObj && allEmails.length > 0) {
      primaryEmailObj = allEmails[0];
    }
    if (primaryEmailObj) {
      updatedClient.email = primaryEmailObj.address;
    }

    await updatedClient.save();
  } catch (err) {
    console.warn(`Error fetching phones/emails (RedtailID=${redtailId}):`, err.message);
  }

  // Photo
  try {
    const imageUrl = `${baseUrl}/contacts/${redtailId}/photo`;
    const photoResp = await axios.get(imageUrl, {
      headers,
      responseType: 'arraybuffer',
    });
    const contentType = photoResp.headers['content-type'] || 'image/jpeg';
    const buffer = Buffer.from(photoResp.data);

    const s3Url = await uploadBufferToS3(buffer, contentType, 'clientPhotos');
    updatedClient.profilePhoto = s3Url;
    await updatedClient.save();
  } catch (err) {
    if (err.response && err.response.status === 404) {
      console.log(`No photo for RedtailID=${redtailId}, skipping upload.`);
    } else {
      console.warn(`Error fetching contact photo (RedtailID=${redtailId}):`, err.message);
    }
  }

  // =========== If Redtail sets advisor at the CONTACT level =========== //
  const servicingAdvisorId = contact.servicing_advisor_id || null;
  const writingAdvisorId   = contact.writing_advisor_id   || null;
  console.log(`[DEBUG] Contact ${redtailId} => servicing_advisor_id=${servicingAdvisorId}, writing_advisor_id=${writingAdvisorId}`);

  // (A) Store them on the client doc so we can re-check when the Household is assigned:
  updatedClient.contactLevelServicingAdvisorId = servicingAdvisorId;
  updatedClient.contactLevelWritingAdvisorId = writingAdvisorId;
  await updatedClient.save();

  // (B) If the contact is already in a Household, apply these to that Household
  const householdId = updatedClient.household;
  if (householdId) {
    const household = await Household.findById(householdId);
    if (!household) {
      console.warn(`[DEBUG] Client ${updatedClient._id} references non-existent household ${householdId}.`);
      return;
    }

    if (servicingAdvisorId) {
      console.log(`[DEBUG] Contact ${redtailId} => applying servicingAdvisorId=${servicingAdvisorId} to household ${household._id}`);
      const servicingName = await fetchRedtailAdvisorName(baseUrl, headers, servicingAdvisorId, 'servicing');
      await handleRedtailAdvisorSync(household.firmId, servicingAdvisorId, servicingName, 'servicing');
      household.redtailServicingAdvisorId = servicingAdvisorId;

      const existingServ = await RedtailAdvisor.findOne({
        firmId: household.firmId,
        redtailAdvisorId: servicingAdvisorId,
      });
      if (existingServ && existingServ.linkedUser) {
        household.servicingLeadAdvisor = existingServ.linkedUser;
      }
    }

    if (writingAdvisorId) {
      console.log(`[DEBUG] Contact ${redtailId} => applying writingAdvisorId=${writingAdvisorId} to household ${household._id}`);
      const writingName = await fetchRedtailAdvisorName(baseUrl, headers, writingAdvisorId, 'writing');
      await handleRedtailAdvisorSync(household.firmId, writingAdvisorId, writingName, 'writing');
      household.redtailWritingAdvisorId = writingAdvisorId;

      const existingWrit = await RedtailAdvisor.findOne({
        firmId: household.firmId,
        redtailAdvisorId: writingAdvisorId,
      });
      if (existingWrit && existingWrit.linkedUser) {
        household.writingLeadAdvisor = existingWrit.linkedUser;
      }
    }
    await household.save();
  } else {
    if (servicingAdvisorId || writingAdvisorId) {
      console.log(`[DEBUG] Contact ${redtailId} => found contact-level advisors but no household is assigned.`);
    }
  }
}

/* ─────────────────────────────────────────────────────────────────
   B) FAMILIES => HOUSEHOLDS (with Family-level advisors)
   ───────────────────────────────────────────────────────────────── */
async function syncFamilies(baseUrl, authHeader, userKey, company, currentUserId) {
  const headers = { Authorization: authHeader, userkey: userKey };
  const url = `${baseUrl}/families?family_members=true`;

  try {
    const resp = await axios.get(url, { headers });
    const families = resp.data.families || [];

    console.log(`[DEBUG] Fetched families from Redtail => count: ${families.length}`);
    for (const family of families) {
      console.log(`[DEBUG] Family ID=${family.id}, name="${family.name}", servicing_advisor_id=${family.servicing_advisor_id}, writing_advisor_id=${family.writing_advisor_id}, membersCount=${(family.members || []).length}`);
      await upsertHouseholdFromRedtailFamily(family, company, currentUserId, baseUrl, headers);
    }
  } catch (err) {
    console.error('Failed to fetch families:', err.response?.data || err);
  }
}

/**
 * upsertHouseholdFromRedtailFamily
 *   1) We no longer skip if 0 accounts; always create/upsert
 *   2) Read "servicing_advisor_id"/"writing_advisor_id" from the family
 *   3) Attempt to store as unlinked RedtailAdvisor if not found
 *   4) For each family member, if they have contact-level advisors, apply them
 *      to the Household if the Household’s not already set.
 */
async function upsertHouseholdFromRedtailFamily(
  family,
  company,
  currentUserId,
  baseUrl,
  headers
) {
  const redtailFamilyId = family.id;
  const name = family.name || 'Unnamed Family';
  const members = family.members || [];

  const servicingAdvisorId = family.servicing_advisor_id || null;
  const writingAdvisorId = family.writing_advisor_id || null;

  // If no members, skip
  if (members.length === 0) {
    console.log(`Family ${redtailFamilyId} => 0 members => skipping household creation.`);
    return;
  }

  // Gather local Clients
  const contactIds = members.map(m => m.contact_id).filter(Boolean);
  const localClients = await Client.find({ redtailId: { $in: contactIds } });
  if (localClients.length === 0) {
    console.log(`Family ${redtailFamilyId} => no matching local Clients => skipping.`);
    return;
  }

  // Upsert Household
  let household;
  try {
    household = await Household.findOneAndUpdate(
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
  } catch (err) {
    console.error(`Failed to upsert household for FamilyID=${redtailFamilyId}`, err);
    return;
  }

  // Link each local client
  for (const member of members) {
    const contactId = member.contact_id;
    if (!contactId) continue;

    const client = await Client.findOne({ redtailId: contactId });
    if (!client) {
      console.log(
        `Family ${redtailFamilyId} => no local client found for redtailId=${contactId}, skipping link.`
      );
      continue;
    }

    client.household = household._id;
    if (member.hoh) {
      household.headOfHousehold = client._id;
    }
    await client.save();
  }

  // Family-level Servicing
  if (servicingAdvisorId) {
    console.log(`[DEBUG] Family ${redtailFamilyId} => servicingAdvisorId=${servicingAdvisorId}`);
    const servicingName = await fetchRedtailAdvisorName(baseUrl, headers, servicingAdvisorId, 'servicing');
    await handleRedtailAdvisorSync(company._id, servicingAdvisorId, servicingName, 'servicing');
    household.redtailServicingAdvisorId = servicingAdvisorId;

    const existingServ = await RedtailAdvisor.findOne({
      firmId: company._id,
      redtailAdvisorId: servicingAdvisorId,
    });
    if (existingServ && existingServ.linkedUser) {
      household.servicingLeadAdvisor = existingServ.linkedUser;
    }
  } else {
    console.log(`[DEBUG] Family ${redtailFamilyId} => no servicingAdvisorId found`);
  }

  // Family-level Writing
  if (writingAdvisorId) {
    console.log(`[DEBUG] Family ${redtailFamilyId} => writingAdvisorId=${writingAdvisorId}`);
    const writingName = await fetchRedtailAdvisorName(baseUrl, headers, writingAdvisorId, 'writing');
    await handleRedtailAdvisorSync(company._id, writingAdvisorId, writingName, 'writing');
    household.redtailWritingAdvisorId = writingAdvisorId;

    const existingWrit = await RedtailAdvisor.findOne({
      firmId: company._id,
      redtailAdvisorId: writingAdvisorId,
    });
    if (existingWrit && existingWrit.linkedUser) {
      household.writingLeadAdvisor = existingWrit.linkedUser;
    }
  } else {
    console.log(`[DEBUG] Family ${redtailFamilyId} => no writingAdvisorId found`);
  }

  // NEW: Also check each client’s stored contact-level advisors
  // in case the Family-level didn't have them but the contact did.
  for (const client of localClients) {
    // Reload client so we have the latest
    const freshClient = await Client.findById(client._id).lean();
    if (!freshClient) continue;

    const cServ = freshClient.contactLevelServicingAdvisorId;
    const cWrit = freshClient.contactLevelWritingAdvisorId;

    // If there's no family-level servicing but the client has one
    if (cServ && !household.redtailServicingAdvisorId) {
      console.log(`[DEBUG] Applying contact-level servicing advisor (ID=${cServ}) from client ${freshClient._id} to household ${household._id}`);
      const contactServName = await fetchRedtailAdvisorName(baseUrl, headers, cServ, 'servicing');
      await handleRedtailAdvisorSync(household.firmId, cServ, contactServName, 'servicing');
      household.redtailServicingAdvisorId = cServ;

      const servAdvisor = await RedtailAdvisor.findOne({
        firmId: household.firmId,
        redtailAdvisorId: cServ,
      });
      if (servAdvisor && servAdvisor.linkedUser) {
        household.servicingLeadAdvisor = servAdvisor.linkedUser;
      }
    }

    // If there's no family-level writing but the client has one
    if (cWrit && !household.redtailWritingAdvisorId) {
      console.log(`[DEBUG] Applying contact-level writing advisor (ID=${cWrit}) from client ${freshClient._id} to household ${household._id}`);
      const contactWritName = await fetchRedtailAdvisorName(baseUrl, headers, cWrit, 'writing');
      await handleRedtailAdvisorSync(household.firmId, cWrit, contactWritName, 'writing');
      household.redtailWritingAdvisorId = cWrit;

      const writAdvisor = await RedtailAdvisor.findOne({
        firmId: household.firmId,
        redtailAdvisorId: cWrit,
      });
      if (writAdvisor && writAdvisor.linkedUser) {
        household.writingLeadAdvisor = writAdvisor.linkedUser;
      }
    }
  }

  await household.save();
}

/**
 * If a client was never put into a Family => orphan => create a solo household
 */
async function createSoloHouseholdsForOrphanClients(company, currentUserId) {
  const orphans = await Client.find({
    $or: [{ household: { $exists: false } }, { household: null }],
  });

  for (const orphan of orphans) {
    const hhName = `Solo: ${orphan.firstName} ${orphan.lastName}`.trim();
    try {
      const newHousehold = await Household.create({
        name: hhName,
        firmId: company._id,
        owner: currentUserId,
        redtailFamilyId: null,
      });
      orphan.household = newHousehold._id;
      await orphan.save();
    } catch (err) {
      console.error(`Failed creating solo household for orphan client ${orphan._id}`, err);
      continue;
    }
  }
}

/* ─────────────────────────────────────────────────────────────────
   HELPER: fetchRedtailAdvisorName
   ───────────────────────────────────────────────────────────────── */
async function fetchRedtailAdvisorName(baseUrl, headers, advisorId, type) {
  let endpoint;
  if (type === 'servicing') {
    endpoint = `${baseUrl}/lists/servicing_advisors`;
  } else {
    endpoint = `${baseUrl}/lists/writing_advisors`;
  }

  try {
    const resp = await axios.get(endpoint, { headers });
    const list = resp.data[type + '_advisors'] || [];
    const match = list.find(a => a.id === advisorId);
    if (match && match.name) {
      console.log(`[DEBUG] Found name for ${type} advisor ID=${advisorId}: "${match.name}"`);
      return match.name;
    } else {
      console.log(`[DEBUG] Could not find matching ${type} advisor ID=${advisorId} in that list`);
      return `Unknown Advisor #${advisorId}`;
    }
  } catch (err) {
    console.warn(`Could not fetch ${type} advisors list for ID=${advisorId}`, err.message);
    return `Unknown Advisor #${advisorId}`;
  }
}

/**
 * handleRedtailAdvisorSync
 *   - Upserts a RedtailAdvisor doc
 *   - If it’s not already there, create it with the given advisorName
 *   - If it is, update the name/type if needed
 */
async function handleRedtailAdvisorSync(firmId, advisorId, advisorName, type) {
  console.log(`[DEBUG] handleRedtailAdvisorSync => firmId=${firmId}, advisorId=${advisorId}, name="${advisorName}", type="${type}"`);

  let existing = await RedtailAdvisor.findOne({
    firmId,
    redtailAdvisorId: advisorId,
  });

  if (!existing) {
    console.log(`[DEBUG] Creating new RedtailAdvisor doc for ID=${advisorId} (type=${type})`);
    existing = await RedtailAdvisor.create({
      firmId,
      redtailAdvisorId: advisorId,
      advisorName: advisorName || '',
      type,
    });
  } else {
    console.log(`[DEBUG] Found existing RedtailAdvisor doc => ID=${existing._id}, currentType=${existing.type}, updating if needed...`);
    existing.advisorName = advisorName || existing.advisorName;
    existing.type = mergeAdvisorType(existing.type, type);
    await existing.save();
  }
}

function mergeAdvisorType(existingType, newType) {
  if (!existingType || existingType === 'unknown') return newType;
  if (existingType !== newType && existingType !== 'both') {
    return 'both';
  }
  return existingType;
}

/* ─────────────────────────────────────────────────────────────────
   D) BENEFICIARIES HELPER
   ───────────────────────────────────────────────────────────────── */
async function fetchAccountBeneficiaries(baseUrl, headers, accountId) {
  console.log(`[DEBUG] Attempting to fetch beneficiaries for accountId=${accountId}`);
  const url = `${baseUrl}/accounts/${accountId}/beneficiaries`;
  try {
    const resp = await axios.get(url, { headers });
    const data = resp.data || {};
    console.log(`[DEBUG] Successful fetch. Data from Redtail for accountId=${accountId}:`, data);
    return data.account_beneficiaries || [];
  } catch (err) {
    console.warn(`Failed to fetch beneficiaries for accountId=${accountId}`, err.message);
    return [];
  }
}

/* ─────────────────────────────────────────────────────────────────
   C) ACCOUNTS
   ───────────────────────────────────────────────────────────────── */
async function syncAccounts(baseUrl, authHeader, userKey) {
  const headers = { Authorization: authHeader, userkey: userKey };

  // We'll do a per-contact approach
  const allClients = await Client.find(
    { redtailId: { $exists: true, $ne: null } },
    '_id redtailId household firstName lastName'
  );

  // We'll collect every Redtail account ID + balance in memory
  const redtailAccountMap = {};

  for (const client of allClients) {
    const contactId = client.redtailId;
    const url = `${baseUrl}/contacts/${contactId}/accounts`;

    try {
      const resp = await axios.get(url, { headers });
      const accounts = resp.data.accounts || [];

      for (const acc of accounts) {
        redtailAccountMap[acc.id] = {
          balance: acc.balance || 0,
          ownerContactId: contactId,
        };
        await upsertAccountFromRedtail(baseUrl, headers, acc, client);
      }
    } catch (err) {
      console.error(`Failed to fetch accounts for Contact ${contactId}`, err.response?.data || err);
    }
  }

  // After finishing, generate an in-memory diff
  await generateAccountsDiff(redtailAccountMap);
}

async function generateAccountsDiff(redtailAccountMap) {
  // 1) Build a Set of Redtail IDs
  const redtailIds = new Set(Object.keys(redtailAccountMap).map(id => parseInt(id, 10)));

  // 2) Find all local accounts w/ redtailAccountId
  const localAccounts = await Account.find({ redtailAccountId: { $exists: true } }).lean();
  const localIds = new Set(localAccounts.map(a => a.redtailAccountId));

  // 3) Missing in local
  const missingLocal = [];
  for (const rtId of redtailIds) {
    if (!localIds.has(rtId)) {
      missingLocal.push(rtId);
    }
  }
  if (missingLocal.length > 0) {
    console.log('--- MISSING ACCOUNTS IN LOCAL: ---');
    let missingTotalValue = 0;
    for (const rtId of missingLocal) {
      const { balance } = redtailAccountMap[rtId];
      console.log(`Missing redtailAccountId=${rtId} (Balance=${balance || 0})`);
      missingTotalValue += balance || 0;
    }
    console.log(`TOTAL MISSING VALUE => $${missingTotalValue.toFixed(2)}`);
  } else {
    console.log('No missing local accounts.');
  }

  // 4) Extra in local
  const extraLocal = [];
  for (const acc of localAccounts) {
    const rtId = acc.redtailAccountId;
    if (rtId && !redtailIds.has(rtId)) {
      extraLocal.push(rtId);
    }
  }
  if (extraLocal.length > 0) {
    console.log('--- EXTRA ACCOUNTS IN LOCAL: ---');
    for (const rtId of extraLocal) {
      console.log(`Local DB has redtailAccountId=${rtId}, not found in Redtail data.`);
    }
  } else {
    console.log('No extra local accounts.');
  }
}

/**
 * upsertAccountFromRedtail tries to get `number` + `balance` from the account
 * If missing, does a 2nd fetch /accounts/:id
 * Then attempts to fetch beneficiary info
 */
async function upsertAccountFromRedtail(baseUrl, headers, accountData, client) {
  const redtailAccountId = accountData.id;

  let rawNumber = accountData.number;
  let rawBalance = accountData.balance;
  let rawType = accountData.account_type;
  let rawCustodian = accountData.company;
  let rawSystematicWithdrawAmount;
  let rawSystematicWithdrawFrequency;
  let rawFederalWithholding;
  let rawStateWithholding;

  // If missing number/balance, do a 2nd fetch
  if (!rawNumber || typeof rawBalance === 'undefined') {
    try {
      const fullResp = await axios.get(`${baseUrl}/accounts/${redtailAccountId}`, { headers });
      const detail = fullResp.data.account || {};

      rawNumber = detail.number || rawNumber;
      rawBalance = typeof detail.balance !== 'undefined' ? detail.balance : rawBalance;
      rawType = detail.account_type || rawType;
      rawCustodian = detail.company || rawCustodian;
      rawSystematicWithdrawAmount = detail.systematic_withdraw_amount;
      rawSystematicWithdrawFrequency = detail.systematic_withdraw_frequency;
      rawFederalWithholding = detail.federal_tax_withholding;
      rawStateWithholding = detail.state_tax_withholding;
    } catch (err) {
      console.warn(
        `Could not fetch full account details for redtailAccountId=${redtailAccountId}`,
        err.response?.data || err
      );
      rawNumber = rawNumber || 'Unknown Number';
      rawBalance = rawBalance || 0;
    }
  }

  const accountNumber = rawNumber || 'Unknown Number';
  const accountValue = parseFloat(rawBalance) || 0;

  // Map type or default
  const validAccountTypes = [
    'Individual','TOD','Joint','Joint Tenants','Tenants in Common','IRA','Roth IRA','Inherited IRA',
    'SEP IRA','Simple IRA','401(k)','403(b)','529 Plan','UTMA','Trust','Custodial','Annuity',
    'Variable Annuity','Fixed Annuity','Deferred Annuity','Immediate Annuity','Other'
  ];
  let accountType = rawType || 'Other';
  let accountTypeRaw = rawType || '';
  if (!validAccountTypes.includes(accountType)) {
    console.warn(
      `Account type "${accountType}" not in enum for redtailAccountId=${redtailAccountId}, defaulting to "Other".`
    );
    accountType = 'Other';
  }

  let custodian = rawCustodian || 'UnknownCustodian';
  let custodianRaw = rawCustodian || '';

  // Default taxStatus
  const taxStatus = accountData.tax_status || 'Taxable';

  // Ensure Household
  let householdId = client.household;
  if (!householdId) {
    console.warn(
      `Client ${client._id} had no household, creating fallback for redtailAccountId=${redtailAccountId}...`
    );
    const fallback = await Household.create({
      name: `Solo: ${client.firstName} ${client.lastName}`,
      firmId: null,
      owner: null,
    });
    householdId = fallback._id;
    client.household = fallback._id;
    await client.save();
  }

  // Upsert account
  let localAccount = await Account.findOne({ redtailAccountId });
  if (!localAccount) {
    localAccount = new Account({
      redtailAccountId,
      accountNumber,
      accountValue,
      accountType,
      accountTypeRaw,
      custodian,
      custodianRaw,
      taxStatus,
      accountOwner: [client._id],
      household: householdId,
    });
  } else {
    localAccount.accountNumber = accountNumber;
    localAccount.accountValue = accountValue;
    localAccount.accountType = accountType;
    localAccount.accountTypeRaw = accountTypeRaw;
    localAccount.custodian = custodian;
    localAccount.custodianRaw = custodianRaw;
    localAccount.taxStatus = taxStatus;
    localAccount.household = householdId;

    if (!localAccount.accountOwner.includes(client._id)) {
      localAccount.accountOwner.push(client._id);
    }
  }

  // Systematic WD fields
  if (typeof rawSystematicWithdrawAmount !== 'undefined') {
    localAccount.systematicWithdrawAmount = rawSystematicWithdrawAmount;
  }
  if (typeof rawSystematicWithdrawFrequency !== 'undefined') {
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

    // Link account to household if not already
    await Household.findByIdAndUpdate(householdId, {
      $addToSet: { accounts: saved._id },
    });

    // Fetch & store beneficiaries
    try {
      const redtailBenefs = await fetchAccountBeneficiaries(baseUrl, headers, redtailAccountId);
      console.log(`[DEBUG] Retrieved ${redtailBenefs.length} beneficiaries from Redtail for redtailAccountId=${redtailAccountId}`);

      const primaryBenefs = [];
      const contingentBenefs = [];

      for (const b of redtailBenefs) {
        console.log('[DEBUG] Beneficiary data:', b);
        const desc = (b.beneficiary_type_description || '').toLowerCase();
        const shareValue = parseFloat(b.percentage) || 0;
        const fullName = b.name?.trim() || 'Unnamed Beneficiary';

        const nameParts = fullName.split(/\s+/);
        const first = nameParts.shift() || 'Beneficiary';
        const last = nameParts.join(' ') || ' ';

        const beneDoc = await Beneficiary.findOneAndUpdate(
          { firstName: first, lastName: last },
          { $set: {} },
          { upsert: true, new: true }
        );

        if (desc === 'primary') {
          primaryBenefs.push({
            beneficiary: beneDoc._id,
            percentageAllocation: shareValue,
          });
        } else {
          contingentBenefs.push({
            beneficiary: beneDoc._id,
            percentageAllocation: shareValue,
          });
        }
      }

      localAccount.beneficiaries = {
        primary: primaryBenefs,
        contingent: contingentBenefs,
      };
      await localAccount.save();
      console.log(`[DEBUG] Beneficiaries stored on localAccount ${localAccount._id}`);
    } catch (bErr) {
      console.warn(
        `Failed to fetch or save beneficiaries for redtailAccountId=${redtailAccountId}:`,
        bErr.message
      );
    }
  } catch (err) {
    console.error(`Error saving account (redtailAccountId=${redtailAccountId}):`, err);
    throw err;
  }
}

/************************************************
 * EXPORT
 ************************************************/
module.exports = {
  syncAll,
};
