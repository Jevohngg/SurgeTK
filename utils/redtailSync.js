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
 *  - **NEW**: Even if a client has no Household at the time we see their advisor info,
 *    we still create/update the `RedtailAdvisor` doc so it appears in your “unlinked” list.
 *  - **NEW**: After creating an orphan's solo Household, we re-check that client's
 *    contact-level advisor IDs and assign them to that newly created Household.
 *  - **NEW**: If a client’s `household` references a non-existent doc, we set it to null
 *    so they become a true orphan and get a solo Household.
 *  - **SECURE**: Now ensures data is scoped by `firmId` so no cross-tenant collisions occur.
 *
 *  - **ADDED**: Persistent advisor mapping:
 *      * Whenever we detect a Redtail advisor that is already "linkedUser" =>
 *        automatically assign that user as the leadAdvisor on the client + household.
 *      * Ensures new contacts get correct leadAdvisor if they share the same Redtail advisor.
 *  - **FIXED**: Convert advisor IDs to numbers, add debug logs to confirm matching.
 *  - **UPDATED**: Set `household.redtailCreated = true` for all new or upserted Households
 *    to unify “familied” vs. “unfamilied” Redtail contacts.
 *  - **IMPROVED**: Orphan contacts get a placeholder `redtailFamilyId` like "SOLO-<contactId>"
 *    so the Redtail badge can be displayed, and we remove the old solo household if a contact
 *    later joins a real Redtail family.
 *  - **IMPROVED**: When a servicing or writing advisor is linked, we also add that user
 *    to the household’s `leadAdvisors` array to ensure immediate reflection in your UI.
 *
 *  - **NOW**: Uses a double-pass approach for counting items, plus phase-based
 *    Socket.io events ("preparing", then "syncing") for a smoother UI experience.
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
 * DOUBLE-PASS COUNTING HELPERS
 *  1) Count total Contacts, Families, and Accounts
 *  2) Then do the actual sync in a second pass
 ************************************************/
async function countAllContacts(baseUrl, authHeader, userKey, lastSync) {
  let total = 0;
  let page = 1;
  let totalPages = 1;

  const updatedSince = lastSync
    ? `&updated_since=${encodeURIComponent(lastSync.toISOString())}`
    : '';

  do {
    const url = `${baseUrl}/contacts?page=${page}&page_size=200${updatedSince}`;
    const resp = await axios.get(url, {
      headers: { Authorization: authHeader, userkey: userKey },
    });
    const contacts = resp.data.contacts || [];
    total += contacts.length;

    const meta = resp.data.meta || {};
    if (page === 1) {
      totalPages = meta.total_pages || 1;
    }

    page++;
  } while (page <= totalPages);

  return total;
}

async function countAllFamilies(baseUrl, authHeader, userKey) {
  let total = 0;
  let page = 1;
  let totalPages = 1;

  do {
    const url = `${baseUrl}/families?page=${page}&page_size=200&family_members=true`;
    const resp = await axios.get(url, {
      headers: { Authorization: authHeader, userkey: userKey },
    });
    const families = resp.data.families || [];
    total += families.length;

    const meta = resp.data.meta || {};
    if (page === 1) {
      totalPages = meta.total_pages || 1;
    }

    page++;
  } while (page <= totalPages);

  return total;
}

async function countAllAccounts(baseUrl, authHeader, userKey, lastSync) {
  // Since there's no global "accounts" endpoint, we do:
  // 1) fetch all contacts
  // 2) sum the total # of accounts from each contact
  let total = 0;
  let page = 1;
  let totalPages = 1;

  const updatedSince = lastSync
    ? `&updated_since=${encodeURIComponent(lastSync.toISOString())}`
    : '';

  const contactIds = [];

  do {
    const url = `${baseUrl}/contacts?page=${page}&page_size=200${updatedSince}`;
    const resp = await axios.get(url, {
      headers: { Authorization: authHeader, userkey: userKey },
    });
    const contacts = resp.data.contacts || [];
    for (const c of contacts) {
      if (c.id) contactIds.push(c.id);
    }

    const meta = resp.data.meta || {};
    if (page === 1) {
      totalPages = meta.total_pages || 1;
    }

    page++;
  } while (page <= totalPages);

  // Now fetch /contacts/:id/accounts just to count them
  for (const cId of contactIds) {
    const url = `${baseUrl}/contacts/${cId}/accounts`;
    try {
      const resp = await axios.get(url, {
        headers: { Authorization: authHeader, userkey: userKey },
      });
      const accounts = resp.data.accounts || [];
      total += accounts.length;
    } catch (err) {
      console.warn(`Error counting accounts for contact ${cId}:`, err.message);
    }
  }

  return total;
}

