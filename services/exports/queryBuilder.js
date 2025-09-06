// services/exports/queryBuilder.js
const mongoose = require('mongoose');
const Account   = require('../../models/Account');
const Asset     = require('../../models/Asset');
const Client    = require('../../models/Client');
const Insurance = require('../../models/Insurance');
const Liability = require('../../models/Liability');
const Household = require('../../models/Household');
const columnCatalog = require('./columnCatalog');

// Build a fast text search condition for "global search"
function buildGlobalSearch(exportType, search) {
  if (!search) return {};
  const s = String(search).trim();
  if (!s) return {};

  switch (exportType) {
    case 'accounts':
      return { $or: [
        { accountNumber:    { $regex: s, $options: 'i' } },
        { accountOwnerName: { $regex: s, $options: 'i' } },
        { custodian:        { $regex: s, $options: 'i' } },
        { accountType:      { $regex: s, $options: 'i' } },
      ]};
    case 'contacts':
      return { $or: [
        { firstName: { $regex: s, $options: 'i' } },
        { lastName:  { $regex: s, $options: 'i' } },
        { email:     { $regex: s, $options: 'i' } },
      ]};
    case 'insurance':
      return { $or: [
        { policyNumber: { $regex: s, $options: 'i' } },
        { carrierName:  { $regex: s, $options: 'i' } },
        { productName:  { $regex: s, $options: 'i' } },
      ]};
    case 'liabilities':
      return { $or: [
        { liabilityName:     { $regex: s, $options: 'i' } },
        { liabilityType:     { $regex: s, $options: 'i' } },
        { creditorName:      { $regex: s, $options: 'i' } },
        { accountLoanNumber: { $regex: s, $options: 'i' } },
      ]};
      case 'assets':
        return { $or: [
          { assetNumber:      { $regex: s, $options: 'i' } },
          { accountOwnerName: { $regex: s, $options: 'i' } },
          { assetType:        { $regex: s, $options: 'i' } },
          { assetName:        { $regex: s, $options: 'i' } },
        ]};
      
    case 'billing':
      return { $or: [{ periodKey: { $regex: s, $options: 'i' } }]};
    default: return {};
  }
}

/**
 * Build the Mongo filter from typed column filters (contains/eq/in/range etc.)
 */
function buildTypedFilters(filters = {}) {
  const out = {};
  for (const [fieldId, cfg] of Object.entries(filters)) {
    if (!cfg || !cfg.op) continue;
    const { op, value, value2 } = cfg;
    switch (op) {
      case 'contains': out[fieldId] = { $regex: String(value || ''), $options: 'i' }; break;
      case 'eq':       out[fieldId] = value; break;
      case 'in':       out[fieldId] = { $in: Array.isArray(value) ? value : [value] }; break;
      case 'gte':      out[fieldId] = { $gte: value }; break;
      case 'lte':      out[fieldId] = { $lte: value }; break;
      case 'between':  out[fieldId] = { $gte: value, $lte: value2 }; break;
      case 'bool':     out[fieldId] = !!value; break;
      default: break;
    }
  }
  return out;
}

function needLookup(columns, prefix) {
  return columns.some(c => c.startsWith(prefix));
}

// Decide if we must materialize household.* fields
function needHouseholdData(columns, typed) {
  const typedKeys = Object.keys(typed || {});
  return needLookup(columns, 'household.') || typedKeys.some(k => k.startsWith('household.'));
}

// Split typed filters so we can apply household.* after we build those fields
function splitTypedFilters(typed = {}) {
  const typedHh = {}, typedOther = {};
  for (const [k, v] of Object.entries(typed)) {
    if (k.startsWith('household.')) typedHh[k] = v;
    else typedOther[k] = v;
  }
  return { typedHh, typedOther };
}


/**
 * For each export type, return:
 * - model
 * - pipeline (+ count pipeline)
 */
