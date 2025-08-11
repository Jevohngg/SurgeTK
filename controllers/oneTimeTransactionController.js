// controllers/oneTimeTransactionController.js
const mongoose = require('mongoose');
const OneTimeTransaction = require('../models/OneTimeTransaction');
const Account = require('../models/Account'); // path may be '../models/Account' or similar

function parseMoney(n) {
  // Accept strings like "1,234.56" or 1234.56
  if (typeof n === 'string') n = n.replace(/,/g, '');
  const num = Number(n);
  return Number.isFinite(num) ? num : NaN;
}

async function ensureAccountAccess(req, accountId) {
  // If you already have a centralized authorization/util to check household/account access, call it here.
  // Otherwise, at minimum ensure the account exists:
  const acct = await Account.findById(accountId).lean();
  if (!acct) {
    const err = new Error('Account not found');
    err.status = 404;
    throw err;
  }
  // TODO: enforce that the current user can access this account (depends on your app)
  return acct;
}

exports.list = async (req, res, next) => {
  try {
    const { accountId } = req.params;
    await ensureAccountAccess(req, accountId);

    const items = await OneTimeTransaction
      .find({ account: accountId })
      .sort({ occurredOn: -1, createdAt: -1 })
      .lean();

    res.json({ ok: true, data: items });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { accountId } = req.params;
    await ensureAccountAccess(req, accountId);

    const { kind, amount, occurredOn, note } = req.body;

    if (!['deposit', 'withdrawal'].includes(kind)) {
      const err = new Error('kind must be "deposit" or "withdrawal"');
      err.status = 400;
      throw err;
    }

    const parsedAmount = parseMoney(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      const err = new Error('amount must be a positive number');
      err.status = 400;
      throw err;
    }

    if (!occurredOn) {
      const err = new Error('occurredOn is required');
      err.status = 400;
      throw err;
    }

    const doc = await OneTimeTransaction.create({
      account: accountId,
      kind,
      amount: parsedAmount,
      occurredOn: new Date(occurredOn),
      note: note?.trim() || undefined,
      createdBy: req.user?._id,
      updatedBy: req.user?._id,
    });

    res.status(201).json({ ok: true, data: doc });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const { accountId, txnId } = req.params;
    await ensureAccountAccess(req, accountId);

    const update = {};
    if (req.body.kind) {
      if (!['deposit', 'withdrawal'].includes(req.body.kind)) {
        const err = new Error('kind must be "deposit" or "withdrawal"');
        err.status = 400;
        throw err;
      }
      update.kind = req.body.kind;
    }
    if (req.body.amount != null) {
      const parsedAmount = parseMoney(req.body.amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        const err = new Error('amount must be a positive number');
        err.status = 400;
        throw err;
      }
      update.amount = parsedAmount;
    }
    if (req.body.occurredOn) {
      update.occurredOn = new Date(req.body.occurredOn);
    }
    if (req.body.note !== undefined) {
      update.note = req.body.note?.trim() || undefined;
    }
    update.updatedBy = req.user?._id;

    const doc = await OneTimeTransaction.findOneAndUpdate(
      { _id: txnId, account: accountId },
      { $set: update },
      { new: true }
    );

    if (!doc) {
      const err = new Error('Transaction not found');
      err.status = 404;
      throw err;
    }

    res.json({ ok: true, data: doc });
  } catch (err) {
    next(err);
  }
};

exports.destroy = async (req, res, next) => {
  try {
    const { accountId, txnId } = req.params;
    await ensureAccountAccess(req, accountId);

    const result = await OneTimeTransaction.deleteOne({ _id: txnId, account: accountId });
    if (result.deletedCount === 0) {
      const err = new Error('Transaction not found');
      err.status = 404;
      throw err;
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};
