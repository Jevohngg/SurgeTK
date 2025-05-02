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
      return res.status(404).json({ message: 'Value Add not found.' });
    }
    console.log('[getValueAdd] Found ValueAdd =>', valueAdd);

    return res.json(valueAdd);
  } catch (err) {
    console.error('Error in getValueAdd:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

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
      return res.status(404).json({ message: 'Household not found.' });
    }

    // 2) Sum up all accountValue for this household
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
      console.log('[createGuardrailsValueAdd] Missing fields =>', missing);
      return res.status(400).json({
        message: 'Cannot generate Guardrails. Missing required fields.',
        missingFields: missing,
      });
    }

    // Calculate
    const guardrailsData = calculateGuardrails(householdWithSum);
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
      return res.status(404).json({ message: 'Value Add not found.' });
    }
    if (valueAdd.type !== 'GUARDRAILS') {
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
      console.log('[updateGuardrailsValueAdd] Missing fields =>', missing);
      return res.status(400).json({
        message: 'Cannot update Guardrails. Missing required fields.',
        missingFields: missing,
      });
    }

    // Recalculate
    const guardrailsData = calculateGuardrails(householdWithSum);
    console.log('[updateGuardrailsValueAdd] guardrailsData =>', guardrailsData);

    // Update
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

// controllers/valueAddController.js

const CompanyID = require('../models/CompanyID'); 
// ...

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
          { path: 'firmId', select: 'companyName companyLogo' } // <-- fetch companyLogo
        ]
      })
      .lean();

    if (!valueAdd) {
      return res.status(404).send('Value Add not found');
    }
    if (valueAdd.type !== 'GUARDRAILS') {
      return res.status(400).send('Not a Guardrails Value Add');
    }

    // Also fetch the user from session
    const user = req.session.user;
    if (!user) {
      return res.status(401).send('Not authorized');
    }

    // Possibly fetch the firm if you prefer (but it’s already in valueAdd.household.firmId)
    const firm = valueAdd.household?.firmId || null;

    // 2) Set user.companyLogo
    user.companyLogo = (firm && firm.companyLogo) ? firm.companyLogo : '';

    // 3) Also fetch the household's clients
    const householdId = valueAdd.household._id;
    const clients = await Client.find({ household: householdId })
      .select('firstName lastName')
      .lean();

    // 4) Render
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