function buildListPipeline({ exportType, firmId, householdIds, columns, search, typedFilters, sort, skip=0, limit=100, debug=false }) {
  const cat = columnCatalog[exportType];
  if (!cat) throw new Error('Unknown export type');

  const matchFirm = { firmId: new mongoose.Types.ObjectId(firmId) };
  const global = buildGlobalSearch(exportType, search);
  const typed  = buildTypedFilters(typedFilters);

  let model, base = [], project = {}, lookups = [];

  switch (exportType) {
    // -------------------------------------------------------------------
    // ACCOUNTS
    // -------------------------------------------------------------------
    case 'accounts':
      model = Account;

        if (Array.isArray(householdIds) && householdIds.length) {
          // Legacy-friendly: include docs that (a) have correct firmId OR (b) are in scoped households
          base.push({
            $match: {
              $or: [
                { firmId: matchFirm.firmId },              // modern docs
                { household: { $in: householdIds } }       // legacy docs without firmId
              ]
            }
          });
        } else {
          base.push({ $match: { ...matchFirm } });         // firm-wide view still uses firmId
        }  
      if (Object.keys(global).length) base.push({ $match: global });

      // typed filters map directly (except household.* handled after lookup)
      {
        const typedMapped = {};
        for (const [k, v] of Object.entries(typed)) {
          if (k.startsWith('household.')) continue;
          typedMapped[k] = v;
        }
        if (Object.keys(typedMapped).length) base.push({ $match: typedMapped });
      }

// Household lookup (prefer account.household, fallback to first owner's household)
// and expose both nested and flat HHID fields.
if (needHouseholdData(columns, typed) || columns.includes('householdId')) {
  lookups.push(
    // Resolve first owner for fallback
    { $addFields: { ownerIds: { $ifNull: ['$accountOwner', []] } } },
    { $lookup:   { from: 'clients', localField: 'ownerIds', foreignField: '_id', as: 'ocHh' } },
    { $addFields: {
        firstOwnerHh: { $cond: [{ $gt: [{ $size: '$ocHh' }, 0] }, { $arrayElemAt: ['$ocHh', 0] }, null] },
        __hhId:       { $ifNull: ['$household', '$firstOwnerHh.household'] }
      }
    },

    // Household + advisors
    { $lookup: { from: 'households', localField: '__hhId', foreignField: '_id', as: 'hh' } },
    { $unwind: { path: '$hh', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'users', localField: 'hh.servicingLeadAdvisor', foreignField: '_id', as: 'sv' } },
    { $unwind: { path: '$sv', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'users', localField: 'hh.writingLeadAdvisor', foreignField: '_id', as: 'wv' } },
    { $unwind: { path: '$wv', preserveNullAndEmptyArrays: true } },

    // Materialize household fields (+ fallback to legacy id) and a flat alias
    { $addFields: {
        'household.userHouseholdId': { $ifNull: ['$hh.userHouseholdId', '$hh.householdId'] },
        'household.totalAccountValue': '$hh.totalAccountValue',
        'household.redtailFamilyId': '$hh.redtailFamilyId',
        'household.servicingLeadAdvisor.name': {
          $cond: [
            { $ifNull: ['$sv._id', false] },
            { $concat: [{ $ifNull: ['$sv.firstName',''] }, ' ', { $ifNull: ['$sv.lastName',''] }] },
            ''
          ]
        },
        'household.writingLeadAdvisor.name': {
          $cond: [
            { $ifNull: ['$wv._id', false] },
            { $concat: [{ $ifNull: ['$wv.firstName',''] }, ' ', { $ifNull: ['$wv.lastName',''] }] },
            ''
          ]
        },
        householdId: { $ifNull: ['$hh.userHouseholdId', '$hh.householdId'] }
      }
    }
  );
}


      // Owner computations if requested
      if (columns.includes('accountOwnerId') || columns.includes('accountOwnerName')) {
        lookups.push(
          { $addFields: { ownerIds: { $ifNull: ['$accountOwner', []] } } },
          { $lookup:   { from: 'clients', localField: 'ownerIds', foreignField: '_id', as: 'oc' } },
          { $addFields: {
              ownerCount: { $size: '$oc' },
              firstOwner: { $cond: [{ $gt: [{ $size: '$oc' }, 0] }, { $arrayElemAt: ['$oc', 0] }, null] }
            }
          },
          { $addFields: {
              accountOwnerId: {
                $cond: [{ $gt: ['$ownerCount', 0] }, { $ifNull: ['$firstOwner.clientId', ''] }, '' ]
              },
              accountOwnerName: {
                $cond: [
                  { $gt: ['$ownerCount', 1] },
                  'Joint',
                  { $cond: [
                      { $eq: ['$ownerCount', 1] },
                      { $trim: { input: { $concat: [
                        { $ifNull: ['$firstOwner.lastName', ''] }, ', ',
                        { $ifNull: ['$firstOwner.firstName', ''] }
                      ] } } },
                      { $ifNull: ['$accountOwnerName', ''] }
                    ]
                  }
                ]
              }
            }
          }
        );
      }

      // Final projection
      project = { _id: 1 };
      for (const colId of columns) {
        project[colId] = '$' + colId;
      }
      break;

    // -------------------------------------------------------------------
    // CONTACTS
    // -------------------------------------------------------------------
    case 'contacts':
      model = Client;
      base.push({ $match: { ...matchFirm } });
      if (Array.isArray(householdIds) && householdIds.length) {
        base.push({ $match: { household: { $in: householdIds } } });
      }
            if (Object.keys(global).length) base.push({ $match: global });
            // Split typed filters so household.* and householdId get applied AFTER lookup
            {
              const { typedHh: _typedHhContacts, typedOther: _typedOtherContacts } = splitTypedFilters(typed);
              var __typedHhContacts = _typedHhContacts || {};
              var __typedFlatHhIdContacts = (typed && Object.prototype.hasOwnProperty.call(typed, 'householdId'))
                ? { householdId: typed.householdId }
          : {};
          // NEW: defer flat marginalTaxBracket filter until after HH lookup
    var __typedFlatHhExtraContacts = {};
    if (typed && Object.prototype.hasOwnProperty.call(typed, 'marginalTaxBracket')) {
      __typedFlatHhExtraContacts.marginalTaxBracket = typed.marginalTaxBracket;
    }
        if (Object.keys(_typedOtherContacts || {}).length) base.push({ $match: _typedOtherContacts });
      }

// AFTER: household fallback + flat alias
// --- CONTACTS: Household + platform lead advisor override ---
const needHHContacts =
  needHouseholdData(columns, typed) ||
  columns.includes('householdId') ||
  Object.prototype.hasOwnProperty.call(typed || {}, 'householdId') ||
  columns.includes('leadAdvisor') ||
  columns.includes('marginalTaxBracket') ||
  columns.includes('marginalTaxBracketPct') ||
  columns.includes('household.marginalTaxBracket');

if (needHHContacts) {
  lookups.push(
    // Household (join by client.household OR by hh.headOfHousehold == client._id)
    {
      $lookup: {
        from: 'households',
        let: { hhRef: '$household', cid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  { $eq: ['$_id', '$$hhRef'] },
                  { $eq: ['$headOfHousehold', '$$cid'] }
                ]
              }
            }
          }
        ],
        as: 'hh'
      }
    },
    { $unwind: { path: '$hh', preserveNullAndEmptyArrays: true } },

    // ── Normalize advisor IDs and support BOTH 'leadAdvisors' (current) AND 'advisors' (legacy) ──
    {
      $addFields: {
        svId: {
          $cond: [
            { $eq: [{ $type: '$hh.servicingLeadAdvisor' }, 'objectId'] },
            '$hh.servicingLeadAdvisor',
            { $convert: { input: '$hh.servicingLeadAdvisor', to: 'objectId', onError: null, onNull: null } }
          ]
        },
        wvId: {
          $cond: [
            { $eq: [{ $type: '$hh.writingLeadAdvisor' }, 'objectId'] },
            '$hh.writingLeadAdvisor',
            { $convert: { input: '$hh.writingLeadAdvisor', to: 'objectId', onError: null, onNull: null } }
          ]
        },
        // Combine normalized arrays: leadAdvisors (new) + advisors (legacy)
        ladIds: {
          $filter: {
            input: {
              $setUnion: [
                {
                  $map: {
                    input: { $ifNull: ['$hh.leadAdvisors', []] },
                    as: 'id',
                    in: {
                      $cond: [
                        { $eq: [{ $type: '$$id' }, 'objectId'] }, '$$id',
                        { $convert: { input: '$$id', to: 'objectId', onError: null, onNull: null } }
                      ]
                    }
                  }
                },
                {
                  $map: {
                    input: { $ifNull: ['$hh.advisors', []] }, // legacy field support
                    as: 'id',
                    in: {
                      $cond: [
                        { $eq: [{ $type: '$$id' }, 'objectId'] }, '$$id',
                        { $convert: { input: '$$id', to: 'objectId', onError: null, onNull: null } }
                      ]
                    }
                  }
                }
              ]
            },
            as: 'x',
            cond: { $ne: ['$$x', null] }
          }
        }
      }
    },

    // Resolve platform advisor documents
    { $lookup: { from: 'users', localField: 'svId',  foreignField: '_id', as: 'sv' } },
    { $unwind: { path: '$sv', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'users', localField: 'wvId',  foreignField: '_id', as: 'wv' } },
    { $unwind: { path: '$wv', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'users', localField: 'ladIds', foreignField: '_id', as: 'lad' } },
    {
      $addFields: {
        firstLad: {
          $cond: [
            { $gt: [{ $size: '$lad' }, 0] },
            { $arrayElemAt: ['$lad', 0] },
            null
          ]
        }
      }
    },

    // Materialize Household ID (nested + flat alias) + marginal tax bracket + leadAdvisor display
    {
      $addFields: {
        'household.userHouseholdId': { $ifNull: ['$hh.userHouseholdId', '$hh.householdId'] },
        householdId:                 { $ifNull: ['$hh.userHouseholdId', '$hh.householdId'] },

        // Surface HH marginal tax bracket (nested + flat)
        'household.marginalTaxBracket': '$hh.marginalTaxBracket',
        marginalTaxBracket:             '$hh.marginalTaxBracket',
        marginalTaxBracketPct: {
          $cond: [
            {
              $and: [
                { $ne: ['$hh.marginalTaxBracket', null] },
                { $ne: ['$hh.marginalTaxBracket', '' ] }
              ]
            },
            { $concat: [ { $toString: '$hh.marginalTaxBracket' }, '%' ] },
            ''
          ]
        },

        // Lead advisor precedence:
        // 1) Servicing (platform)  2) Writing (platform)
        // 3) First of (leadAdvisors ∪ advisors)
        // 4) Imported client strings (last/first)
        leadAdvisor: {
          $let: {
            vars: {
              nameSv: {
                $trim: {
                  input: {
                    $concat: [
                      { $ifNull: ['$sv.lastName',''] },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: [{ $ifNull: ['$sv.lastName',''] }, '' ] },
                              { $ne: [{ $ifNull: ['$sv.firstName',''] }, '' ] }
                            ]
                          },
                          ', ',
                          ''
                        ]
                      },
                      { $ifNull: ['$sv.firstName',''] }
                    ]
                  }
                }
              },
              nameWv: {
                $trim: {
                  input: {
                    $concat: [
                      { $ifNull: ['$wv.lastName',''] },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: [{ $ifNull: ['$wv.lastName',''] }, '' ] },
                              { $ne: [{ $ifNull: ['$wv.firstName',''] }, '' ] }
                            ]
                          },
                          ', ',
                          ''
                        ]
                      },
                      { $ifNull: ['$wv.firstName',''] }
                    ]
                  }
                }
              },
              nameL0: {
                $trim: {
                  input: {
                    $concat: [
                      { $ifNull: ['$firstLad.lastName',''] },
                      {
                        $cond: [
                          {
                            $and: [
                              { $ne: [{ $ifNull: ['$firstLad.lastName',''] }, '' ] },
                              { $ne: [{ $ifNull: ['$firstLad.firstName',''] }, '' ] }
                            ]
                          },
                          ', ',
                          ''
                        ]
                      },
                      { $ifNull: ['$firstLad.firstName',''] }
                    ]
                  }
                }
              },
              nameImport: {
                $trim: {
                  input: {
                    $cond: [
                      {
                        $and: [
                          { $ne: [{ $ifNull: ['$leadAdvisorLastName',''] }, '' ] },
                          { $ne: [{ $ifNull: ['$leadAdvisorFirstName',''] }, '' ] }
                        ]
                      },
                      {
                        $concat: [
                          { $ifNull: ['$leadAdvisorLastName',''] },
                          ', ',
                          { $ifNull: ['$leadAdvisorFirstName',''] }
                        ]
                      },
                      {
                        $concat: [
                          { $ifNull: ['$leadAdvisorLastName',''] },
                          { $ifNull: ['$leadAdvisorFirstName',''] }
                        ]
                      }
                    ]
                  }
                }
              }
            },
            in: {
              $cond: [
                { $ifNull: ['$sv._id', false] }, '$$nameSv',
                {
                  $cond: [
                    { $ifNull: ['$wv._id', false] }, '$$nameWv',
                    {
                      $cond: [
                        { $gt: [{ $size: '$lad' }, 0] }, '$$nameL0',
                        '$$nameImport'
                      ]
                    }
                  ]
                }
              ]
            }
          }
        }
      }
    }
  );

  // Apply any deferred HH filters now that HH fields exist
  {
    const _deferredContacts = Object.assign(
      {},
      __typedHhContacts || {},
      __typedFlatHhIdContacts || {},
      __typedFlatHhExtraContacts || {}
    );
    if (Object.keys(_deferredContacts).length) lookups.push({ $match: _deferredContacts });
  }
}






      project = { _id: 1 };
      for (const colId of columns) {
        switch (colId) {
          case 'clientName':
            project[colId] = {
              $trim: { input: { $concat: [
                { $ifNull: ['$lastName',''] }, ', ',
                { $ifNull: ['$firstName',''] }
              ] } }
            };
            break;
          default:
            project[colId] = '$' + colId;
        }
      }
      break;

    // -------------------------------------------------------------------
    // INSURANCE
    // -------------------------------------------------------------------
