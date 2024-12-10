const Account = require('../models/Account');
const Client = require('../models/Client');
const Household = require('../models/Household');
const Beneficiary = require('../models/Beneficiary');
const HouseholdSnapshot = require('../models/HouseholdSnapshot');
// const AccountHistory = require('../models/AccountHistory'); // If using AccountHistory

// Helper to recalculate monthly net worth after account changes
async function recalculateMonthlyNetWorth(householdId) {
  const accounts = await Account.find({ household: householdId }).lean();
  const totalNetWorth = accounts.reduce((sum, acc) => sum + (acc.accountValue || 0), 0);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  // Upsert snapshot
  await HouseholdSnapshot.findOneAndUpdate(
    { household: householdId, year, month },
    { netWorth: totalNetWorth },
    { upsert: true }
  );
}

// Create a new account
exports.createAccount = async (req, res) => {
  try {
    const householdId = req.params.householdId;
    const userId = req.session.user._id;

    // Check if the household exists and belongs to the user
    const household = await Household.findOne({ _id: householdId, owner: userId });
    if (!household) {
      return res.status(404).json({ message: 'Household not found or access denied.' });
    }

    // Extract data from the request body
    const {
      accountOwner,
      accountNumber,
      accountValue,
      accountType,
      systematicWithdrawAmount,
      systematicWithdrawFrequency,
      federalTaxWithholding,
      stateTaxWithholding,
      taxStatus,
      valueAsOf12_31,
      custodian,
      beneficiaries,
      taxForms,
      inheritedAccountDetails,
      iraAccountDetails,
    } = req.body;

    // Prepare the account data
    const accountData = {
      accountOwner,
      household: householdId,
      accountNumber,
      accountValue,
      accountType,
      taxStatus,
      custodian,
    };


    // Handle optional fields
    if (systematicWithdrawAmount !== undefined && systematicWithdrawAmount !== '') {
      accountData.systematicWithdrawAmount = systematicWithdrawAmount;
    }
    if (
      systematicWithdrawFrequency !== undefined &&
      systematicWithdrawFrequency !== '' &&
      ['Monthly', 'Quarterly', 'Annually'].includes(systematicWithdrawFrequency)
    ) {
      accountData.systematicWithdrawFrequency = systematicWithdrawFrequency;
    }
    if (federalTaxWithholding !== undefined && federalTaxWithholding !== '') {
      accountData.federalTaxWithholding = federalTaxWithholding;
    }
    if (stateTaxWithholding !== undefined && stateTaxWithholding !== '') {
      accountData.stateTaxWithholding = stateTaxWithholding;
    }
    if (valueAsOf12_31 !== undefined && valueAsOf12_31 !== '') {
      accountData.valueAsOf12_31 = valueAsOf12_31;
    }
    if (taxForms && taxForms.length > 0) {
      accountData.taxForms = taxForms;
    }
    if (inheritedAccountDetails && Object.keys(inheritedAccountDetails).length > 0) {
      accountData.inheritedAccountDetails = inheritedAccountDetails;
    }
    if (iraAccountDetails && iraAccountDetails.length > 0) {
      accountData.iraAccountDetails = iraAccountDetails;
    }

    // Handle Beneficiaries
    const beneficiaryIds = { primary: [], contingent: [] };

    if (beneficiaries) {
      // Save primary beneficiaries
      for (const primary of beneficiaries.primary || []) {
        const beneficiary = new Beneficiary({
          firstName: primary.firstName,
          lastName: primary.lastName,
          relationship: primary.relationship,
          dateOfBirth: primary.dateOfBirth || null,
          ssn: primary.ssn || null,
        });
        await beneficiary.save();
        beneficiaryIds.primary.push({
          beneficiary: beneficiary._id,
          percentageAllocation: primary.percentageAllocation,
        });
      }

      // Save contingent beneficiaries
      for (const contingent of beneficiaries.contingent || []) {
        const beneficiary = new Beneficiary({
          firstName: contingent.firstName,
          lastName: contingent.lastName,
          relationship: contingent.relationship,
          dateOfBirth: contingent.dateOfBirth || null,
          ssn: contingent.ssn || null,
        });
        await beneficiary.save();
        beneficiaryIds.contingent.push({
          beneficiary: beneficiary._id,
          percentageAllocation: contingent.percentageAllocation,
        });
      }

      accountData.beneficiaries = beneficiaryIds;
    }

        // Fetch the client to set accountOwnerName
        if (accountOwner) {
          const client = await Client.findById(accountOwner).lean();
          accountData.accountOwnerName = client ? client.firstName : 'Unknown';
        }

    // Create the new account
    const account = new Account(accountData);
    await account.save();

   


    // Update Household
    household.accounts.push(account._id);
    await household.save();

    // Optionally record history
    // await AccountHistory.create({ accountId: account._id, accountValue: accountValue });

    // Recalculate monthly net worth
    await recalculateMonthlyNetWorth(householdId);

    res.status(201).json({ message: 'Account created successfully.', account });
  } catch (error) {
    console.error('Error creating account:', error);
    res.status(400).json({ message: error.message });
  }
};

