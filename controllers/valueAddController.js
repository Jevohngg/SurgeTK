// controllers/valueAddController.js

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const xlsx = require('xlsx');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const { Table } = require('pdfkit-table');

const Household = require('../models/Household');
const Client = require('../models/Client');
const Account = require('../models/Account');
const Beneficiary = require('../models/Beneficiary');
const User = require('../models/User');
const ImportReport = require('../models/ImportReport');
const ValueAdd = require('../models/ValueAdd');
const { uploadFile } = require('../utils/s3');
const { generatePreSignedUrl } = require('../utils/s3');
const { getMarginalTaxBracket } = require('../utils/taxBrackets');
const { ensureAuthenticated } = require('../middleware/authMiddleware');

// Guardrails logic
const {
  validateGuardrailsInputs,
  calculateGuardrails
} = require('../services/valueadds/guardrailsService');

const {
  validateBucketsInputs,
  calculateBuckets
} = require('../services/valueadds/bucketsService');

/**
 * Retrieve all ValueAdds for a given household
 */
exports.getValueAddsForHousehold = async (req, res) => {
  try {
    const householdId = req.params.householdId;
    console.log('[getValueAddsForHousehold] householdId =>', householdId);

    const valueAdds = await ValueAdd.find({ household: householdId }).lean();
    console.log('[getValueAddsForHousehold] Found ValueAdds =>', valueAdds);

    return res.json(valueAdds);
  } catch (err) {
    console.error('Error in getValueAddsForHousehold:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * Retrieve a single ValueAdd by ID
 */
exports.getValueAdd = async (req, res) => {
  try {
    const valueAddId = req.params.id;
    console.log('[getValueAdd] valueAddId =>', valueAddId);

    const valueAdd = await ValueAdd.findById(valueAddId).lean();
    if (!valueAdd) {
      console.error('[getValueAdd] No ValueAdd found with that ID.');
      return res.status(404).json({ message: 'Value Add not found.' });
    }
    console.log('[getValueAdd] Found ValueAdd =>', valueAdd);

    return res.json(valueAdd);
  } catch (err) {
    console.error('Error in getValueAdd:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// Import the CompanyID model here, so we can reference the firm’s settings
const CompanyID = require('../models/CompanyID');

/**
 * Create a new Guardrails ValueAdd for the given household
 * (Now sums all accounts so the guardrails result is not zero.)
 */
exports.createGuardrailsValueAdd = async (req, res) => {
  try {
    const householdId = req.params.householdId;
    console.log('[createGuardrailsValueAdd] householdId =>', householdId);

    // 1) Fetch the household doc
    const household = await Household.findById(householdId).lean();
    console.log('[createGuardrailsValueAdd] Found Household =>', household);

    if (!household) {
      console.error('[createGuardrailsValueAdd] No household found for ID:', householdId);
      return res.status(404).json({ message: 'Household not found.' });
    }

    // 2) Fetch the firm to get dynamic guardrails fields
    const firm = await CompanyID.findById(household.firmId).lean();
    if (!firm) {
      console.error('[createGuardrailsValueAdd] No firm found for firmId:', household.firmId);
    } else {
      console.log('[createGuardrailsValueAdd] Firm doc =>', firm);
    }

    // 3) Sum up all accountValue for this household
    const accounts = await Account.find({ household: householdId }).lean();
    console.log('[createGuardrailsValueAdd] Found Accounts =>', accounts);

    let sum = 0;
    accounts.forEach(acc => {
      sum += (acc.accountValue || 0);
    });
    console.log('[createGuardrailsValueAdd] Summed =>', sum);

    // Build a new household object that has totalAccountValue
    const householdWithSum = {
      ...household,
      totalAccountValue: sum,
      accounts: accounts,
    };
    console.log('[createGuardrailsValueAdd] householdWithSum =>', householdWithSum);

    // Validate
    const missing = validateGuardrailsInputs(householdWithSum);
    if (missing.length > 0) {
      console.error('[createGuardrailsValueAdd] Missing fields =>', missing);
      return res.status(400).json({
        message: 'Cannot generate Guardrails. Missing required fields.',
        missingFields: missing,
      });
    }

    // ===========================
    //  Use firm’s dynamic fields
    // ===========================
    const userAvailableRate = firm?.guardrailsDistributionRate ?? 0.054;
    const userUpperFactor   = firm?.guardrailsUpperFactor ?? 0.8;
    const userLowerFactor   = firm?.guardrailsLowerFactor ?? 1.2;

    console.log('[createGuardrailsValueAdd] userAvailableRate =>', userAvailableRate);
    console.log('[createGuardrailsValueAdd] userUpperFactor   =>', userUpperFactor);
    console.log('[createGuardrailsValueAdd] userLowerFactor   =>', userLowerFactor);

    // Compute new upper/lower by multiplying
    const newUpperRate = userAvailableRate * userUpperFactor;
    const newLowerRate = userAvailableRate * userLowerFactor;

    console.log('[createGuardrailsValueAdd] newUpperRate =>', newUpperRate);
    console.log('[createGuardrailsValueAdd] newLowerRate =>', newLowerRate);

    // Step D: pass them into calculateGuardrails
    const guardrailsData = calculateGuardrails(householdWithSum, {
      distributionRate: userAvailableRate,  // new "middle"
      upperRate: newUpperRate,
      lowerRate: newLowerRate
    });

    console.log('[createGuardrailsValueAdd] guardrailsData =>', guardrailsData);

    // Create the ValueAdd
    const newValueAdd = new ValueAdd({
      household: household._id,
      type: 'GUARDRAILS',
      currentData: guardrailsData,
      history: [{ date: new Date(), data: guardrailsData }],
    });

    await newValueAdd.save();
    console.log('[createGuardrailsValueAdd] New ValueAdd saved =>', newValueAdd._id);

    return res.status(201).json({
      message: 'Guardrails ValueAdd created successfully.',
      valueAdd: newValueAdd
    });
  } catch (err) {
    console.error('Error in createGuardrailsValueAdd:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * Update/refresh an existing Guardrails ValueAdd (re-calc and store new snapshot)
 * (Also sums the accountValue to ensure we get correct guardrails data.)
 */
exports.updateGuardrailsValueAdd = async (req, res) => {
  try {
    const valueAddId = req.params.id;
    console.log('[updateGuardrailsValueAdd] valueAddId =>', valueAddId);

    const valueAdd = await ValueAdd.findById(valueAddId).populate('household');
    console.log('[updateGuardrailsValueAdd] Found ValueAdd =>', valueAdd);

    if (!valueAdd) {
      console.error('[updateGuardrailsValueAdd] No ValueAdd found for ID:', valueAddId);
      return res.status(404).json({ message: 'Value Add not found.' });
    }
    if (valueAdd.type !== 'GUARDRAILS') {
      console.error('[updateGuardrailsValueAdd] ValueAdd type is not GUARDRAILS. It is:', valueAdd.type);
      return res.status(400).json({ message: 'Value Add is not of type GUARDRAILS.' });
    }

    // 1) Sum accounts again to get the latest total portfolio value
    const householdId = valueAdd.household._id;
    console.log('[updateGuardrailsValueAdd] householdId =>', householdId);

    const accounts = await Account.find({ household: householdId }).lean();
    console.log('[updateGuardrailsValueAdd] Found Accounts =>', accounts);

    let sum = 0;
    accounts.forEach(acc => {
      sum += (acc.accountValue || 0);
    });
    console.log('[updateGuardrailsValueAdd] Summed =>', sum);

    // Build a new object for the calculation
    const householdWithSum = {
      ...valueAdd.household.toObject(), // convert the Mongoose doc to plain object
      totalAccountValue: sum
    };
    console.log('[updateGuardrailsValueAdd] householdWithSum =>', householdWithSum);

    // Validate
    const missing = validateGuardrailsInputs(householdWithSum);
    if (missing.length > 0) {
      console.error('[updateGuardrailsValueAdd] Missing fields =>', missing);
      return res.status(400).json({
        message: 'Cannot update Guardrails. Missing required fields.',
        missingFields: missing,
      });
    }

    // 2) Fetch updated firm data
    const firm = await CompanyID.findById(valueAdd.household.firmId).lean();
    if (!firm) {
      console.error('[updateGuardrailsValueAdd] No firm found for firmId:', valueAdd.household.firmId);
    } else {
      console.log('[updateGuardrailsValueAdd] Firm doc =>', firm);
    }

    // Use dynamic fields again
    const userAvailableRate = firm?.guardrailsDistributionRate ?? 0.054;
    const userUpperFactor   = firm?.guardrailsUpperFactor ?? 0.8;
    const userLowerFactor   = firm?.guardrailsLowerFactor ?? 1.2;

    console.log('[updateGuardrailsValueAdd] userAvailableRate =>', userAvailableRate);
    console.log('[updateGuardrailsValueAdd] userUpperFactor   =>', userUpperFactor);
    console.log('[updateGuardrailsValueAdd] userLowerFactor   =>', userLowerFactor);

    const newUpperRate = userAvailableRate * userUpperFactor;
    const newLowerRate = userAvailableRate * userLowerFactor;

    console.log('[updateGuardrailsValueAdd] newUpperRate =>', newUpperRate);
    console.log('[updateGuardrailsValueAdd] newLowerRate =>', newLowerRate);

    // Recalculate
    const guardrailsData = calculateGuardrails(householdWithSum, {
      distributionRate: userAvailableRate,
      upperRate: newUpperRate,
      lowerRate: newLowerRate
    });

    console.log('[updateGuardrailsValueAdd] guardrailsData =>', guardrailsData);

    // Update the ValueAdd doc
    valueAdd.currentData = guardrailsData;
    valueAdd.history.push({ date: new Date(), data: guardrailsData });
    await valueAdd.save();
    console.log('[updateGuardrailsValueAdd] ValueAdd updated =>', valueAdd._id);

    return res.json({
      message: 'Guardrails ValueAdd updated successfully.',
      valueAdd
    });
  } catch (err) {
    console.error('Error in updateGuardrailsValueAdd:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// For viewing the Guardrails page in your server-side rendering
exports.viewGuardrailsPage = async (req, res) => {
  try {
    const valueAddId = req.params.id;
    console.log('[viewGuardrailsPage] valueAddId =>', valueAddId);

    // 1) Populate ValueAdd => household => firmId
    const valueAdd = await ValueAdd.findById(valueAddId)
      .populate({
        path: 'household',
        populate: [
          { path: 'leadAdvisors', select: 'name avatar email' },
          { path: 'firmId', select: 'companyName companyLogo' }
        ]
      })
      .lean();

    if (!valueAdd) {
      console.error('[viewGuardrailsPage] No ValueAdd found for ID:', valueAddId);
      return res.status(404).send('Value Add not found');
    }
    if (valueAdd.type !== 'GUARDRAILS') {
      console.error('[viewGuardrailsPage] ValueAdd type is not GUARDRAILS.');
      return res.status(400).send('Not a Guardrails Value Add');
    }

    // Also fetch the user from session
    const user = req.session.user;
    if (!user) {
      console.error('[viewGuardrailsPage] No user in session.');
      return res.status(401).send('Not authorized');
    }

    // Possibly fetch the firm if you prefer
    const firm = valueAdd.household?.firmId || null;

    // 2) Set user.companyLogo
    user.companyLogo = (firm && firm.companyLogo) ? firm.companyLogo : '';
    console.log('[viewGuardrailsPage] user.companyLogo =>', user.companyLogo);

    // 3) Also fetch the household's clients
    const householdId = valueAdd.household._id;
    const clients = await Client.find({ household: householdId })
      .select('firstName lastName')
      .lean();

    // 4) Render your page with relevant data
    return res.render('valueAdds/guardrailsView', {
      layout: false,
      guardrailsData: valueAdd.currentData,
      advisors: valueAdd.household.leadAdvisors || [],
      firm: valueAdd.household.firmId || null,
      householdClients: clients || [],
      user,
      hideStatsBanner: true,
    });
  } catch (err) {
    console.error('Error in viewGuardrailsPage:', err);
    return res.status(500).send('Server Error');
  }
};

/**
 * Create a new Buckets ValueAdd for the given household
 */
exports.createBucketsValueAdd = async (req, res) => {
  try {
    const householdId = req.params.householdId;
    console.log('[createBucketsValueAdd] householdId =>', householdId);

    // 1) Fetch the household doc
    const household = await Household.findById(householdId).lean();
    console.log('[createBucketsValueAdd] Found Household =>', household);

    if (!household) {
      console.error('[createBucketsValueAdd] No household found for ID:', householdId);
      return res.status(404).json({ message: 'Household not found.' });
    }

    // 2) Fetch the firm doc to read bucketsDistributionRate
    const firm = await CompanyID.findById(household.firmId).lean();
    if (!firm) {
      console.error('[createBucketsValueAdd] No firm found for firmId:', household.firmId);
    } else {
      console.log('[createBucketsValueAdd] Firm doc =>', firm);
    }

    // 3) Fetch all Accounts for this household
    const accounts = await Account.find({ household: householdId }).lean();
    console.log('[createBucketsValueAdd] Found Accounts =>', accounts);

    // 4) Sum total portfolio value
    let totalPortfolio = 0;
    accounts.forEach(acc => {
      totalPortfolio += (acc.accountValue || 0);
    });
    console.log('[createBucketsValueAdd] totalPortfolio =>', totalPortfolio);

    // 5) Compute monthly distribution from systematicWithdrawAmount
    let totalMonthlyWithdrawal = 0;
    accounts.forEach(acc => {
      if (acc.systematicWithdrawAmount && acc.systematicWithdrawAmount > 0) {
        const freq = acc.systematicWithdrawFrequency || 'Monthly';
        let monthlyEquivalent = 0;
        switch (freq) {
          case 'Quarterly':
            monthlyEquivalent = acc.systematicWithdrawAmount / 3;
            break;
          case 'Annually':
            monthlyEquivalent = acc.systematicWithdrawAmount / 12;
            break;
          default:
            monthlyEquivalent = acc.systematicWithdrawAmount;
        }
        totalMonthlyWithdrawal += monthlyEquivalent;
      }
    });
    console.log('[createBucketsValueAdd] totalMonthlyWithdrawal =>', totalMonthlyWithdrawal);

    // 6) Derive a fallback distributionRate from the household’s actual monthly withdrawals
    let distributionRate = 0;
    if (totalPortfolio > 0 && totalMonthlyWithdrawal > 0) {
      distributionRate = (totalMonthlyWithdrawal * 12) / totalPortfolio;
    }
    console.log('[createBucketsValueAdd] distributionRate =>', distributionRate);

    // 7) Merge that into a new "householdWithSum" for validation & allocations
    const householdWithSum = {
      ...household,
      totalAccountValue: totalPortfolio,
      accounts: accounts,
    };
    console.log('[createBucketsValueAdd] householdWithSum =>', householdWithSum);

    // 8) Validate inputs for Buckets
    const missing = validateBucketsInputs(householdWithSum);
    if (missing.length > 0) {
      console.error('[createBucketsValueAdd] Missing fields =>', missing);
      return res.status(400).json({
        message: 'Cannot generate Buckets. Missing required fields.',
        missingFields: missing,
      });
    }

    // =====================================
    //  Use the user's bucketsDistributionRate
    // =====================================
    const userBucketsDistributionRate = firm?.bucketsDistributionRate ?? 0.054;
    console.log('[createBucketsValueAdd] userBucketsDistributionRate =>', userBucketsDistributionRate);

    // We'll define an offset approach, so that Upper/Lower remain 0.006 away
    const offset = 0.006;
    const newLowerRate = userBucketsDistributionRate - offset;
    const newUpperRate = userBucketsDistributionRate + offset;

    console.log('[createBucketsValueAdd] newLowerRate =>', newLowerRate);
    console.log('[createBucketsValueAdd] newUpperRate =>', newUpperRate);

    // Now call calculateBuckets with these rates
    const bucketsData = calculateBuckets(householdWithSum, {
      distributionRate: userBucketsDistributionRate,
      upperRate: newUpperRate,
      lowerRate: newLowerRate
    });
    console.log('[createBucketsValueAdd] bucketsData =>', bucketsData);

    // 9) Build warnings if any accounts lacked allocations
    const warnings = [];
    if (bucketsData.missingAllocationsCount > 0) {
      warnings.push(
        `There are ${bucketsData.missingAllocationsCount} account(s) missing asset allocation fields.`
      );
    }

    // 10) Create and save the ValueAdd
    const newValueAdd = new ValueAdd({
      household: household._id,
      type: 'BUCKETS',
      currentData: bucketsData,
      history: [{ date: new Date(), data: bucketsData }],
      warnings,
    });

    await newValueAdd.save();
    console.log('[createBucketsValueAdd] New Buckets ValueAdd saved =>', newValueAdd._id);

    return res.status(201).json({
      message: 'Buckets ValueAdd created successfully.',
      valueAdd: newValueAdd,
    });
  } catch (err) {
    console.error('Error in createBucketsValueAdd:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * Update an existing Buckets ValueAdd
 */
exports.updateBucketsValueAdd = async (req, res) => {
  try {
    const valueAddId = req.params.id;
    console.log('[updateBucketsValueAdd] valueAddId =>', valueAddId);

    const valueAdd = await ValueAdd.findById(valueAddId).populate('household');
    console.log('[updateBucketsValueAdd] Found ValueAdd =>', valueAdd);

    if (!valueAdd) {
      console.error('[updateBucketsValueAdd] No ValueAdd found for ID:', valueAddId);
      return res.status(404).json({ message: 'Value Add not found.' });
    }
    if (valueAdd.type !== 'BUCKETS') {
      console.error('[updateBucketsValueAdd] ValueAdd type is not BUCKETS. It is:', valueAdd.type);
      return res.status(400).json({ message: 'Value Add is not of type BUCKETS.' });
    }

    // 1) Convert the Mongoose doc to plain JS object
    const household = valueAdd.household.toObject();
    console.log('[updateBucketsValueAdd] household =>', household);

    // 2) Fetch accounts
    const accounts = await Account.find({ household: household._id }).lean();
    console.log('[updateBucketsValueAdd] Accounts =>', accounts);

    // 3) Sum total portfolio
    let totalPortfolio = 0;
    accounts.forEach(acc => {
      totalPortfolio += (acc.accountValue || 0);
    });
    console.log('[updateBucketsValueAdd] totalPortfolio =>', totalPortfolio);

    // 4) Compute monthly withdrawals => distributionRate
    let totalMonthlyWithdrawal = 0;
    accounts.forEach(acc => {
      if (acc.systematicWithdrawAmount && acc.systematicWithdrawAmount > 0) {
        const freq = acc.systematicWithdrawFrequency || 'Monthly';
        let monthlyEquivalent = 0;
        switch (freq) {
          case 'Quarterly':
            monthlyEquivalent = acc.systematicWithdrawAmount / 3;
            break;
          case 'Annually':
            monthlyEquivalent = acc.systematicWithdrawAmount / 12;
            break;
          default:
            monthlyEquivalent = acc.systematicWithdrawAmount;
        }
        totalMonthlyWithdrawal += monthlyEquivalent;
      }
    });
    console.log('[updateBucketsValueAdd] totalMonthlyWithdrawal =>', totalMonthlyWithdrawal);

    let distributionRate = 0;
    if (totalPortfolio > 0 && totalMonthlyWithdrawal > 0) {
      distributionRate = (totalMonthlyWithdrawal * 12) / totalPortfolio;
    }
    console.log('[updateBucketsValueAdd] distributionRate =>', distributionRate);

    // 5) Build a new object for validation & allocations
    const householdWithSum = {
      ...household,
      totalAccountValue: totalPortfolio,
      accounts: accounts,
    };
    console.log('[updateBucketsValueAdd] householdWithSum =>', householdWithSum);

    // 6) Validate
    const missing = validateBucketsInputs(householdWithSum);
    if (missing.length > 0) {
      console.error('[updateBucketsValueAdd] Missing fields =>', missing);
      return res.status(400).json({
        message: 'Cannot update Buckets. Missing required fields.',
        missingFields: missing,
      });
    }

    // 7) Pull the user's chosen Buckets distribution settings from the firm
    const firm = await CompanyID.findById(valueAdd.household.firmId).lean();
    if (!firm) {
      console.error('[updateBucketsValueAdd] No firm found for firmId:', valueAdd.household.firmId);
    } else {
      console.log('[updateBucketsValueAdd] Firm doc =>', firm);
    }

    const userBucketsDistributionRate = firm?.bucketsDistributionRate ?? 0.054;
    console.log('[updateBucketsValueAdd] userBucketsDistributionRate =>', userBucketsDistributionRate);

    // Same offset approach
    const offset = 0.006;
    const newLowerRate = userBucketsDistributionRate - offset;
    const newUpperRate = userBucketsDistributionRate + offset;
    console.log('[updateBucketsValueAdd] newLowerRate =>', newLowerRate);
    console.log('[updateBucketsValueAdd] newUpperRate =>', newUpperRate);

    // Recalculate
    const bucketsData = calculateBuckets(householdWithSum, {
      distributionRate: userBucketsDistributionRate,
      upperRate: newUpperRate,
      lowerRate: newLowerRate
    });
    console.log('[updateBucketsValueAdd] bucketsData =>', bucketsData);

    // 8) Build warnings
    const warnings = [];
    if (bucketsData.missingAllocationsCount > 0) {
      warnings.push(
        `There are ${bucketsData.missingAllocationsCount} account(s) missing asset allocation fields.`
      );
    }

    // 9) Update the ValueAdd doc
    valueAdd.currentData = bucketsData;
    valueAdd.history.push({ date: new Date(), data: bucketsData });
    valueAdd.warnings = warnings;
    await valueAdd.save();
    console.log('[updateBucketsValueAdd] ValueAdd updated =>', valueAdd._id);

    // 10) Return JSON
    return res.json({
      message: 'Buckets ValueAdd updated successfully.',
      valueAdd,
    });
  } catch (err) {
    console.error('Error in updateBucketsValueAdd:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

const { calculateDistributionTable } = require('../services/distributionTableService');
const { getHouseholdTotals } = require('../services/householdUtils');










/**
 * Render a ValueAdd in HTML form (Guardrails or Buckets).
 */
exports.viewValueAddPage = async (req, res) => {
  try {
    const valueAddId = req.params.id;
    console.log('--- viewValueAddPage START ---');
    console.log(`ValueAdd ID param: ${valueAddId}`);

    const valueAdd = await ValueAdd.findById(valueAddId)
      .populate({
        path: 'household',
        populate: [
          { path: 'leadAdvisors', select: 'name avatar email' },
          {
            path: 'firmId',
            // add bucketsTitle and bucketsDisclaimer to the select
            select: 'companyName companyLogo phoneNumber companyAddress companyWebsite bucketsEnabled bucketsTitle bucketsDisclaimer  bucketsDistributionRate companyBrandingColor guardrailsEnabled guardrailsTitle guardrailsDisclaimer guardrailsDistributionRate guardrailsUpperFactor guardrailsLowerFactor '
          }
        ]
      })
      .lean();

    if (!valueAdd) {
      console.error('[viewValueAddPage] No ValueAdd found for ID:', valueAddId);
      return res.status(404).send('Value Add not found');
    }

    console.log(`[viewValueAddPage] ValueAdd type: ${valueAdd.type}`);

    // ----------------------------------------------------------------------
    // Handle BUCKETS
    // ----------------------------------------------------------------------
    if (valueAdd.type === 'BUCKETS') {
      // 1) Load buckets.html
      let bucketsHtml;
      try {
        bucketsHtml = fs.readFileSync(
          path.join(__dirname, '..', 'views', 'valueAdds', 'buckets.html'),
          'utf8'
        );
      } catch (readErr) {
        console.error('[viewValueAddPage] Error reading buckets.html:', readErr);
        return res.status(500).send('Error loading Buckets template');
      }

      // 2) Fetch the Household as a Mongoose doc
      const householdId = valueAdd.household._id;
      console.log(`[viewValueAddPage] BUCKETS => Household ID: ${householdId}`);

      const householdDoc = await Household.findById(householdId).populate('accounts').exec();
      if (!householdDoc) {
        console.log('[viewValueAddPage] No household found with that ID in the DB.');
        return res.status(404).send('Household not found');
      }

      // 3) Recompute total assets & monthly distribution
      const { totalAssets, monthlyDistribution } = getHouseholdTotals(householdDoc);
      householdDoc.totalAccountValue = totalAssets;
      householdDoc.actualMonthlyDistribution = monthlyDistribution;
      await householdDoc.save();

      // 4) Convert to plain object
      const freshHousehold = householdDoc.toObject();
      console.log('[viewValueAddPage] freshHousehold =>', freshHousehold);

      // 5) Fetch clients for display name
      const clients = await Client.find({ household: householdId }).lean();
      console.log('[viewValueAddPage] BUCKETS => clients =>', clients);

      let clientNameLine = '---';
      if (clients.length === 1) {
        const c = clients[0];
        clientNameLine = `${c.lastName}, ${c.firstName}`;
      } else if (clients.length === 2) {
        const [c1, c2] = clients;
        if (
          c1.lastName &&
          c2.lastName &&
          c1.lastName.toLowerCase() === c2.lastName.toLowerCase()
        ) {
          clientNameLine = `${c1.lastName}, ${c1.firstName} & ${c2.firstName}`;
        } else {
          clientNameLine = `${c1.lastName}, ${c1.firstName} & ${c2.lastName}, ${c2.firstName}`;
        }
      } else if (clients.length > 2) {
        const c = clients[0];
        clientNameLine = `${c.lastName}, ${c.firstName}`;
      }

      // 6) Distribution table logic for “Current”, “Available”, “Upper”, “Lower”
      const firm = valueAdd.household?.firmId || {};
      console.log('[viewValueAddPage] BUCKETS => firm =>', firm);

      const DEFAULT_LOWER  = 0.048;
      const DEFAULT_AVAIL  = 0.054;
      const DEFAULT_UPPER  = 0.060;
      
      const OFFSET_BELOW = DEFAULT_AVAIL - DEFAULT_LOWER;
      const OFFSET_ABOVE = DEFAULT_UPPER - DEFAULT_AVAIL;
      
      const userAvailableRate = (firm?.bucketsDistributionRate != null)
        ? firm.bucketsDistributionRate
        : 0.054;

      console.log('[viewValueAddPage] userAvailableRate (buckets) =>', userAvailableRate);

      const newLowerRate = userAvailableRate - OFFSET_BELOW;
      const newUpperRate = userAvailableRate + OFFSET_ABOVE;
      console.log('[viewValueAddPage] newLowerRate (buckets) =>', newLowerRate);
      console.log('[viewValueAddPage] newUpperRate (buckets) =>', newUpperRate);

      const distOptions = {
        availableRate: userAvailableRate,
        upperRate: newUpperRate,
        lowerRate: newLowerRate
      };

      const distTable = calculateDistributionTable(freshHousehold, distOptions);
      console.log('[viewValueAddPage] distTable (buckets) =>', distTable);

      // 7) Bucket-specific data from the ValueAdd
      const valueAddTitle = firm.bucketsTitle || 'Buckets Strategy';
      const customDisclaimer = firm.bucketsDisclaimer || 'Some default disclaimers...';
      const d = valueAdd.currentData || {};
      const hideAnnuitiesColumn = (d.annuitiesPercent ?? 0) === 0;
      const reportDate = new Date().toLocaleDateString();
      const firmLogo = valueAdd.household?.firmId?.companyLogo || '';
      const firmColor = firm.companyBrandingColor || '#282e38';

      // Bucket bars
      const cashHeightPx = `${(d.cashHeight || 0).toFixed(0)}px`;
      const incomeHeightPx = `${(d.incomeHeight || 0).toFixed(0)}px`;
      const annuitiesHeightPx = `${(d.annuitiesHeight || 0).toFixed(0)}px`;
      const growthHeightPx = `${(d.growthHeight || 0).toFixed(0)}px`;

      // Bucket Amounts
      const cashAmt = (d.cashAmount || 0).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
      const incomeAmt = (d.incomeAmount || 0).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
      const annuitiesAmt = (d.annuitiesAmount || 0).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
      const growthAmt = (d.growthAmount || 0).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });

      // "Total Assets" label
      const totalAssetsForLabel = d.portfolioValue || 0;
      function roundDownToNearestThousand(amount) {
        return Math.floor(amount / 1000) * 1000;
      }
      const roundedTotalAssets = roundDownToNearestThousand(totalAssetsForLabel);
      const formattedTotalAssets = roundedTotalAssets.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });

      // Dist Table columns
      const currentPortValueNum = distTable.current.portfolioValue || 0;
      const currentPortValue = currentPortValueNum.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
      const currentRateNum = distTable.current.distributionRate || 0;
      const currentDistribRate = `${(currentRateNum * 100).toFixed(1)}%`;
      const currentMonthlyIncomeNum = distTable.current.monthlyIncome || 0;
      const currentMonthlyIncome = currentMonthlyIncomeNum.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });

      // Available column
      const availablePortValue = currentPortValue;
      const availableRateNum = distTable.available.distributionRate || 0;
      const availableDistribRate = `${(availableRateNum * 100).toFixed(1)}%`;
      const availableMonthlyIncomeNum = distTable.available.monthlyIncome || 0;
      const availableMonthlyIncome = availableMonthlyIncomeNum.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });

      // Upper
      const upperPortValueNum = distTable.upper.portfolioValue || 0;
      const upperPortValue = upperPortValueNum.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
      const upperRateNum = distTable.upper.distributionRate || 0;
      const upperDistribRate = `${(upperRateNum * 100).toFixed(1)}%`;
      const upperMonthlyIncomeNum = distTable.upper.monthlyIncome || 0;
      const upperMonthlyIncome = upperMonthlyIncomeNum.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });

      // Lower
      const lowerPortValueNum = distTable.lower.portfolioValue || 0;
      const lowerPortValue = lowerPortValueNum.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
      const lowerRateNum = distTable.lower.distributionRate || 0;
      const lowerDistribRate = `${(lowerRateNum * 100).toFixed(1)}%`;
      const lowerMonthlyIncomeNum = distTable.lower.monthlyIncome || 0;
      const lowerMonthlyIncome = lowerMonthlyIncomeNum.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });

      // 9) Build replacements
      const replacements = {
        '{{FIRM_LOGO}}': firmLogo,
        '{{VALUE_ADD_TITLE}}': valueAddTitle,
        '{{BUCKETS_DISCLAIMER}}': customDisclaimer,
        '{{CLIENT_NAME_LINE}}': clientNameLine,
        '{{REPORT_DATE}}': reportDate,
        '{{BRAND_COLOR}}': firmColor,

        '{{TOTAL_ASSETS}}': formattedTotalAssets,
        '{{HIDE_ANNUITIES}}': hideAnnuitiesColumn ? 'display: none;' : '',


        '{{CASH_HEIGHT}}': cashHeightPx,
        '{{INCOME_HEIGHT}}': incomeHeightPx,
        '{{ANNUITIES_HEIGHT}}': annuitiesHeightPx,
        '{{GROWTH_HEIGHT}}': growthHeightPx,

        '{{CASH_AMOUNT}}': cashAmt,
        '{{INCOME_AMOUNT}}': incomeAmt,
        '{{ANNUITIES_AMOUNT}}': annuitiesAmt,
        '{{GROWTH_AMOUNT}}': growthAmt,

        '{{CURRENT_PORT_VALUE}}': currentPortValue,
        '{{AVAILABLE_PORT_VALUE}}': availablePortValue,
        '{{UPPER_PORT_VALUE}}': upperPortValue,
        '{{LOWER_PORT_VALUE}}': lowerPortValue,

        '{{CURRENT_DISTRIB_RATE}}': currentDistribRate,
        '{{AVAILABLE_DISTRIB_RATE}}': availableDistribRate,
        '{{UPPER_DISTRIB_RATE}}': upperDistribRate,
        '{{LOWER_DISTRIB_RATE}}': lowerDistribRate,

        '{{CURRENT_MONTHLY_INCOME}}': currentMonthlyIncome,
        '{{AVAILABLE_MONTHLY_INCOME}}': availableMonthlyIncome,
        '{{UPPER_MONTHLY_INCOME}}': upperMonthlyIncome,
        '{{LOWER_MONTHLY_INCOME}}': lowerMonthlyIncome,
      };

      // Footer fields
      const firmData = valueAdd.household?.firmId || {};
      const fPhone = firmData.phoneNumber || '';
      const fAddress = firmData.companyAddress || '';
      const fWebsite = firmData.companyWebsite || '';

      const footerParts = [];
      if (fAddress) footerParts.push(`<span class="firmField">${fAddress}</span>`);
      if (fPhone) footerParts.push(`<span class="firmField">${fPhone}</span>`);
      if (fWebsite) footerParts.push(`<span class="firmField">${fWebsite}</span>`);

      const footerCombined = footerParts.join(`<div class="footerBall"></div>`);
      replacements['{{FIRM_FOOTER_INFO}}'] = footerCombined;

      // 4) Do all replacements
      for (const [placeholder, val] of Object.entries(replacements)) {
        const regex = new RegExp(placeholder, 'g');
        bucketsHtml = bucketsHtml.replace(regex, val);
      }

      // 11) Send final Buckets HTML
      console.log('[viewValueAddPage] Sending final Buckets HTML...');
      return res.send(bucketsHtml);

    // ----------------------------------------------------------------------
    // Handle GUARDRAILS
    // ----------------------------------------------------------------------
    } else if (valueAdd.type === 'GUARDRAILS') {
      // 1) Load guardrails.html
      let guardrailsHtml;
      try {
        guardrailsHtml = fs.readFileSync(
          path.join(__dirname, '..', 'views', 'valueAdds', 'guardrails.html'),
          'utf8'
        );
      } catch (readErr) {
        console.error('[viewValueAddPage] Error reading guardrails.html:', readErr);
        return res.status(500).send('Error loading Guardrails template');
      }

      // 2) Fetch Household similarly
      const householdId = valueAdd.household._id;
      console.log(`[viewValueAddPage] GUARDRAILS => Household ID: ${householdId}`);

      const householdDoc = await Household.findById(householdId).populate('accounts').exec();
      if (!householdDoc) {
        console.log('[viewValueAddPage] No household found for that ID.');
        return res.status(404).send('Household not found');
      }
      const firm = valueAdd.household?.firmId || {};

      // 3) Recompute totals
      const { totalAssets, monthlyDistribution } = getHouseholdTotals(householdDoc);
      householdDoc.totalAccountValue = totalAssets;
      householdDoc.actualMonthlyDistribution = monthlyDistribution;
      await householdDoc.save();

      const freshHousehold = householdDoc.toObject();
      console.log('[viewValueAddPage] GUARDRAILS => freshHousehold =>', freshHousehold);

      // 4) Clients for display name
      const clients = await Client.find({ household: householdId }).lean();
      console.log('[viewValueAddPage] GUARDRAILS => clients =>', clients);

      let guardrailsClientName = '---';
      if (clients.length === 1) {
        const c = clients[0];
        guardrailsClientName = `${c.lastName}, ${c.firstName}`;
      } else if (clients.length === 2) {
        const [gc1, gc2] = clients;
        if (
          gc1.lastName &&
          gc2.lastName &&
          gc1.lastName.toLowerCase() === gc2.lastName.toLowerCase()
        ) {
          guardrailsClientName = `${gc1.lastName}, ${gc1.firstName} & ${gc2.firstName}`;
        } else {
          guardrailsClientName = `${gc1.lastName}, ${gc1.firstName} & ${gc2.lastName}, ${gc2.firstName}`;
        }
      } else if (clients.length > 2) {
        const c = clients[0];
        guardrailsClientName = `${c.lastName}, ${c.firstName}`;
      }

      const DEFAULT_LOWER  = 0.048;
      const DEFAULT_AVAIL  = 0.054;
      const DEFAULT_UPPER  = 0.060;
      
      const OFFSET_BELOW = DEFAULT_AVAIL - DEFAULT_LOWER;
      const OFFSET_ABOVE = DEFAULT_UPPER - DEFAULT_AVAIL;
      
      const userAvailableRate = (firm?.bucketsDistributionRate != null)
        ? firm.bucketsDistributionRate
        : 0.054;

      console.log('[viewValueAddPage] guardrails => userAvailableRate =>', userAvailableRate);

      const newLowerRate = userAvailableRate - OFFSET_BELOW;
      const newUpperRate = userAvailableRate + OFFSET_ABOVE;
      console.log('[viewValueAddPage] guardrails => newLowerRate =>', newLowerRate);
      console.log('[viewValueAddPage] guardrails => newUpperRate =>', newUpperRate);

      const distOptions = {
        availableRate: userAvailableRate,
        upperRate: newUpperRate,
        lowerRate: newLowerRate
      };
      const guardrailsTable = calculateDistributionTable(freshHousehold, distOptions);
      console.log('[viewValueAddPage] guardrails => guardrailsTable =>', guardrailsTable);

      // 6) Build placeholders
      const guardrailsTitle = firm.guardrailsTitle || 'Guardrails Strategy';
      const customDisclaimer = firm.guardrailsDisclaimer || 'Some default disclaimers...';

      const guardrailsReportDate = new Date().toLocaleDateString();
      const guardrailsFirmLogo = valueAdd.household?.firmId?.companyLogo || '';
      const distTable = calculateDistributionTable(freshHousehold, distOptions);
      const firmColor = firm.companyBrandingColor || '#282e38';

      // ---------------------------------------------------------
      // Current scenario (show 0 decimals for currency, as Buckets does)
      // ---------------------------------------------------------
      const curPV = guardrailsTable.current.portfolioValue || 0;
      const curRate = guardrailsTable.current.distributionRate || 0;
      const curMonthly = guardrailsTable.current.monthlyIncome || 0;

      // Convert to 0-decimal currency
      const currentPortValue = curPV.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
      const currentDistribRate = `${(curRate * 100).toFixed(1)}%`;
      const currentMonthlyIncome = curMonthly.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });

      // ---------------------------------------------------------
      // Available scenario
      // ---------------------------------------------------------
      const avPV = guardrailsTable.available.portfolioValue || 0;
      const avRate = guardrailsTable.available.distributionRate || 0;
      const avMonthly = guardrailsTable.available.monthlyIncome || 0;

      const availablePortValue = avPV.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
      const availableDistribRate = `${(avRate * 100).toFixed(1)}%`;
      const availableMonthlyIncome = avMonthly.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });

      // ---------------------------------------------------------
      // Upper scenario
      // ---------------------------------------------------------
      const upPV = guardrailsTable.upper.portfolioValue || 0;
      const upRate = guardrailsTable.upper.distributionRate || 0;
      const upMonthly = guardrailsTable.upper.monthlyIncome || 0;

      const upperPortValue = upPV.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
      const upperDistribRate = `${(upRate * 100).toFixed(1)}%`;
      const upperMonthlyIncome = upMonthly.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });

      // ---------------------------------------------------------
      // Lower scenario
      // ---------------------------------------------------------
      const lowPV = guardrailsTable.lower.portfolioValue || 0;
      const lowRate = guardrailsTable.lower.distributionRate || 0;
      const lowMonthly = guardrailsTable.lower.monthlyIncome || 0;

      // Adjust positioning for the "Current" vertical marker
      let ratio = (curRate - lowRate) / (upRate - lowRate);
      if (ratio < 0) {
        ratio = ratio * 0.3;
        if (ratio < -0.2) ratio = -0.2;
      }
      if (ratio > 1) {
        ratio = 1 + (ratio - 1) * 0.3;
        if (ratio > 1.2) ratio = 1.2;
      }
      const leftPercent = 14.4 + (ratio * 71.2);
      const currentDistribLeft = `${leftPercent.toFixed(1)}%`;

      const lowerPortValue = lowPV.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });
      const lowerDistribRate = `${(lowRate * 100).toFixed(1)}%`;
      const lowerMonthlyIncome = lowMonthly.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      });

      try {
        guardrailsHtml = guardrailsHtml.replace(/{{FIRM_LOGO}}/g, guardrailsFirmLogo);
        guardrailsHtml = guardrailsHtml.replace(/{{BRAND_COLOR}}/g, firmColor);
        guardrailsHtml = guardrailsHtml.replace(/{{VALUE_ADD_TITLE}}/g, guardrailsTitle);
        guardrailsHtml = guardrailsHtml.replace(/{{CLIENT_NAME_LINE}}/g, guardrailsClientName);
        guardrailsHtml = guardrailsHtml.replace(/{{REPORT_DATE}}/g, guardrailsReportDate);
        guardrailsHtml = guardrailsHtml.replace(/{{CURRENT_DISTRIB_LEFT}}/g, currentDistribLeft);
        guardrailsHtml = guardrailsHtml.replace(/{{CURRENT_DISTRIB_RATE}}/g, currentDistribRate);

        guardrailsHtml = guardrailsHtml.replace(/{{CURRENT_PORT_VALUE}}/g, currentPortValue);
        guardrailsHtml = guardrailsHtml.replace(/{{CURRENT_MONTHLY_INCOME}}/g, currentMonthlyIncome);

        guardrailsHtml = guardrailsHtml.replace(/{{AVAILABLE_PORT_VALUE}}/g, availablePortValue);
        guardrailsHtml = guardrailsHtml.replace(/{{AVAILABLE_DISTRIB_RATE}}/g, availableDistribRate);
        guardrailsHtml = guardrailsHtml.replace(/{{AVAILABLE_MONTHLY_INCOME}}/g, availableMonthlyIncome);

        guardrailsHtml = guardrailsHtml.replace(/{{UPPER_PORT_VALUE}}/g, upperPortValue);
        guardrailsHtml = guardrailsHtml.replace(/{{UPPER_DISTRIB_RATE}}/g, upperDistribRate);
        guardrailsHtml = guardrailsHtml.replace(/{{UPPER_MONTHLY_INCOME}}/g, upperMonthlyIncome);

        guardrailsHtml = guardrailsHtml.replace(/{{LOWER_PORT_VALUE}}/g, lowerPortValue);
        guardrailsHtml = guardrailsHtml.replace(/{{LOWER_DISTRIB_RATE}}/g, lowerDistribRate);
        guardrailsHtml = guardrailsHtml.replace(/{{LOWER_MONTHLY_INCOME}}/g, lowerMonthlyIncome);

        // Insert guardrails disclaimer placeholder
        guardrailsHtml = guardrailsHtml.replace(/{{GUARDRAILS_DISCLAIMER}}/g, customDisclaimer);

        const fPhone = firm.phoneNumber || '';
        const fAddress = firm.companyAddress || '';
        const fWebsite = firm.companyWebsite || '';

        const footerParts = [];
        if (fAddress) footerParts.push(`<span class="firmField">${fAddress}</span>`);
        if (fPhone) footerParts.push(`<span class="firmField">${fPhone}</span>`);
        if (fWebsite) footerParts.push(`<span class="firmField">${fWebsite}</span>`);

        const footerCombined = footerParts.join(' <div class="footerBall"></div> ');
        guardrailsHtml = guardrailsHtml.replace(/{{FIRM_FOOTER_INFO}}/g, footerCombined);
      } catch (replaceErr) {
        console.error('[viewValueAddPage] Error replacing placeholders in guardrailsHtml:', replaceErr);
        return res.status(500).send('Error processing Guardrails HTML');
      }

      // 8) Send final HTML
      console.log('[viewValueAddPage] Sending Guardrails HTML...');
      return res.send(guardrailsHtml);

    // Otherwise => unsupported
    } else {
      console.log('[viewValueAddPage] Not a recognized Value Add type:', valueAdd.type);
      return res.status(400).send('Unsupported Value Add type');
    }
  } catch (err) {
    console.error('Error in viewValueAddPage:', err);
    return res.status(500).send('Server Error');
  }
};









