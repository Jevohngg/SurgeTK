// controllers/accountHistoryController.js

const AccountHistory = require('../models/AccountHistory');
const Account        = require('../models/Account');

exports.getHistory = async (req, res) => {
  try {
    const { accountId } = req.params;
    const firmId        = req.session.user.firmId;

    console.log('[getHistory] accountId =', accountId);

    // 1) firm / ownership check
    const acct = await Account.findById(accountId).populate('household');
    if (!acct || acct.household.firmId.toString() !== firmId) {
      console.log('[getHistory] access denied or not found for accountId=', accountId);
      return res.status(404).json({ message: 'Account not found or access denied' });
    }

    // 2) pagination parameters
    const page  = parseInt(req.query.page  || '1',  10);
    const limit = parseInt(req.query.limit || '20', 10);

    // 3) fetch history rows
    const history = await AccountHistory.find({ account: accountId })
      .sort({ changedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('changedBy', 'firstName lastName email')
      .lean();

    console.log('[getHistory] found', history.length, 'records for accountId=', accountId);

    // 4) get total count for client‐side pagination
    const total = await AccountHistory.countDocuments({ account: accountId });

    console.log('[getHistory] returning payload:', { history, total });

    return res.status(200).json({ history, total });
  } catch (err) {
    console.error('[getHistory] error fetching history:', err);
    return res.status(500).json({ message: 'Error fetching history.' });
  }
};

exports.deleteHistory = async (req, res) => {
  try {
    const { historyId } = req.params;
    const user          = req.session.user;

    // Locate the row and its related account → household
    const row = await AccountHistory.findById(historyId).populate({
      path: 'account',
      populate: { path: 'household' },
    });

    // Authorization check
    if (!row || row.account.household.firmId.toString() !== user.firmId) {
      return res.status(404).json({ message: 'History row not found or access denied' });
    }

    // Delete and respond
    await row.deleteOne();
    return res.status(200).json({ message: 'History row deleted.' });
  } catch (err) {
    console.error('[deleteHistory] error deleting history row:', err);
    return res.status(500).json({ message: 'Error deleting history row.' });
  }
};
