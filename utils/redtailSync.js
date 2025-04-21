// utils/redtailSync.js
const axios = require('axios');

const redtailDevKey = process.env.REDTAIL_API_KEY_DEV;
const redtailProdKey = process.env.REDTAIL_API_KEY_PROD;


function getBaseURL(isProduction) {
  return isProduction 
    ? 'https://crm.redtailtechnology.com/api/public/v1'
    : 'https://review.crm.redtailtechnology.com/api/public/v1';
}

async function fetchContacts(user) {
  const base = getBaseURL(user.redtail?.environment === 'production');
  try {
    const response = await axios.get(`${base}/contacts`, {
      headers: {
        Authorization: user.redtail?.apiKey, 
        userkey: user.redtail?.userKey
      }
    });
    return response.data; // or handle pagination
  } catch (err) {
    // handle error
    throw err;
  }
}

module.exports = { fetchContacts, /* etc. */ };