/************************************************
 * PROGRESS CALCULATION
 ************************************************/
function calculateProgress(context) {
  const {
    totalContacts,
    totalFamilies,
    totalAccounts,
    processedContacts,
    processedFamilies,
    processedAccounts,
  } = context;

  // Weighted approach: 40% => Contacts, 30% => Families, 30% => Accounts
  let fraction = 0;

  if (totalContacts > 0) {
    fraction += (processedContacts / totalContacts) * 40;
  }
  if (totalFamilies > 0) {
    fraction += (processedFamilies / totalFamilies) * 30;
  }
  if (totalAccounts > 0) {
    fraction += (processedAccounts / totalAccounts) * 30;
  }

  if (fraction > 100) fraction = 100;
  if (fraction < 0) fraction = 0;
  return fraction;
}

/**
 * Emits Socket.io events with a `phase` and `percent`.
 * By default, we consider everything in the "syncing" phase,
 * except if you want to emit "preparing" explicitly.
 */
function emitProgress(context, phase = 'syncing') {
  if (!context.io || !context.userRoom) return;
  const percent = Math.round(calculateProgress(context));
  context.io.to(context.userRoom).emit('redtailSyncProgress', {
    phase,
    percent,
  });
}

/************************************************
 * AWS / S3
 ************************************************/
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

/************************************************
 * getRedtailBaseUrl, buildAuthHeader
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

/************************************************
 * MAIN syncAll
 * 1) PHASE "preparing" => double-pass counting
 * 2) PHASE "syncing"   => actual sync
 ************************************************/
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

  // 1) Decrypt
  const passwordPlain = decryptString(encryptedPassword, encryptionIV, authTag);
  const baseUrl = getRedtailBaseUrl(environment);
  const authHeader = buildAuthHeader(apiKey, username, passwordPlain);

  // ---- PHASE: PREPARING (counting pass) ----
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', {
      phase: 'preparing',
      percent: 0,
    });
  }

  let totalContacts = 0;
  let totalFamilies = 0;
  let totalAccounts = 0;

  try {
    totalContacts = await countAllContacts(baseUrl, authHeader, userKey, lastSync);
    totalFamilies = await countAllFamilies(baseUrl, authHeader, userKey);
    totalAccounts = await countAllAccounts(baseUrl, authHeader, userKey, lastSync);
    console.log('Double-pass counts =>', {
      totalContacts,
      totalFamilies,
      totalAccounts,
    });
  } catch (err) {
    console.error('Error in double-pass counting:', err.message);
    // If counting fails, fallback to 0 => user sees quick jump, but we'll proceed
  }

  // Build sync context
  const syncContext = {
    totalContacts,
    totalFamilies,
    totalAccounts,
    processedContacts: 0,
    processedFamilies: 0,
    processedAccounts: 0,
    io,
    userRoom,
  };

  // ---- PHASE: SYNCING (actual pass) ----
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', {
      phase: 'syncing',
      percent: 0,
    });
  }

  // Contacts
  await syncContacts(baseUrl, authHeader, userKey, lastSync, company._id, syncContext);

  // Families => Households, plus fix invalid refs, orphans
  await syncFamilies(baseUrl, authHeader, userKey, company, currentUserId, syncContext);
  await fixInvalidHouseholdRefs(company._id);
  await createSoloHouseholdsForOrphanClients(company, currentUserId, baseUrl, authHeader);

  // Accounts
  await syncAccounts(baseUrl, authHeader, userKey, company._id, currentUserId, syncContext);

  // Force 100%
  syncContext.processedContacts = totalContacts;
  syncContext.processedFamilies = totalFamilies;
  syncContext.processedAccounts = totalAccounts;
  emitProgress(syncContext, 'syncing');

  // Update lastSync
  company.redtail.lastSync = new Date();
  await company.save();
}

