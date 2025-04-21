/**************************************************
 * routes/integrations.js  (Fixed to read nested user_key)
 **************************************************/
const express = require('express');
const router = express.Router();
const axios = require('axios');
const CompanyID = require('../models/CompanyID');

// Helper to build Basic Auth from APIKey:Username:Password
function buildBasicAuth(apiKey, username, password) {
  const raw = `${apiKey}:${username}:${password}`;
  const base64 = Buffer.from(raw).toString('base64');
  return `Basic ${base64}`;
}

// The function to retrieve userKey from Redtail
async function getRedtailUserKey(username, password, environment) {
  const isProd = (environment === 'production');

  // Choose the correct base URL
  const baseUrl = isProd
    ? 'https://crm.redtailtechnology.com/api/public/v1'
    : 'https://review.crm.redtailtechnology.com/api/public/v1';

  // Pick correct Redtail key from .env
  const apiKey = isProd 
    ? process.env.REDTAIL_API_KEY_PROD
    : process.env.REDTAIL_API_KEY_DEV;

  // Build Basic Auth header
  const authHeader = buildBasicAuth(apiKey, username, password);

  // ──────────────── DEBUG LOGS ────────────────
  console.log('[DEBUG] environment:', environment);
  console.log('[DEBUG] isProd:', isProd);
  console.log('[DEBUG] baseUrl:', baseUrl);
  console.log('[DEBUG] using apiKey (from .env):', apiKey);
  console.log('[DEBUG] Auth header (Base64) starts with:', authHeader.slice(0, 15), '...');

  try {
    const resp = await axios.get(`${baseUrl}/authentication`, {
      headers: {
        Authorization: authHeader
      }
    });

    // Log the entire response data from Redtail
    console.log('[DEBUG] Redtail response data:', resp.data);

    // *IMPORTANT*: The actual user_key is at resp.data.authenticated_user.user_key
    // not resp.data.user_key
    return resp.data.authenticated_user.user_key; 
  } catch (err) {
    console.error('[DEBUG] Error fetching Redtail userKey - err.response.data:', err.response?.data);
    throw new Error(`Could not fetch userKey: ${err.message}`);
  }
}

// POST route to connect to Redtail
router.post('/redtail/connect', async (req, res) => {
  try {
    const { environment, username, password } = req.body;
    if (!environment || !username || !password) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    // 1) Attempt to get the userKey from Redtail
    const userKey = await getRedtailUserKey(username, password, environment);
    console.log('[DEBUG] userKey returned from Redtail:', userKey);

    // 2) Identify the user’s firm/company from session
    const companyId = req.session.user?.companyId;
    console.log('[DEBUG] companyId from session:', companyId);

    if (!companyId) {
      return res.status(401).json({ success: false, message: 'No company in session' });
    }

    // 3) Find the corresponding CompanyID document
    const company = await CompanyID.findOne({ companyId });
    console.log('[DEBUG] Company document before save:', company);

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    // 4) Determine dev vs. prod for finalApiKey
    const isProd = (environment === 'production');
    const finalApiKey = isProd 
      ? process.env.REDTAIL_API_KEY_PROD
      : process.env.REDTAIL_API_KEY_DEV;

    // 5) Save Redtail data in DB
    company.redtail = {
      apiKey: finalApiKey,   // dev or prod key
      userKey,               // from getRedtailUserKey
      username,
      environment,
      lastSync: null
    };

    await company.save();
    console.log('[DEBUG] Company document AFTER save:', company);

    return res.json({ success: true });
  } catch (err) {
    console.error('Error connecting to Redtail:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
