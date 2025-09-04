// controllers/liabilitiesController.js
'use strict';

const mongoose = require('mongoose');
const Liability = require('../models/Liability');
const Client = require('../models/Client');
const ValueAdd = require('../models/ValueAdd');                // <-- fix: import
const ValueAddController = require('./valueAddController');

// GET /api/households/:householdId/liabilities
exports.getLiabilities = async (req, res) => {
  try {
    const { householdId } = req.params;
    let {
      page = 1,
      limit = 10,
      search = '',
      sortField = 'creditorName',
      sortOrder = 'asc'
    } = req.query;

    page = parseInt(page, 10);
    limit = limit === 'all' ? 0 : parseInt(limit, 10);
    const skip = limit > 0 ? (page - 1) * limit : 0;
    const order = sortOrder === 'asc' ? 1 : -1;

    // 1) Find all client IDs in this household
    const clientDocs = await Client.find({ household: householdId }, '_id');
    const clientIds = clientDocs.map(c => c._id);

    // 2) Build the base match
    const match = { owners: { $in: clientIds } };

    // 3) Handle search (with escaping)
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const term = new RegExp(escaped, 'i');

      // find matching owners
      const ownerMatches = await Client.find({
        _id: { $in: clientIds },
        $or: [{ firstName: term }, { lastName: term }]
      }, '_id');
      const ownerIds = ownerMatches.map(o => o._id);

      match.$or = [
        { creditorName: term },
        { liabilityType: term },
        { liabilityName: term },
        { accountLoanNumber: term }
      ];
      if (ownerIds.length) match.$or.push({ owners: { $in: ownerIds } });
    }

    // 4) Decide whether to use simple find or aggregation
    let liabilities, total;
    if (sortField === 'owners.firstName' || sortField === 'owners.lastName') {
      const nameKey = sortField.split('.')[1]; // "firstName" or "lastName"
      const pipeline = [
        { $match: match },
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
      ];

      [liabilities, total] = await Promise.all([
        Liability.aggregate(pipeline),
        Liability.countDocuments(match)
      ]);

      liabilities = liabilities.map(l => ({
        ...l,
        owners: [{
          _id:       l.owners._id,
          firstName: l.owners.firstName,
          lastName:  l.owners.lastName
        }],
      }));
    } else {
      const valid = [
        'creditorName','liabilityType','accountLoanNumber', 'liabilityName',
        'outstandingBalance','interestRate','monthlyPayment'
      ];
      if (!valid.includes(sortField)) sortField = 'creditorName';

      [total, liabilities] = await Promise.all([
        Liability.countDocuments(match),
        Liability.find(match)
          .sort({ [sortField]: order })
          .skip(skip)
          .limit(limit)
          .populate('owners','firstName lastName')
          .lean()
      ]);
    }

    const totalPages = limit > 0 ? Math.ceil(total / limit) : 1;
    return res.json({
      liabilities,
      totalLiabilities: total,
      currentPage: page,
      totalPages
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error fetching liabilities.' });
  }
};

// POST /api/households/:householdId/liabilities
// POST /api/households/:householdId/liabilities
exports.createLiability = async (req, res) => {
  try {
    const {
      owner,                // single client _id or 'joint'
      liabilityType,
      liabilityName,
      creditorName,
      accountLoanNumber,
      outstandingBalance,
      interestRate,
      monthlyPayment,
      estimatedPayoffDate
    } = req.body;

    const { householdId } = req.params;

    let owners = [];
    let firmId;

    if (owner === 'joint') {
      // include every client in this household and derive firmId
      const clients = await Client
        .find({ household: householdId }, '_id firmId')
        .lean();

      if (!clients.length) {
        return res.status(400).json({ message: 'No clients found in this household.' });
      }

      const distinctFirmIds = [...new Set(clients.map(c => c.firmId?.toString()).filter(Boolean))];
      if (distinctFirmIds.length > 1) {
        return res.status(400).json({ message: 'Household members belong to different firms; cannot determine firmId.' });
      }

      owners = clients.map(c => c._id);
      firmId = clients[0].firmId;
    } else {
      const ownerId = new mongoose.Types.ObjectId(owner);
      const ownerDoc = await Client.findById(ownerId).select('_id firmId household').lean();
      if (!ownerDoc) {
        return res.status(400).json({ message: 'Owner not found.' });
      }
      if (ownerDoc.household?.toString() !== String(householdId)) {
        return res.status(400).json({ message: 'Owner does not belong to this household.' });
      }
      if (!ownerDoc.firmId) {
        return res.status(400).json({ message: 'Unable to resolve firmId from owner.' });
      }

      owners = [ownerId];
      firmId = ownerDoc.firmId;
    }

    if (!firmId) {
      return res.status(400).json({ message: 'Unable to resolve firmId for this liability.' });
    }

    const liab = new Liability({
      firmId,
      household: householdId,
      owners,
      liabilityType,
      liabilityName,
      creditorName,
      accountLoanNumber,
      outstandingBalance,
      interestRate,
      monthlyPayment,
      estimatedPayoffDate
    });

    // attach context for audit log (create)
    liab.$locals = liab.$locals || {};
    liab.$locals.activityCtx = req.activityCtx;

    await liab.save();
    await liab.populate('owners', 'firstName lastName');

    // ── AUTO-REFRESH NET_WORTH VALUEADD ─────────────
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
    // ────────────────────────────────────────────────

    return res.json({
      message:   'Liability created successfully.',
      liability: liab
    });

  } catch (err) {
    console.error('createLiability error:', err);

    if (err.code === 11000 && err.keyPattern?.accountLoanNumber) {
      return res.status(400).json({
        message: `A liability with loan number "${err.keyValue.accountLoanNumber}" already exists.`
      });
    }

    return res.status(500).json({
      message: err.message || 'Server error creating liability.'
    });
  }
};


// GET /api/liabilities/:id
exports.getLiabilityById = async (req, res) => {
  try {
    const liab = await Liability
      .findById(req.params.id)
      .populate('owners','firstName lastName')
      .lean();

    if (!liab) return res.status(404).json({ message: 'Liability not found.' });
    res.json(liab);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
};

// PUT /api/liabilities/:id
exports.updateLiability = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      owner,                // new owner _id or 'joint'
      liabilityType,
      liabilityName,
      creditorName,
      accountLoanNumber,
      outstandingBalance,
      interestRate,
      monthlyPayment,
      estimatedPayoffDate
    } = req.body;

    const updates = {
      liabilityType,
      liabilityName,
      creditorName,
      accountLoanNumber,
      outstandingBalance,
      interestRate,
      monthlyPayment,
      estimatedPayoffDate
    };

    if (owner) {
      if (owner === 'joint') {
        // get the liability to read its household id
        const existing = await Liability.findById(id).lean();
        if (!existing) return res.status(404).json({ message: 'Liability not found.' });

        const clients = await Client.find({ household: existing.household }, '_id firmId').lean();
        if (!clients.length) return res.status(400).json({ message: 'No clients found in this household.' });

        const distinctFirmIds = [...new Set(clients.map(c => c.firmId?.toString()).filter(Boolean))];
        if (distinctFirmIds.length > 1) {
          return res.status(400).json({ message: 'Household members belong to different firms; cannot determine firmId.' });
        }

        updates.owners = clients.map(c => c._id);
        updates.firmId = clients[0].firmId;
      } else {
        const ownerId = new mongoose.Types.ObjectId(owner);
        const ownerDoc = await Client.findById(ownerId).select('firmId').lean();
        if (!ownerDoc?.firmId) return res.status(400).json({ message: 'Owner has no firmId.' });

        updates.owners = [ownerId];
        updates.firmId = ownerDoc.firmId;
      }
    }

    const liabDoc = await Liability
      .findByIdAndUpdate(id, updates, {
        new: true,
        runValidators: true,
        activityCtx: req.activityCtx // <-- audit context for query-based update
      })
      .populate('owners', 'firstName lastName');

    if (!liabDoc) {
      return res.status(404).json({ message: 'Liability not found.' });
    }

    // ── AUTO-REFRESH NET_WORTH VALUEADD ─────────────
    try {
      const netWorthVA = await ValueAdd.findOne({ household: liabDoc.household, type: 'NET_WORTH' });
      if (netWorthVA) {
        await ValueAddController.updateNetWorthValueAdd(
          { params: { id: netWorthVA._id } },
          { status: () => ({ json: () => {} }), json: () => {} }
        );
      }
    } catch (e) {
      console.error('Failed to auto-update Net Worth ValueAdd:', e);
    }
    // ────────────────────────────────────────────────

    return res.json({
      message:   'Liability updated successfully.',
      liability: liabDoc.toObject()
    });

  } catch (err) {
    console.error('updateLiability error:', err);
    return res.status(500).json({ message: 'Error updating liability.' });
  }
};