// In accountController.js or similar

// Expanded search criteria in getAccountsByHousehold
exports.getAccountsByHousehold = async (req, res) => {
  try {
    const householdId = req.params.householdId;
    const userId = req.session.user._id;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    let { sortField = 'accountOwnerName', sortOrder = 'asc', search = '' } = req.query;

    const validSortFields = {
      accountOwnerName: 'accountOwnerName',
      accountType: 'accountType',
      systematicWithdrawAmount: 'systematicWithdrawAmount',
      updatedAt: 'updatedAt',
      accountValue: 'accountValue'
    };

    if (!validSortFields[sortField]) {
      sortField = 'accountOwnerName';
    }

    const sortFieldDB = validSortFields[sortField];
    const sortOrderValue = sortOrder === 'desc' ? -1 : 1;

    const household = await Household.findOne({ _id: householdId, owner: userId }).lean();
    if (!household) {
      return res.status(404).json({ message: 'Household not found or access denied.' });
    }

    const conditions = { household: householdId };
    if (search) {
      const regex = new RegExp(search, 'i');
      conditions.$or = [
        { accountOwnerName: regex },
        { accountNumber: regex },
        { accountType: regex },
        { custodian: regex }
        // Add more fields if desired
      ];
    }

    const totalAccounts = await Account.countDocuments(conditions);

    const accounts = await Account.find(conditions)
      .populate('accountOwner', 'firstName lastName')
      .populate('beneficiaries.primary.beneficiary')
      .populate('beneficiaries.contingent.beneficiary')
      .sort({ [sortFieldDB]: sortOrderValue })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({ accounts, totalAccounts });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ message: 'Error fetching accounts.', error: error.message });
  }
};





// Update an account
exports.updateAccount = async (req, res) => {
  try {
    const accountId = req.params.accountId;
    const userId = req.session.user._id;

    // Find the account and ensure it belongs to a household owned by the user
    const account = await Account.findById(accountId).populate('household');
    if (!account || account.household.owner.toString() !== userId) {
      return res.status(404).json({ message: 'Account not found or access denied.' });
    }

    const {
      accountOwner,
      accountNumber,
      accountValue,
      accountType,
      systematicWithdrawAmount,
      systematicWithdrawFrequency,
      federalTaxWithholding,
      stateTaxWithholding,
      taxStatus,
      valueAsOf12_31,
      custodian,
      beneficiaries,
      taxForms,
      inheritedAccountDetails,
      iraAccountDetails,
    } = req.body;

    // Track old value to log changes if needed
    // const oldValue = account.accountValue;

    if (accountOwner) account.accountOwner = accountOwner;
    if (accountNumber) account.accountNumber = accountNumber;
    if (accountValue !== undefined && accountValue !== '') account.accountValue = accountValue;
    if (accountType) account.accountType = accountType;
    if (taxStatus) account.taxStatus = taxStatus;
    if (custodian) account.custodian = custodian;

    account.systematicWithdrawAmount =
      systematicWithdrawAmount !== undefined && systematicWithdrawAmount !== ''
        ? systematicWithdrawAmount
        : account.systematicWithdrawAmount;

    if (
      systematicWithdrawFrequency !== undefined &&
      systematicWithdrawFrequency !== '' &&
      ['Monthly', 'Quarterly', 'Annually'].includes(systematicWithdrawFrequency)
    ) {
      account.systematicWithdrawFrequency = systematicWithdrawFrequency;
    }

    account.federalTaxWithholding =
      federalTaxWithholding !== undefined && federalTaxWithholding !== ''
        ? federalTaxWithholding
        : account.federalTaxWithholding;

    account.stateTaxWithholding =
      stateTaxWithholding !== undefined && stateTaxWithholding !== ''
        ? stateTaxWithholding
        : account.stateTaxWithholding;

    account.valueAsOf12_31 =
      valueAsOf12_31 !== undefined && valueAsOf12_31 !== ''
        ? valueAsOf12_31
        : account.valueAsOf12_31;

    // Handle beneficiaries
    if (beneficiaries) {
      // Remove existing beneficiaries
      await Beneficiary.deleteMany({
        _id: {
          $in: [
            ...account.beneficiaries.primary.map((b) => b.beneficiary),
            ...account.beneficiaries.contingent.map((b) => b.beneficiary),
          ],
        },
      });

      const beneficiaryIds = { primary: [], contingent: [] };

      // Save primary beneficiaries
      for (const primary of beneficiaries.primary || []) {
        const beneficiary = new Beneficiary({
          firstName: primary.firstName,
          lastName: primary.lastName,
          relationship: primary.relationship,
          dateOfBirth: primary.dateOfBirth || null,
          ssn: primary.ssn || null,
        });
        await beneficiary.save();
        beneficiaryIds.primary.push({
          beneficiary: beneficiary._id,
          percentageAllocation: primary.percentageAllocation,
        });
      }

      // Save contingent beneficiaries
      for (const contingent of beneficiaries.contingent || []) {
        const beneficiary = new Beneficiary({
          firstName: contingent.firstName,
          lastName: contingent.lastName,
          relationship: contingent.relationship,
          dateOfBirth: contingent.dateOfBirth || null,
          ssn: contingent.ssn || null,
        });
        await beneficiary.save();
        beneficiaryIds.contingent.push({
          beneficiary: beneficiary._id,
          percentageAllocation: contingent.percentageAllocation,
        });
      }

      account.beneficiaries = beneficiaryIds;
    }

    if (taxForms && taxForms.length > 0) {
      account.taxForms = taxForms;
    }

    if (inheritedAccountDetails && Object.keys(inheritedAccountDetails).length > 0) {
      account.inheritedAccountDetails = inheritedAccountDetails;
    }

    if (iraAccountDetails && iraAccountDetails.length > 0) {
      account.iraAccountDetails = iraAccountDetails;
    }

    await account.save();

    // Optionally record history if account value changed
    // if (accountValue && accountValue !== oldValue) {
    //   await AccountHistory.create({ accountId: account._id, accountValue });
    // }

    // Recalculate monthly net worth
    await recalculateMonthlyNetWorth(account.household._id);

    res.json({ message: 'Account updated successfully.', account });
  } catch (error) {
    console.error('Error updating account:', error);
    res.status(500).json({ message: 'Error updating account.', error: error.message });
  }
};

