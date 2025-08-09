// utils/valueAddRefresh.js
/**
 * Force‑recalculate the latest numbers for ANY ValueAdd document.
 * We call the existing controller update functions directly, so
 * everything is done in‑process (no HTTP round‑trips, no auth).
 */
const valueAddCtrl = require('../controllers/valueAddController');

// a no‑op “res” object so controller functions do not crash
const noop = () => {};
const chain = { json: noop, send: noop, end: noop };
const dummyRes = {
  status: () => chain,
  json: noop,
  send: noop,
  end:  noop
};

exports.refreshOne = async function refreshOne(vaDoc) {
  const req = { params: { id: vaDoc._id.toString() } };

  try {
    switch (vaDoc.type) {
      case 'BUCKETS':
        await valueAddCtrl.updateBucketsValueAdd(req, dummyRes);
        break;
      case 'GUARDRAILS':
        await valueAddCtrl.updateGuardrailsValueAdd(req, dummyRes);
        break;
      case 'BENEFICIARY':
        await valueAddCtrl.updateBeneficiaryValueAdd(req, dummyRes);
        break;
      case 'NET_WORTH':
        await valueAddCtrl.updateNetWorthValueAdd(req, dummyRes);
        break;
      case 'HOMEWORK':
        await valueAddCtrl.updateHomeworkValueAdd(req, dummyRes);
        break;
      default:
        console.warn('[refreshOne] Unsupported type', vaDoc.type);
    }
  } catch (err) {
    // Do NOT kill the whole packet – just log and keep going
    console.error(`[refreshOne] ${vaDoc.type} ${vaDoc._id} refresh failed:`, err);
  }
};
