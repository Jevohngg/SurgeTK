// controllers/accountController.js

const Account = require('../models/Account');
const Client = require('../models/Client');
const Household = require('../models/Household');
const Beneficiary = require('../models/Beneficiary');

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

    // Handle optional fields - only add them if they are provided and have valid values
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

    // Create the new account
    const account = new Account(accountData);
    await account.save();

    // Update Household
    household.accounts.push(account._id);
    await household.save();

    console.log('Account created:', account);

    res.status(201).json({ message: 'Account created successfully.', account });
  } catch (error) {
    console.error('Error creating account:', error);

    // Send the error message to the client
    res.status(400).json({ message: error.message });
  }

};

// Get accounts for a household with pagination
exports.getAccountsByHousehold = async (req, res) => {
  try {
    const householdId = req.params.householdId;
    const userId = req.session.user._id;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const household = await Household.findOne({ _id: householdId, owner: userId }).lean();

    if (!household) {
      return res.status(404).json({ message: 'Household not found or access denied.' });
    }

    const totalAccounts = await Account.countDocuments({ household: householdId });

    const accounts = await Account.find({ household: householdId })
      .populate('accountOwner', 'firstName lastName')
      .populate('beneficiaries.primary.beneficiary')
      .populate('beneficiaries.contingent.beneficiary')
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

    // Update account fields
    if (accountOwner) account.accountOwner = accountOwner;
    if (accountNumber) account.accountNumber = accountNumber;
    if (accountValue) account.accountValue = accountValue;
    if (accountType) account.accountType = accountType;
    if (taxStatus) account.taxStatus = taxStatus;
    if (custodian) account.custodian = custodian;

    // Handle optional fields
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

      // Add new beneficiaries
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

    // Handle tax forms
    if (taxForms && taxForms.length > 0) {
      account.taxForms = taxForms;
    }

    // Handle inherited account details
    if (inheritedAccountDetails && Object.keys(inheritedAccountDetails).length > 0) {
      account.inheritedAccountDetails = inheritedAccountDetails;
    }

    // Handle IRA account details
    if (iraAccountDetails && iraAccountDetails.length > 0) {
      account.iraAccountDetails = iraAccountDetails;
    }

    await account.save();

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

    // Delete the accounts
    await Account.deleteMany({ _id: { $in: accountIds } });

    res.status(200).json({ message: 'Selected accounts have been deleted successfully.' });
  } catch (error) {
    console.error('Error deleting accounts:', error);
    res.status(500).json({ message: 'Server error while deleting accounts.', error: error.message });
  }
};