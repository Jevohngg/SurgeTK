// controllers/liabilitiesController.js
const mongoose = require('mongoose');
const Liability = require('../models/Liability');
const Client = require('../models/Client');
const ValueAddController = require('./valueAddController');

// controllers/liabilitiesController.js
// controllers/liabilitiesController.js
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
        { accountLoanNumber: term }
      ];
      if (ownerIds.length) match.$or.push({ owners: { $in: ownerIds } });
    }

    // 4) Decide whether to use simple find or aggregation
    let liabilities, total;
    if (sortField === 'owners.firstName' || sortField === 'owners.lastName') {
      // aggregation for owner sort
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

        { $skip: skip },
        ...(limit > 0 ? [{ $limit: limit }] : []),
      ];

      // run aggregation & also get count separately
      [liabilities, total] = await Promise.all([
        Liability.aggregate(pipeline),
        Liability.countDocuments(match)
      ]);

      // convert _id fields back to strings & mimic .lean() + populate
      liabilities = liabilities.map(l => ({
        ...l,
        owners: [{
          _id:        l.owners._id,
          firstName:  l.owners.firstName,
          lastName:   l.owners.lastName
        }],
      }));
    } else {
      // simple find for everything else
      const valid = [
        'creditorName','liabilityType','accountLoanNumber',
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
      creditorName,
      accountLoanNumber,
      outstandingBalance,
      interestRate,
      monthlyPayment,
      estimatedPayoffDate
    } = req.body;

    const householdId = req.params.householdId;
    let owners;

    if (owner === 'joint') {
      // include every client in this household
      const clients = await Client
        .find({ household: householdId }, '_id')
        .lean();
      owners = clients.map(c => c._id);
    } else {
      // single‐owner case
      owners = [ new mongoose.Types.ObjectId(owner) ];
    }

    const liab = new Liability({
      household: householdId,
      owners,
      liabilityType,
      creditorName,
      accountLoanNumber,
      outstandingBalance,
      interestRate,
      monthlyPayment,
      estimatedPayoffDate
    });

    await liab.save();
    await liab.populate('owners', 'firstName lastName');

    // ── AUTO-REFRESH NET_WORTH VALUEADD ─────────────
    try {
      const netWorthVA = await ValueAdd.findOne({
        household: householdId,
        type:      'NET_WORTH'
      });
      if (netWorthVA) {
        // call our existing update handler with a dummy res
        await ValueAddController.updateNetWorthValueAdd(
          { params: { id: netWorthVA._id } },
          { status: () => ({ json: () => {} }), json: () => {} }
        );
      }
    } catch (e) {
      console.error('Failed to auto-update Net Worth ValueAdd:', e);
    }
    // ─────────────────────────────────────────────────

    return res.json({
      message:   'Liability created successfully.',
      liability: liab
    });

  } catch (err) {
    console.error('createLiability error:', err);

    // Handle duplicate loan‐number error
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
      creditorName,
      accountLoanNumber,
      outstandingBalance,
      interestRate,
      monthlyPayment,
      estimatedPayoffDate
    } = req.body;

    // base fields to update
    const updates = {
      liabilityType,
      creditorName,
      accountLoanNumber,
      outstandingBalance,
      interestRate,
      monthlyPayment,
      estimatedPayoffDate
    };

    if (owner) {
      if (owner === 'joint') {
        // look up existing liability to get its household
        const existing = await Liability
          .findById(id)
          .populate('owners')
          .lean();
        const hh = existing.owners[0].household;
        const clients = await Client
          .find({ household: hh }, '_id')
          .lean();
        updates.owners = clients.map(c => c._id);
      } else {
        owners = [ new mongoose.Types.ObjectId(owner) ];
      }
    }

    const liab = await Liability
      .findByIdAndUpdate(id, updates, { new: true })
      .populate('owners', 'firstName lastName')
      .lean();

    if (!liab) {
      return res.status(404).json({ message: 'Liability not found.' });
    }

        // ── AUTO-REFRESH NET_WORTH VALUEADD ─────────────
        try {
          const netWorthVA = await ValueAdd.findOne({
            household: householdId,
            type:      'NET_WORTH'
          });
          if (netWorthVA) {
            // call our existing update handler with a dummy res
            await ValueAddController.updateNetWorthValueAdd(
              { params: { id: netWorthVA._id } },
              { status: () => ({ json: () => {} }), json: () => {} }
            );
          }
        } catch (e) {
          console.error('Failed to auto-update Net Worth ValueAdd:', e);
        }
        // ─────────────────────────────────────────────────

    return res.json({
      message:   'Liability updated successfully.',
      liability: liab
    });

  } catch (err) {
    console.error('updateLiability error:', err);
    return res.status(500).json({ message: 'Error updating liability.' });
  }
};

// DELETE /api/liabilities/:id
exports.deleteLiability = async (req, res) => {
  try {
    await Liability.findByIdAndDelete(req.params.id);
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
    await Liability.deleteMany({ _id: { $in: liabilityIds } });
    res.json({ message: 'Selected liabilities deleted successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error bulk deleting liabilities.' });
  }
};
