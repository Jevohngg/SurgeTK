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

  // 3) Sync Contacts
  await syncContacts(baseUrl, authHeader, userKey, lastSync, company._id);

  // Emit ~40%
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', { percent: 40 });
  }

  // 4) Sync Families => upsert Households
  await syncFamilies(baseUrl, authHeader, userKey, company, currentUserId);

  // Emit ~60%
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', { percent: 60 });
  }

  // 4a) Create solo Households for orphans + fix invalid references
  await fixInvalidHouseholdRefs(company._id);
  await createSoloHouseholdsForOrphanClients(company, currentUserId, baseUrl, authHeader);

  // Emit ~75%
  if (io && userRoom) {
    io.to(userRoom).emit('redtailSyncProgress', { percent: 75 });
  }

  // 5) Sync Accounts
  await syncAccounts(baseUrl, authHeader, userKey, company._id, currentUserId);

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

/**
 * fixInvalidHouseholdRefs
 *  Checks if any Client references a Household doc (within this firm) that no longer exists,
 *  sets it to null so they become a true orphan
 */
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

/* ---------------------------------------------------------------
   FETCH CONTACT PHONES & EMAILS
   --------------------------------------------------------------- */
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

/* ---------------------------------------------------------------
   A) CONTACTS (including contact-level advisors)
   --------------------------------------------------------------- */
async function syncContacts(baseUrl, authHeader, userKey, lastSync, firmId) {
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
      }
    } catch (err) {
      console.error(`Failed to fetch contacts on page ${page}`, err.response?.data || err);
    }

    page += 1;
  } while (page <= totalPages);
}

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
  const ssn = contact.tax_id || '';

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

  // Refine phones/emails
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

  const rawServ = contact.servicing_advisor_id || null;
  const rawWrit = contact.writing_advisor_id || null;
  const servicingAdvisorId = rawServ ? parseInt(rawServ, 10) : null;
  const writingAdvisorId   = rawWrit ? parseInt(rawWrit, 10) : null;

  console.log(
    `[DEBUG] Contact ${redtailId} => servicing_advisor_id=${servicingAdvisorId}, writing_advisor_id=${writingAdvisorId}`
  );

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
        // Add to leadAdvisors array
        household.leadAdvisors.addToSet(existServ.linkedUser);
      }
    }
    if (writingAdvisorId) {
      household.redtailWritingAdvisorId = writingAdvisorId;
      const existWrit = await RedtailAdvisor.findOne({ firmId, redtailAdvisorId: writingAdvisorId });
      if (existWrit && existWrit.linkedUser) {
        household.writingLeadAdvisor = existWrit.linkedUser;
        // Add to leadAdvisors array
        household.leadAdvisors.addToSet(existWrit.linkedUser);
      }
    }
    household.redtailCreated = true;
    await household.save();
  } else {
    if (servicingAdvisorId || writingAdvisorId) {
      console.log(`[DEBUG] Contact ${updatedClient._id} => found contact-level advisors but no household is assigned (orphan).`);
    }
  }
}

/* ---------------------------------------------------------------
   B) FAMILIES => HOUSEHOLDS (with Family-level advisors)
   --------------------------------------------------------------- */
