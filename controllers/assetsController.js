// controllers/assetsController.js
'use strict';

const mongoose = require('mongoose');
const Asset = require('../models/Asset');
const Client = require('../models/Client');
const ValueAdd = require('../models/ValueAdd');                // <-- for NET_WORTH refresh
const ValueAddController = require('./valueAddController');    // <-- for updater

// GET /api/households/:householdId/assets
exports.getAssets = async (req, res) => {
  try {
    const { householdId } = req.params;
    let {
      page = 1,
      limit = 10,
      search = '',
      sortField = 'assetNumber',
      sortOrder = 'asc'
    } = req.query;

    page = parseInt(page, 10);
    limit = limit === 'all' ? 0 : parseInt(limit, 10);
    const skip = limit > 0 ? (page - 1) * limit : 0;
    const order = sortOrder === 'asc' ? 1 : -1;

    // We’ll allow sorting by owner first/last name via aggregation.
    const validSortFields = ['assetNumber', 'assetType', 'assetValue', 'owners.firstName', 'owners.lastName', 'assetName'];
    if (!validSortFields.includes(sortField)) sortField = 'assetNumber';

    // 1) Find all clients in the household
    const clientDocs = await Client.find({ household: householdId }, '_id');
    const clientIds = clientDocs.map(c => c._id);

    // 2) Base query
    const q = { owners: { $in: clientIds } };

    // 3) Search
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const term = new RegExp(escaped, 'i');

      let numericVal = Number.isFinite(parseFloat(search)) ? parseFloat(search) : null;

      const matchingOwners = await Client.find({
        _id: { $in: clientIds },
        $or: [{ firstName: term }, { lastName: term }]
      }).select('_id');

      const matchingOwnerIds = matchingOwners.map(o => o._id);

      const orClauses = [
        { assetType: term },
        { assetName: term },
        { assetNumber: term },
      ];
      if (numericVal !== null) orClauses.push({ assetValue: numericVal });
      if (matchingOwnerIds.length) orClauses.push({ owners: { $in: matchingOwnerIds } });

      q.$or = orClauses;
    }

    // 4) Fetch assets (aggregation when sorting by owner name)
    let assets, total;
    if (sortField.startsWith('owners.')) {
      const nameKey = sortField.split('.')[1]; // firstName or lastName
      const pipeline = [
        { $match: q },
        {
          $lookup: {
            from: 'clients',
            localField: 'owners',
            foreignField: '_id',
            as: 'owners'
          }
        },
        { $unwind: '$owners' },
        { $sort: { [`owners.${nameKey}`]: order } },
        ...(skip ? [{ $skip: skip }] : []),
        ...(limit > 0 ? [{ $limit: limit }] : []),
        // keep fields as-is; we'll send owners as array with a single owner for display parity
      ];

      [assets, total] = await Promise.all([
        Asset.aggregate(pipeline),
        Asset.countDocuments(q)
      ]);

      assets = assets.map(a => ({
        ...a,
        owners: [{
          _id:       a.owners._id,
          firstName: a.owners.firstName,
          lastName:  a.owners.lastName
        }]
      }));
    } else {
      [total, assets] = await Promise.all([
        Asset.countDocuments(q),
        Asset.find(q)
          .sort({ [sortField]: order })
          .skip(skip)
          .limit(limit)
          .populate('owners', 'firstName lastName')
          .lean()
      ]);
    }

    const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
    res.json({
      assets,
      totalAssets: total,
      currentPage: page,
      totalPages
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching assets.' });
  }
};

// POST /api/households/:householdId/assets
exports.createAsset = async (req, res) => {
  try {
    const { householdId } = req.params;
    let { owner } = req.body;
    const { assetType, assetName, assetNumber, assetValue } = req.body;

    // "joint" => all members of household
    if (owner === 'joint') {
      const clients = await Client.find({ household: householdId }, '_id');
      owner = clients.map(c => c._id);
    } else {
      owner = [ new mongoose.Types.ObjectId(owner) ];
    }

    const asset = new Asset({
      owners: owner,
      assetType,
      assetName,
      assetNumber,
      assetValue
    });

    // attach context for audit log (create)
    asset.$locals = asset.$locals || {};
    asset.$locals.activityCtx = req.activityCtx;

    await asset.save();

    // Refresh NET_WORTH value add
    try {
      const netWorthVA = await ValueAdd.findOne({ household: householdId, type: 'NET_WORTH' });
      if (netWorthVA) {
        await ValueAddController.updateNetWorthValueAdd(
          { params: { id: netWorthVA._id } },
          { status: () => ({ json: () => {} }), json: () => {} }
        );
      }
    } catch (e) {
      console.error('Failed to auto-update Net Worth ValueAdd:', e);
    }

    return res.json({ message: 'Asset created successfully.', asset });
  } catch (err) {
    console.error(err);

    if (err.code === 11000 && err.keyPattern?.assetNumber) {
      return res
        .status(400)
        .json({ message: `An asset with number "${err.keyValue.assetNumber}" already exists.` });
    }

    return res
      .status(500)
      .json({ message: err.message || 'Server error creating asset.' });
  }
};

// GET /api/assets/:id
exports.getAssetById = async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id)
      .populate('owners', 'firstName lastName')
      .lean();

    if (!asset) {
      return res.status(404).json({ message: 'Asset not found.' });
    }
    res.json(asset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PUT /api/assets/:id
exports.updateAsset = async (req, res) => {
  try {
    const { id } = req.params;

    // Determine owners update (if provided)
    const updates = { ...req.body };
    if ('owner' in updates) {
      if (updates.owner === 'joint') {
        // get household from an existing owner
        const existing = await Asset.findById(id).lean();
        if (!existing) return res.status(404).json({ message: 'Asset not found.' });

        // determine household via any owner on this asset
        const anyOwner = existing.owners?.[0];
        let householdId = null;
        if (anyOwner) {
          const ownerDoc = await Client.findById(anyOwner).select('household').lean();
          householdId = ownerDoc?.household || null;
        }

        if (!householdId) {
          return res.status(400).json({ message: 'Unable to resolve household for joint assignment.' });
        }

        const clients = await Client.find({ household: householdId }, '_id').lean();
        updates.owners = clients.map(c => c._id);
      } else if (updates.owner) {
        updates.owners = [ new mongoose.Types.ObjectId(updates.owner) ];
      }
      delete updates.owner;
    }

    const assetDoc = await Asset.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true, activityCtx: req.activityCtx } // <-- audit context
    );

    if (!assetDoc) {
      return res.status(404).json({ message: 'Asset not found.' });
    }

    // Refresh NET_WORTH value add (resolve household from any owner)
    try {
      const anyOwner = assetDoc.owners?.[0];
      if (anyOwner) {
        const ownerDoc = await Client.findById(anyOwner).select('household').lean();
        if (ownerDoc?.household) {
          const netWorthVA = await ValueAdd.findOne({
            household: ownerDoc.household,
            type: 'NET_WORTH'
          });
          if (netWorthVA) {
            await ValueAddController.updateNetWorthValueAdd(
              { params: { id: netWorthVA._id } },
              { status: () => ({ json: () => {} }), json: () => {} }
            );
          }
        }
      }
    } catch (e) {
      console.error('Failed to auto-update Net Worth ValueAdd:', e);
    }

    res.json({ message: 'Asset updated successfully.', asset: assetDoc.toObject() });
  } catch (err) {
    console.error('updateAsset error:', err);
    res.status(500).json({ message: 'Error updating asset.' });
  }
};