// -------------------------------------------------------------------
// INSURANCE — use stored household or fall back to ownerClient.household
// -------------------------------------------------------------------
case 'insurance':
  model = Insurance;

  base.push({ $match: { ...matchFirm } });
  if (Object.keys(global).length) base.push({ $match: global });
  if (Object.keys(typed).length)  base.push({ $match: typed });

  const needHHIns  = needLookup(columns, 'household.');
  const scopedHHIns = Array.isArray(householdIds) && householdIds.length > 0;

  // Owner client (single) -> derive __hhId
  lookups.push(
    { $lookup: { from: 'clients', localField: 'ownerClient', foreignField: '_id', as: 'oc' } },
    { $unwind: { path: '$oc', preserveNullAndEmptyArrays: true } },
    { $addFields: {
      __hhId: { $ifNull: ['$oc.household', '$household'] }
    }
  }
  
  );

  // Keep a raw copy before conversion (for debug)
if (debug) {
  lookups.push({
    $addFields: {
      ownerIdsRaw: '$ownerIds',
      __dbg_ownerIdsRawTypes: {
        $map: { input: '$ownerIds', as: 'x', in: { $type: '$$x' } }
      }
    }
  });
}

  
  // --- NEW: Surface Client ID for Insurance exports ---
if (columns.includes('clientId')) {
  lookups.push({
    $addFields: {
      clientId: { $ifNull: ['$oc.clientId', ''] }
    }
  });
}


  // Scope by derived household id
  if (scopedHHIns) {
    lookups.push({ $match: { $expr: { $in: ['$$ROOT.__hhId', householdIds] } } });
  }

  // Household ID display (+ fallback)
  if (needHHIns) {
    lookups.push(
      { $lookup: { from: 'households', localField: '__hhId', foreignField: '_id', as: 'hh' } },
      { $unwind: { path: '$hh', preserveNullAndEmptyArrays: true } },
      { $addFields: {
          'household.userHouseholdId': {
            $ifNull: ['$hh.userHouseholdId', '$hh.householdId']
          }
        }
      }
    );
  }

  // Owner/insured display (reuse oc)
  if (columns.includes('ownerClient.name')) {
    lookups.push({
      $addFields: {
        'ownerClient.name': {
          $trim: { input: { $concat: [
            { $ifNull: ['$oc.lastName',''] }, ', ',
            { $ifNull: ['$oc.firstName',''] }
          ] } }
        }
      }
    });
  }
  if (columns.includes('insuredClient.name')) {
    lookups.push(
      { $lookup: { from: 'clients', localField: 'insuredClient', foreignField: '_id', as: 'ic' } },
      { $unwind: { path: '$ic', preserveNullAndEmptyArrays: true } },
      { $addFields: {
          'insuredClient.name': {
            $trim: { input: { $concat: [
              { $ifNull: ['$ic.lastName',''] }, ', ',
              { $ifNull: ['$ic.firstName',''] }
            ] } }
          }
        }
      }
    );
  }

  project = { _id: 1 };
  for (const colId of columns) project[colId] = '$' + colId;
  break;



    // -------------------------------------------------------------------
    // LIABILITIES
    // -------------------------------------------------------------------
