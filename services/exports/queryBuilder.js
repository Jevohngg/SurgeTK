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
        { assetNumber:       { $regex: s, $options: 'i' } },
        { assetOwnerName:    { $regex: s, $options: 'i' } },
        { assetType:         { $regex: s, $options: 'i' } },
        { assetDisplayName:  { $regex: s, $options: 'i' } },
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
function buildListPipeline({ exportType, firmId, householdIds, columns, search, typedFilters, sort, skip=0, limit=100 }) {
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

      // Household lookup only if requested
      if (needLookup(columns, 'household.')) {
        lookups.push(
          { $lookup: { from: 'households', localField: 'household', foreignField: '_id', as: 'hh' } },
          { $unwind: { path: '$hh', preserveNullAndEmptyArrays: true } },
          { $lookup: { from: 'users', localField: 'hh.servicingLeadAdvisor', foreignField: '_id', as: 'sv' } },
          { $unwind: { path: '$sv', preserveNullAndEmptyArrays: true } },
          { $lookup: { from: 'users', localField: 'hh.writingLeadAdvisor', foreignField: '_id', as: 'wv' } },
          { $unwind: { path: '$wv', preserveNullAndEmptyArrays: true } },
          { $addFields: {
            'household.userHouseholdId': '$hh.userHouseholdId',
            'household.totalAccountValue': '$hh.totalAccountValue',
            'household.redtailFamilyId': '$hh.redtailFamilyId',
            'household.servicingLeadAdvisor.name': {
              $cond: [{ $ifNull: ['$sv._id', false] }, { $concat: [{ $ifNull: ['$sv.firstName',''] }, ' ', { $ifNull: ['$sv.lastName',''] }] }, '' ]
            },
            'household.writingLeadAdvisor.name': {
              $cond: [{ $ifNull: ['$wv._id', false] }, { $concat: [{ $ifNull: ['$wv.firstName',''] }, ' ', { $ifNull: ['$wv.lastName',''] }] }, '' ]
            },
          } }
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
      if (Object.keys(typed).length)  base.push({ $match: typed });

      if (needLookup(columns, 'household.')) {
        lookups.push(
          { $lookup: { from: 'households', localField: 'household', foreignField: '_id', as: 'hh' } },
          { $unwind: { path: '$hh', preserveNullAndEmptyArrays: true } },
          { $addFields: { 'household.userHouseholdId': '$hh.userHouseholdId' } }
        );
      }

      // Lead Advisor (strings on client)
// Lead Advisor: "LastName, FirstName" from strings on Client
if (columns.includes('leadAdvisor')) {
  lookups.push({
    $addFields: {
      leadAdvisor: {
        $let: {
          vars: {
            ln: { $ifNull: ['$leadAdvisorLastName',  ''] },
            fn: { $ifNull: ['$leadAdvisorFirstName', ''] }
          },
          in: {
            $trim: {
              input: {
                $cond: [
                  { $and: [ { $ne: ['$$ln',''] }, { $ne: ['$$fn',''] } ] },
                  { $concat: ['$$ln', ', ', '$$fn'] },
                  { $concat: ['$$ln', '$$fn'] } // one of them may be empty
                ]
              }
            }
          }
        }
      }
    }
  });
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
// INSURANCE (derive household from ownerClient when needed)
// -------------------------------------------------------------------
case 'insurance': {
  model = Insurance;

  const { typedHh, typedOther } = splitTypedFilters(typed);

  // Base firm scope. If user scope is by householdIds, allow legacy docs with no firmId (will restrict later).
  if (Array.isArray(householdIds) && householdIds.length) {
    base.push({ $match: { $or: [ matchFirm, { firmId: { $exists: false } } ] } });
    base.push({ $match: global });
    if (Object.keys(typedOther).length) base.push({ $match: typedOther });
  } else {
    base.push({ $match: { ...matchFirm } });
    if (Object.keys(global).length) base.push({ $match: global });
    if (Object.keys(typedOther).length) base.push({ $match: typedOther });
  }

  const mustMaterializeHH = needHouseholdData(columns, typed);

  // Owner client (single) — used both for firm fallback and HH derivation.
  // NOTE: this lookup is safe even when we don't need household.* columns
  // because we'll also use it to include legacy records by owner firm.
  lookups.push(
    { $lookup: { from: 'clients', localField: 'ownerClient', foreignField: '_id', as: 'oc' } },
    { $unwind: { path: '$oc', preserveNullAndEmptyArrays: true } }
  );

  // If firm-wide scope (no householdIds), include legacy docs by checking the owner's firm
  if (!Array.isArray(householdIds) || !householdIds.length) {
    lookups.push({ $match: { $or: [ { firmId: matchFirm.firmId }, { 'oc.firmId': matchFirm.firmId } ] } });
  }

  // Derive Household ID:
  // householdIdDerived = document.household || oc.household
  if (mustMaterializeHH) {
    lookups.push(
      { $addFields: {
          householdIdDerived: { $ifNull: ['$household', '$oc.household'] }
        }
      },
      { $lookup: { from: 'households', localField: 'householdIdDerived', foreignField: '_id', as: 'hh' } },
      { $unwind: { path: '$hh', preserveNullAndEmptyArrays: true } },
      { $addFields: { 'household.userHouseholdId': '$hh.userHouseholdId' } }
    );

    // If user scope was household-limited, enforce it now (safe for legacy docs with no firmId)
    if (Array.isArray(householdIds) && householdIds.length) {
      lookups.push({ $match: { householdIdDerived: { $in: householdIds } } });
    }

    // Apply typed filters on household.* after we've materialized those fields
    if (Object.keys(typedHh).length) lookups.push({ $match: typedHh });
  }

  // Existing extra lookups (insured name) — keep if requested
  if (needLookup(columns, 'insuredClient.')) {
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
}


    // -------------------------------------------------------------------
    // LIABILITIES
    // -------------------------------------------------------------------
// -------------------------------------------------------------------
// LIABILITIES (derive household from owners[] when needed)
// -------------------------------------------------------------------
case 'liabilities': {
  model = Liability;

  const { typedHh, typedOther } = splitTypedFilters(typed);

  // Base firm scope; allow legacy no-firmId only when we have householdIds to clamp later
  if (Array.isArray(householdIds) && householdIds.length) {
    base.push({ $match: { $or: [ matchFirm, { firmId: { $exists: false } } ] } });
  } else {
    base.push({ $match: { ...matchFirm } });
  }
  if (Object.keys(global).length) base.push({ $match: global });
  if (Object.keys(typedOther).length) base.push({ $match: typedOther });

  const mustMaterializeHH = needHouseholdData(columns, typed);

  // owners[] -> clients ("oc") for legacy firm fallback AND household derivation
  lookups.push(
    { $addFields: { ownerIds: { $ifNull: ['$owners', []] } } },
    { $lookup:   { from: 'clients', localField: 'ownerIds', foreignField: '_id', as: 'oc' } }
  );

  // If firm-wide scope, include legacy docs whose owner client belongs to this firm
  if (!Array.isArray(householdIds) || !householdIds.length) {
    lookups.push({ $match: { $or: [ { firmId: matchFirm.firmId }, { 'oc.firmId': matchFirm.firmId } ] } });
  }

  if (mustMaterializeHH) {
    // Derive: prefer document.household, else first non-null household from owners' clients
    lookups.push(
      { $addFields: {
          ownerHouseholds: { $map: { input: '$oc', as: 'c', in: '$$c.household' } }
        }
      },
      { $addFields: {
          householdIdDerived: {
            $ifNull: [
              '$household',
              { $first: { $filter: { input: '$ownerHouseholds', as: 'h', cond: { $ne: ['$$h', null] } } } }
            ]
          }
        }
      },
      { $lookup: { from: 'households', localField: 'householdIdDerived', foreignField: '_id', as: 'hh' } },
      { $unwind: { path: '$hh', preserveNullAndEmptyArrays: true } },
      { $addFields: { 'household.userHouseholdId': '$hh.userHouseholdId' } }
    );

    if (Array.isArray(householdIds) && householdIds.length) {
      lookups.push({ $match: { householdIdDerived: { $in: householdIds } } });
    }

    if (Object.keys(typedHh).length) lookups.push({ $match: typedHh });
  }

  // Owner-derived display fields (Client ID + "Joint"/"Last, First") if requested
  if (columns.includes('clientId') || columns.includes('liabilityOwnerName')) {
    lookups.push(
      { $addFields: {
          ownerCount: { $size: '$oc' },
          firstOwner: { $cond: [{ $gt: [{ $size: '$oc' }, 0] }, { $arrayElemAt: ['$oc', 0] }, null] }
        }
      },
      { $addFields: {
          clientId: {
            $cond: [{ $gt: ['$ownerCount', 0] }, { $ifNull: ['$firstOwner.clientId', ''] }, '' ]
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
                ]
              }
            ]
          }
        }
      }
    );
  }

  project = { _id: 1 };
  for (const colId of columns) project[colId] = '$' + colId;
  break;
}


    // -------------------------------------------------------------------
    // ASSETS (NEW)
    // -------------------------------------------------------------------
// -------------------------------------------------------------------
// ASSETS (derive household from owners[]; model has no household field)
// -------------------------------------------------------------------
case 'assets': {
  model = Asset;

  const { typedHh, typedOther } = splitTypedFilters(typed);

  // Base firm scope; allow legacy no-firmId only when we have householdIds to clamp later
  if (Array.isArray(householdIds) && householdIds.length) {
    base.push({ $match: { $or: [ matchFirm, { firmId: { $exists: false } } ] } });
  } else {
    base.push({ $match: { ...matchFirm } });
  }
  if (Object.keys(global).length) base.push({ $match: global });
  if (Object.keys(typedOther).length) base.push({ $match: typedOther });

  const mustMaterializeHH = needHouseholdData(columns, typed);

  // owners[] -> clients ("oc") for firm fallback and household derivation
  lookups.push(
    { $addFields: { ownerIds: { $ifNull: ['$owners', []] } } },
    { $lookup:   { from: 'clients', localField: 'ownerIds', foreignField: '_id', as: 'oc' } }
  );

  // If firm-wide scope, include legacy docs whose owner client belongs to this firm
  if (!Array.isArray(householdIds) || !householdIds.length) {
    lookups.push({ $match: { $or: [ { firmId: matchFirm.firmId }, { 'oc.firmId': matchFirm.firmId } ] } });
  }

  if (mustMaterializeHH) {
    lookups.push(
      { $addFields: { ownerHouseholds: { $map: { input: '$oc', as: 'c', in: '$$c.household' } } } },
      { $addFields: {
          householdIdDerived: { $first: { $filter: { input: '$ownerHouseholds', as: 'h', cond: { $ne: ['$$h', null] } } } }
        }
      },
      { $lookup: { from: 'households', localField: 'householdIdDerived', foreignField: '_id', as: 'hh' } },
      { $unwind: { path: '$hh', preserveNullAndEmptyArrays: true } },
      { $addFields: { 'household.userHouseholdId': '$hh.userHouseholdId' } }
    );

    if (Array.isArray(householdIds) && householdIds.length) {
      lookups.push({ $match: { householdIdDerived: { $in: householdIds } } });
    }

    if (Object.keys(typedHh).length) lookups.push({ $match: typedHh });
  }

  // Owner-derived display fields if requested
  if (columns.includes('clientId') || columns.includes('assetOwnerName')) {
    lookups.push(
      { $addFields: {
          ownerCount: { $size: '$oc' },
          firstOwner: { $cond: [{ $gt: [{ $size: '$oc' }, 0] }, { $arrayElemAt: ['$oc', 0] }, null] }
        }
      },
      { $addFields: {
          clientId: {
            $cond: [{ $gt: ['$ownerCount', 0] }, { $ifNull: ['$firstOwner.clientId', ''] }, '' ]
          },
          assetOwnerName: {
            $cond: [
              { $gt: ['$ownerCount', 1] }, 'Joint',
              { $cond: [
                  { $eq: ['$ownerCount', 1] },
                  { $trim: { input: { $concat: [
                    { $ifNull: ['$firstOwner.lastName', ''] }, ', ',
                    { $ifNull: ['$firstOwner.firstName', ''] }
                  ] } } },
                  ''
                ]
              }
            ]
          }
        }
      }
    );
  }

  project = { _id: 1 };
  for (const colId of columns) project[colId] = '$' + colId;
  break;
}


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