// DELETE /api/assets/:id
exports.deleteAsset = async (req, res) => {
  try {
    const { id } = req.params;

    // find household (for value add refresh) before/after deletion
    let householdId = null;
    const existing = await Asset.findById(id).lean();
    if (existing?.owners?.length) {
      const ownerDoc = await Client.findById(existing.owners[0]).select('household').lean();
      householdId = ownerDoc?.household || null;
    }

    await Asset.findByIdAndDelete(id, { activityCtx: req.activityCtx }); // <-- audit context

    // refresh NET_WORTH value add
    try {
      if (householdId) {
        const netWorthVA = await ValueAdd.findOne({ household: householdId, type: 'NET_WORTH' });
        if (netWorthVA) {
          await ValueAddController.updateNetWorthValueAdd(
            { params: { id: netWorthVA._id } },
            { status: () => ({ json: () => {} }), json: () => {} }
          );
        }
      }
    } catch (e) {
      console.error('Failed to auto-update Net Worth ValueAdd:', e);
    }

    res.json({ message: 'Asset deleted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error deleting asset.' });
  }
};

// DELETE /api/assets/bulk-delete
exports.bulkDeleteAssets = async (req, res) => {
  try {
    const { assetIds } = req.body;
    if (!Array.isArray(assetIds) || assetIds.length === 0) {
      return res.status(400).json({ message: 'No assetIds provided.' });
    }

    // Collect households impacted, then delete one-by-one so each delete is logged
    const assets = await Asset.find({ _id: { $in: assetIds } }).select('_id owners').lean();

    const hhSet = new Set();
    for (const a of assets) {
      const firstOwner = a.owners?.[0];
      if (firstOwner) {
        const ownerDoc = await Client.findById(firstOwner).select('household').lean();
        if (ownerDoc?.household) hhSet.add(ownerDoc.household.toString());
      }
    }

    for (const _id of assetIds) {
      await Asset.findOneAndDelete({ _id }, { activityCtx: req.activityCtx });
    }

    // Refresh NET_WORTH once per household
    try {
      for (const household of hhSet) {
        const netWorthVA = await ValueAdd.findOne({ household, type: 'NET_WORTH' });
        if (netWorthVA) {
          await ValueAddController.updateNetWorthValueAdd(
            { params: { id: netWorthVA._id } },
            { status: () => ({ json: () => {} }), json: () => {} }
          );
        }
      }
    } catch (e) {
      console.error('Failed to auto-update Net Worth ValueAdd (bulk):', e);
    }

    res.json({ message: 'Selected assets deleted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error bulk deleting assets.' });
  }
};