// DELETE /api/liabilities/:id
exports.deleteLiability = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Liability.findByIdAndDelete(id, { activityCtx: req.activityCtx }); // <-- audit context

    if (deleted) {
      // refresh NET_WORTH
      try {
        const netWorthVA = await ValueAdd.findOne({ household: deleted.household, type: 'NET_WORTH' });
        if (netWorthVA) {
          await ValueAddController.updateNetWorthValueAdd(
            { params: { id: netWorthVA._id } },
            { status: () => ({ json: () => {} }), json: () => {} }
          );
        }
      } catch (e) {
        console.error('Failed to auto-update Net Worth ValueAdd:', e);
      }
    }

    res.json({ message: 'Liability deleted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error deleting liability.' });
  }
};

// DELETE /api/liabilities/bulk-delete
exports.bulkDeleteLiabilities = async (req, res) => {
  try {
    const { liabilityIds } = req.body;
    if (!Array.isArray(liabilityIds) || liabilityIds.length === 0) {
      return res.status(400).json({ message: 'No liabilityIds provided.' });
    }

    // Fetch households for refresh & then delete one-by-one (so each delete is logged)
    const liabs = await Liability.find({ _id: { $in: liabilityIds } }).select('_id household').lean();
    const hhSet = new Set(liabs.map(l => l.household?.toString()).filter(Boolean));

    for (const _id of liabilityIds) {
      await Liability.findOneAndDelete({ _id }, { activityCtx: req.activityCtx });
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

    res.json({ message: 'Selected liabilities deleted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error bulk deleting liabilities.' });
  }
};
