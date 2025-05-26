// controllers/assetsController.js
const mongoose = require('mongoose');
const Asset = require('../models/Asset');
const Client = require('../models/Client');

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

    // We'll allow the user to sort by "owner.firstName", "assetType", or "assetValue",
    // as well as the default "assetNumber"
    const validSortFields = ['assetNumber', 'owner.firstName', 'assetType', 'assetValue'];
    if (!validSortFields.includes(sortField)) {
      sortField = 'assetNumber'; // fallback to default
    }
    const sort = { [sortField]: sortOrder === 'asc' ? 1 : -1 };

    // 1) Find all clients in the household
    const clientDocs = await Client.find({ household: householdId }, '_id');
    const clientIds = clientDocs.map(c => c._id);

    // 2) Base query for all assets belonging to those clients
    const q = { owner: { $in: clientIds } };

    // 3) If there's a search term, allow searching by:
    //    - Owner name (firstName/lastName)
    //    - assetType (regex)
    //    - assetNumber (regex)
    //    - assetValue (numeric exact match)
    if (search) {
      const term = new RegExp(search, 'i');
      let numericVal = parseFloat(search);
      if (Number.isNaN(numericVal)) {
        numericVal = null;
      }

      // Find clients matching the name within this household
      const matchingOwners = await Client.find({
        _id: { $in: clientIds },
        $or: [
          { firstName: { $regex: term } },
          { lastName: { $regex: term } }
        ]
      }).select('_id');

      const matchingOwnerIds = matchingOwners.map(o => o._id);

      const orClauses = [
        { assetType: term },
        { assetNumber: term }
      ];

      if (numericVal !== null) {
        orClauses.push({ assetValue: numericVal });
      }
      if (matchingOwnerIds.length > 0) {
        orClauses.push({ owner: { $in: matchingOwnerIds } });
      }

      q.$or = orClauses;
    }

    // 4) Fetch paginated assets
    const [total, assets] = await Promise.all([
      Asset.countDocuments(q),
      Asset.find(q)
        // Because we can sort by "owner.firstName",
        // we need a special syntax for Mongoose:
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('owner', 'firstName lastName')
        .lean()
    ]);

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
// POST /api/households/:householdId/assets
exports.createAsset = async (req, res) => {
  try {
    const { householdId } = req.params;
    const { owner, assetType, assetNumber, assetValue } = req.body;
    const asset = new Asset({ owner, assetType, assetNumber, assetValue });
    await asset.save();
    return res.json({ message: 'Asset created successfully.', asset });
  } catch (err) {
    console.error(err);

    // Handle duplicate-key (11000) on assetNumber
    if (err.code === 11000 && err.keyPattern?.assetNumber) {
      return res
        .status(400)
        .json({ message: `An asset with number "${err.keyValue.assetNumber}" already exists.` });
    }

    // Other validation or server errors
    return res
      .status(500)
      .json({ message: err.message || 'Server error creating asset.' });
  }
};


// GET /api/assets/:id
exports.getAssetById = async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id)
      .populate('owner', 'firstName lastName')
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
    const updates = req.body;
    const asset = await Asset.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found.' });
    }
    res.json({ message: 'Asset updated successfully.', asset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error updating asset.' });
  }
};

// DELETE /api/assets/:id
exports.deleteAsset = async (req, res) => {
  try {
    await Asset.findByIdAndDelete(req.params.id);
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
    await Asset.deleteMany({ _id: { $in: assetIds } });
    res.json({ message: 'Selected assets deleted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error bulk deleting assets.' });
  }
};