exports.bulkDeleteAccounts = async (req, res) => {
  try {
    const { accountIds } = req.body;
    const userId = req.session.user._id;

    if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
      return res.status(400).json({ message: 'No account IDs provided.' });
    }

    // Find all accounts and ensure they belong to households owned by the user
    const accounts = await Account.find({ _id: { $in: accountIds } }).populate('household');

    // Filter out accounts not owned by this user
    const ownedAccounts = accounts.filter(account => account.household.owner.toString() === userId.toString());

    if (ownedAccounts.length !== accountIds.length) {
      return res.status(403).json({ message: 'One or more accounts do not belong to the user.' });
    }

    // Remove associated beneficiaries
    const beneficiaryIds = [];
    for (const account of ownedAccounts) {
      beneficiaryIds.push(...account.beneficiaries.primary.map(b => b.beneficiary));
      beneficiaryIds.push(...account.beneficiaries.contingent.map(b => b.beneficiary));
    }

    await Beneficiary.deleteMany({ _id: { $in: beneficiaryIds } });

    // Remove accounts from their households
    const householdIds = ownedAccounts.map(acc => acc.household._id);
    for (const hhId of householdIds) {
      await Household.findByIdAndUpdate(hhId, { $pull: { accounts: { $in: accountIds } } });
    }

    await Account.deleteMany({ _id: { $in: accountIds } });

    // Recalculate monthly net worth for affected households
    // This is done per household to keep data consistent
    for (const hhId of householdIds) {
      await recalculateMonthlyNetWorth(hhId);
    }

    res.status(200).json({ message: 'Selected accounts have been deleted successfully.' });
  } catch (error) {
    console.error('Error deleting accounts:', error);
    res.status(500).json({ message: 'Server error while deleting accounts.', error: error.message });
  }
};