/************************************************
 * fixInvalidHouseholdRefs
 ************************************************/
async function fixInvalidHouseholdRefs(firmId) {
  const withRefs = await Client.find({
    firmId,
    household: { $exists: true, $ne: null }
  }, '_id household');

  if (!withRefs.length) return;

  for (const client of withRefs) {
    const hhExists = await Household.exists({ _id: client.household, firmId });
    if (!hhExists) {
      await Client.updateOne(
        { _id: client._id },
        { $set: { household: null } }
      );
      console.log(`[DEBUG] fixInvalidHouseholdRefs => Client ${client._id} had invalid household ref, resetting to null.`);
    }
  }
}

/************************************************
 * fetchContactPhones, fetchContactEmails
 ************************************************/
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

/************************************************
 * syncContacts (SECOND PASS)
 ************************************************/
async function syncContacts(baseUrl, authHeader, userKey, lastSync, firmId, syncContext) {
  const headers = { Authorization: authHeader, userkey: userKey };

  let page = 1;
  let totalPages = 1;
  const updatedSince = lastSync
    ? `&updated_since=${encodeURIComponent(lastSync.toISOString())}`
    : '';

  do {
    const url = `${baseUrl}/contacts?page=${page}&page_size=200&include=phones,emails,addresses,family,accounts${updatedSince}`;
    try {
      const resp = await axios.get(url, { headers });
      const contacts = resp.data.contacts || [];
      totalPages = resp.data.meta?.total_pages || 1;

      for (const contact of contacts) {
        await upsertClientFromRedtail(contact, baseUrl, headers, firmId);

        // After each contact
        syncContext.processedContacts++;
        emitProgress(syncContext, 'syncing');
      }
    } catch (err) {
      console.error(`Failed to fetch contacts on page ${page}`, err.response?.data || err);
    }

    page++;
  } while (page <= totalPages);
}

/************************************************
 * upsertClientFromRedtail
 ************************************************/