const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');

/** Generate PDF with a short wait for older Puppeteer */
async function generateValueAddPDF(url) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2' });
  await new Promise(resolve => setTimeout(resolve, 2000)); // 2s
  const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
  await browser.close();
  return pdfBuffer;
}

exports.downloadValueAddPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const viewUrl = `${req.protocol}://${req.get('host')}/api/value-add/${id}/view`;

    const pdfBuffer = await generateValueAddPDF(viewUrl);

    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="value-add-${id}.pdf"`,
      'Content-Length': pdfBuffer.length
    });
    return res.end(pdfBuffer, 'binary');
  } catch (error) {
    console.error('Error generating PDF for download:', error);
    return res.status(500).send('Failed to generate PDF');
  }
};

exports.emailValueAddPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const { recipient } = req.body;
    if (!recipient) {
      console.error('[emailValueAddPDF] No recipient provided.');
      return res.status(400).json({ message: 'No recipient provided.' });
    }

    const viewUrl = `${req.protocol}://${req.get('host')}/api/value-add/${id}/view`;
    console.log('[emailValueAddPDF] Generating PDF from =>', viewUrl);
    const pdfBuffer = await generateValueAddPDF(viewUrl);

    // Use real SMTP in production
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: (process.env.SMTP_SECURE === 'true'),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const mailOptions = {
      from: '"SurgeTech" <no-reply@yourdomain.com>',
      to: recipient,
      subject: 'Your Value Add Document',
      text: 'Hello,\n\nAttached is your Value Add PDF.\n',
      attachments: [
        {
          filename: `value-add-${id}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('[emailValueAddPDF] Email sent =>', info.messageId);

    return res.json({ message: 'Email sent successfully' });
  } catch (error) {
    console.error('Error emailing PDF:', error);
    return res.status(500).json({ message: 'Error sending email', error: error.message });
  }
};

exports.openEmailClient = async (req, res) => {
  try {
    const { id } = req.params;
    const pdfLink = `${req.protocol}://${req.get('host')}/api/value-add/${id}/download`;
    console.log('[openEmailClient] pdfLink =>', pdfLink);

    const subject = encodeURIComponent('Your Value Add Document');
    const body = encodeURIComponent(`Hello,\n\nHere is the Value Add: ${pdfLink}\n\n`);

    return res.redirect(`mailto:?subject=${subject}&body=${body}`);
  } catch (err) {
    console.error('Error generating mailto link:', err);
    return res.status(500).send('Failed to open mail client');
  }
};

/**
 * POST /api/value-add/:id/email
 * - Actually send the PDF as an attachment via Nodemailer
 * - The user can specify any recipient in req.body
 */
exports.emailValueAddPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const { recipient } = req.body;
    if (!recipient) {
      console.error('[emailValueAddPDF duplicate] No recipient provided.');
      return res.status(400).json({ message: 'No recipient provided.' });
    }

    const viewUrl = `${req.protocol}://${req.get('host')}/api/value-add/${id}/view`;
    console.log('[emailValueAddPDF duplicate] Generating PDF from =>', viewUrl);
    const pdfBuffer = await generateValueAddPDF(viewUrl);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: (process.env.SMTP_SECURE === 'true'),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const mailOptions = {
      from: '"SurgeTech" <no-reply@yourdomain.com>',
      to: recipient,
      subject: 'Your Value Add Document',
      text: 'Hello,\n\nAttached is your Value Add PDF.\n',
      attachments: [
        {
          filename: `value-add-${id}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('[emailValueAddPDF duplicate] Email sent =>', info.messageId);

    return res.json({ message: 'Email sent successfully' });
  } catch (error) {
    console.error('Error emailing PDF:', error);
    return res.status(500).json({ message: 'Error sending email', error: error.message });
  }
};





/**
 * POST /api/value-add/:id/save-snapshot
 * 
 * Replicates EXACTLY the logic from viewValueAddPage for either
 * BUCKETS or GUARDRAILS, then stores the final replaced HTML
 * in the snapshot data. This ensures the snapshot is 100% accurate
 * and will match what the user saw on screen.
 */
exports.saveValueAddSnapshot = async (req, res) => {
  try {
    const valueAddId = req.params.id;
    console.log('--- saveValueAddSnapshot START ---');
    console.log(`ValueAdd ID param: ${valueAddId}`);

    // 1) Fetch the ValueAdd, including household -> accounts -> firm, etc.
    const valueAdd = await ValueAdd.findById(valueAddId)
      .populate({
        path: 'household',
        populate: [
          { path: 'leadAdvisors', select: 'name avatar email' },
          {
            path: 'firmId',
            select: `
              companyName companyLogo phoneNumber companyAddress companyWebsite
              bucketsEnabled bucketsTitle bucketsDisclaimer bucketsDistributionRate companyBrandingColor
              guardrailsEnabled guardrailsTitle guardrailsDisclaimer guardrailsDistributionRate
              guardrailsUpperFactor guardrailsLowerFactor
            `
          }
        ]
      })
      .exec();

    if (!valueAdd) {
      console.error('[saveValueAddSnapshot] No ValueAdd found for ID:', valueAddId);
      return res.status(404).json({ message: 'Value Add not found' });
    }

    console.log(`[saveValueAddSnapshot] ValueAdd type: ${valueAdd.type}`);

    let finalReplacedHtml = ''; // We'll store the fully replaced HTML here.

    // ----------------------------------------------------------------------
    // Handle BUCKETS
    // ----------------------------------------------------------------------
    if (valueAdd.type === 'BUCKETS') {
      // 1) Load buckets.html (as in viewValueAddPage)
      let bucketsHtml;
      try {
        bucketsHtml = fs.readFileSync(
          path.join(__dirname, '..', 'views', 'valueAdds', 'buckets.html'),
          'utf8'
        );
      } catch (readErr) {
        console.error('[saveValueAddSnapshot] Error reading buckets.html:', readErr);
        return res.status(500).json({ message: 'Error loading Buckets template' });
      }

      // 2) Fetch Household w/ accounts
      const householdId = valueAdd.household._id;
      const householdDoc = await Household.findById(householdId).populate('accounts').exec();
      if (!householdDoc) {
        console.log('[saveValueAddSnapshot] No household found with that ID.');
        return res.status(404).json({ message: 'Household not found' });
      }

      // 3) Recompute totals
      const { totalAssets, monthlyDistribution } = getHouseholdTotals(householdDoc);
      householdDoc.totalAccountValue = totalAssets;
      householdDoc.actualMonthlyDistribution = monthlyDistribution;
      await householdDoc.save();

      // Convert to plain object
      const freshHousehold = householdDoc.toObject();
      console.log('[saveValueAddSnapshot] freshHousehold =>', freshHousehold);

      // 4) Fetch clients for display name
      const clients = await Client.find({ household: householdId }).lean();
      console.log('[saveValueAddSnapshot] BUCKETS => clients =>', clients);

      let clientNameLine = '---';
      if (clients.length === 1) {
        const c = clients[0];
        clientNameLine = `${c.lastName}, ${c.firstName}`;
      } else if (clients.length === 2) {
        const [c1, c2] = clients;
        if (
          c1.lastName &&
          c2.lastName &&
          c1.lastName.toLowerCase() === c2.lastName.toLowerCase()
        ) {
          clientNameLine = `${c1.lastName}, ${c1.firstName} & ${c2.firstName}`;
        } else {
          clientNameLine = `${c1.lastName}, ${c1.firstName} & ${c2.lastName}, ${c2.firstName}`;
        }
      } else if (clients.length > 2) {
        const c = clients[0];
        clientNameLine = `${c.lastName}, ${c.firstName}`;
      }

      // 5) Distribution table logic
      const firm = valueAdd.household?.firmId || {};
      const DEFAULT_LOWER = 0.048;
      const DEFAULT_AVAIL = 0.054;
      const DEFAULT_UPPER = 0.060;

      const OFFSET_BELOW = DEFAULT_AVAIL - DEFAULT_LOWER;
      const OFFSET_ABOVE = DEFAULT_UPPER - DEFAULT_AVAIL;

      const userAvailableRate = (firm?.bucketsDistributionRate != null)
        ? firm.bucketsDistributionRate
        : 0.054;

      const newLowerRate = userAvailableRate - OFFSET_BELOW;
      const newUpperRate = userAvailableRate + OFFSET_ABOVE;

      const distOptions = {
        availableRate: userAvailableRate,
        upperRate: newUpperRate,
        lowerRate: newLowerRate
      };

      const distTable = calculateDistributionTable(freshHousehold, distOptions);
      console.log('[saveValueAddSnapshot] BUCKETS => distTable =>', distTable);

      // 6) Build final placeholders same as in viewValueAddPage
      const valueAddTitle = firm.bucketsTitle || 'Buckets Strategy';
      const customDisclaimer = firm.bucketsDisclaimer || 'Some default disclaimers...';
      const d = valueAdd.currentData || {};
      const reportDate = new Date().toLocaleDateString();
      const firmLogo = firm.companyLogo || '';
      const firmColor = firm.companyBrandingColor || '#282e38';

      const cashHeightPx     = `${(d.cashHeight || 0).toFixed(0)}px`;
      const incomeHeightPx   = `${(d.incomeHeight || 0).toFixed(0)}px`;
      const annuitiesHeightPx= `${(d.annuitiesHeight || 0).toFixed(0)}px`;
      const growthHeightPx   = `${(d.growthHeight || 0).toFixed(0)}px`;

      const cashAmt = (d.cashAmount || 0).toLocaleString('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
      });
      const incomeAmt = (d.incomeAmount || 0).toLocaleString('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
      });
      const annuitiesAmt = (d.annuitiesAmount || 0).toLocaleString('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
      });
      const growthAmt = (d.growthAmount || 0).toLocaleString('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
      });

      function roundDownToNearestThousand(amount) {
        return Math.floor(amount / 1000) * 1000;
      }
      const totalAssetsForLabel = d.portfolioValue || 0;
      const roundedTotalAssets = roundDownToNearestThousand(totalAssetsForLabel);
      const formattedTotalAssets = roundedTotalAssets.toLocaleString('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
      });

      // Dist table columns
      const currentPortValueNum = distTable.current.portfolioValue || 0;
      const currentPortValue = currentPortValueNum.toLocaleString('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
      });
      const currentRateNum = distTable.current.distributionRate || 0;
      const currentDistribRate = `${(currentRateNum * 100).toFixed(1)}%`;
      const currentMonthlyIncomeNum = distTable.current.monthlyIncome || 0;
      const currentMonthlyIncome = currentMonthlyIncomeNum.toLocaleString('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
      });

      const availablePortValue = currentPortValue;
      const availableRateNum = distTable.available.distributionRate || 0;
      const availableDistribRate = `${(availableRateNum * 100).toFixed(1)}%`;
      const availableMonthlyIncomeNum = distTable.available.monthlyIncome || 0;
      const availableMonthlyIncome = availableMonthlyIncomeNum.toLocaleString('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
      });

      const upperPortValueNum = distTable.upper.portfolioValue || 0;
      const upperPortValue = upperPortValueNum.toLocaleString('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
      });
      const upperRateNum = distTable.upper.distributionRate || 0;
      const upperDistribRate = `${(upperRateNum * 100).toFixed(1)}%`;
      const upperMonthlyIncomeNum = distTable.upper.monthlyIncome || 0;
      const upperMonthlyIncome = upperMonthlyIncomeNum.toLocaleString('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
      });

      const lowerPortValueNum = distTable.lower.portfolioValue || 0;
      const lowerPortValue = lowerPortValueNum.toLocaleString('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
      });
      const lowerRateNum = distTable.lower.distributionRate || 0;
      const lowerDistribRate = `${(lowerRateNum * 100).toFixed(1)}%`;
      const lowerMonthlyIncomeNum = distTable.lower.monthlyIncome || 0;
      const lowerMonthlyIncome = lowerMonthlyIncomeNum.toLocaleString('en-US', {
        style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
      });

      // 7) Perform the same placeholder replacements
      const replacements = {
        '{{FIRM_LOGO}}': firmLogo,
        '{{VALUE_ADD_TITLE}}': valueAddTitle,
        '{{BUCKETS_DISCLAIMER}}': customDisclaimer,
        '{{CLIENT_NAME_LINE}}': clientNameLine,
        '{{REPORT_DATE}}': reportDate,
        '{{BRAND_COLOR}}': firmColor,

        '{{TOTAL_ASSETS}}': formattedTotalAssets,

        '{{CASH_HEIGHT}}': cashHeightPx,
        '{{INCOME_HEIGHT}}': incomeHeightPx,
        '{{ANNUITIES_HEIGHT}}': annuitiesHeightPx,
        '{{GROWTH_HEIGHT}}': growthHeightPx,

        '{{CASH_AMOUNT}}': cashAmt,
        '{{INCOME_AMOUNT}}': incomeAmt,
        '{{ANNUITIES_AMOUNT}}': annuitiesAmt,
        '{{GROWTH_AMOUNT}}': growthAmt,

        '{{CURRENT_PORT_VALUE}}': currentPortValue,
        '{{AVAILABLE_PORT_VALUE}}': availablePortValue,
        '{{UPPER_PORT_VALUE}}': upperPortValue,
        '{{LOWER_PORT_VALUE}}': lowerPortValue,

        '{{CURRENT_DISTRIB_RATE}}': currentDistribRate,
        '{{AVAILABLE_DISTRIB_RATE}}': availableDistribRate,
        '{{UPPER_DISTRIB_RATE}}': upperDistribRate,
        '{{LOWER_DISTRIB_RATE}}': lowerDistribRate,

        '{{CURRENT_MONTHLY_INCOME}}': currentMonthlyIncome,
        '{{AVAILABLE_MONTHLY_INCOME}}': availableMonthlyIncome,
        '{{UPPER_MONTHLY_INCOME}}': upperMonthlyIncome,
        '{{LOWER_MONTHLY_INCOME}}': lowerMonthlyIncome,
      };

      // Footer
      const fPhone = firm.phoneNumber || '';
      const fAddress = firm.companyAddress || '';
      const fWebsite = firm.companyWebsite || '';
      const footerParts = [];
      if (fAddress) footerParts.push(`<span class="firmField">${fAddress}</span>`);
      if (fPhone)   footerParts.push(`<span class="firmField">${fPhone}</span>`);
      if (fWebsite) footerParts.push(`<span class="firmField">${fWebsite}</span>`);
      const footerCombined = footerParts.join(`<div class="footerBall"></div>`);
      replacements['{{FIRM_FOOTER_INFO}}'] = footerCombined;

      // Replace in bucketsHtml
      for (const [placeholder, val] of Object.entries(replacements)) {
        const regex = new RegExp(placeholder, 'g');
        bucketsHtml = bucketsHtml.replace(regex, val);
      }

      finalReplacedHtml = bucketsHtml;

    // ----------------------------------------------------------------------
    // Handle GUARDRAILS
    // ----------------------------------------------------------------------
  } else if (valueAdd.type === 'GUARDRAILS') {
    let guardrailsHtml;
    try {
      guardrailsHtml = fs.readFileSync(
        path.join(__dirname, '..', 'views', 'valueAdds', 'guardrails.html'),
        'utf8'
      );
    } catch (readErr) {
      console.error('[saveValueAddSnapshot] Error reading guardrails.html:', readErr);
      return res.status(500).json({ message: 'Error loading Guardrails template' });
    }
  
    // 2) Fetch Household w/ accounts
    const householdId = valueAdd.household._id;
    const householdDoc = await Household.findById(householdId).populate('accounts').exec();
    if (!householdDoc) {
      console.log('[saveValueAddSnapshot] No household found for that ID.');
      return res.status(404).json({ message: 'Household not found' });
    }
    const firm = valueAdd.household?.firmId || {};
  
    // 3) Recompute totals
    const { totalAssets, monthlyDistribution } = getHouseholdTotals(householdDoc);
    householdDoc.totalAccountValue = totalAssets;
    householdDoc.actualMonthlyDistribution = monthlyDistribution;
    await householdDoc.save();
  
    const freshHousehold = householdDoc.toObject();
  
    // 4) Clients
    const clients = await Client.find({ household: householdId }).lean();
    let guardrailsClientName = '---';
    if (clients.length === 1) {
      const c = clients[0];
      guardrailsClientName = `${c.lastName}, ${c.firstName}`;
    } else if (clients.length === 2) {
      const [gc1, gc2] = clients;
      if (
        gc1.lastName &&
        gc2.lastName &&
        gc1.lastName.toLowerCase() === gc2.lastName.toLowerCase()
      ) {
        guardrailsClientName = `${gc1.lastName}, ${gc1.firstName} & ${gc2.firstName}`;
      } else {
        guardrailsClientName = `${gc1.lastName}, ${gc1.firstName} & ${gc2.lastName}, ${gc2.firstName}`;
      }
    } else if (clients.length > 2) {
      const c = clients[0];
      guardrailsClientName = `${c.lastName}, ${c.firstName}`;
    }
  
    // 5) Use the same offset logic as Buckets
    const DEFAULT_LOWER  = 0.048;
    const DEFAULT_AVAIL  = 0.054;
    const DEFAULT_UPPER  = 0.060;
    
    const OFFSET_BELOW = DEFAULT_AVAIL - DEFAULT_LOWER;
    const OFFSET_ABOVE = DEFAULT_UPPER - DEFAULT_AVAIL;
  
    // If you truly want to use the same "bucketsDistributionRate" for guardrails:
    const userAvailableRate = firm?.bucketsDistributionRate != null
      ? firm.bucketsDistributionRate
      : 0.054;
  
    const newLowerRate = userAvailableRate - OFFSET_BELOW;
    const newUpperRate = userAvailableRate + OFFSET_ABOVE;
  
    const distOptions = {
      availableRate: userAvailableRate,
      upperRate: newUpperRate,
      lowerRate: newLowerRate
    };
    const guardrailsTable = calculateDistributionTable(freshHousehold, distOptions);
  
    // 6) Same placeholders as Buckets => bar heights, amounts, total assets
    const d = valueAdd.currentData || {};
    
    // Bar heights if your guardrails.html uses them
    const cashHeightPx = `${(d.cashHeight || 0).toFixed(0)}px`;
    const incomeHeightPx = `${(d.incomeHeight || 0).toFixed(0)}px`;
    const annuitiesHeightPx = `${(d.annuitiesHeight || 0).toFixed(0)}px`;
    const growthHeightPx = `${(d.growthHeight || 0).toFixed(0)}px`;
  
    // Bucket amounts if you have them
    const cashAmt = (d.cashAmount || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
    const incomeAmt = (d.incomeAmount || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
    const annuitiesAmt = (d.annuitiesAmount || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
    const growthAmt = (d.growthAmount || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
  
    function roundDownToNearestThousand(amount) {
      return Math.floor(amount / 1000) * 1000;
    }
    const totalAssetsForLabel = d.portfolioValue || 0;
    const roundedTotalAssets = roundDownToNearestThousand(totalAssetsForLabel);
    const formattedTotalAssets = roundedTotalAssets.toLocaleString('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
    });
  
    // 7) Distribution columns (Current, Available, Upper, Lower)
    const currentPortValueNum = guardrailsTable.current.portfolioValue || 0;
    const currentPortValue = currentPortValueNum.toLocaleString('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
    });
    const currentRateNum = guardrailsTable.current.distributionRate || 0;
    const currentDistribRate = `${(currentRateNum * 100).toFixed(1)}%`;
    const currentMonthlyIncomeNum = guardrailsTable.current.monthlyIncome || 0;
    const currentMonthlyIncome = currentMonthlyIncomeNum.toLocaleString('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
    });
  
    const availablePortValue = currentPortValue; // same approach as Buckets
    const availableRateNum = guardrailsTable.available.distributionRate || 0;
    const availableDistribRate = `${(availableRateNum * 100).toFixed(1)}%`;
    const availableMonthlyIncomeNum = guardrailsTable.available.monthlyIncome || 0;
    const availableMonthlyIncome = availableMonthlyIncomeNum.toLocaleString('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
    });
  
    const upperPortValueNum = guardrailsTable.upper.portfolioValue || 0;
    const upperPortValue = upperPortValueNum.toLocaleString('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
    });
    const upperRateNum = guardrailsTable.upper.distributionRate || 0;
    const upperDistribRate = `${(upperRateNum * 100).toFixed(1)}%`;
    const upperMonthlyIncomeNum = guardrailsTable.upper.monthlyIncome || 0;
    const upperMonthlyIncome = upperMonthlyIncomeNum.toLocaleString('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
    });
  
    const lowerPortValueNum = guardrailsTable.lower.portfolioValue || 0;
    const lowerPortValue = lowerPortValueNum.toLocaleString('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
    });
    const lowerRateNum = guardrailsTable.lower.distributionRate || 0;
    const lowerDistribRate = `${(lowerRateNum * 100).toFixed(1)}%`;
    const lowerMonthlyIncomeNum = guardrailsTable.lower.monthlyIncome || 0;
    const lowerMonthlyIncome = lowerMonthlyIncomeNum.toLocaleString('en-US', {
      style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0
    });
  
    // 8) Keep your “vertical marker” ratio logic
    let ratio = (currentRateNum - lowerRateNum) / (upperRateNum - lowerRateNum);
    if (ratio < 0) {
      ratio *= 0.3;
      if (ratio < -0.2) ratio = -0.2;
    }
    if (ratio > 1) {
      ratio = 1 + (ratio - 1) * 0.3;
      if (ratio > 1.2) ratio = 1.2;
    }
    const leftPercent = 14.4 + ratio * 71.2;
    const currentDistribLeft = `${leftPercent.toFixed(1)}%`;
  
    // 9) Now define placeholders
    const guardrailsTitle = firm.guardrailsTitle || 'Guardrails Strategy';
    const customDisclaimer = firm.guardrailsDisclaimer || 'Some default disclaimers...';
    const guardrailsReportDate = new Date().toLocaleDateString();
    const guardrailsFirmLogo = firm.companyLogo || '';
    const firmColor = firm.companyBrandingColor || '#282e38';
  
    // 10) Replace placeholders (like the Buckets approach)
    try {
      // Bar heights, amounts
      guardrailsHtml = guardrailsHtml.replace(/{{CASH_HEIGHT}}/g, cashHeightPx);
      guardrailsHtml = guardrailsHtml.replace(/{{INCOME_HEIGHT}}/g, incomeHeightPx);
      guardrailsHtml = guardrailsHtml.replace(/{{ANNUITIES_HEIGHT}}/g, annuitiesHeightPx);
      guardrailsHtml = guardrailsHtml.replace(/{{GROWTH_HEIGHT}}/g, growthHeightPx);
  
      guardrailsHtml = guardrailsHtml.replace(/{{CASH_AMOUNT}}/g, cashAmt);
      guardrailsHtml = guardrailsHtml.replace(/{{INCOME_AMOUNT}}/g, incomeAmt);
      guardrailsHtml = guardrailsHtml.replace(/{{ANNUITIES_AMOUNT}}/g, annuitiesAmt);
      guardrailsHtml = guardrailsHtml.replace(/{{GROWTH_AMOUNT}}/g, growthAmt);
  
      guardrailsHtml = guardrailsHtml.replace(/{{TOTAL_ASSETS}}/g, formattedTotalAssets);
  
      // distribution table columns
      guardrailsHtml = guardrailsHtml.replace(/{{CURRENT_PORT_VALUE}}/g, currentPortValue);
      guardrailsHtml = guardrailsHtml.replace(/{{AVAILABLE_PORT_VALUE}}/g, availablePortValue);
      guardrailsHtml = guardrailsHtml.replace(/{{UPPER_PORT_VALUE}}/g, upperPortValue);
      guardrailsHtml = guardrailsHtml.replace(/{{LOWER_PORT_VALUE}}/g, lowerPortValue);
  
      guardrailsHtml = guardrailsHtml.replace(/{{CURRENT_DISTRIB_RATE}}/g, currentDistribRate);
      guardrailsHtml = guardrailsHtml.replace(/{{AVAILABLE_DISTRIB_RATE}}/g, availableDistribRate);
      guardrailsHtml = guardrailsHtml.replace(/{{UPPER_DISTRIB_RATE}}/g, upperDistribRate);
      guardrailsHtml = guardrailsHtml.replace(/{{LOWER_DISTRIB_RATE}}/g, lowerDistribRate);
  
      guardrailsHtml = guardrailsHtml.replace(/{{CURRENT_MONTHLY_INCOME}}/g, currentMonthlyIncome);
      guardrailsHtml = guardrailsHtml.replace(/{{AVAILABLE_MONTHLY_INCOME}}/g, availableMonthlyIncome);
      guardrailsHtml = guardrailsHtml.replace(/{{UPPER_MONTHLY_INCOME}}/g, upperMonthlyIncome);
      guardrailsHtml = guardrailsHtml.replace(/{{LOWER_MONTHLY_INCOME}}/g, lowerMonthlyIncome);
  
      // Keep your vertical marker
      guardrailsHtml = guardrailsHtml.replace(/{{CURRENT_DISTRIB_LEFT}}/g, currentDistribLeft);
  
      // disclaimers
      guardrailsHtml = guardrailsHtml.replace(/{{GUARDRAILS_DISCLAIMER}}/g, customDisclaimer);
  
      // other placeholders
      guardrailsHtml = guardrailsHtml.replace(/{{FIRM_LOGO}}/g, guardrailsFirmLogo);
      guardrailsHtml = guardrailsHtml.replace(/{{BRAND_COLOR}}/g, firmColor);
      guardrailsHtml = guardrailsHtml.replace(/{{VALUE_ADD_TITLE}}/g, guardrailsTitle);
      guardrailsHtml = guardrailsHtml.replace(/{{CLIENT_NAME_LINE}}/g, guardrailsClientName);
      guardrailsHtml = guardrailsHtml.replace(/{{REPORT_DATE}}/g, guardrailsReportDate);
  
      // Footer
      const fPhone = firm.phoneNumber || '';
      const fAddress = firm.companyAddress || '';
      const fWebsite = firm.companyWebsite || '';
      const footerParts = [];
      if (fAddress) footerParts.push(`<span class="firmField">${fAddress}</span>`);
      if (fPhone)   footerParts.push(`<span class="firmField">${fPhone}</span>`);
      if (fWebsite) footerParts.push(`<span class="firmField">${fWebsite}</span>`);
      const footerCombined = footerParts.join(' <div class="footerBall"></div> ');
      guardrailsHtml = guardrailsHtml.replace(/{{FIRM_FOOTER_INFO}}/g, footerCombined);
  
    } catch (replaceErr) {
      console.error('[saveValueAddSnapshot] Error replacing placeholders in guardrailsHtml:', replaceErr);
      return res.status(500).json({ message: 'Error processing Guardrails HTML' });
    }
  
    finalReplacedHtml = guardrailsHtml;
  }else {
      console.log('[saveValueAddSnapshot] Not a recognized Value Add type:', valueAdd.type);
      return res.status(400).json({ message: 'Unsupported Value Add type' });
    }

    // 9) Insert the final HTML into a new snapshot
    const snapshot = {
      timestamp: new Date(),
      snapshotData: {
        finalHtml: finalReplacedHtml
      }
    };
    valueAdd.snapshots.push(snapshot);

    await valueAdd.save();

    console.log('[saveValueAddSnapshot] Snapshot saved successfully!');
    return res.status(201).json({
      message: 'Snapshot saved successfully.',
      snapshot
    });
  } catch (err) {
    console.error('Error in saveValueAddSnapshot:', err);
    return res.status(500).json({ message: 'Server Error', error: err.message });
  }
};








/**
 * GET /api/value-add/:id/snapshots
 * Returns a list of saved snapshots with their IDs and timestamps.
 */
exports.getValueAddSnapshots = async (req, res) => {
  try {
    const valueAddId = req.params.id;
    const valueAdd = await ValueAdd.findById(valueAddId).select('snapshots').lean();
    if (!valueAdd) {
      return res.status(404).json({ message: 'Value Add not found.' });
    }

    // Map each snapshot to just the relevant info for the dropdown
    const snapshotsList = valueAdd.snapshots.map(s => ({
      _id: s._id,
      timestamp: s.timestamp
    }));

    res.json(snapshotsList);
  } catch (err) {
    console.error('Error fetching snapshots:', err);
    res.status(500).json({ message: 'Server error fetching snapshots.' });
  }
};

exports.downloadValueAddSnapshotPDF = async (req, res) => {
  try {
    const { id, snapshotId } = req.params;
    
    // We'll build the snapshot view URL
    const snapshotViewUrl = `${req.protocol}://${req.get('host')}/api/value-add/${id}/view/${snapshotId}`;
    console.log('[downloadValueAddSnapshotPDF] Generating PDF from =>', snapshotViewUrl);

    // Reuse your existing generateValueAddPDF:
    const pdfBuffer = await generateValueAddPDF(snapshotViewUrl);

    // Send the PDF as a download
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="value-add-${id}-snapshot-${snapshotId}.pdf"`,
      'Content-Length': pdfBuffer.length
    });
    return res.end(pdfBuffer, 'binary');
  } catch (error) {
    console.error('[downloadValueAddSnapshotPDF] Error generating snapshot PDF:', error);
    return res.status(500).send('Failed to generate snapshot PDF');
  }
};

exports.emailValueAddSnapshotPDF = async (req, res) => {
  try {
    const { id, snapshotId } = req.params;
    const { recipient } = req.body;
    if (!recipient) {
      console.error('[emailValueAddSnapshotPDF] No recipient provided.');
      return res.status(400).json({ message: 'No recipient provided.' });
    }

    const snapshotViewUrl = `${req.protocol}://${req.get('host')}/api/value-add/${id}/view/${snapshotId}`;
    console.log('[emailValueAddSnapshotPDF] Generating PDF from =>', snapshotViewUrl);

    const pdfBuffer = await generateValueAddPDF(snapshotViewUrl);

    // your nodemailer logic
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: (process.env.SMTP_SECURE === 'true'),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const mailOptions = {
      from: '"SurgeTech" <no-reply@yourdomain.com>',
      to: recipient,
      subject: 'Your Value Add Snapshot Document',
      text: 'Hello,\n\nAttached is your Value Add Snapshot PDF.\n',
      attachments: [
        {
          filename: `value-add-${id}-snapshot-${snapshotId}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('[emailValueAddSnapshotPDF] Email sent =>', info.messageId);

    return res.json({ message: 'Snapshot email sent successfully' });
  } catch (error) {
    console.error('[emailValueAddSnapshotPDF] Error emailing snapshot PDF:', error);
    return res.status(500).json({ message: 'Error sending email', error: error.message });
  }
};



/**
 * GET /api/value-add/:id/view/:snapshotId
 * 
 * Renders a "strict" snapshot that never updates. We rely solely
 * on the final replaced HTML stored in snapshotData.finalHtml.
 */
exports.viewSnapshot = async (req, res) => {
  try {
    const { id, snapshotId } = req.params;
    console.log('[viewSnapshot] ENTER => ValueAdd:', id, ' snapshotId:', snapshotId);

    // 1) Fetch the ValueAddDoc (with snapshots only)
    const valueAddDoc = await ValueAdd.findById(id)
      .select('snapshots')
      .lean();
    if (!valueAddDoc) {
      console.error('[viewSnapshot] ValueAdd not found =>', id);
      return res.status(404).send('Value Add not found');
    }

    // 2) Locate the snapshot
    const snap = valueAddDoc.snapshots.find(s => s._id.toString() === snapshotId);
    if (!snap) {
      console.error('[viewSnapshot] Snapshot not found =>', snapshotId);
      return res.status(404).send('Snapshot not found');
    }

    // 3) Return the stored finalHtml. This is EXACTLY what was rendered at save time.
    const finalHtml = snap.snapshotData?.finalHtml || '';

    console.log('[viewSnapshot] Returning finalHtml for snapshot =>', snapshotId);
    return res.send(finalHtml);

  } catch (err) {
    console.error('[viewSnapshot] Error =>', err);
    return res.status(500).send('Server Error');
  }
};