exports.getAccountById = async (req, res) => {
  try {
    const accountId = req.params.accountId;
    const userId = req.session.user._id;

    const account = await Account.findById(accountId)
      .populate('household')
      .populate('accountOwner', 'firstName lastName')
      .populate({
        path: 'beneficiaries.primary.beneficiary',
        select: 'firstName lastName relationship dateOfBirth ssn',
      })
      .populate({
        path: 'beneficiaries.contingent.beneficiary',
        select: 'firstName lastName relationship dateOfBirth ssn',
      })
      .lean();

    if (!account) {
      return res.status(404).json({ message: 'Account not found.' });
    }

    if (!account.household || !account.household.owner) {
      return res.status(404).json({ message: 'Account or associated household not found.' });
    }

    if (account.household.owner.toString() !== userId) {
      return res.status(403).json({ message: 'Access denied for this account.' });
    }

    const fullAccountDetails = {
      accountOwner: account.accountOwner || { firstName: '---', lastName: '---' },
      accountNumber: account.accountNumber || '---',
      accountValue: account.accountValue || '---',
      accountType: account.accountType || '---',
      custodian: account.custodian || '---',
      systematicWithdrawAmount: account.systematicWithdrawAmount || '---',
      systematicWithdrawFrequency: account.systematicWithdrawFrequency || '---',
      federalTaxWithholding: account.federalTaxWithholding || '---',
      stateTaxWithholding: account.stateTaxWithholding || '---',
      taxStatus: account.taxStatus || '---',
      valueAsOf12_31: account.valueAsOf12_31 || '---',
      beneficiaries: account.beneficiaries || { primary: [], contingent: [] },
      taxForms: account.taxForms || [],
      inheritedAccountDetails: account.inheritedAccountDetails || {},
      iraAccountDetails: account.iraAccountDetails || [],
      createdAt: account.createdAt || '---',
      updatedAt: account.updatedAt || '---',
    };

    res.json(fullAccountDetails);
  } catch (error) {
    console.error('Error fetching account details:', error);
    res.status(500).json({ message: 'Error fetching account details.', error: error.message });
  }
};

exports.getAccountsSummaryByHousehold = async (req, res) => {
  try {
    const householdId = req.params.householdId;
    const userId = req.session.user._id;

    // Validate household ownership
    const household = await Household.findOne({ _id: householdId, owner: userId }).lean();
    if (!household) {
      return res.status(404).json({ message: 'Household not found or access denied.' });
    }

    const pipeline = [
      { $match: { household: household._id } },
      {
        $group: {
          _id: null,
          totalNetWorth: { $sum: '$accountValue' },
          assetAllocation: { $push: { type: '$accountType', value: '$accountValue' } },
          taxStatusSummary: { $push: { status: '$taxStatus', value: '$accountValue' } }
        }
      }
    ];

    const [result] = await Account.aggregate(pipeline);

    const assetAllocation = {};
    const taxStatusSummary = {};

    if (result) {
      (result.assetAllocation || []).forEach(a => {
        assetAllocation[a.type] = (assetAllocation[a.type] || 0) + a.value;
      });

      (result.taxStatusSummary || []).forEach(t => {
        taxStatusSummary[t.status] = (taxStatusSummary[t.status] || 0) + t.value;
      });
    }

    const systematicWithdrawals = await Account.find({ household: household._id, systematicWithdrawAmount: { $gt: 0 } }).lean();

    res.json({
      totalNetWorth: (result && result.totalNetWorth) || 0,
      assetAllocation,
      taxStatusSummary,
      systematicWithdrawals
    });
  } catch (error) {
    console.error('Error fetching account summary:', error);
    res.status(500).json({ message: 'Error fetching account summary.', error: error.message });
  }
};

exports.getMonthlyNetWorth = async (req, res) => {
  try {
    const { householdId } = req.params;
    const userId = req.session.user._id;

    const household = await Household.findOne({ _id: householdId, owner: userId }).lean();
    if (!household) {
      return res.status(404).json({ message: 'Household not found or access denied.' });
    }

    const now = new Date();
    const oneYearAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    const snapshots = await HouseholdSnapshot.find({
      household: householdId,
      $or: [
        { year: { $gt: oneYearAgo.getFullYear() } },
        {
          year: oneYearAgo.getFullYear(),
          month: { $gte: oneYearAgo.getMonth() }
        }
      ]
    }).sort({ year: 1, month: 1 }).lean();

    const monthlyNetWorth = snapshots.map(s => {
      const monthDate = new Date(s.year, s.month, 1);
      return {
        month: monthDate.toLocaleString('default', { month: 'short', year: 'numeric' }),
        netWorth: s.netWorth || 0
      };
    });

    res.json({ monthlyNetWorth });
  } catch (error) {
    console.error("Error fetching monthly net worth:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.deleteAccount = async (req, res) => {
  try {
    const accountId = req.params.accountId;
    const userId = req.session.user._id;

    // Find the account and ensure the user owns it
    const account = await Account.findById(accountId).populate('household');
    if (!account || account.household.owner.toString() !== userId.toString()) {
      return res.status(404).json({ message: 'Account not found or access denied.' });
    }

    // Remove associated beneficiaries
    const beneficiaryIds = [
      ...account.beneficiaries.primary.map(b => b.beneficiary),
      ...account.beneficiaries.contingent.map(b => b.beneficiary),
    ];
    await Beneficiary.deleteMany({ _id: { $in: beneficiaryIds } });

    // Remove the account from the household
    await Household.findByIdAndUpdate(account.household._id, { $pull: { accounts: account._id } });

    // Delete the account
    await Account.deleteOne({ _id: account._id });

    res.status(200).json({ message: 'Account deleted successfully.' });
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ message: 'Server error while deleting account.', error: error.message });
  }
};