// -------------------------------------------------------------------
// LIABILITIES — use stored household or fall back to owners' client.household
// -------------------------------------------------------------------
case 'liabilities':
  model = Liability;

  base.push({ $match: { ...matchFirm } });
  if (Object.keys(global).length) base.push({ $match: global });
  if (Object.keys(typed).length)  base.push({ $match: typed });

  const needHHLiab  = needLookup(columns, 'household.');
  const scopedHHLiab = Array.isArray(householdIds) && householdIds.length > 0;

  // Owners -> Clients, derive __hhId
  lookups.push(
    { $addFields: { ownerIds: { $ifNull: ['$owners', []] } } },
    { $lookup:   { from: 'clients', localField: 'ownerIds', foreignField: '_id', as: 'oc' } },
    { $addFields: {
        ownerCount: { $size: '$oc' },
        firstOwner: {
          $cond: [{ $gt: [{ $size: '$oc' }, 0] }, { $arrayElemAt: ['$oc', 0] }, null]
        },
        __hhId: {
          $ifNull: [
            { $cond: [
              { $gt: [{ $size: '$oc' }, 0] },
              '$firstOwner.household',
              null
            ] },
            '$household'
          ]
        }
        
      }
    }
  );

  // Scope by derived household id
  if (scopedHHLiab) {
    lookups.push({ $match: { $expr: { $in: ['$$ROOT.__hhId', householdIds] } } });
  }

  // Household ID display
  if (needHHLiab) {
    lookups.push(
      { $lookup: { from: 'households', localField: '__hhId', foreignField: '_id', as: 'hh' } },
      { $unwind: { path: '$hh', preserveNullAndEmptyArrays: true } },
      { $addFields: {
          'household.userHouseholdId': {
            $ifNull: ['$hh.userHouseholdId', '$hh.householdId'] // fallback if userHouseholdId missing
          }
        }
      }
    );
  }

  // Owner virtuals (reuse oc/firstOwner)
  if (columns.includes('clientId') || columns.includes('liabilityOwnerName')) {
    lookups.push(
      { $addFields: {
          clientId: {
            $cond: [
              { $gt: ['$ownerCount', 0] }, { $ifNull: ['$firstOwner.clientId', ''] }, ''
            ]
          },
          liabilityOwnerName: {
            $cond: [
              { $gt: ['$ownerCount', 1] }, 'Joint',
              { $cond: [
                  { $eq: ['$ownerCount', 1] },
                  { $trim: { input: { $concat: [
                    { $ifNull: ['$firstOwner.lastName', ''] }, ', ',
                    { $ifNull: ['$firstOwner.firstName', ''] }
                  ] } } },
                  ''
                ] }
            ]
          }
        }
      }
    );
  }

  project = { _id: 1 };
  for (const colId of columns) project[colId] = '$' + colId;
  break;



    // -------------------------------------------------------------------
    // ASSETS (NEW)
    // -------------------------------------------------------------------