async function upsertClientFromRedtail(contact, baseUrl, headers, firmId) {
  const redtailId = contact.id;

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

  let maritalStatus = '';
  if (contact.marital_status) {
    const ms = contact.marital_status.toLowerCase();
    if (ms.includes('married')) maritalStatus = 'Married';
    else if (ms.includes('widowed')) maritalStatus = 'Widowed';
    else if (ms.includes('divorced')) maritalStatus = 'Divorced';
    else maritalStatus = 'Single';
  }

  const dob = contact.dob ? new Date(contact.dob) : null;
  // const ssn = contact.tax_id || '';

  let primaryEmail = '';
  if (Array.isArray(contact.emails) && contact.emails.length) {
    const primary = contact.emails.find(e => e.is_primary);
    primaryEmail = primary ? primary.address : contact.emails[0].address;
  }

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

  let updatedClient;
  try {
    updatedClient = await Client.findOneAndUpdate(
      { firmId, redtailId },
      {
        $set: {
          firmId,
          redtailId,
          firstName,
          middleName,
          lastName,
          dob,

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

  // fetch additional phones/emails
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
  // try {
  //   const imageUrl = `${baseUrl}/contacts/${redtailId}/photo`;
  //   const photoResp = await axios.get(imageUrl, {
  //     headers,
  //     responseType: 'arraybuffer',
  //   });
  //   const contentType = photoResp.headers['content-type'] || 'image/jpeg';
  //   const buffer = Buffer.from(photoResp.data);

  //   const s3Url = await uploadBufferToS3(buffer, contentType, 'clientPhotos');
  //   updatedClient.profilePhoto = s3Url;
  //   await updatedClient.save();
  // } catch (err) {
  //   if (err.response && err.response.status === 404) {

  //   } else {
  //     console.warn(`Error fetching contact photo (RedtailID=${redtailId}):`, err.message);
  //   }
  // }

  const rawServ = contact.servicing_advisor_id || null;
  const rawWrit = contact.writing_advisor_id || null;
  const servicingAdvisorId = rawServ ? parseInt(rawServ, 10) : null;
  const writingAdvisorId   = rawWrit ? parseInt(rawWrit, 10) : null;



  updatedClient.contactLevelServicingAdvisorId = servicingAdvisorId;
  updatedClient.contactLevelWritingAdvisorId   = writingAdvisorId;
  await updatedClient.save();

  // Create/Update RedtailAdvisor doc
  if (servicingAdvisorId) {
    const servicingName = await fetchRedtailAdvisorName(baseUrl, headers, servicingAdvisorId, 'servicing');
    await handleRedtailAdvisorSync(firmId, servicingAdvisorId, servicingName, 'servicing');
    const existingServ = await RedtailAdvisor.findOne({ firmId, redtailAdvisorId: servicingAdvisorId });
    if (existingServ && existingServ.linkedUser) {
      updatedClient.leadAdvisor = existingServ.linkedUser;
      await updatedClient.save();
    }
  }
  if (writingAdvisorId) {
    const writingName = await fetchRedtailAdvisorName(baseUrl, headers, writingAdvisorId, 'writing');
    await handleRedtailAdvisorSync(firmId, writingAdvisorId, writingName, 'writing');
    const existingWrit = await RedtailAdvisor.findOne({ firmId, redtailAdvisorId: writingAdvisorId });
    if (existingWrit && existingWrit.linkedUser) {
      updatedClient.leadAdvisor = existingWrit.linkedUser;
      await updatedClient.save();
    }
  }

  // If client has a household, update it
  const householdId = updatedClient.household;
  if (householdId) {
    const household = await Household.findOne({ _id: householdId, firmId });
    if (!household) {
      console.warn(`[DEBUG] Client ${updatedClient._id} references non-existent household ${householdId}.`);
      return;
    }

    if (servicingAdvisorId) {
      household.redtailServicingAdvisorId = servicingAdvisorId;
      const existServ = await RedtailAdvisor.findOne({ firmId, redtailAdvisorId: servicingAdvisorId });
      if (existServ && existServ.linkedUser) {
        household.servicingLeadAdvisor = existServ.linkedUser;
        household.leadAdvisors.addToSet(existServ.linkedUser);
      }
    }
    if (writingAdvisorId) {
      household.redtailWritingAdvisorId = writingAdvisorId;
      const existWrit = await RedtailAdvisor.findOne({ firmId, redtailAdvisorId: writingAdvisorId });
      if (existWrit && existWrit.linkedUser) {
        household.writingLeadAdvisor = existWrit.linkedUser;
        household.leadAdvisors.addToSet(existWrit.linkedUser);
      }
    }
    household.redtailCreated = true;
    await household.save();
  } else {
    if (servicingAdvisorId || writingAdvisorId) {
    
    }
  }
}

/************************************************
 * syncFamilies (SECOND PASS)
 ************************************************/
async function syncFamilies(baseUrl, authHeader, userKey, company, currentUserId, syncContext) {
  const headers = { Authorization: authHeader, userkey: userKey };
  const url = `${baseUrl}/families?family_members=true`;

  try {
    const resp = await axios.get(url, { headers });
    const families = resp.data.families || [];
  

    for (const family of families) {
      await upsertHouseholdFromRedtailFamily(family, company, currentUserId, baseUrl, headers);

      // After each family
      syncContext.processedFamilies++;
      emitProgress(syncContext, 'syncing');
    }
  } catch (err) {
    console.error('Failed to fetch families:', err.response?.data || err);
  }
}

/************************************************
 * upsertHouseholdFromRedtailFamily
 ************************************************/
async function upsertHouseholdFromRedtailFamily(
  family,
  company,
  currentUserId,
  baseUrl,
  headers
) {
  const firmId = company._id;
  const redtailFamilyId = family.id;
  const name = family.name || 'Unnamed Family';
  const members = family.members || [];

  const servicingAdvisorId = family.servicing_advisor_id || null;
  const writingAdvisorId   = family.writing_advisor_id   || null;

  if (members.length === 0) {
  
    return;
  }

  const contactIds = members.map(m => m.contact_id).filter(Boolean);
  const localClients = await Client.find({ firmId, redtailId: { $in: contactIds } });
  if (localClients.length === 0) {

    return;
  }

  let household;
  try {
    household = await Household.findOneAndUpdate(
      { firmId, redtailFamilyId },
      {
        $set: {
          firmId,
          name,
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

  household.redtailCreated = true;

  for (const member of members) {
    const contactId = member.contact_id;
    if (!contactId) continue;

    const client = await Client.findOne({ firmId, redtailId: contactId });
    if (!client) continue;

    const oldHouseholdId = client.household;
    client.household = household._id;
    if (member.hoh) {
      household.headOfHousehold = client._id;
    }
    await client.save();

    // remove old solo household if empty
    if (oldHouseholdId && !oldHouseholdId.equals(household._id)) {
      const oldHH = await Household.findOne({ _id: oldHouseholdId });
      if (oldHH) {
        const countMembers = await Client.countDocuments({ household: oldHouseholdId });
        if (countMembers === 0) {
       
          await Household.deleteOne({ _id: oldHouseholdId });
        }
      }
    }
  }

  if (servicingAdvisorId) {
    const servicingName = await fetchRedtailAdvisorName(baseUrl, headers, servicingAdvisorId, 'servicing');
    await handleRedtailAdvisorSync(firmId, servicingAdvisorId, servicingName, 'servicing');
    household.redtailServicingAdvisorId = servicingAdvisorId;
    const existingServ = await RedtailAdvisor.findOne({ firmId, redtailAdvisorId: servicingAdvisorId });
    if (existingServ && existingServ.linkedUser) {
      household.servicingLeadAdvisor = existingServ.linkedUser;
      household.leadAdvisors.addToSet(existingServ.linkedUser);
    }
  }

  if (writingAdvisorId) {
    const writingName = await fetchRedtailAdvisorName(baseUrl, headers, writingAdvisorId, 'writing');
    await handleRedtailAdvisorSync(firmId, writingAdvisorId, writingName, 'writing');
    household.redtailWritingAdvisorId = writingAdvisorId;
    const existingWrit = await RedtailAdvisor.findOne({ firmId, redtailAdvisorId: writingAdvisorId });
    if (existingWrit && existingWrit.linkedUser) {
      household.writingLeadAdvisor = existingWrit.linkedUser;
      household.leadAdvisors.addToSet(existingWrit.linkedUser);
    }
  }

  // also check each localClient for contact-level advisors
  for (const client of localClients) {
    const cServ = client.contactLevelServicingAdvisorId;
    const cWrit = client.contactLevelWritingAdvisorId;
    if (cServ && !household.redtailServicingAdvisorId) {
      const servName = await fetchRedtailAdvisorName(baseUrl, headers, cServ, 'servicing');
      await handleRedtailAdvisorSync(firmId, cServ, servName, 'servicing');
      household.redtailServicingAdvisorId = cServ;
      const servAdvisor = await RedtailAdvisor.findOne({ firmId, redtailAdvisorId: cServ });
      if (servAdvisor && servAdvisor.linkedUser) {
        household.servicingLeadAdvisor = servAdvisor.linkedUser;
        household.leadAdvisors.addToSet(servAdvisor.linkedUser);
      }
    }
    if (cWrit && !household.redtailWritingAdvisorId) {
      const writName = await fetchRedtailAdvisorName(baseUrl, headers, cWrit, 'writing');
      await handleRedtailAdvisorSync(firmId, cWrit, writName, 'writing');
      household.redtailWritingAdvisorId = cWrit;
      const writAdvisor = await RedtailAdvisor.findOne({ firmId, redtailAdvisorId: cWrit });
      if (writAdvisor && writAdvisor.linkedUser) {
        household.writingLeadAdvisor = writAdvisor.linkedUser;
        household.leadAdvisors.addToSet(writAdvisor.linkedUser);
      }
    }
  }

  await household.save();
}

/************************************************
 * createSoloHouseholdsForOrphanClients
 ************************************************/
async function createSoloHouseholdsForOrphanClients(company, currentUserId, baseUrl, authHeader) {
  const firmId = company._id;
  const orphans = await Client.find({
    firmId,
    $or: [{ household: { $exists: false } }, { household: null }],
  });

  for (const orphan of orphans) {
    const hhName = `Solo: ${orphan.firstName} ${orphan.lastName}`.trim();
    const isRedtailContact = orphan.redtailId != null;

    const placeholderFamilyId = isRedtailContact
      ? `SOLO-${orphan.redtailId}`
      : null;

    let newHousehold;
    try {
      newHousehold = await Household.findOneAndUpdate(
        { firmId, redtailFamilyId: placeholderFamilyId },
        {
          $set: {
            firmId,
            name: hhName,
            owner: currentUserId,
            redtailCreated: isRedtailContact
          },
          $setOnInsert: {
            redtailFamilyId: placeholderFamilyId
          },
        },
        { upsert: true, new: true }
      );

      orphan.household = newHousehold._id;
      await orphan.save();
    } catch (err) {
      console.error(`Failed creating solo household for orphan client ${orphan._id}`, err);
      continue;
    }

    const servicingAdvisorId = orphan.contactLevelServicingAdvisorId;
    const writingAdvisorId   = orphan.contactLevelWritingAdvisorId;

    if (servicingAdvisorId) {
      const servicingName = await fetchRedtailAdvisorName(baseUrl, { Authorization: authHeader, userkey: '' }, servicingAdvisorId, 'servicing');
      await handleRedtailAdvisorSync(firmId, servicingAdvisorId, servicingName, 'servicing');
      newHousehold.redtailServicingAdvisorId = servicingAdvisorId;

      const existingServ = await RedtailAdvisor.findOne({
        firmId,
        redtailAdvisorId: servicingAdvisorId,
      });
      if (existingServ && existingServ.linkedUser) {
        newHousehold.servicingLeadAdvisor = existingServ.linkedUser;
        newHousehold.leadAdvisors.addToSet(existingServ.linkedUser);
      }
    }

    if (writingAdvisorId) {
      const writingName = await fetchRedtailAdvisorName(baseUrl, { Authorization: authHeader, userkey: '' }, writingAdvisorId, 'writing');
      await handleRedtailAdvisorSync(firmId, writingAdvisorId, writingName, 'writing');
      newHousehold.redtailWritingAdvisorId = writingAdvisorId;

      const existingWrit = await RedtailAdvisor.findOne({
        firmId,
        redtailAdvisorId: writingAdvisorId,
      });
      if (existingWrit && existingWrit.linkedUser) {
        newHousehold.writingLeadAdvisor = existingWrit.linkedUser;
        newHousehold.leadAdvisors.addToSet(existingWrit.linkedUser);
      }
    }

    await newHousehold.save();

  }
}

/************************************************
 * fetchRedtailAdvisorName, handleRedtailAdvisorSync
 ************************************************/
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
      return match.name;
    } else {
      return `Unknown Advisor #${advisorId}`;
    }
  } catch (err) {
    console.warn(`Could not fetch ${type} advisors list for ID=${advisorId}`, err.message);
    return `Unknown Advisor #${advisorId}`;
  }
}

async function handleRedtailAdvisorSync(firmId, advisorId, advisorName, type) {
  if (!advisorId) return;

  let existing = await RedtailAdvisor.findOne({
    firmId,
    redtailAdvisorId: advisorId,
  });

  if (!existing) {
    existing = await RedtailAdvisor.create({
      firmId,
      redtailAdvisorId: advisorId,
      advisorName: advisorName || '',
      type,
    });
    console.log(`[DEBUG] Created new RedtailAdvisor doc for ID=${advisorId}, type=${type}`);
  } else {
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

/************************************************
 * syncAccounts (SECOND PASS)
 ************************************************/
async function syncAccounts(baseUrl, authHeader, userKey, firmId, currentUserId, syncContext) {
  const headers = { Authorization: authHeader, userkey: userKey };

  // Re-enumerate contacts (since this is second pass)
  const allContacts = [];
  let page = 1;
  let totalPages = 1;
  const updatedSince = syncContext.lastSync
    ? `&updated_since=${encodeURIComponent(syncContext.lastSync.toISOString())}`
    : '';

  do {
    const url = `${baseUrl}/contacts?page=${page}&page_size=200${updatedSince}`;
    try {
      const resp = await axios.get(url, { headers });
      const contacts = resp.data.contacts || [];
      const meta = resp.data.meta || {};
      totalPages = meta.total_pages || 1;

      for (const c of contacts) {
        if (c.id) allContacts.push(c.id);
      }
    } catch (err) {
      console.error(`syncAccounts => error enumerating contacts page=${page}`, err.message);
    }
    page++;
  } while (page <= totalPages);

  const redtailAccountMap = {};

  for (const contactId of allContacts) {
    const client = await Client.findOne({ firmId, redtailId: contactId });
    const url = `${baseUrl}/contacts/${contactId}/accounts`;

    try {
      const resp = await axios.get(url, { headers });
      const accounts = resp.data.accounts || [];

      for (const acc of accounts) {
        redtailAccountMap[acc.id] = {
          balance: parseFloat(acc.balance) || 0,
          ownerContactId: contactId,
        };

        if (client) {
          await upsertAccountFromRedtail(baseUrl, headers, acc, client, firmId, currentUserId);
        } else {
          console.warn(`No local client for contactId=${contactId}, skipping upsertAccount for Redtail account ID=${acc.id}`);
        }

        // After each account
        syncContext.processedAccounts++;
        emitProgress(syncContext, 'syncing');
      }
    } catch (err) {
      console.error(`Failed to fetch accounts for Contact ${contactId}`, err.response?.data || err);
    }
  }

  await generateAccountsDiff(redtailAccountMap, firmId);
}

/************************************************
 * generateAccountsDiff
 ************************************************/
async function generateAccountsDiff(redtailAccountMap, firmId) {
  const redtailIds = new Set(Object.keys(redtailAccountMap).map(id => parseInt(id, 10)));
  const localAccounts = await Account.find({ firmId, redtailAccountId: { $exists: true } }).lean();
  const localIds = new Set(localAccounts.map(a => a.redtailAccountId));

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
      missingTotalValue += parseFloat(balance) || 0;
      console.log(`Missing redtailAccountId=${rtId} (Balance=${balance || 0})`);
    }
    console.log(`TOTAL MISSING VALUE => $${missingTotalValue.toFixed(2)}`);
  } else {
    console.log('No missing local accounts.');
  }

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

/************************************************
 * upsertAccountFromRedtail
 ************************************************/
async function upsertAccountFromRedtail(baseUrl, headers, accountData, client, firmId, currentUserId) {
  const redtailAccountId = accountData.id;

  let rawNumber = accountData.number;
  let rawBalance = accountData.balance;
  let rawType = accountData.account_type;
  let rawCustodian = accountData.company;

  // We'll initially assume these might come from top-level fields:
  let rawSystematicWithdrawAmount = accountData.systematic_withdraw_amount;       // (existing)
  let rawSystematicWithdrawFrequency = accountData.systematic_withdraw_frequency; // (existing)
  let rawFederalWithholding;
  let rawStateWithholding;

  // Attempt to fetch the full account detail from Redtail:
  try {
    const fullResp = await axios.get(`${baseUrl}/accounts/${redtailAccountId}`, { headers });
    const detail = fullResp.data.account || {};

    // TOP-LEVEL FIELDS
    rawNumber = detail.number || rawNumber;
    rawBalance = typeof detail.balance !== 'undefined' ? detail.balance : rawBalance;
    rawType = detail.account_type || rawType;
    rawCustodian = detail.company || rawCustodian;

    // If Redtail returns these top-level:
    rawSystematicWithdrawAmount = detail.systematic_withdraw_amount;
    rawSystematicWithdrawFrequency = detail.systematic_withdraw_frequency;
    rawFederalWithholding = detail.federal_tax_withholding;
    rawStateWithholding = detail.state_tax_withholding;

    // ----------------------------
    // NEW or UPDATED: Payment Data
    // ----------------------------
    // If Redtail provides systematic info via detail.payment, parse it:
    if (detail.payment) {
      // Example approach if Redtail uses "premium_frequency" for withdrawal frequency:
      if (detail.payment.premium_frequency) {
        // Convert numeric IDs to strings recognized by our Mongoose enum
        // e.g., 1 => 'Monthly', 2 => 'Quarterly', 3 => 'Semi-annual', 4 => 'Annually'
        const frequencyMap = {
          1: 'Monthly',
          2: 'Quarterly',
          3: 'Semi-annual', // match your updated enum or map it to 'Annually' if you prefer
          4: 'Annually',
        };
        rawSystematicWithdrawFrequency = frequencyMap[detail.payment.premium_frequency] || '';
      }

      // If there's a separate numeric field for the amount, handle that:
      if (typeof detail.payment.withdraw_amount !== 'undefined') {
        rawSystematicWithdrawAmount = detail.payment.withdraw_amount;
      }
    }

  } catch (err) {
    console.warn(
      `Could not fetch full account details for redtailAccountId=${redtailAccountId}`,
      err.response?.data || err
    );
    rawNumber = rawNumber || 'Unknown Number';
    rawBalance = rawBalance || 0;
  }

  // Convert to safe fallback values
  const accountNumber = rawNumber || 'Unknown Number';
  const accountValue = parseFloat(rawBalance) || 0;

  // Ensure recognized Account Type or default to 'Other'
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
  const taxStatus = accountData.tax_status || 'Taxable';

  // Ensure we have a Household for this account
  let householdId = client.household;
  if (!householdId) {
    console.warn(
      `Client ${client._id} had no household, creating fallback for redtailAccountId=${redtailAccountId}...`
    );
    const fallback = await Household.create({
      firmId,
      name: `Solo: ${client.firstName} ${client.lastName}`,
      owner: currentUserId,
      redtailFamilyId: null,
      redtailCreated: client.redtailId != null,
    });
    householdId = fallback._id;
    client.household = fallback._id;
    await client.save();
  }

  // Upsert the Account
  let localAccount = await Account.findOne({ firmId, redtailAccountId });
  if (!localAccount) {
    localAccount = new Account({
      firmId,
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
    localAccount.firmId = firmId;
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

  // -------------------------------------------------
  // NEW or UPDATED: Apply the systematic withdraw data
  // -------------------------------------------------
  if (typeof rawSystematicWithdrawAmount !== 'undefined') {
    localAccount.systematicWithdrawAmount = rawSystematicWithdrawAmount;
  }
  if (typeof rawSystematicWithdrawFrequency !== 'undefined') {
    localAccount.systematicWithdrawFrequency = rawSystematicWithdrawFrequency;
  }

  // Federal / State Withholding
  if (typeof rawFederalWithholding !== 'undefined') {
    localAccount.federalTaxWithholding = rawFederalWithholding;
  }
  if (typeof rawStateWithholding !== 'undefined') {
    localAccount.stateTaxWithholding = rawStateWithholding;
  }

  // Save the Account and link to Household
  try {
    const saved = await localAccount.save();

    await Household.findByIdAndUpdate(householdId, {
      $addToSet: { accounts: saved._id },
      $set: { redtailCreated: true },
    });

    // Fetch Beneficiaries, etc. (existing code)
    try {
      const redtailBenefs = await fetchAccountBeneficiaries(baseUrl, headers, redtailAccountId);
    

      const primaryBenefs = [];
      const contingentBenefs = [];
      for (const b of redtailBenefs) {
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


async function fetchAccountBeneficiaries(baseUrl, headers, accountId) {
  
  const url = `${baseUrl}/accounts/${accountId}/beneficiaries`;
  try {
    const resp = await axios.get(url, { headers });
    return resp.data.account_beneficiaries || [];
  } catch (err) {
    console.warn(`Failed to fetch beneficiaries for accountId=${accountId}`, err.message);
    return [];
  }
}

/************************************************
 * EXPORT
 ************************************************/
module.exports = {
  syncAll,
};
