/**************************************************
 * routes/integrations.js
 * Safely storing the Redtail password by encrypting it at rest
 * using AES-256-GCM. 
 **************************************************/
const express = require('express');
const router = express.Router();
const axios = require('axios');
const CompanyID = require('../models/CompanyID');
const { syncAll } = require('../utils/redtailSync');
const { encryptString } = require('../utils/encryption'); // <--- IMPORT the encryption helper

/**
 * Build Basic Auth for the /authentication endpoint
 * (using dev/prod apiKey : RedtailUsername : RedtailPassword).
 */
function buildBasicAuth(apiKey, username, password) {
  const raw = `${apiKey}:${username}:${password}`;
  const base64 = Buffer.from(raw).toString('base64');
  return `Basic ${base64}`;
}

/**
 * Call Redtail /authentication to retrieve the user_key (dev environment).
 * Dev environment specifically wants (apiKey + username + password).
 */
async function getRedtailUserKey(username, password, environment) {
  const isProd = (environment === 'production');
  const baseUrl = isProd
    ? 'https://crm.redtailtechnology.com/api/public/v1'
    : 'https://review.crm.redtailtechnology.com/api/public/v1';

  // Pick correct dev/prod API Key from .env
  const apiKey = isProd 
    ? process.env.REDTAIL_API_KEY_PROD
    : process.env.REDTAIL_API_KEY_DEV;

  // For /authentication, do Basic auth with the real password
  const authHeader = buildBasicAuth(apiKey, username, password);

  try {
    const resp = await axios.get(`${baseUrl}/authentication`, {
      headers: {
        Authorization: authHeader
      }
    });
    // The user_key is found in resp.data.authenticated_user.user_key
    return resp.data.authenticated_user.user_key; 
  } catch (err) {
    console.error('[DEBUG] Error in getRedtailUserKey:', err.response?.data || err);
    throw new Error(`Could not fetch userKey: ${err.message}`);
  }
}

/**
 * POST /redtail/connect
 *  1) Use the real username/password + dev/prod apiKey to get userKey from /authentication
 *  2) Encrypt the password for storage
 *  3) Store all credentials in the DB, including the encrypted password
 */
router.post('/redtail/connect', async (req, res) => {
  try {
    const { environment, username, password } = req.body;
    if (!environment || !username || !password) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    // (1) Retrieve userKey from Redtail
    const userKey = await getRedtailUserKey(username, password, environment);

    // (2) Identify the user’s company
    const companyId = req.session.user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, message: 'No company in session.' });
    }
    const company = await CompanyID.findOne({ companyId });
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found.' });
    }

    // (3) Determine dev/prod finalApiKey
    const isProd = (environment === 'production');
    const finalApiKey = isProd 
      ? process.env.REDTAIL_API_KEY_PROD
      : process.env.REDTAIL_API_KEY_DEV;

    // (4) Encrypt the password before storing
    //     encryptString returns { ciphertext, iv, authTag }
    const { ciphertext, iv, authTag } = encryptString(password);

    // (5) Save Redtail config to DB
    company.redtail = {
      apiKey: finalApiKey,   // dev or prod key
      userKey,               // from getRedtailUserKey
      username,              // Redtail username
      // Instead of storing password in plaintext:
      encryptedPassword: ciphertext,
      encryptionIV: iv,
      authTag,
      environment,
      lastSync: null
    };
    await company.save();

    return res.json({ success: true });
  } catch (err) {
    console.error('Error connecting to Redtail:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /redtail/sync
 * - Reuse the dev/prod apiKey, userKey, username, 
 *   and (encrypted) password to do the actual data sync.
 */
// routes/integrations.js
router.post('/redtail/sync', async (req, res) => {
    try {
      const companyId = req.session.user?.companyId;
      const currentUserId = req.session.user?._id;  // Must be a valid Mongoose ObjectId
  
      if (!companyId || !currentUserId) {
        return res.status(401).json({ success: false, message: 'No company or user in session.' });
      }
  
      const company = await CompanyID.findOne({ companyId });
      if (!company) {
        return res.status(404).json({ success: false, message: 'Company not found.' });
      }
  
      // Check if we have all the Redtail encryption fields
      const r = company.redtail || {};
      if (!r.apiKey || !r.userKey || !r.username || !r.encryptedPassword || !r.encryptionIV || !r.authTag) {
        return res.status(400).json({
          success: false,
          message: 'Redtail not fully connected (missing some credentials).'
        });
      }
  
      // Perform the sync, passing currentUserId
      await syncAll(company, currentUserId);
  
      return res.json({ success: true, message: 'Redtail sync completed successfully.' });
    } catch (err) {
      console.error('Redtail Sync Error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  });
  

module.exports = router;