// -------------------------------------------------------------------
// ASSETS — derive household from owners -> clients -> household
// -------------------------------------------------------------------
case 'assets':
  model = Asset;

  // Firm + search
  base.push({ $match: { ...matchFirm } });
  if (Object.keys(global).length) base.push({ $match: global });

  // Split typed filters so we can apply HH-related ones AFTER we materialize them
  {
    const { typedHh, typedOther } = splitTypedFilters(typed);
    // Keep for later
    var _typedHhAssets = typedHh || {};
    // Defer a flat householdId filter too (if present)
    var _typedFlatHhId = (typed && Object.prototype.hasOwnProperty.call(typed, 'householdId'))
      ? { householdId: typed.householdId }
      : {};
    // Apply non-household filters now
    if (Object.keys(typedOther || {}).length) base.push({ $match: typedOther });
  }

  // Decide whether we must materialize household.* (also trigger on flat 'householdId')
  const needHHAssets =
    needHouseholdData(columns, typed) ||
    columns.includes('householdId') ||
    Object.prototype.hasOwnProperty.call(typed || {}, 'householdId');

  // Normalize owners across legacy shapes and resolve to Client docs
  lookups.push(
    // Build ownerIds from: owners[] | owner (single) | accountOwner[]
    {
      $addFields: {
        ownerIds: {
          $let: {
            vars: {
              ownersArr:    { $ifNull: ['$owners', []] },
              ownerSingle:  {
                $cond: [
                  { $ne: [ { $ifNull: ['$owner', null] }, null ] },
                  [ '$owner' ],
                  []
                ]
              },
              acctOwnerArr: { $ifNull: ['$accountOwner', []] }
            },
            in: {
              $cond: [
                { $gt: [ { $size: '$$ownersArr' }, 0 ] }, '$$ownersArr',
                {
                  $cond: [
                    { $gt: [ { $size: '$$acctOwnerArr' }, 0 ] }, '$$acctOwnerArr',
                    '$$ownerSingle'
                  ]
                }
              ]
            }
          }
        }
      }
    },
    // Convert any string ids to ObjectIds and drop malformed entries
// Convert only strings to ObjectIds; keep existing ObjectIds as-is; drop malformed
{
  $addFields: {
    ownerIds: {
      $filter: {
        input: {
          $map: {
            input: '$ownerIds',
            as: 'oid',
            in: {
              $cond: [
                { $eq: [{ $type: '$$oid' }, 'objectId'] },
                // already an ObjectId -> keep it
                '$$oid',
                // string -> try to convert; anything else -> null (to be filtered out)
                {
                  $convert: {
                    input: '$$oid',
                    to: 'objectId',
                    onError: null,
                    onNull: null
                  }
                }
              ]
            }
          }
        },
        as: 'oid2',
        cond: { $ne: ['$$oid2', null] }
      }
    }
  }
}
,
    { $lookup: { from: 'clients', localField: 'ownerIds', foreignField: '_id', as: 'oc' } },
    {
      $addFields: {
        ownerCount: { $size: '$oc' },
        firstOwner: {
          $cond: [{ $gt: [{ $size: '$oc' }, 0] }, { $arrayElemAt: ['$oc', 0] }, null]
        },
        // Effective household id (even when Asset docs don't store a 'household' field)
        __hhId: {
          $ifNull: [
            '$household', // in case some docs have it
            {
              $cond: [
                { $gt: [{ $size: '$oc' }, 0] },
                '$firstOwner.household',
                null
              ]
            }
          ]
        }
      }
    }
  );

  // Scope by derived household id when the request is household-scoped
  if (Array.isArray(householdIds) && householdIds.length) {
    lookups.push({ $match: { $expr: { $in: ['$$ROOT.__hhId', householdIds] } } });
  }

  // Materialize Household ID display (nested + flat alias)
  if (needHHAssets) {
    lookups.push(
      { $lookup: { from: 'households', localField: '__hhId', foreignField: '_id', as: 'hh' } },
      { $unwind: { path: '$hh', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          // preferred nested path (same as liabilities/insurance)
          'household.userHouseholdId': {
            $ifNull: ['$hh.userHouseholdId', '$hh.householdId']
          },
          // flat alias for UIs/columns that use 'householdId'
          householdId: {
            $ifNull: ['$hh.userHouseholdId', '$hh.householdId']
          }
        }
      }
    );

    // Apply any deferred typed filters on HH fields now
    const _deferred = Object.assign({}, _typedHhAssets || {}, _typedFlatHhId || {});
    if (Object.keys(_deferred).length) lookups.push({ $match: _deferred });
  }

  // Owner virtuals (reuse oc/firstOwner)
  if (columns.includes('clientId') || columns.includes('assetOwnerName')) {
    lookups.push(
      {
        $addFields: {
          clientId: {
            $cond: [
              { $gt: ['$ownerCount', 0] }, { $ifNull: ['$firstOwner.clientId', ''] }, ''
            ]
          },
          assetOwnerName: {
            $cond: [
              { $gt: ['$ownerCount', 1] }, 'Joint',
              {
                $cond: [
                  { $eq: ['$ownerCount', 1] },
                  {
                    $trim: {
                      input: {
                        $concat: [
                          { $ifNull: ['$firstOwner.lastName', ''] }, ', ',
                          { $ifNull: ['$firstOwner.firstName', ''] }
                        ]
                      }
                    }
                  },
                  ''
                ]
              }
            ]
          }
        }
      }
    );
  }

  // Final projection
