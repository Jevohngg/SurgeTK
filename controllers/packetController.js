// controllers/packetController.js
const Surge          = require('../models/Surge');
const SurgeSnapshot  = require('../models/SurgeSnapshot');
const { generatePreSignedUrl } = require('../utils/s3');
const Household = require('../models/Household');

/**
 * GET /api/households/:id/packets
 * Returns an array of every Surge packet prepared for this household.
 * [{ surgeId, surgeName, startDate, endDate, packetUrl }]
 */
// controllers/packetController.js
exports.listHouseholdPackets = async (req, res, next) => {
    // 1) Log params
    console.log('[packetController] req.params =', req.params);
    const { householdId } = req.params;
    console.log('[packetController] → derived householdId:', householdId);
  
    try {
      // 2) Log and fetch snapshots
      const snaps = await SurgeSnapshot
        .find({ household: householdId })
        .sort('-preparedAt')
        .lean();
      console.log(`[packetController]   found ${snaps.length} snapshot(s) for household ${householdId}`);
      console.log('[packetController]   snapshots:', snaps);
  
      // 3) Extract and log surge IDs
      const surgeIds = snaps.map(s => s.surgeId.toString());
      console.log('[packetController]   surgeIds to fetch:', surgeIds);
  
      // 4) Fetch and log Surge docs
      const surges = await Surge
        .find({ _id: { $in: surgeIds } })
        .select('name startDate endDate')
        .lean();
      console.log('[packetController]   retrieved Surge docs:', surges);
  
      const surgeById = Object.fromEntries(surges.map(s => [s._id.toString(), s]));
  
      // 5) Build packets array with URLs, logging each
      const packets = await Promise.all(snaps.map(async snap => {
        const surge = surgeById[snap.surgeId.toString()] || {};
        const url   = await generatePreSignedUrl(snap.packetKey, 60 * 60);
        const packet = {
          surgeId:   snap.surgeId.toString(),
          surgeName: surge.name || '(deleted surge)',
          startDate: surge.startDate,
          endDate:   surge.endDate,
          packetUrl: url
        };
        console.log('[packetController]   built packet object:', packet);
        return packet;
      }));
  
      // 6) Final log before sending
      console.log('[packetController]   returning packets array:', packets);
      res.json({ packets });
  
    } catch (err) {
      console.error('[packetController] ❌ error in listHouseholdPackets:', err);
      next(err);
    }
  };
  