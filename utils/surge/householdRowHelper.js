const Household      = require('../../models/Household');
const Client         = require('../../models/Client');
const SurgeSnapshot  = require('../../models/SurgeSnapshot');
const { generateHouseholdWarnings } = require('../pdf/warningHelper');
const { WARNING_TYPES }            = require('../constants');

/**
 * Returns one enriched object ready for table rendering.
 * Used by GET /api/surge/:id/households
 */
async function buildHouseholdRow({ surge, householdId }) {
  // 1) Fetch household + its lead advisors
  const hh = await Household.findById(householdId)
    .populate('leadAdvisors', 'firstName lastName avatar') // _id remains present
    .lean();
  if (!hh) return null;

  // 2) Compute the human-readable household name via Client docs
  const clients = await Client.find({ household: householdId }).lean();
  let householdName = 'Unnamed Household';
  if (clients && clients.length > 0) {
    const first     = clients[0];
    const lastName  = first.lastName  || '';
    const firstName = first.firstName || '';

    if (clients.length === 1) {
      householdName = `${lastName}, ${firstName}`;
    } else if (clients.length === 2) {
      const second = clients[1];
      const l2     = second.lastName  || '';
      const f2     = second.firstName || '';
      if (l2.toLowerCase() === lastName.toLowerCase()) {
        householdName = `${lastName}, ${firstName} & ${f2}`;
      } else {
        householdName = `${lastName}, ${firstName} & ${l2}, ${f2}`;
      }
    } else {
      // More than two clients, fallback to head-of-household only
      householdName = `${lastName}, ${firstName}`;
    }
  }

  // 3) Advisor info
  const advDocs   = Array.isArray(hh.leadAdvisors) ? hh.leadAdvisors : [];
  const advisorIds = advDocs
    .map(a => a && a._id ? a._id.toString() : null)
    .filter(Boolean);                                // ★ NEW
  const advisorId   = advisorIds[0] || null;         // ★ NEW (convenience)
  const advisorName =
    advDocs.length > 0
      ? `${advDocs[0].firstName} ${advDocs[0].lastName}`
      : '—';

  // 4) Warning icons (one per warning, with full-label tooltip)
  const warningIds   = await generateHouseholdWarnings({ householdId, surge });
  const warningIcons = warningIds
    .map(id => {
      const cfg      = WARNING_TYPES[id] || {};
      const iconName = cfg.icon      || 'info';
      const color    = cfg.badge     || 'secondary';
      const tooltip  = cfg.label     || id.replace(/_/g, ' ');
      return `<span
                class="material-symbols-outlined text-${color} me-1"
                data-bs-toggle="tooltip"
                data-bs-placement="top"
                title="${tooltip}">
                  ${iconName}
              </span>`;
    })
    .join('');

  // 5) Has this household already been prepared?
  const prepared = Boolean(
    await SurgeSnapshot.exists({ surgeId: surge._id, household: householdId })
  );

  /* 6) Return enriched row (warningIds added for server‑side filtering) */
  return {
    _id           : hh._id.toString(),
    householdName,
    advisorName,
    advisorId,      // ★ NEW
    advisorIds,     // ★ NEW (array, used for filtering)
    warningIcons,
    warningIds,
    prepared
  };
}

module.exports = { buildHouseholdRow };