exports.createBucketsValueAdd = async (req, res) => {
  try {
    const householdId = req.params.householdId;
    // 1) Fetch the household doc
    const household = await Household.findById(householdId).lean();
    if (!household) {
      return res.status(404).json({ message: 'Household not found.' });
    }

    // 2) Fetch all Accounts for this household
    const accounts = await Account.find({ household: householdId }).lean();

    // 3) Sum total portfolio value
    let totalPortfolio = 0;
    accounts.forEach(acc => {
      totalPortfolio += (acc.accountValue || 0);
    });

    // 4) Compute monthly distribution from systematicWithdrawAmount
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
          // If monthly or unknown => treat as monthly
          default:
            monthlyEquivalent = acc.systematicWithdrawAmount;
        }
        totalMonthlyWithdrawal += monthlyEquivalent;
      }
    });

    // 5) Derive the distribution rate
    //    totalMonthlyWithdrawal * 12 / totalPortfolio
    //    If totalPortfolio is 0, fallback to 0 or 0.054, etc.
    let distributionRate = 0;
    if (totalPortfolio > 0 && totalMonthlyWithdrawal > 0) {
      distributionRate = (totalMonthlyWithdrawal * 12) / totalPortfolio;
    }

    // 6) Merge that into a new "householdWithSum" for validation & allocations
    const householdWithSum = {
      ...household,
      totalAccountValue: totalPortfolio,
      accounts: accounts,
    };

    // 7) Validate inputs for Buckets
    const missing = validateBucketsInputs(householdWithSum);
    if (missing.length > 0) {
      return res.status(400).json({
        message: 'Cannot generate Buckets. Missing required fields.',
        missingFields: missing,
      });
    }

    // 8) Calculate the Buckets data
    //    Pass the dynamic distributionRate so "current" matches actual
    const bucketsData = calculateBuckets(householdWithSum, {
      distributionRate,
      upperFactor: 0.8,
      lowerFactor: 1.2,
    });

    // 9) Build warnings if any accounts lacked allocations
    const warnings = [];
    if (bucketsData.missingAllocationsCount > 0) {
      warnings.push(
        `There are ${bucketsData.missingAllocationsCount} account(s) missing asset allocation fields.`
      );
      // Optionally detail each missing account:
      // bucketsData.missingAllocations.forEach(acc => {
      //   warnings.push(`Account #${acc.accountNumber || 'N/A'} lacks full allocation fields.`);
      // });
    }

    // 10) Create and save the ValueAdd
    const newValueAdd = new ValueAdd({
      household: household._id,
      type: 'BUCKETS',
      currentData: bucketsData,
      history: [{ date: new Date(), data: bucketsData }],
      warnings, // Store your warnings array if your ValueAdd schema supports it
    });

    await newValueAdd.save();
    return res.status(201).json({
      message: 'Buckets ValueAdd created successfully.',
      valueAdd: newValueAdd,
    });
  } catch (err) {
    console.error('Error in createBucketsValueAdd:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// controllers/valueAddController.js (or relevant file)

exports.updateBucketsValueAdd = async (req, res) => {
  try {
    const valueAddId = req.params.id;
    const valueAdd = await ValueAdd.findById(valueAddId).populate('household');
    if (!valueAdd) {
      return res.status(404).json({ message: 'Value Add not found.' });
    }
    if (valueAdd.type !== 'BUCKETS') {
      return res.status(400).json({ message: 'Value Add is not of type BUCKETS.' });
    }

    // 1) Convert the Mongoose doc to plain JS object
    const household = valueAdd.household.toObject();

    // 2) Fetch accounts
    const accounts = await Account.find({ household: household._id }).lean();

    // 3) Sum total portfolio
    let totalPortfolio = 0;
    accounts.forEach(acc => {
      totalPortfolio += (acc.accountValue || 0);
    });

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
            monthlyEquivalent = acc.systematicWithdrawAmount; // monthly
        }
        totalMonthlyWithdrawal += monthlyEquivalent;
      }
    });

    let distributionRate = 0;
    if (totalPortfolio > 0 && totalMonthlyWithdrawal > 0) {
      distributionRate = (totalMonthlyWithdrawal * 12) / totalPortfolio;
    }

    // 5) Build a new object for validation & allocations
    const householdWithSum = {
      ...household,
      totalAccountValue: totalPortfolio,
      accounts: accounts,
    };

    // 6) Validate & calculate
    const missing = validateBucketsInputs(householdWithSum);
    if (missing.length > 0) {
      return res.status(400).json({
        message: 'Cannot update Buckets. Missing required fields.',
        missingFields: missing,
      });
    }

    const bucketsData = calculateBuckets(householdWithSum, {
      distributionRate,
      upperFactor: 0.8,
      lowerFactor: 1.2,
    });

    // 7) Build warnings
    const warnings = [];
    if (bucketsData.missingAllocationsCount > 0) {
      warnings.push(
        `There are ${bucketsData.missingAllocationsCount} account(s) missing asset allocation fields.`
      );
    }

    // 8) Update the ValueAdd doc
    valueAdd.currentData = bucketsData;
    valueAdd.history.push({ date: new Date(), data: bucketsData });
    valueAdd.warnings = warnings; // If your schema supports it
    await valueAdd.save();

    // 9) Return JSON
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
            select: 'companyName companyLogo phoneNumber companyAddress companyWebsite bucketsEnabled bucketsTitle bucketsDisclaimer companyBrandingColor guardrailsEnabled guardrailsTitle guardrailsDisclaimer'
          }
        ]
      })
      .lean();

    if (!valueAdd) {
      console.log('No ValueAdd found with that ID.');
      return res.status(404).send('Value Add not found');
    }

    console.log(`ValueAdd type: ${valueAdd.type}`);

    // ----------------------------------------------------------------------
    // Handle BUCKETS
    // ----------------------------------------------------------------------
    if (valueAdd.type === 'BUCKETS') {
      // 1) Load buckets.html
      let bucketsHtml = fs.readFileSync(
        path.join(__dirname, '..', 'views', 'valueAdds', 'buckets.html'),
        'utf8'
      );

      // 2) Fetch the Household as a Mongoose doc
      const householdId = valueAdd.household._id;
      console.log(`Household ID from valueAdd: ${householdId}`);

      const householdDoc = await Household.findById(householdId).populate('accounts').exec();
      if (!householdDoc) {
        console.log('No household found with that ID in the DB.');
        return res.status(404).send('Household not found');
      }

      // 3) Recompute total assets & monthly distribution
      const { totalAssets, monthlyDistribution } = getHouseholdTotals(householdDoc);
      householdDoc.totalAccountValue = totalAssets;
      householdDoc.actualMonthlyDistribution = monthlyDistribution;

      // 4) Save so the doc is up to date
      await householdDoc.save();

      // 5) Convert to plain object
      const freshHousehold = householdDoc.toObject();

      // 6) Fetch clients for display name
      const clients = await Client.find({ household: householdId }).lean();
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

      // 7) Distribution table logic for “Current”, “Available”, “Upper”, “Lower”
      const distOptions = {
        availableRate: 0.054, // 5.4% for "Available"
        upperRate: 0.06,     // 6.0% for "Upper"
        lowerRate: 0.048,    // 4.8% for "Lower"
      };
      const distTable = calculateDistributionTable(freshHousehold, distOptions);

      // 8) Bucket-specific data from the ValueAdd
      const firm = valueAdd.household?.firmId || {};

      const valueAddTitle = firm.bucketsTitle || 'Buckets Strategy';
      const customDisclaimer = firm.bucketsDisclaimer || 'Some default disclaimers...';
      const d = valueAdd.currentData || {};
      const reportDate = new Date().toLocaleDateString();
      const firmLogo = valueAdd.household?.firmId?.companyLogo || '';
      const firmColor = firm.companyBrandingColor || '#282e38';

      // Bucket bars
      const cashHeightPx = `${(d.cashHeight || 0).toFixed(0)}px`;
      const incomeHeightPx = `${(d.incomeHeight || 0).toFixed(0)}px`;
      const annuitiesHeightPx = `${(d.annuitiesHeight || 0).toFixed(0)}px`;
      const growthHeightPx = `${(d.growthHeight || 0).toFixed(0)}px`;

      const cashAmt = `$${(d.cashAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const incomeAmt = `$${(d.incomeAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const annuitiesAmt = `$${(d.annuitiesAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const growthAmt = `$${(d.growthAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // "Total Assets" label in the top portion
      const totalAssetsForLabel = d.portfolioValue || 0;

      // Current column
      const currentPortValueNum = distTable.current.portfolioValue || 0;
      const currentPortValue = `$${currentPortValueNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const currentRateNum = distTable.current.distributionRate || 0;
      const currentDistribRate = `${(currentRateNum * 100).toFixed(1)}%`;
      const currentMonthlyIncomeNum = distTable.current.monthlyIncome || 0;
      currentMonthlyIncomeNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      const currentMonthlyIncome = `$${currentMonthlyIncomeNum.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;

      // Available column
      const availablePortValue = currentPortValue;
      const availableRateNum = distTable.available.distributionRate || 0;
      const availableDistribRate = `${(availableRateNum * 100).toFixed(1)}%`;
      const availableMonthlyIncomeNum = distTable.available.monthlyIncome || 0;
      const availableMonthlyIncome = `$${availableMonthlyIncomeNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Upper column
      const upperPortValueNum = distTable.upper.portfolioValue || 0;
      const upperPortValue = `$${upperPortValueNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const upperRateNum = distTable.upper.distributionRate || 0;
      const upperDistribRate = `${(upperRateNum * 100).toFixed(1)}%`;
      const upperMonthlyIncomeNum = distTable.upper.monthlyIncome || 0;
      const upperMonthlyIncome = `$${upperMonthlyIncomeNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Lower column
      const lowerPortValueNum = distTable.lower.portfolioValue || 0;
      const lowerPortValue = `$${lowerPortValueNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const lowerRateNum = distTable.lower.distributionRate || 0;
      const lowerDistribRate = `${(lowerRateNum * 100).toFixed(1)}%`;
      const lowerMonthlyIncomeNum = distTable.lower.monthlyIncome || 0;
      const lowerMonthlyIncome = `$${lowerMonthlyIncomeNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // 9) Build replacements
      const replacements = {
        '{{FIRM_LOGO}}': firmLogo,
        '{{VALUE_ADD_TITLE}}': valueAddTitle,
        '{{BUCKETS_DISCLAIMER}}': customDisclaimer,
        '{{CLIENT_NAME_LINE}}': clientNameLine,
        '{{REPORT_DATE}}': reportDate,
        '{{BRAND_COLOR}}': firmColor,

        '{{TOTAL_ASSETS}}': `$${totalAssetsForLabel.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,

        '{{CASH_HEIGHT}}': cashHeightPx,
        '{{INCOME_HEIGHT}}': incomeHeightPx,
        '{{ANNUITIES_HEIGHT}}': annuitiesHeightPx,
        '{{GROWTH_HEIGHT}}': growthHeightPx,

        '{{CASH_AMOUNT}}': cashAmt,
        '{{INCOME_AMOUNT}}': incomeAmt,
        '{{ANNUITIES_AMOUNT}}': annuitiesAmt,
        '{{GROWTH_AMOUNT}}': growthAmt,

        // Table columns
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

      // 1) Gather firm data
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
      console.log('Sending final Buckets HTML...');
      return res.send(bucketsHtml);

    // ----------------------------------------------------------------------
    // Handle GUARDRAILS
    // ----------------------------------------------------------------------
    } else if (valueAdd.type === 'GUARDRAILS') {
      // 1) Load guardrails.html
      let guardrailsHtml = fs.readFileSync(
        path.join(__dirname, '..', 'views', 'valueAdds', 'guardrails.html'),
        'utf8'
      );

      // 2) Fetch Household similarly
      const householdId = valueAdd.household._id;
      const householdDoc = await Household.findById(householdId).populate('accounts').exec();
      if (!householdDoc) {
        console.log('No household found for that ID.');
        return res.status(404).send('Household not found');
      }

      // 3) Recompute totals
      const { totalAssets, monthlyDistribution } = getHouseholdTotals(householdDoc);
      householdDoc.totalAccountValue = totalAssets;
      householdDoc.actualMonthlyDistribution = monthlyDistribution;
      await householdDoc.save();

      const freshHousehold = householdDoc.toObject();

      // 4) Clients for display name
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

      // 5) Do any distribution logic (similar or simpler than BUCKETS)
      const guardrailsOptions = {
        availableRate: 0.054, // or any default you choose
        upperRate: 0.06,
        lowerRate: 0.048,
      };
      const guardrailsTable = calculateDistributionTable(freshHousehold, {
        availableRate: 0.054,
        upperRate: 0.06,
        lowerRate: 0.048,
      });

      const distOptions = {
        availableRate: 0.054, // 5.4% for "Available"
        upperRate: 0.06,     // 6.0% for "Upper"
        lowerRate: 0.048,    // 4.8% for "Lower"
      };

      // 6) Build placeholders
      // --- ADDED dynamic approach to read from firm.guardrailsTitle / guardrailsDisclaimer
      const firm = valueAdd.household?.firmId || {};
      const guardrailsTitle = firm.guardrailsTitle || 'Guardrails Strategy';
      const customDisclaimer = firm.guardrailsDisclaimer || 'Some default disclaimers...';

      const guardrailsReportDate = new Date().toLocaleDateString();
      const guardrailsFirmLogo = valueAdd.household?.firmId?.companyLogo || '';
      const distTable = calculateDistributionTable(freshHousehold, distOptions);
      const firmColor = firm.companyBrandingColor || '#282e38';

      // Current scenario
      const curPV = guardrailsTable.current.portfolioValue || 0;
      const curRate = guardrailsTable.current.distributionRate || 0;
      const curMonthly = guardrailsTable.current.monthlyIncome || 0;
      const currentMonthlyIncomeNum = distTable.current.monthlyIncome || 0;
      currentMonthlyIncomeNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      const currentPortValue = `$${curPV.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const currentDistribRate = `${(curRate * 100).toFixed(1)}%`;
      const currentMonthlyIncome = `$${currentMonthlyIncomeNum.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;

      // Available scenario
      const avPV = guardrailsTable.available.portfolioValue || 0;
      const avRate = guardrailsTable.available.distributionRate || 0;
      const avMonthly = guardrailsTable.available.monthlyIncome || 0;

      const availablePortValue = `$${avPV.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const availableDistribRate = `${(avRate * 100).toFixed(1)}%`;
      const availableMonthlyIncome = `$${avMonthly.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Upper scenario
      const upPV = guardrailsTable.upper.portfolioValue || 0;
      const upRate = guardrailsTable.upper.distributionRate || 0;
      const upMonthly = guardrailsTable.upper.monthlyIncome || 0;

      const upperPortValue = `$${upPV.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const upperDistribRate = `${(upRate * 100).toFixed(1)}%`;
      const upperMonthlyIncome = `$${upMonthly.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Lower scenario
      const lowPV = guardrailsTable.lower.portfolioValue || 0;
      const lowRate = guardrailsTable.lower.distributionRate || 0;
      const lowMonthly = guardrailsTable.lower.monthlyIncome || 0;

      let ratio = (curRate - lowRate) / (upRate - lowRate);
      // Example: ratio < 0 => currentRate < lowerRate

      // ALLOW PARTIAL LEFT OVERSHOOT
      if (ratio < 0) {
        ratio = ratio * 0.3;
        if (ratio < -0.2) ratio = -0.2;
      }

      // ALLOW PARTIAL RIGHT OVERSHOOT
      if (ratio > 1) {
        ratio = 1 + (ratio - 1) * 0.3;
        if (ratio > 1.2) ratio = 1.2;
      }

      // Map ratio => a left% between 15 and 85
      const leftPercent = 14.4 + (ratio * 71.2);
      const currentDistribLeft = `${leftPercent.toFixed(1)}%`;

      const lowerPortValue = `$${lowPV.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const lowerDistribRate = `${(lowRate * 100).toFixed(1)}%`;
      const lowerMonthlyIncome = `$${lowMonthly.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // 7) Replace in guardrailsHtml
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

      // NEW: Insert guardrails disclaimer placeholder
      guardrailsHtml = guardrailsHtml.replace(/{{GUARDRAILS_DISCLAIMER}}/g, customDisclaimer);




      const fPhone = firm.phoneNumber || '';
      const fAddress = firm.companyAddress || '';
      const fWebsite = firm.companyWebsite || '';

      const footerParts = [];
      if (fAddress) footerParts.push(`<span class="firmField">${fAddress}</span>`);
      if (fPhone) footerParts.push(`<span class="firmField">${fPhone}</span>`);
      if (fWebsite) footerParts.push(`<span class="firmField">${fWebsite}</span>`);

      const footerCombined = footerParts.join(' <div class="footerBall"></div> ');




      // Replace {{FIRM_FOOTER_INFO}} with the combined HTML
      guardrailsHtml = guardrailsHtml.replace(/{{FIRM_FOOTER_INFO}}/g, footerCombined);



      // 8) Send final HTML
      console.log('Sending Guardrails HTML...');
      return res.send(guardrailsHtml);

    // Otherwise => unsupported
    } else {
      console.log('Not a recognized Value Add type. Exiting.');
      return res.status(400).send('Unsupported Value Add type');
    }
  } catch (err) {
    console.error('Error in viewValueAddPage:', err);
    return res.status(500).send('Server Error');
  }
};

// controllers/valueAddController.js
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
      return res.status(400).json({ message: 'No recipient provided.' });
    }

    const viewUrl = `${req.protocol}://${req.get('host')}/api/value-add/${id}/view`;
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

    await transporter.sendMail(mailOptions);
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
      return res.status(400).json({ message: 'No recipient provided.' });
    }

    const viewUrl = `${req.protocol}://${req.get('host')}/api/value-add/${id}/view`;
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

    await transporter.sendMail(mailOptions);
    return res.json({ message: 'Email sent successfully' });
  } catch (error) {
    console.error('Error emailing PDF:', error);
    return res.status(500).json({ message: 'Error sending email', error: error.message });
  }
};