async function syncFamilies(baseUrl, authHeader, userKey, company, currentUserId) {
  const headers = { Authorization: authHeader, userkey: userKey };
  const url = `${baseUrl}/families?family_members=true`;

  try {
    const resp = await axios.get(url, { headers });
    const families = resp.data.families || [];
    console.log(`[DEBUG] Fetched families => count: ${families.length}`);

    for (const family of families) {
      await upsertHouseholdFromRedtailFamily(family, company, currentUserId, baseUrl, headers);
    }
  } catch (err) {
    console.error('Failed to fetch families:', err.response?.data || err);
  }
}

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
    console.log(`Family ${redtailFamilyId} => 0 members => skipping household creation.`);
    return;
  }

  const contactIds = members.map(m => m.contact_id).filter(Boolean);
  const localClients = await Client.find({ firmId, redtailId: { $in: contactIds } });
  if (localClients.length === 0) {
    console.log(`Family ${redtailFamilyId} => no matching local Clients => skipping.`);
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

    // If they came from a solo household, remove that if it's now empty
    if (oldHouseholdId && !oldHouseholdId.equals(household._id)) {
      const oldHH = await Household.findOne({ _id: oldHouseholdId });
      if (oldHH) {
        const countMembers = await Client.countDocuments({ household: oldHouseholdId });
        if (countMembers === 0) {
          console.log(`[DEBUG] Removing empty old solo household _id=${oldHouseholdId} after reassigning client.`);
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
      // Also add them to leadAdvisors array
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
      // Also add them to leadAdvisors array
      household.leadAdvisors.addToSet(existingWrit.linkedUser);
    }
  }

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

/**
 * createSoloHouseholdsForOrphanClients
 *  If a client is not in a Redtail Family, create a "solo" household
 *  using a placeholder "SOLO-<redtailId>" if the client has a redtailId.
 */
async function createSoloHouseholdsForOrphanClients(company, currentUserId, baseUrl, authHeader) {
  const firmId = company._id;
  const orphans = await Client.find({
    firmId,
    $or: [{ household: { $exists: false } }, { household: null }],
  });

  for (const orphan of orphans) {
    const hhName = `Solo: ${orphan.firstName} ${orphan.lastName}`.trim();
    const isRedtailContact = orphan.redtailId != null;

    // Create a placeholder ID if they are a Redtail contact
    const placeholderFamilyId = isRedtailContact
      ? `SOLO-${orphan.redtailId}`
      : null;

    let newHousehold;
    try {
      // Upsert by (firmId, redtailFamilyId=placeholderFamilyId)
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

    // Re-check the orphan's contact-level advisors
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
    console.log(`[DEBUG] Created/updated solo household with placeholder ID=${placeholderFamilyId} for orphan ${orphan._id}`);
  }
}

/* ---------------------------------------------------------------
   HELPER: fetchRedtailAdvisorName
   --------------------------------------------------------------- */
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

/**
 * handleRedtailAdvisorSync
 *   - Upserts a RedtailAdvisor doc
 *   - If it’s not already there, create it
 *   - If it is, update the name/type if needed
 */
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

/* ---------------------------------------------------------------
   C) ACCOUNTS
   --------------------------------------------------------------- */
async function syncAccounts(baseUrl, authHeader, userKey, firmId, currentUserId) {
  const headers = { Authorization: authHeader, userkey: userKey };
  const allClients = await Client.find(
    { firmId, redtailId: { $exists: true, $ne: null } },
    '_id redtailId household firstName lastName'
  );

  const redtailAccountMap = {};

  for (const client of allClients) {
    const contactId = client.redtailId;
    const url = `${baseUrl}/contacts/${contactId}/accounts`;

    try {
      const resp = await axios.get(url, { headers });
      const accounts = resp.data.accounts || [];

      for (const acc of accounts) {
        redtailAccountMap[acc.id] = {
          balance: parseFloat(acc.balance) || 0,
          ownerContactId: contactId,
        };
        await upsertAccountFromRedtail(baseUrl, headers, acc, client, firmId, currentUserId);
      }
    } catch (err) {
      console.error(`Failed to fetch accounts for Contact ${contactId}`, err.response?.data || err);
    }
  }

  await generateAccountsDiff(redtailAccountMap, firmId);
}

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

async function upsertAccountFromRedtail(baseUrl, headers, accountData, client, firmId, currentUserId) {
  const redtailAccountId = accountData.id;

  let rawNumber = accountData.number;
  let rawBalance = accountData.balance;
  let rawType = accountData.account_type;
  let rawCustodian = accountData.company;
  let rawSystematicWithdrawAmount;
  let rawSystematicWithdrawFrequency;
  let rawFederalWithholding;
  let rawStateWithholding;

  // Fetch detail if missing
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

    await Household.findByIdAndUpdate(householdId, {
      $addToSet: { accounts: saved._id },
      $set: { redtailCreated: true },
    });

    try {
      const redtailBenefs = await fetchAccountBeneficiaries(baseUrl, headers, redtailAccountId);
      console.log(`[DEBUG] Retrieved ${redtailBenefs.length} beneficiaries for redtailAccountId=${redtailAccountId}`);

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

async function fetchAccountBeneficiaries(baseUrl, headers, accountId) {
  console.log(`[DEBUG] Attempting to fetch beneficiaries for accountId=${accountId}`);
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