// Final projection
project = { _id: 1 };
for (const colId of columns) {
  project[colId] = '$' + colId;
}

// Keep flat alias available when the nested Household ID is requested
if (columns.includes('household.userHouseholdId')) {
  project['householdId'] = '$householdId';
}

break;





    // -------------------------------------------------------------------
    // BILLING (union)
    // -------------------------------------------------------------------
// -------------------------------------------------------------------
// BILLING (union: Households anchor + union Accounts)
// -------------------------------------------------------------------
case 'billing':
  model = null;

  // Pipeline for HOUSEHOLDS
  const hhBase = [{ $match: { ...matchFirm } }];
  if (Array.isArray(householdIds) && householdIds.length) {
    hhBase.push({ $match: { _id: { $in: householdIds } } });
  }
  const hhPipe = hhBase.concat([
    { $project: {
      entityType: { $literal: 'Household' },
      entityKey: '$userHouseholdId',
      entries: {
        $concatArrays: [
          { $cond: [{ $isMap: '$billing.feeByMonth' },   { $objectToArray: '$billing.feeByMonth' },   []] },
          { $cond: [{ $isMap: '$billing.feeByQuarter' }, { $objectToArray: '$billing.feeByQuarter' }, []] },
          { $cond: [{ $isMap: '$billing.feeByYear' },    { $objectToArray: '$billing.feeByYear' },    []] },
        ]
      }
    }},
    { $unwind: { path: '$entries', preserveNullAndEmptyArrays: false } },
    { $replaceRoot: {
      newRoot: {
        entityType: '$entityType',
        entityKey:  '$entityKey',
        billType:   '$entries.v.billType',
        periodType: '$entries.v.periodType',
        periodKey:  '$entries.v.periodKey',
        amount:     '$entries.v.amount',
        source:     '$entries.v.source',
        note:       '$entries.v.note',
        importedAt: '$entries.v.importedAt'
      }
    }},
    // Synthesize a stable string _id for table selection
    { $addFields: {
      _id: {
        $concat: [
          'BILL|',
          '$entityType','|',
          { $toString: { $ifNull: ['$entityKey', '' ] } }, '|',
          { $ifNull: ['$billType',   '' ] }, '|',
          { $ifNull: ['$periodType', '' ] }, '|',
          { $ifNull: ['$periodKey',  '' ] }, '|',
          { $ifNull: [ { $dateToString: { date: '$importedAt', format: '%Y-%m-%dT%H:%M:%S.%LZ' } }, '' ] }
        ]
      }
    }}
  ]);

  // Pipeline for ACCOUNTS
  const acctBase = [{ $match: { ...matchFirm } }];
  if (Array.isArray(householdIds) && householdIds.length) {
    acctBase.push({ $match: { household: { $in: householdIds } } });
  }
  const acctPipe = acctBase.concat([
    { $project: {
      entityType: { $literal: 'Account' },
      entityKey: '$accountNumber',
      entries: {
        $concatArrays: [
          { $cond: [{ $isMap: '$billing.billingByMonth' },   { $objectToArray: '$billing.billingByMonth' },   []] },
          { $cond: [{ $isMap: '$billing.billingByQuarter' }, { $objectToArray: '$billing.billingByQuarter' }, []] },
          { $cond: [{ $isMap: '$billing.billingByYear' },    { $objectToArray: '$billing.billingByYear' },    []] },
        ]
      }
    }},
    { $unwind: { path: '$entries', preserveNullAndEmptyArrays: false } },
    { $replaceRoot: {
      newRoot: {
        entityType: '$entityType',
        entityKey:  '$entityKey',
        billType:   '$entries.v.billType',
        periodType: '$entries.v.periodType',
        periodKey:  '$entries.v.periodKey',
        amount:     '$entries.v.amount',
        source:     '$entries.v.source',
        note:       '$entries.v.note',
        importedAt: '$entries.v.importedAt'
      }
    }},
    { $addFields: {
      _id: {
        $concat: [
          'BILL|',
          '$entityType','|',
          { $toString: { $ifNull: ['$entityKey', '' ] } }, '|',
          { $ifNull: ['$billType',   '' ] }, '|',
          { $ifNull: ['$periodType', '' ] }, '|',
          { $ifNull: ['$periodKey',  '' ] }, '|',
          { $ifNull: [ { $dateToString: { date: '$importedAt', format: '%Y-%m-%dT%H:%M:%S.%LZ' } }, '' ] }
        ]
      }
    }}
  ]);

  // Households anchor + union Accounts (matches controller's aggregate on Household)
  base = hhPipe;
  lookups.push({ $unionWith: { coll: 'accounts', pipeline: acctPipe } });

  if (Object.keys(global).length) base.push({ $match: global });
  if (Object.keys(typed).length)  base.push({ $match: typed });

  project = { _id: 1 };
  for (const colId of columns) project[colId] = '$' + colId;

  break;


    default:
      throw new Error('Unknown export type');
  }

  // Sorting & paging
  const sortSpec = Object.keys(sort || {}).length ? sort : { _id: 1 };
  const page = [{ $sort: sortSpec }, { $skip: skip }, { $limit: limit }];

  return {
    model,
    pipeline:      [...base, ...lookups, { $project: project }, ...page],
    countPipeline: [...base, ...lookups, { $count: 'count' }]
  };
}

module.exports = { buildListPipeline };
