// controllers/valueAddController.js
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const xlsx = require('xlsx');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const { Table } = require('pdfkit-table');
const puppeteer = require('puppeteer-core'); 
const nodemailer = require('nodemailer');

const CompanyID = require('../models/CompanyID');
const Household = require('../models/Household');
const Client = require('../models/Client');
const Account = require('../models/Account');
const Asset = require('../models/Asset');
const Liability = require('../models/Liability');
const Beneficiary = require('../models/Beneficiary');
const User = require('../models/User');
const ImportReport = require('../models/ImportReport');
const ValueAdd = require('../models/ValueAdd');

const { uploadFile } = require('../utils/s3');
const { generatePreSignedUrl } = require('../utils/s3');
const { getMarginalTaxBracket } = require('../utils/taxBrackets');
const { buildDisclaimer } = require('../utils/disclaimerBuilder');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const HomeworkSettings = require('../models/HomeworkSettings');
const { computeValueAdd } = require('../services/valueadds/computeValueAdd');
const { renderMeetingWorksheetPages } = require('../services/valueadds/renderMeetingWorksheet');




const {
  validateGuardrailsInputs,
  calculateGuardrails
} = require('../services/valueadds/guardrailsService');

const {
  validateBucketsInputs,
  calculateBuckets
} = require('../services/valueadds/bucketsService');

const { calculateDistributionTable } = require('../services/distributionTableService');
const { getHouseholdTotals } = require('../services/householdUtils');
const { totalMonthlyDistribution } = require('../services/monthlyDistribution');

/**
 * Retrieve all ValueAdds for a given household
 */
exports.getValueAddsForHousehold = async (req, res) => {
  try {
    const householdId = req.params.householdId;
   

    const valueAdds = await ValueAdd.find({ household: householdId }).lean();
  

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

    // const valueAdd = await ValueAdd.findById(valueAddId).lean();
    let  valueAdd = await ValueAdd.findById(valueAddId).lean();
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

    // NEW – compute household’s actual monthly withdrawal
const totalMonthlyWithdrawal = totalMonthlyDistribution(accounts);
console.log('[createGuardrailsValueAdd] totalMonthlyWithdrawal =>', totalMonthlyWithdrawal);


    // Build a new household object that has totalAccountValue
      const householdWithSum = {
      ...household,
      totalAccountValue: sum,
      accounts,
      actualMonthlyDistribution: totalMonthlyWithdrawal, // ← NEW
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

    // NEW – compute up‑to‑date withdrawals
const totalMonthlyWithdrawal = totalMonthlyDistribution(accounts);
console.log('[updateGuardrailsValueAdd] totalMonthlyWithdrawal =>', totalMonthlyWithdrawal);


    // Build a new object for the calculation
      const householdWithSum = {
      ...valueAdd.household.toObject(), // convert the Mongoose doc to plain object
      totalAccountValue: sum,
      accounts,
      actualMonthlyDistribution: totalMonthlyWithdrawal, // ← NEW
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
    // const valueAdd = await ValueAdd.findById(valueAddId)
    let  valueAdd = await ValueAdd.findById(valueAddId)
      .populate({
        path: 'household',
        populate: [
          { path: 'leadAdvisors', select: 'firstName lastName avatar email' },
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
    // 1) Pull the FULL household with its accounts so we can
    //    recalculate every account’s 4‑way allocation ⬇️
    const householdDoc = await Household.findById(householdId)
                                         .populate('accounts')
                                         .exec();
    if (!householdDoc) {
      console.error('[createBucketsValueAdd] No household found for ID:', householdId);
      return res.status(404).json({ message: 'Household not found.' });
    }

    /* ----------------------------------------------------------
       0️⃣  Force‑refresh each account’s asset‑allocation fields
           (same helper the Household Details page triggers)
    ---------------------------------------------------------- */
    const { totalAccountValue, monthlyDistribution } =
          getHouseholdTotals(householdDoc);   // recalculates + mutates
    
    // persist the fresh totals (optional but keeps Mongo in sync)
    householdDoc.totalAccountValue         = totalAccountValue;
    householdDoc.actualMonthlyDistribution = monthlyDistribution;
    await householdDoc.save();

    // convert back to plain JS object for the rest of the function
    const household = householdDoc.toObject();
    console.log('[createBucketsValueAdd] Refreshed Household =>', household);

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
    // 2) Re‑query the accounts so we now hold the UPDATED allocation %’s
    const accounts = await Account.find({ household: householdId }).lean();
    console.log('[createBucketsValueAdd] Accounts after refresh =>', accounts);

    // 4) Sum total portfolio value
    let totalPortfolio = 0;
    accounts.forEach(acc => {
      totalPortfolio += (acc.accountValue || 0);
    });
    console.log('[createBucketsValueAdd] totalPortfolio =>', totalPortfolio);

    // 5) Compute monthly distribution using helper (multi‑withdrawal aware)
const totalMonthlyWithdrawal = totalMonthlyDistribution(accounts);
console.log('[createBucketsValueAdd] totalMonthlyWithdrawal =>', totalMonthlyWithdrawal);


    // 5) Compute monthly distribution from systematicWithdrawAmount
    // let totalMonthlyWithdrawal = 0;
    // accounts.forEach(acc => {
    //   if (acc.systematicWithdrawAmount && acc.systematicWithdrawAmount > 0) {
    //     const freq = acc.systematicWithdrawFrequency || 'Monthly';
    //     let monthlyEquivalent = 0;
    //     switch (freq) {
    //       case 'Quarterly':
    //         monthlyEquivalent = acc.systematicWithdrawAmount / 3;
    //         break;
    //       case 'Annually':
    //         monthlyEquivalent = acc.systematicWithdrawAmount / 12;
    //         break;
    //       default:
    //         monthlyEquivalent = acc.systematicWithdrawAmount;
    //     }
    //     totalMonthlyWithdrawal += monthlyEquivalent;
    //   }
    // });
    // console.log('[createBucketsValueAdd] totalMonthlyWithdrawal =>', totalMonthlyWithdrawal);

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
      accounts,
      actualMonthlyDistribution: totalMonthlyWithdrawal, // ← NEW
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

 // -----------------------------------------------------------
 // Pull the three advisor‑configured Bucket rates correctly
 // -----------------------------------------------------------
 const availRate = (firm?.bucketsAvailableRate     != null)
                 ? firm.bucketsAvailableRate
                 : (firm?.bucketsDistributionRate != null)
                 ? firm.bucketsDistributionRate   // legacy middle rate
                 : 0.054;                         // hard‑coded default

 const upperRate = (firm?.bucketsUpperRate != null)
                 ? firm.bucketsUpperRate
                 : availRate + 0.006;

 const lowerRate = (firm?.bucketsLowerRate != null)
                 ? firm.bucketsLowerRate
                 : availRate - 0.006;

 console.log('[createBucketsValueAdd] Bucket rates =>',
             { availRate, upperRate, lowerRate });


    console.log('[createBucketsValueAdd] newLowerRate =>', newLowerRate);
    console.log('[createBucketsValueAdd] newUpperRate =>', newUpperRate);

    // Now call calculateBuckets with these rates
    const bucketsData = calculateBuckets(householdWithSum, {
       distributionRate: availRate,
       upperRate:        upperRate,
       lowerRate:        lowerRate
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

    const householdDoc = await Household.findById(valueAdd.household._id)
                                       .populate('accounts')
                                       .exec();
    if (!householdDoc) {
      return res.status(404).json({ message: 'Household no longer exists.' });
    }

    const { totalAccountValue, monthlyDistribution } =
          getHouseholdTotals(householdDoc);       // recalculates allocations

    householdDoc.totalAccountValue         = totalAccountValue;
    householdDoc.actualMonthlyDistribution = monthlyDistribution;
    await householdDoc.save();

    const household = householdDoc.toObject();
    console.log('[updateBucketsValueAdd] Refreshed household =>', household);

    // Re‑query the accounts so we hold the new percentages
    const accounts = await Account.find({ household: household._id }).lean();
    console.log('[updateBucketsValueAdd] Accounts =>', accounts);

    // 3) Sum total portfolio
    let totalPortfolio = 0;
    accounts.forEach(acc => {
      totalPortfolio += (acc.accountValue || 0);
    });
    console.log('[updateBucketsValueAdd] totalPortfolio =>', totalPortfolio);

    // 4) Compute monthly withdrawals => distributionRate
    // 4) Compute monthly withdrawals using helper
const totalMonthlyWithdrawal = totalMonthlyDistribution(accounts);
console.log('[updateBucketsValueAdd] totalMonthlyWithdrawal =>', totalMonthlyWithdrawal);

    // let totalMonthlyWithdrawal = 0;
    // accounts.forEach(acc => {
    //   if (acc.systematicWithdrawAmount && acc.systematicWithdrawAmount > 0) {
    //     const freq = acc.systematicWithdrawFrequency || 'Monthly';
    //     let monthlyEquivalent = 0;
    //     switch (freq) {
    //       case 'Quarterly':
    //         monthlyEquivalent = acc.systematicWithdrawAmount / 3;
    //         break;
    //       case 'Annually':
    //         monthlyEquivalent = acc.systematicWithdrawAmount / 12;
    //         break;
    //       default:
    //         monthlyEquivalent = acc.systematicWithdrawAmount;
    //     }
    //     totalMonthlyWithdrawal += monthlyEquivalent;
    //   }
    // });
    // console.log('[updateBucketsValueAdd] totalMonthlyWithdrawal =>', totalMonthlyWithdrawal);

    let distributionRate = 0;
    if (totalPortfolio > 0 && totalMonthlyWithdrawal > 0) {
      distributionRate = (totalMonthlyWithdrawal * 12) / totalPortfolio;
    }
    console.log('[updateBucketsValueAdd] distributionRate =>', distributionRate);

    // 5) Build a new object for validation & allocations
      const householdWithSum = {
      ...household,
      totalAccountValue: totalPortfolio,
      accounts,
      actualMonthlyDistribution: totalMonthlyWithdrawal, // ← NEW
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

     const availRate = (firm?.bucketsAvailableRate     != null)
                     ? firm.bucketsAvailableRate
                     : (firm?.bucketsDistributionRate != null)
                     ? firm.bucketsDistributionRate
                     : 0.054;
    
     const upperRate = (firm?.bucketsUpperRate != null)
                     ? firm.bucketsUpperRate
                     : availRate + 0.006;
    
     const lowerRate = (firm?.bucketsLowerRate != null)
                     ? firm.bucketsLowerRate
                     : availRate - 0.006;
    
     console.log('[updateBucketsValueAdd] Bucket rates =>',
                 { availRate, upperRate, lowerRate });




    // Recalculate
    const bucketsData = calculateBuckets(householdWithSum, {
       distributionRate: availRate,
       upperRate:        upperRate,
       lowerRate:        lowerRate
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













/**
 * Render a ValueAdd in HTML form (Guardrails or Buckets).
 */
exports.viewValueAddPage = async (req, res) => {
  try {
    const valueAddId = req.params.id;
    console.log('--- viewValueAddPage START ---');
    console.log(`ValueAdd ID param: ${valueAddId}`);

    // const valueAdd = await ValueAdd.findById(valueAddId)
    let  valueAdd = await ValueAdd.findById(valueAddId)
      .populate({
        path: 'household',
        populate: [
          { path: 'leadAdvisors', select: 'firstName lastName avatar email' },
          {
            path: 'firmId',
            // add bucketsTitle and bucketsDisclaimer to the select
            select: 'companyName companyLogo phoneNumber companyAddress companyWebsite bucketsEnabled bucketsTitle bucketsDisclaimer bucketsDistributionRate bucketsAvailableRate bucketsUpperRate bucketsLowerRate companyBrandingColor guardrailsEnabled guardrailsTitle guardrailsDisclaimer guardrailsDistributionRate guardrailsAvailableRate guardrailsUpperRate guardrailsLowerRate guardrailsUpperFactor guardrailsLowerFactor beneficiaryEnabled beneficiaryTitle beneficiaryDisclaimer netWorthEnabled netWorthTitle netWorthDisclaimer'

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
      console.log('[Buckets view] currentData keys =', Object.keys(valueAdd.currentData || {}));

      /* 1️⃣  Always recalc Buckets before you render it  */
      await exports.updateBucketsValueAdd(
            { params: { id: valueAddId } },
            { status: () => ({ json(){} }), json(){} }   // stubbed res
      );

      // 2️⃣  Pull the freshly‑saved doc so currentData is the new one
      valueAdd = await ValueAdd.findById(valueAddId)
               .populate({
                 path: 'household',
                 populate: [
                   { path: 'leadAdvisors', select: 'firstName lastName avatar email' },
                       { path: 'firmId' }
                 ]
               })
               .lean();

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

      // 3) Recompute total account value & monthly distribution
      const { totalAccountValue, monthlyDistribution } = getHouseholdTotals(householdDoc);
      householdDoc.totalAccountValue = totalAccountValue;
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

      /* ──────────────────────────────────────────────────────────
         NEW explicit‑rate logic (Step 4‑a)
      ────────────────────────────────────────────────────────── */
      const {
        bucketsAvailableRate,
        bucketsUpperRate,
        bucketsLowerRate
      } = firm;

      const avail = bucketsAvailableRate ?? firm.bucketsDistributionRate ?? 0.054;
      const upper = bucketsUpperRate    ?? (avail + 0.006);
      const lower = bucketsLowerRate    ?? (avail - 0.006);

      const distOptions = {
        availableRate : avail,
        upperRate     : upper,
        lowerRate     : lower
      };

      console.log('[viewValueAddPage] Buckets rates =>',
                  { avail, upper, lower });    

      const distTable = calculateDistributionTable(freshHousehold, distOptions);
      console.log('[viewValueAddPage] distTable (buckets) =>', distTable);

      // 7) Bucket-specific data from the ValueAdd
      const valueAddTitle = firm.bucketsTitle || 'Buckets Strategy';
      const customDisclaimer = buildDisclaimer({
        household : valueAdd.household,        // advisors already populated
        customText: firm.bucketsDisclaimer || ''
      });
      
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

      // "Total account value" label
      const totalAccountValueForLabel = d.portfolioValue || 0;
      function roundDownToNearestThousand(amount) {
        return Math.floor(amount / 1000) * 1000;
      }
      const roundedTotalAccountValue = roundDownToNearestThousand(totalAccountValueForLabel);
      const formattedTotalAccountValue = roundedTotalAccountValue.toLocaleString('en-US', {
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

        '{{TOTAL_ACCOUNT_VALUE}}': formattedTotalAccountValue,
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
      const { totalAccountValue, monthlyDistribution } = getHouseholdTotals(householdDoc);
      householdDoc.totalAccountValue = totalAccountValue;
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


      /* ──────────────────────────────────────────────────────────
         NEW explicit‑rate logic (Step 4‑b)
      ────────────────────────────────────────────────────────── */
      const {
        guardrailsAvailableRate,
        guardrailsUpperRate,
        guardrailsLowerRate
      } = firm;

      const avail = guardrailsAvailableRate ?? firm.guardrailsDistributionRate ?? 0.054;
      const upper = guardrailsUpperRate    ?? (avail + 0.006);
      const lower = guardrailsLowerRate    ?? (avail - 0.006);

      const distOptions = {
        availableRate : avail,
        upperRate     : upper,
        lowerRate     : lower
      };

      console.log('[viewValueAddPage] Guardrails rates =>',
                  { avail, upper, lower });

      
      const guardrailsTable = calculateDistributionTable(freshHousehold, distOptions);
      console.log('[viewValueAddPage] guardrails => guardrailsTable =>', guardrailsTable);

      // 6) Build placeholders
      const guardrailsTitle = firm.guardrailsTitle || 'Guardrails Strategy';
      const customDisclaimer = buildDisclaimer({
         household : valueAdd.household,
         customText: firm.guardrailsDisclaimer || ''
       });

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

/* ────────────────────────────────────────────────────────────────
 * 8)  Position the blue “Current Distribution” marker
 *     ------------------------------------------------------------
 *     • 0 %  → sits on the Lower Guard‑rail
 *     • 50 % → sits on the Available/Middle rate
 *     • 100 %→ sits on the Upper Guard‑rail
 *     The bar itself starts 14.4 % from the left edge and spans
 *     71.2 % of the width, so final = 14.4 + ratio*71.2.
 * ──────────────────────────────────────────────────────────────── */
const lowerRateNum     = distTable.lower     .distributionRate;   // e.g. 0.028
const availableRateNum = distTable.available .distributionRate;   // e.g. 0.050
const upperRateNum     = distTable.upper     .distributionRate;   // e.g. 0.080
const currentRateNum   = distTable.current   .distributionRate;   // user’s actual

// 1) Compute a “raw” ratio that can go below 0 or above 1
let rawRatio;
if (currentRateNum <= availableRateNum) {
  const span = availableRateNum - lowerRateNum || 1;
  rawRatio = ((currentRateNum - lowerRateNum) / span) * 0.5;
} else {
  const span = upperRateNum - availableRateNum || 1;
  rawRatio = 0.5 + ((currentRateNum - availableRateNum) / span) * 0.5;
}

// 2) Gentle rubber-band outside [0…1]
let ratio = rawRatio;
if (ratio < 0) {
  ratio = Math.max(ratio * 0.3, -0.2);
}
if (ratio > 1) {
  ratio = Math.min(1 + (ratio - 1) * 0.3, 1.2);
}

// 3) Map into your CSS % and clamp to [0…100]
const leftPct    = 14.4 + ratio * 71.2;
const boundedPct = Math.max(0, Math.min(100, leftPct));
const currentDistribLeft = `${boundedPct.toFixed(1)}%`;



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

    } else if (valueAdd.type === 'BENEFICIARY') {
      // dispatch to your new handler
      console.log('[viewValueAddPage] Dispatching BENEFICIARY');

        // refresh the data in place
        await exports.updateBeneficiaryValueAdd(
          { params: { id: valueAddId } },          // fake req
          { status: () => ({ json(){} }), json(){} } // stub res
        );
      // reload so the template sees the new currentData
      valueAdd = await ValueAdd.findById(valueAddId).lean();
      return exports.viewBeneficiaryPage(req, res);

    } else if (valueAdd.type === 'NET_WORTH') {

    console.log('[viewValueAddPage] Dispatching NETWORTH');
    return exports.viewNetWorthPage(req, res);

    } else if (valueAdd.type === 'HOMEWORK') {

    console.log('[viewValueAddPage] Dispatching HOMEWORK');
    return exports.viewHomeworkPage(req, res);

  } else {
      console.log('[viewValueAddPage] Unsupported type:', valueAdd.type);
      return res.status(400).send('Unsupported Value Add type');
    }

  } catch (err) {
    console.error('Error in viewValueAddPage:', err);
    return res.status(500).send('Server Error');
  }
};












/** Generate PDF with a short wait for older Puppeteer */



function buildLaunchOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  const executablePath = process.env.CHROME_BIN; // provided by your buildpack/script

  if (isProd && !executablePath) {
    throw new Error('CHROME_BIN is not set in production.');
  }

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--no-zygote',
    '--no-first-run'
  ];

  return isProd
    ? { headless: true, executablePath, args }
    : { headless: true, args };
}

async function generateValueAddPDF(url) {
  let browser;
  try {
    const launchOpts = buildLaunchOptions();
    browser = await puppeteer.launch(launchOpts);

    const page = await browser.newPage();

    // Make CSS printing predictable
    try { await page.emulateMediaType('screen'); } catch { /* noop */ }

    // Load and wait for network to settle
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });

    // Extra settle: wait for webfonts/images without using page.waitForTimeout
    await page.evaluate(() => (window.document.fonts ? window.document.fonts.ready : Promise.resolve()));
    await new Promise(r => setTimeout(r, 800)); // tiny buffer, replaceable if you want

    const pdfBuffer = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true, // honors @page size from your HTML
      format: 'Letter',        // ignored if preferCSSPageSize + @page present
      margin: { top: '0.4in', right: '0.4in', bottom: '0.4in', left: '0.4in' }
    });

    return pdfBuffer;
  } finally {
    if (browser) await browser.close();
  }
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

// exports.emailValueAddPDF = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { recipient } = req.body;
//     if (!recipient) {
//       console.error('[emailValueAddPDF] No recipient provided.');
//       return res.status(400).json({ message: 'No recipient provided.' });
//     }

//     const viewUrl = `${req.protocol}://${req.get('host')}/api/value-add/${id}/view`;
//     console.log('[emailValueAddPDF] Generating PDF from =>', viewUrl);
//     const pdfBuffer = await generateValueAddPDF(viewUrl);

//     // Use real SMTP in production
//     const transporter = nodemailer.createTransport({
//       host: process.env.SMTP_HOST,
//       port: parseInt(process.env.SMTP_PORT, 10),
//       secure: (process.env.SMTP_SECURE === 'true'),
//       auth: {
//         user: process.env.SMTP_USER,
//         pass: process.env.SMTP_PASS
//       }
//     });

//     const mailOptions = {
//       from: '"SurgeTech" <no-reply@yourdomain.com>',
//       to: recipient,
//       subject: 'Your Value Add Document',
//       text: 'Hello,\n\nAttached is your Value Add PDF.\n',
//       attachments: [
//         {
//           filename: `value-add-${id}.pdf`,
//           content: pdfBuffer,
//           contentType: 'application/pdf'
//         }
//       ]
//     };

//     const info = await transporter.sendMail(mailOptions);
//     console.log('[emailValueAddPDF] Email sent =>', info.messageId);

//     return res.json({ message: 'Email sent successfully' });
//   } catch (error) {
//     console.error('Error emailing PDF:', error);
//     return res.status(500).json({ message: 'Error sending email', error: error.message });
//   }
// };

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
    // const valueAdd = await ValueAdd.findById(valueAddId)
    let  valueAdd = await ValueAdd.findById(valueAddId)
      .populate({
        path: 'household',
        populate: [
          { path: 'leadAdvisors', select: 'firstName lastName avatar email' },
          {
            path: 'firmId',
            select: `
              companyName companyLogo companyBrandingColor phoneNumber companyAddress companyWebsite
              bucketsEnabled bucketsTitle bucketsDisclaimer bucketsDistributionRate bucketsAvailableRate bucketsUpperRate bucketsLowerRate guardrailsEnabled guardrailsTitle guardrailsDisclaimer guardrailsDistributionRate guardrailsAvailableRate guardrailsUpperRate guardrailsLowerRate guardrailsUpperFactor guardrailsLowerFactor
              beneficiaryEnabled beneficiaryTitle beneficiaryDisclaimer netWorthEnabled netWorthTitle netWorthDisclaimer
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
      const { totalAccountValue, monthlyDistribution } = getHouseholdTotals(householdDoc);
      householdDoc.totalAccountValue = totalAccountValue;
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

 const availRate = (firm?.bucketsAvailableRate     != null)
                 ? firm.bucketsAvailableRate
                 : (firm?.bucketsDistributionRate != null)
                 ? firm.bucketsDistributionRate
                 : 0.054;

 const upperRate = (firm?.bucketsUpperRate != null)
                 ? firm.bucketsUpperRate
                 : availRate + 0.006;

 const lowerRate = (firm?.bucketsLowerRate != null)
                 ? firm.bucketsLowerRate
                 : availRate - 0.006;

 const distOptions = {
   availableRate : availRate,
   upperRate     : upperRate,
   lowerRate     : lowerRate
 };

      const distTable = calculateDistributionTable(freshHousehold, distOptions);
      console.log('[saveValueAddSnapshot] BUCKETS => distTable =>', distTable);

      // 6) Build final placeholders same as in viewValueAddPage
      const valueAddTitle = firm.bucketsTitle || 'Buckets Strategy';
      const customDisclaimer = buildDisclaimer({
        household : valueAdd.household,        // advisors already populated
        customText: firm.bucketsDisclaimer || ''
      });
      
      const d = valueAdd.currentData || {};
      const hideAnnuitiesColumn = (d.annuitiesPercent ?? 0) === 0;
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
      const totalAccountValueForLabel = d.portfolioValue || 0;
      const roundedTotalAccountValue = roundDownToNearestThousand(totalAccountValueForLabel);
      const formattedTotalAccountValue = roundedTotalAccountValue.toLocaleString('en-US', {
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

        '{{TOTAL_ACCOUNT_VALUE}}': formattedTotalAccountValue,
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
    const { totalAccountValue, monthlyDistribution } = getHouseholdTotals(householdDoc);
    householdDoc.totalAccountValue = totalAccountValue;
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
  

      /* ──────────────────────────────────────────────────────────
         NEW explicit‑rate logic (Step 4‑b)
      ────────────────────────────────────────────────────────── */
      const {
        guardrailsAvailableRate,
        guardrailsUpperRate,
        guardrailsLowerRate
      } = firm;

      const avail = guardrailsAvailableRate ?? firm.guardrailsDistributionRate ?? 0.054;
      const upper = guardrailsUpperRate    ?? (avail + 0.006);
      const lower = guardrailsLowerRate    ?? (avail - 0.006);

      const distOptions = {
        availableRate : avail,
        upperRate     : upper,
        lowerRate     : lower
      };

      console.log('[viewValueAddPage] Guardrails rates =>',
                  { avail, upper, lower });


    const guardrailsTable = calculateDistributionTable(freshHousehold, distOptions);
  
    // 6) Same placeholders as Buckets => bar heights, amounts, total AccountValue
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
    const totalAccountValueForLabel = d.portfolioValue || 0;
    const roundedTotalAccountValue = roundDownToNearestThousand(totalAccountValueForLabel);
    const formattedTotalAccountValue = roundedTotalAccountValue.toLocaleString('en-US', {
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
  
/* ────────────────────────────────────────────────────────────────
 * 8)  Position the blue “Current Distribution” marker
 *     ------------------------------------------------------------
 *     • 0 %  → sits on the Lower Guard‑rail
 *     • 50 % → sits on the Available/Middle rate
 *     • 100 %→ sits on the Upper Guard‑rail
 *     The bar itself starts 14.4 % from the left edge and spans
 *     71.2 % of the width, so final = 14.4 + ratio*71.2.
 * ──────────────────────────────────────────────────────────────── */

// 1) Raw ratio
let rawRatio;
if (currentRateNum <= availableRateNum) {
  const span = availableRateNum - lowerRateNum || 1;
  rawRatio = ((currentRateNum - lowerRateNum) / span) * 0.5;
} else {
  const span = upperRateNum - availableRateNum || 1;
  rawRatio = 0.5 + ((currentRateNum - availableRateNum) / span) * 0.5;
}

// 2) Rubber-band outside [0…1]
let ratio = rawRatio;
if (ratio < 0) {
  ratio = Math.max(ratio * 0.3, -0.2);
}
if (ratio > 1) {
  ratio = Math.min(1 + (ratio - 1) * 0.3, 1.2);
}

// 3) CSS left % clamped to the container bounds
const leftPct    = 14.4 + ratio * 71.2;
const boundedPct = Math.max(0, Math.min(100, leftPct));
const currentDistribLeft = `${boundedPct.toFixed(1)}%`;


/* ────────────────────────────────────────────────────────────────
 * 9)  Placeholders for template
 * ──────────────────────────────────────────────────────────────── */
const guardrailsTitle      = firm.guardrailsTitle      || 'Guardrails Strategy';
const customDisclaimer = buildDisclaimer({
  household : valueAdd.household,
  customText: firm.guardrailsDisclaimer || ''
});
const guardrailsReportDate = new Date().toLocaleDateString();
const guardrailsFirmLogo   = firm.companyLogo          || '';
const firmColor            = firm.companyBrandingColor || '#282e38';

  
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
  
      guardrailsHtml = guardrailsHtml.replace(/{{TOTAL_ACCOUNT_VALUE}}/g, formattedTotalAccountValue);
  
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
    // ----------------------------------------------------------------------
    // Handle BENEFICIARY
    // ----------------------------------------------------------------------
  } else if (valueAdd.type === 'BENEFICIARY') {
    try {
      // 1) Load beneficiary.html
      let beneficiaryHtml = fs.readFileSync(
        path.join(__dirname, '..', 'views', 'valueAdds', 'beneficiary.html'),
        'utf8'
      );

      // 2) We replicate your "viewBeneficiaryPage" logic
      // Deconstruct from valueAdd.currentData
      const { primaryBeneficiaries, contingentBeneficiaries, investments } = valueAdd.currentData || {};

      // 3) We fetch the household for clientNameLine + date + firm data
      const householdDoc = await Household.findById(valueAdd.household._id).exec();
      if (!householdDoc) {
        console.log('[saveValueAddSnapshot] No household found for that ID.');
        return res.status(404).json({ message: 'Household not found' });
      }

      // Build top-of-page logic
      let clientNameLine = '---';
      let reportedDateStr = new Date().toLocaleString('en-US', { 
        month: 'long', day: 'numeric', year: 'numeric'
      });
      let firmLogoUrl = '';

      // If the household has a firm
      const firmData = valueAdd.household?.firmId || {};
      if (firmData.companyLogo) {
        firmLogoUrl = firmData.companyLogo;
      }

      // A) Get the clients for top-of-page naming
      const clients = await Client.find({ household: householdDoc._id })
        .select('firstName lastName')
        .lean();

      function formatHouseholdName(clientsArr) {
        if (!clientsArr || clientsArr.length === 0) return '---';

        if (clientsArr.length === 1) {
          const c = clientsArr[0];
          return `${c.lastName}, ${c.firstName}`;
        } else if (clientsArr.length === 2) {
          const [c1, c2] = clientsArr;
          if ((c1.lastName || '').toLowerCase() === (c2.lastName || '').toLowerCase()) {
            return `${c1.lastName}, ${c1.firstName} & ${c2.firstName}`;
          } else {
            return `${c1.lastName}, ${c1.firstName} & ${c2.lastName}, ${c2.firstName}`;
          }
        } else {
          // More than 2 => fallback
          const c = clientsArr[0];
          return `${c.lastName}, ${c.firstName}`;
        }
      }

      clientNameLine = formatHouseholdName(clients);

      // B) Prepare the primary/contingent rows
      const USD = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format;

      const primaryRows = (primaryBeneficiaries || []).map(b => `
        <tr>
          <td>${b.name}</td>
          <td class="tableCellWidth160">${USD(b.totalReceives)}</td>
        </tr>
      `).join('');

      const contingentRows = (contingentBeneficiaries || []).map(b => `
        <tr>
          <td>${b.name}</td>
          <td class="tableCellWidth160">${USD(b.totalReceives)}</td>
        </tr>
      `).join('');

      // C) Build the investmentBlocks
      const investmentBlocks = (investments || []).map(block => {
        const highlightClass = block.ownerName.includes('Kim') ? 'girlBackground15P' : 'boyBackground15P';

        const rows = block.accounts.map(acc => {
          const primaryLines = acc.primary.map(p => `${p.name}<br>`).join('').slice(0, -4);
          const contingentLines = acc.contingent.map(c => `${c.name}<br>`).join('').slice(0, -4);

          const typeLines =
            acc.primary.map(_ => 'Primary<br>').join('').slice(0, -4) +
            '<br>' +
            acc.contingent.map(_ => 'Contingent<br>').join('').slice(0, -4);

          const pctLines =
            acc.primary.map(p => `${p.percentage}%<br>`).join('').slice(0, -4) +
            '<br>' +
            acc.contingent.map(c => `${c.percentage}%<br>`).join('').slice(0, -4);

          const recLines =
            acc.primary.map(p => `${USD(p.receives)}<br>`).join('').slice(0, -4) +
            '<br>' +
            acc.contingent.map(c => `${USD(c.receives)}<br>`).join('').slice(0, -4);

          return `
            <tr>
              <td>${acc.accountName}</td>
              <td class="tableCellWidth80">${USD(acc.value)}</td>
              <td class="tableCellWidth80 doubbleRowedCell">${primaryLines}<br>${contingentLines}</td>
              <td class="tableCellWidth80 doubbleRowedCell">${typeLines}</td>
              <td class="tableCellWidth80 doubbleRowedCell">${pctLines}</td>
              <td class="tableCellWidth80 doubbleRowedCell">${recLines}</td>
            </tr>
          `;
        }).join('');

        return `
          <div class="h113">${block.ownerName}</div>
          <div class="valueAddTable doubbleRowed" style="margin-top:5px;">
            <table>
              <tbody>
                <tr>
                  <th class="${highlightClass}">Account</th>
                  <th class="tableCellWidth80 ${highlightClass}">Value</th>
                  <th class="tableCellWidth80 ${highlightClass}">Beneficiary</th>
                  <th class="tableCellWidth80 ${highlightClass}">Type</th>
                  <th class="tableCellWidth80 ${highlightClass}">Percentage</th>
                  <th class="tableCellWidth80 ${highlightClass}">Receieves</th>
                </tr>
                ${rows}
              </tbody>
            </table>
          </div>
        `;
      }).join('');

      // D) Footer logic
      const firmColor = firmData.companyBrandingColor || '#282e38';
      const fPhone = firmData.phoneNumber || '';
      const fAddress = firmData.companyAddress || '';
      const fWebsite = firmData.companyWebsite || '';
      const footerParts = [];
      if (fAddress) footerParts.push(`<span class="firmField">${fAddress}</span>`);
      if (fPhone)   footerParts.push(`<span class="firmField">${fPhone}</span>`);
      if (fWebsite) footerParts.push(`<span class="firmField">${fWebsite}</span>`);
      const footerCombined = footerParts.join(`<div class="footerBall"></div>`);

      // NEW ❶ – compute the dynamic title (same logic used in view route)
      const beneficiaryTitle = firmData.beneficiaryTitle || 'Beneficiary Value Add';

      const beneficiaryDisclaimer = buildDisclaimer({
        household : valueAdd.household,
         customText: firmData.beneficiaryDisclaimer || ''
       });

      // E) Replace placeholders in beneficiaryHtml
      beneficiaryHtml = beneficiaryHtml.replace(/{{BENEFICIARY_TITLE}}/g, beneficiaryTitle);
      beneficiaryHtml = beneficiaryHtml.replace(/{{BENEFICIARY_DISCLAIMER}}/g, beneficiaryDisclaimer);
      beneficiaryHtml = beneficiaryHtml.replace(/{{FIRM_FOOTER_INFO}}/g, footerCombined);
      beneficiaryHtml = beneficiaryHtml.replace(/{{BRAND_COLOR}}/g, firmColor);

      beneficiaryHtml = beneficiaryHtml.replace(/{{CLIENT_NAME_LINE}}/g, clientNameLine);
      beneficiaryHtml = beneficiaryHtml.replace(/{{REPORTED_DATE}}/g, reportedDateStr);
      beneficiaryHtml = beneficiaryHtml.replace(/{{FIRM_LOGO}}/g, firmLogoUrl);

      beneficiaryHtml = beneficiaryHtml.replace(/{{PRIMARY_ROWS}}/g, primaryRows);
      beneficiaryHtml = beneficiaryHtml.replace(/{{CONTINGENT_ROWS}}/g, contingentRows);
      beneficiaryHtml = beneficiaryHtml.replace(/{{INVESTMENT_BLOCKS}}/g, investmentBlocks);

      // F) finalReplacedHtml
      finalReplacedHtml = beneficiaryHtml;

    } catch (errBeneficiary) {
      console.error('[saveValueAddSnapshot] Error processing BENEFICIARY snapshot:', errBeneficiary);
      return res.status(500).json({ message: 'Error processing Beneficiary HTML' });
    }
  } else if (valueAdd.type === 'NET_WORTH') {
    try {
      // 1) Load networth.html template
      let networthHtml;
      try {
        networthHtml = fs.readFileSync(
          path.join(__dirname, '..', 'views', 'valueAdds', 'networth.html'),
          'utf8'
        );
      } catch (readErr) {
        console.error('[saveValueAddSnapshot] Error reading networth.html:', readErr);
        return res.status(500).json({ message: 'Error loading NetWorth template' });
      }
  
      // 2) Attempt the same "auto-update" logic (optional, if you want the updated data)
      try {
        await exports.updateNetWorthValueAdd(
          { params: { id: valueAdd._id } },
          { status: () => ({ json: () => {} }), json: () => {} }
        );
        await valueAdd.reload();
      } catch (autoErr) {
        console.error('[saveValueAddSnapshot: NET_WORTH] Auto-update error =>', autoErr);
      }
  
      // 3) Grab the updated data
      const d = valueAdd.currentData || {};
  
      // 4) Fetch clients (for clientNameLine)
      const householdId = valueAdd.household?._id;
      let clients = [];
      if (householdId) {
        clients = await Client.find({ household: householdId })
          .select('firstName lastName')
          .lean();
      }
  
      // A) Build name line
      const clientName = dynamicNameLine(clients);
  
      // B) Decide how to label columns exactly as in viewNetWorthPage:
      let client1Label = 'Client1';
      let client2Label = 'Client2';
  
      if (clients.length === 1) {
        // Single client => use that client’s first name for column 1, nothing for column 2
        client1Label = clients[0]?.firstName || 'Client';
        client2Label = '';
      } else if (clients.length === 2) {
        // Two clients => use each real first name
        client1Label = clients[0]?.firstName || 'Client1';
        client2Label = clients[1]?.firstName || 'Client2';
      }
      // If 3+ => fallback to 'Client1' / 'Client2'
  
      // For removing columns if there’s only one client
      const singleClient = (clients.length === 1);
  
      // 5) Prepare the placeholders using your currentData
      const netWorthDisplay = formatMoney(d.netWorth || 0);
      const totalAssetsDisp = formatMoney(d.sumAllAssets || 0);
      const totalLiabDisp   = formatMoney(d.totalLiabilities || 0);
  
      // 6) Replace placeholders for the rows
      networthHtml = networthHtml.replace(/{{TOTAL_NET_WORTH}}/g, netWorthDisplay);
      networthHtml = networthHtml.replace(/{{TOTAL_ASSETS}}/g, totalAssetsDisp);
      networthHtml = networthHtml.replace(/{{TOTAL_LIABILITIES}}/g, totalLiabDisp);
      
  
      networthHtml = networthHtml.replace(/{{CASH_EQUIVALENT_ROWS}}/g, d.cashTableRows || '');
      networthHtml = networthHtml.replace(/{{INVESTABLE_ROWS}}/g,       d.investTableRows || '');
      networthHtml = networthHtml.replace(/{{OTHER_ASSETS_ROWS}}/g,     d.otherTableRows || '');
      networthHtml = networthHtml.replace(/{{LIABILITY_ROWS}}/g,        d.allLiabilityRows || '');
  
      networthHtml = networthHtml.replace(/{{CLIENT1_LABEL}}/g, client1Label);
      networthHtml = networthHtml.replace(/{{CLIENT2_LABEL}}/g, client2Label);
      networthHtml = networthHtml.replace(/{{CLIENT_COUNT_INT}}/g, String(clients.length));
  
      // 7) Date, disclaimers, firm info
      const dateStr = new Date().toLocaleDateString();
      networthHtml = networthHtml.replace(/{{CLIENT_NAME_LINE}}/g, clientName);
      networthHtml = networthHtml.replace(/{{REPORT_DATE}}/g, dateStr);
  
      const firm = valueAdd.household?.firmId || {};
      const networthDisclaimer = buildDisclaimer({
        household : valueAdd.household,
        customText: firm.netWorthDisclaimer || ''

      });
      const firmColor = firm.companyBrandingColor || '#282e38';
      networthHtml = networthHtml.replace(/{{BRAND_COLOR}}/g, firmColor);
      networthHtml = networthHtml.replace(/{{NETWORTH_DISCLAIMER}}/g, networthDisclaimer);
  
      const firmLogo = firm.companyLogo || '';
      networthHtml = networthHtml.replace(/{{FIRM_LOGO}}/g, firmLogo);

      // 8a) Inject the Net Worth Value Add title
      const networthTitle = firm.netWorthTitle || 'Net Worth Summary';
      // replace your {{NETWORTH_TITLE}} placeholder in the template
      networthHtml = networthHtml.replace(
        /\{\{\s*NETWORTH_TITLE\s*\}\}/g,
        networthTitle
      );
      
  
      // 8) Firm footer logic (same approach as other ValueAdds)
      const fPhone   = firm.phoneNumber    || '';
      const fAddress = firm.companyAddress || '';
      const fWebsite = firm.companyWebsite || '';
      const footerParts = [];
      if (fAddress) footerParts.push(`<span class="firmField">${fAddress}</span>`);
      if (fPhone)   footerParts.push(`<span class="firmField">${fPhone}</span>`);
      if (fWebsite) footerParts.push(`<span class="firmField">${fWebsite}</span>`);
      const footerCombined = footerParts.join(`<div class="footerBall"></div>`);
      networthHtml = networthHtml.replace(/{{FIRM_FOOTER_INFO}}/g, footerCombined);
  
      // 9) If single client => remove 2 columns from the HTML (Client2 + Joint)
      if (singleClient) {
        networthHtml = networthHtml.replace(
          /<th[^>]*>{{CLIENT2_LABEL}}<\/th>\s*<th[^>]*>Joint<\/th>/g,
          ''
        );
        networthHtml = networthHtml.replace(
          /(<td class="curencyCell tableCellWidth56">[^<]*<\/td>\s*)(<td class="curencyCell tableCellWidth56">[^<]*<\/td>\s*<td class="curencyCell tableCellWidth56">[^<]*<\/td>)/g,
          '$1'
        );
      }
  
      // 10) The final replaced HTML for NetWorth
      finalReplacedHtml = networthHtml;
      
    } catch (errNet) {
      console.error('[saveValueAddSnapshot: NET_WORTH] Error building NetWorth snapshot:', errNet);
      return res.status(500).json({ message: 'Error processing NetWorth HTML' });
    }
  } else if (valueAdd.type === 'HOMEWORK') {
    try {
      // 1) Auto-refresh HOMEWORK so currentData.page1Html/page2Html are fresh
      const noop  = () => {};
      const chain = { json: noop, send: noop, end: noop };
      await exports.updateHomeworkValueAdd(
        { params: { id: valueAddId } },               // <-- use valueAddId declared at the top
        { status: () => chain, json: noop, send: noop, end: noop }
      );
  
      // 2) Reload the ValueAdd (get fresh currentData + firm)
      valueAdd = await ValueAdd.findById(valueAddId)
        .populate({ path: 'household', populate: [{ path: 'firmId' }] })
        .exec();
      if (!valueAdd) {
        return res.status(404).json({ message: 'Value Add not found.' });
      }
  
      // 3) Load the Homework template
      let template;
      try {
        template = fs.readFileSync(
          path.join(__dirname, '..', 'views', 'valueAdds', 'meetingworksheet.html'),
          'utf8'
        );
      } catch (readErr) {
        console.error('[saveValueAddSnapshot][HOMEWORK] Missing meetingworksheet.html:', readErr);
        return res.status(500).json({ message: 'Template not found' });
      }
  
      // 4) Header/footer replacements
      const firm   = valueAdd.household?.firmId || {};
      const header = valueAdd.currentData?.header || {};
  
      const footerParts = [];
      if (firm.companyAddress) footerParts.push(`<span class="firmField">${firm.companyAddress}</span>`);
      if (firm.phoneNumber)    footerParts.push(`<span class="firmField">${firm.phoneNumber}</span>`);
      if (firm.companyWebsite) footerParts.push(`<span class="firmField">${firm.companyWebsite}</span>`);
      const footerCombined = footerParts.join(`<div class="footerBall"></div>`);
  
      const disclaimerText =
        (typeof buildDisclaimer === 'function')
          ? buildDisclaimer({ household: valueAdd.household, customText: header.homeworkDisclaimer || '' })
          : (header.homeworkDisclaimer || '');
  
      // 5) Build final HTML + inject the page content
      let html = template;
      html = html.replace(/{{FIRM_LOGO}}/g, header.firmLogo || '');
      html = html.replace(/{{BRAND_COLOR}}/g, header.brandColor || '#282e38');
      html = html.replace(/{{HOMEWORK_TITLE}}/g, header.homeworkTitle || 'Homework');
      html = html.replace(/{{CLIENT_NAME_LINE}}/g, header.clientNameLine || '---');
      html = html.replace(/{{REPORT_DATE}}/g, header.reportDate || new Date().toLocaleDateString());
      html = html.replace(/{{HOMEWORK_DISCLAIMER}}/g, disclaimerText);
      html = html.replace(/{{FIRM_FOOTER_INFO}}/g, footerCombined);
      html = html.replace(/{{HOMEWORK_PAGE1}}/g, valueAdd.currentData?.page1Html || '');
      html = html.replace(/{{HOMEWORK_PAGE2}}/g, valueAdd.currentData?.page2Html || '');
  
      // 6) Persist snapshot (store in both html and snapshotData.finalHtml for compatibility)
      const notes = (req.body && typeof req.body.notes === 'string') ? req.body.notes : '';
      valueAdd.snapshots = valueAdd.snapshots || [];
      const snapshot = {
        timestamp: new Date(),
        type: valueAdd.type,
        notes,
        html,                                           // primary (new) field
        snapshotData: { finalHtml: html },              // legacy reader support
        header: valueAdd.currentData?.header || {},
        data:   valueAdd.currentData || {}
      };
      valueAdd.snapshots.push(snapshot);
      await valueAdd.save();
  
      console.log('[saveValueAddSnapshot][HOMEWORK] Snapshot saved successfully!');
      return res.status(201).json({
        message: 'Snapshot saved successfully.',
        snapshot: {
          _id: valueAdd.snapshots[valueAdd.snapshots.length - 1]._id,
          timestamp: snapshot.timestamp
        }
      });
    } catch (e) {
      console.error('[saveValueAddSnapshot][HOMEWORK] Error:', e);
      return res.status(500).json({ message: 'Server Error', error: e.message });
    }
  }
  
  /* ------------------------------------------------------------------
     FINALIZE for NON‑HOMEWORK ValueAdds
     (BUCKETS / GUARDRAILS / BENEFICIARY / NET_WORTH)
     We get here only when type !== 'HOMEWORK'. The branches above set
     `finalReplacedHtml`. Persist it now and respond.
  ------------------------------------------------------------------- */
  if (!finalReplacedHtml) {
    console.error('[saveValueAddSnapshot] No final HTML was produced for type:', valueAdd.type);
    return res.status(500).json({ message: 'No HTML produced for snapshot.' });
  }
  
  const notes = (req.body && typeof req.body.notes === 'string') ? req.body.notes : '';
  valueAdd.snapshots = valueAdd.snapshots || [];
  const snapshot = {
    timestamp: new Date(),
    type: valueAdd.type,
    notes,
    html: finalReplacedHtml,
    snapshotData: { finalHtml: finalReplacedHtml }, // legacy reader support
    header: valueAdd.currentData?.header || {},
    data:   valueAdd.currentData || {}
  };
  valueAdd.snapshots.push(snapshot);
  await valueAdd.save();
  
  console.log('[saveValueAddSnapshot] Snapshot saved successfully!', { type: valueAdd.type });
  return res.status(201).json({
    message: 'Snapshot saved successfully.',
    snapshot: {
      _id: valueAdd.snapshots[valueAdd.snapshots.length - 1]._id,
      timestamp: snapshot.timestamp
    }
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








// for currency formatting
const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
}).format;

exports.viewBeneficiaryPage = async (req, res) => {
  try {
    const { id } = req.params;

    // 1) Retrieve the ValueAdd doc, including household->firmId for firm-specific settings
    const va = await ValueAdd.findById(id)
      .populate({
        path: 'household',
        populate: [
          { path: 'leadAdvisors', select: 'firstName lastName avatar email' },
          { path: 'firmId' }
        ]
      })
      .lean();

    if (!va) return res.status(404).send('Not found');
    if (va.type !== 'BENEFICIARY') return res.status(400).send('Wrong type');

    /* ────────────────────────────────────────────────────────────────────
     *  FIX: Guarantee currentData has the expected shape so destructuring
     *       never throws (“Cannot destructure … as it is undefined”).
     * ──────────────────────────────────────────────────────────────────── */
  
    const DEFAULT_BENEFICIARY = {
      primaryBeneficiaries   : [],
      contingentBeneficiaries: [],
      investments            : []
    };
    va.currentData = {
      ...DEFAULT_BENEFICIARY,
      ...(va.currentData || {})
    };
    // FIX END

    // 2) Deconstruct the beneficiary data from the ValueAdd
    const {
      primaryBeneficiaries,
      contingentBeneficiaries,
      investments
    } = va.currentData;

      // ─────────────────────────────────────────────────────────────
    // NEW: Collapse exact-name duplicates inside each table bucket
    // (character-for-character match; no lowercasing or trimming)
    // ─────────────────────────────────────────────────────────────
    function collapseByExactName(list) {
      const map = new Map();
      (list || []).forEach((b) => {
        const key = (typeof b.name === 'string') ? b.name : '';
        const amt = Number(b.totalReceives) || 0;
        if (!map.has(key)) map.set(key, { name: key, totalReceives: 0 });
        map.get(key).totalReceives += amt;
      });
      return Array.from(map.values());
    }

    const groupedPrimary    = collapseByExactName(primaryBeneficiaries);
    const groupedContingent = collapseByExactName(contingentBeneficiaries);

    // 3) Load your beneficiary.html template
    let html = fs.readFileSync(
      path.join(__dirname, '..', 'views', 'valueAdds', 'beneficiary.html'),
      'utf8'
    );

    // A) Household "Client Name" line at top (Doe, John & Jane, etc.)
    let clientNameLine = '---';
    let reportedDateStr = '';
    let firmLogoUrl = '';

    if (va.household) {
      // Grab the clients for the top-of-page naming
      const clients = await Client.find({ household: va.household._id })
        .select('firstName lastName')
        .lean();

      // This helper formats the household name (e.g. "Doe, John & Jane")
      function formatHouseholdName(clientsArr) {
        if (!clientsArr || clientsArr.length === 0) return '---';
        if (clientsArr.length === 1) {
          const c = clientsArr[0];
          return `${c.lastName}, ${c.firstName}`;
        } else if (clientsArr.length === 2) {
          const [c1, c2] = clientsArr;
          if ((c1.lastName || '').toLowerCase() === (c2.lastName || '').toLowerCase()) {
            return `${c1.lastName}, ${c1.firstName} & ${c2.firstName}`;
          } else {
            return `${c1.lastName}, ${c1.firstName} & ${c2.lastName}, ${c2.firstName}`;
          }
        } else {
          // More than 2 => fallback
          const c = clientsArr[0];
          return `${c.lastName}, ${c.firstName}`;
        }
      }

      clientNameLine = formatHouseholdName(clients);

      // For the “Reported as of Date” (e.g. "May 17, 2023")
      const now = new Date();
      reportedDateStr = now.toLocaleString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });

      // For the firm logo
      if (va.household.firmId && va.household.firmId.companyLogo) {
        firmLogoUrl = va.household.firmId.companyLogo;
      }
    }

    // B) Create table rows for Primary & Contingent
    const primaryRows = (groupedPrimary || []).map(b => `
      <tr>
        <td>${b.name}</td>
        <td class="tableCellWidth160">${USD(b.totalReceives)}</td>
      </tr>
    `).join('');

    const contingentRows = (groupedContingent || []).map(b => `
      <tr>
        <td>${b.name}</td>
        <td class="tableCellWidth160">${USD(b.totalReceives)}</td>
      </tr>
    `).join('');

    // C) Build the “Investments per Owner” tables
    const investmentBlocks = (investments || []).map(block => {
      // Simple highlight logic: if name includes "Kim", apply a special CSS class
      const highlightClass = block.ownerName.includes('Kim') ? 'girlBackground15P' : 'boyBackground15P';

      // For each owner, we build a single table showing all their accounts
      const rows = block.accounts.map(acc => {
        const primaryLines = acc.primary.map(p => `${p.name}<br>`).join('').slice(0, -4);
        const contingentLines = acc.contingent.map(c => `${c.name}<br>`).join('').slice(0, -4);

        const typeLines =
          acc.primary.map(_ => 'Primary<br>').join('').slice(0, -4) +
          '<br>' +
          acc.contingent.map(_ => 'Contingent<br>').join('').slice(0, -4);

        const pctLines =
          acc.primary.map(p => `${p.percentage}%<br>`).join('').slice(0, -4) +
          '<br>' +
          acc.contingent.map(c => `${c.percentage}%<br>`).join('').slice(0, -4);

        const recLines =
          acc.primary.map(p => `${USD(p.receives)}<br>`).join('').slice(0, -4) +
          '<br>' +
          acc.contingent.map(c => `${USD(c.receives)}<br>`).join('').slice(0, -4);

        return `
          <tr>
            <td>${acc.accountName}</td>
            <td class="tableCellWidth80">${USD(acc.value)}</td>
            <td class="tableCellWidth80 doubbleRowedCell">${primaryLines}<br>${contingentLines}</td>
            <td class="tableCellWidth80 doubbleRowedCell">${typeLines}</td>
            <td class="tableCellWidth80 doubbleRowedCell">${pctLines}</td>
            <td class="tableCellWidth80 doubbleRowedCell">${recLines}</td>
          </tr>
        `;
      }).join('');

      return `
        <div class="h113">${block.ownerName}</div>
        <div class="valueAddTable doubbleRowed" style="margin-top:5px;">
          <table>
            <tbody>
              <tr>
                <th class="${highlightClass}">Account</th>
                <th class="tableCellWidth80 ${highlightClass}">Value</th>
                <th class="tableCellWidth80 ${highlightClass}">Beneficiary</th>
                <th class="tableCellWidth80 ${highlightClass}">Type</th>
                <th class="tableCellWidth80 ${highlightClass}">Percentage</th>
                <th class="tableCellWidth80 ${highlightClass}">Receieves</th>
              </tr>
              ${rows}
            </tbody>
          </table>
        </div>
      `;
    }).join('');

    // D) Pull firm-level info for disclaimers, logo, footer, and new dynamic Title
    const firmData = va.household?.firmId || {};
    const fPhone = firmData.phoneNumber || '';
    const fAddress = firmData.companyAddress || '';
    const fWebsite = firmData.companyWebsite || '';
    const firmColor = firmData.companyBrandingColor || '#282e38';

    const footerParts = [];
    if (fAddress) footerParts.push(`<span class="firmField">${fAddress}</span>`);
    if (fPhone)   footerParts.push(`<span class="firmField">${fPhone}</span>`);
    if (fWebsite) footerParts.push(`<span class="firmField">${fWebsite}</span>`);

    const footerCombined = footerParts.join(`<div class="footerBall"></div>`);

    // New dynamic beneficiary title (coming from firm settings)
    const beneficiaryTitle = firmData.beneficiaryTitle || 'Beneficiary Value Add';

    const beneficiaryDisclaimer = buildDisclaimer({
      household : va.household,
      customText: firmData.beneficiaryDisclaimer || ''
    });

    // E) Replace placeholders in beneficiary.html
    //    (You must ensure beneficiary.html actually contains these placeholders.)
    html = html.replace(/{{BENEFICIARY_TITLE}}/g, beneficiaryTitle);
    html = html.replace(/{{BENEFICIARY_DISCLAIMER}}/g, beneficiaryDisclaimer);
    html = html.replace(/{{FIRM_FOOTER_INFO}}/g, footerCombined);
    html = html.replace(/{{BRAND_COLOR}}/g, firmColor);

    // For the top header area
    html = html.replace(/{{CLIENT_NAME_LINE}}/g, clientNameLine);
    html = html.replace(/{{REPORTED_DATE}}/g, reportedDateStr);
    html = html.replace(/{{FIRM_LOGO}}/g, firmLogoUrl || '');

    // For the beneficiary details
    html = html.replace(/{{PRIMARY_ROWS}}/g, primaryRows);
    html = html.replace(/{{CONTINGENT_ROWS}}/g, contingentRows);
    html = html.replace(/{{INVESTMENT_BLOCKS}}/g, investmentBlocks);

    // F) Send the final HTML to the browser
    res.send(html);

  } catch (err) {
    console.error('viewBeneficiaryPage error:', err);
    res.status(500).send('Server Error');
  }
};





exports.createBeneficiaryValueAdd = async (req, res) => {
  try {
    const { householdId } = req.params;

    // 1) Fetch and populate all accounts for this household
    const accounts = await Account.find({ household: householdId })
      .populate('beneficiaries.primary.beneficiary', 'firstName lastName')
      .populate('beneficiaries.contingent.beneficiary', 'firstName lastName')
      .populate('accountOwner', 'firstName lastName')
      .lean();

    // 2) Roll up total for each primary & contingent beneficiary
    const primaryTotals   = {};
    const contingentTotals = {};

    accounts.forEach(acc => {
      const value = acc.accountValue || 0;

      ;(acc.beneficiaries.primary || []).forEach(({ beneficiary, percentageAllocation }) => {
        const share = value * (percentageAllocation / 100);
        const id = beneficiary._id.toString();
        if (!primaryTotals[id]) {
          primaryTotals[id] = { 
            name: `${beneficiary.firstName} ${beneficiary.lastName}`,
            totalReceives: 0 
          };
        }
        primaryTotals[id].totalReceives += share;
      });

      ;(acc.beneficiaries.contingent || []).forEach(({ beneficiary, percentageAllocation }) => {
        const share = value * (percentageAllocation / 100);
        const id = beneficiary._id.toString();
        if (!contingentTotals[id]) {
          contingentTotals[id] = { 
            name: `${beneficiary.firstName} ${beneficiary.lastName}`,
            totalReceives: 0 
          };
        }
        contingentTotals[id].totalReceives += share;
      });
    });

    const primaryBeneficiaries   = Object.values(primaryTotals);
    const contingentBeneficiaries = Object.values(contingentTotals);

      // ─────────────────────────────────────────────────────────────
    // NEW: Collapse duplicates by exact name per table
    // ─────────────────────────────────────────────────────────────
    function collapseByExactName(list) {
      const map = new Map();
      (list || []).forEach((b) => {
        const key = (typeof b.name === 'string') ? b.name : '';
        const amt = Number(b.totalReceives) || 0;
        if (!map.has(key)) map.set(key, { name: key, totalReceives: 0 });
        map.get(key).totalReceives += amt;
      });
      return Array.from(map.values());
    }
    const groupedPrimary    = collapseByExactName(primaryBeneficiaries);
    const groupedContingent = collapseByExactName(contingentBeneficiaries);

    // 3) Build the “Investments – Owner” sections
    //    group accounts by each accountOwner
    const investmentsByOwner = {};
    accounts.forEach(acc => {
// Get last 4 digits if accountNumber exists
let lastFour = '';
if (acc.accountNumber && typeof acc.accountNumber === 'string') {
  lastFour = acc.accountNumber.slice(-4);
} else if (acc.accountNumber && typeof acc.accountNumber === 'number') {
  lastFour = String(acc.accountNumber).slice(-4);
}

// Append to account type
const displayAccountName = lastFour
  ? `${acc.accountTypeRaw || acc.accountType} - ${lastFour}`
  : (acc.accountTypeRaw || acc.accountType);

const row = {
  accountName: displayAccountName,
  value: acc.accountValue || 0,
  primary:   (acc.beneficiaries.primary || []).map(b => ({
    name:       `${b.beneficiary.firstName} ${b.beneficiary.lastName}`,
    percentage: b.percentageAllocation,
    receives:   (acc.accountValue || 0) * (b.percentageAllocation / 100)
  })),
  contingent: (acc.beneficiaries.contingent || []).map(b => ({
    name:       `${b.beneficiary.firstName} ${b.beneficiary.lastName}`,
    percentage: b.percentageAllocation,
    receives:   (acc.accountValue || 0) * (b.percentageAllocation / 100)
  })),
};


      (acc.accountOwner || []).forEach(owner => {
        const key = owner._id.toString();
        if (!investmentsByOwner[key]) {
          investmentsByOwner[key] = {
            ownerName: `${owner.firstName} ${owner.lastName}`,
            accounts:  []
          };
        }
        investmentsByOwner[key].accounts.push(row);
      });
    });

    const investments = Object.values(investmentsByOwner);

    // 4) Create your new data object
    const data = {
      primaryBeneficiaries   : groupedPrimary,
      contingentBeneficiaries: groupedContingent,
      investments
    };

    // 5) Build warnings array
    const warnings = [];
    if (primaryBeneficiaries.length === 0 && contingentBeneficiaries.length === 0) {
      warnings.push('No beneficiaries found on any accounts!');
    }
    // ...Add any other potential checks

    // 6) Create & save the ValueAdd
    const va = new ValueAdd({
      household: householdId,
      type: 'BENEFICIARY',
      currentData: data,
      history: [{ date: new Date(), data }],
      warnings // attach the warnings array
    });
    await va.save();

    return res.status(201).json({
      message: 'Beneficiary ValueAdd created.',
      valueAdd: va
    });
  } catch (err) {
    console.error('createBeneficiaryValueAdd error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};


//
// UPDATE (refresh) a Beneficiary ValueAdd
//
exports.updateBeneficiaryValueAdd = async (req, res) => {
  try {
    console.log('[BENEFICIARY:update] entering refresh for', req.params.id);
    const { id } = req.params;
    const va = await ValueAdd.findById(id);
    if (!va) return res.status(404).json({ message: 'ValueAdd not found.' });
    if (va.type !== 'BENEFICIARY') {
      return res.status(400).json({ message: 'Not a Beneficiary ValueAdd.' });
    }

    // same logic as create, but re-use va.household
    const accounts = await Account.find({ household: va.household })
      .populate('beneficiaries.primary.beneficiary', 'firstName lastName')
      .populate('beneficiaries.contingent.beneficiary', 'firstName lastName')
      .populate('accountOwner', 'firstName lastName')
      .lean();

    const primaryTotals   = {};
    const contingentTotals = {};
    accounts.forEach(acc => {
      const v = acc.accountValue || 0;
      ;(acc.beneficiaries.primary || []).forEach(({ beneficiary, percentageAllocation }) => {
        const share = v * (percentageAllocation / 100);
        const id2 = beneficiary._id.toString();
        primaryTotals[id2] = primaryTotals[id2] || {
          name: `${beneficiary.firstName} ${beneficiary.lastName}`,
          totalReceives: 0
        };
        primaryTotals[id2].totalReceives += share;
      });
      ;(acc.beneficiaries.contingent || []).forEach(({ beneficiary, percentageAllocation }) => {
        const share = v * (percentageAllocation / 100);
        const id2 = beneficiary._id.toString();
        contingentTotals[id2] = contingentTotals[id2] || {
          name: `${beneficiary.firstName} ${beneficiary.lastName}`,
          totalReceives: 0
        };
        contingentTotals[id2].totalReceives += share;
      });
    });

    const primaryBeneficiaries   = Object.values(primaryTotals);
    const contingentBeneficiaries = Object.values(contingentTotals);
 // ─────────────────────────────────────────────────────────────
    // NEW: Collapse duplicates by exact name per table
    // ─────────────────────────────────────────────────────────────
    function collapseByExactName(list) {
      const map = new Map();
      (list || []).forEach((b) => {
        const key = (typeof b.name === 'string') ? b.name : '';
        const amt = Number(b.totalReceives) || 0;
        if (!map.has(key)) map.set(key, { name: key, totalReceives: 0 });
        map.get(key).totalReceives += amt;
      });
      return Array.from(map.values());
    }
    const groupedPrimary    = collapseByExactName(primaryBeneficiaries);
    const groupedContingent = collapseByExactName(contingentBeneficiaries);


    const investmentsByOwner = {};
    accounts.forEach(acc => {
// Get last 4 digits if accountNumber exists
let lastFour = '';
if (acc.accountNumber && typeof acc.accountNumber === 'string') {
  lastFour = acc.accountNumber.slice(-4);
} else if (acc.accountNumber && typeof acc.accountNumber === 'number') {
  lastFour = String(acc.accountNumber).slice(-4);
}

// Append to account type
const displayAccountName = lastFour
  ? `${acc.accountTypeRaw || acc.accountType} - ${lastFour}`
  : (acc.accountTypeRaw || acc.accountType);

const row = {
  accountName: displayAccountName,
  value: acc.accountValue || 0,
  primary:   (acc.beneficiaries.primary || []).map(b => ({
    name:       `${b.beneficiary.firstName} ${b.beneficiary.lastName}`,
    percentage: b.percentageAllocation,
    receives:   (acc.accountValue || 0) * (b.percentageAllocation / 100)
  })),
  contingent: (acc.beneficiaries.contingent || []).map(b => ({
    name:       `${b.beneficiary.firstName} ${b.beneficiary.lastName}`,
    percentage: b.percentageAllocation,
    receives:   (acc.accountValue || 0) * (b.percentageAllocation / 100)
  })),
};


      (acc.accountOwner || []).forEach(owner => {
        const key = owner._id.toString();
        if (!investmentsByOwner[key]) {
          investmentsByOwner[key] = {
            ownerName: `${owner.firstName} ${owner.lastName}`,
            accounts:  []
          };
        }
        investmentsByOwner[key].accounts.push(row);
      });
    });

    const investments = Object.values(investmentsByOwner);

    // build fresh data
    const newData = {
      primaryBeneficiaries   : groupedPrimary,
      contingentBeneficiaries: groupedContingent,
      investments
    };

    // build warnings array
    const warnings = [];
    if (primaryBeneficiaries.length === 0 && contingentBeneficiaries.length === 0) {
      warnings.push('No beneficiaries found on any accounts!');
    }
    // ...Add any other potential checks

    // push new snapshot
    va.currentData = newData;
    va.history.push({ date: new Date(), data: newData });
    va.warnings = warnings; // attach warnings

    await va.save();

    console.log('[BENEFICIARY:update] primary =',
                primaryBeneficiaries.length,
                'contingent =', contingentBeneficiaries.length,
                'invest blocks =', investments.length);

    return res.json({
      message: 'Beneficiary ValueAdd updated.',
      valueAdd: va
    });
  } catch (err) {
    console.error('updateBeneficiaryValueAdd error:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};






/***********************************************************
 * NET WORTH VALUE ADD: CREATE, UPDATE, and VIEW
 ***********************************************************/

/**
 * A small helper to pick the "final" account type string:
 * - accountType (if set and not 'Other')
 * - else accountTypeRaw (if set and not 'Other')
 * - else 'Other'
 */
function determineDisplayType(acc) {
  // Trim and unify to lower for checks
  const typed = (acc.accountType || '').trim();
  const rawed = (acc.accountTypeRaw || '').trim();

  if (typed && typed.toLowerCase() !== 'other') {
    return typed;
  } else if (rawed && rawed.toLowerCase() !== 'other') {
    return rawed;
  } else {
    return 'Other';
  }
}

/**
 * Decides if an account or asset is "CASH_EQUIVALENT", "INVESTABLE", or "OTHER"
 * Uses the final chosen type string in place of picking accountTypeRaw first.
 */
function categorizeAccountType(acc) {
  const finalType = determineDisplayType(acc).toLowerCase();

  const cashKeywords = ['checking','individual','savings','money market','cd','cash'];
  const investKeywords = [
    'ira','roth','401(k)','403(b)','tsp','brokerage','sep ira','simple ira','annuity', 'joint' , 'joint account', 'join', 'joint tenants'
  ];

  // Check for “cash” matches
  for (let ck of cashKeywords) {
    if (finalType.includes(ck)) {
      return 'CASH_EQUIVALENT';
    }
  }
  // Check for “invest” matches
  for (let ik of investKeywords) {
    if (finalType.includes(ik)) {
      return 'INVESTABLE';
    }
  }
  // Otherwise fallback
  return 'OTHER';
}

/**
 * Decides if an item belongs to client1, client2, or is Joint.
 * We'll pass in owner(s) plus the two IDs. 
 * If exactly 1 owner => it's either c1 or c2 if that matches, else 'Joint'.
 * If exactly 2 => 'Joint'.
 * If 3+ or mismatch => 'Joint'.
 */
function determineOwnerColumn(ownerIds, c1Id, c2Id) {
  const s1 = c1Id ? String(c1Id) : '';
  const s2 = c2Id ? String(c2Id) : '';

  if (Array.isArray(ownerIds)) {
    if (ownerIds.length === 2) return 'Joint';
    if (ownerIds.length === 1) {
      const single = String(ownerIds[0]);
      if (single === s1) return 'Client1';
      if (single === s2) return 'Client2';
      return 'Joint';
    }
    // 0 or 3+ => treat as Joint
    return 'Joint';
  } else {
    // Single non-array
    const single = String(ownerIds);
    if (single === s1) return 'Client1';
    if (single === s2) return 'Client2';
    return 'Joint';
  }
}

/**
 * Format a number as currency with no decimal cents.
 */
function formatMoney(amount = 0) {
  return `$${amount.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })}`;
}

/**
 * Helper to build <tr> rows, plus a final "Total" row, for either:
 *  - Single client => 2 columns: [Label, Client1]
 *  - Exactly two or more => 4 columns: [Label, Client1, Client2, Joint]
 *
 * items => [ { label, column:'Client1'|'Client2'|'Joint', amount }, ... ]
 */
function buildNetWorthRows(items, singleClient = false) {
  let sumClient1 = 0;
  let sumClient2 = 0;
  let sumJoint   = 0;
  let html = '';

  items.forEach(item => {
    const display = formatMoney(item.amount || 0);

    if (singleClient) {
      // Only 1 client => 2 columns total
      sumClient1 += item.amount || 0;
      html += `
        <tr>
          <td>${item.label}</td>
          <td class="curencyCell tableCellWidth56">${display}</td>
        </tr>
      `;
    } else {
      // 2+ clients => 4 columns
      let c1Val = '', c2Val = '', jointVal = '';
      if (item.column === 'Client1') {
        c1Val = display;
        sumClient1 += (item.amount || 0);
      } else if (item.column === 'Client2') {
        c2Val = display;
        sumClient2 += (item.amount || 0);
      } else {
        jointVal = display;
        sumJoint += (item.amount || 0);
      }

      html += `
        <tr>
          <td>${item.label}</td>
          <td class="curencyCell tableCellWidth56">${c1Val}</td>
          <td class="curencyCell tableCellWidth56">${c2Val}</td>
          <td class="curencyCell tableCellWidth56">${jointVal}</td>
        </tr>
      `;
    }
  });

  // Final row with each column's sum => "Total"
  if (singleClient) {
    // 2 columns
    html += `
      <tr class="tableFooterRow" style="font-weight: bold;">
        <td>Total</td>
        <td class="curencyCell tableCellWidth56">${formatMoney(sumClient1)}</td>
      </tr>
    `;
  } else {
    // 4 columns
    html += `
      <tr class="tableFooterRow" style="font-weight: bold;">
        <td>Total</td>
        <td class="curencyCell tableCellWidth56">${formatMoney(sumClient1)}</td>
        <td class="curencyCell tableCellWidth56">${formatMoney(sumClient2)}</td>
        <td class="curencyCell tableCellWidth56">${formatMoney(sumJoint)}</td>
      </tr>
    `;
  }

  return html;
}

/**
 * Utility to build a “Banks, Paul & Emily” line or “Doe, John +2 more” if 3+ clients
 */
function dynamicNameLine(clients) {
  if (!clients || clients.length === 0) return '---';

  if (clients.length === 1) {
    const c = clients[0];
    return `${c.lastName}, ${c.firstName}`;
  } else if (clients.length === 2) {
    const [c1, c2] = clients;
    if (c1.lastName.toLowerCase() === c2.lastName.toLowerCase()) {
      return `${c1.lastName}, ${c1.firstName} & ${c2.firstName}`;
    } else {
      return `${c1.lastName}, ${c1.firstName} & ${c2.lastName}, ${c2.firstName}`;
    }
  } else {
    const c = clients[0];
    return `${c.lastName}, ${c.firstName} +${clients.length - 1} more`;
  }
}


// --------------------------------------------------------------
// CREATE NetWorth ValueAdd
// --------------------------------------------------------------
exports.createNetWorthValueAdd = async (req, res) => {
  try {
    const { householdId } = req.params;
    console.log('[createNetWorthValueAdd] START. Household =>', householdId);

    // Check if a NET_WORTH doc already exists
    const existing = await ValueAdd.findOne({ household: householdId, type: 'NET_WORTH' }).lean();
    if (existing) {
      console.log('[createNetWorthValueAdd] Already exists =>', existing._id);
      return res.status(400).json({ message: 'Net Worth ValueAdd already exists. Use update.' });
    }

    const household = await Household.findById(householdId).lean();
    if (!household) {
      console.error('[createNetWorthValueAdd] No household found =>', householdId);
      return res.status(404).json({ message: 'Household not found.' });
    }

    const householdClients = await Client.find({ household: householdId }).lean();
    const c1Id = householdClients[0]?._id;
    const c2Id = householdClients[1]?._id;
    const singleClient = (householdClients.length === 1);

    // ACCOUNTS
    const accounts = await Account.find({ household: householdId }).lean();
    console.log('[createNetWorthValueAdd] Found accounts =>', accounts.length);

    const cashArr = [];
    const investArr = [];
    const otherArr = [];
    let totalAccounts = 0;

    accounts.forEach(acc => {
      const category = categorizeAccountType(acc);
      const col = determineOwnerColumn(acc.accountOwner, c1Id, c2Id);
      const val = acc.accountValue || 0;
      totalAccounts += val;

      // Show type + last 4 of account number (if present)
let label = determineDisplayType(acc);
if (acc.accountNumber) {
  const last4 = String(acc.accountNumber).slice(-4);
  if (last4) label += ` - ${last4}`;
}


      if (category === 'CASH_EQUIVALENT') {
        cashArr.push({ label, column: col, amount: val });
      } else if (category === 'INVESTABLE') {
        investArr.push({ label, column: col, amount: val });
      } else {
        otherArr.push({ label, column: col, amount: val });
      }
    });

    // PHYSICAL ASSETS => also “other”
    const clientIds = householdClients.map(c => c._id);
    const assets = await Asset.find({ owners: { $in: clientIds } })
    .lean();
    let totalPhysical = 0;
    assets.forEach(pa => {
      const col = determineOwnerColumn(pa.owners, c1Id, c2Id);
      const val = pa.assetValue || 0;
      totalPhysical += val;
      const label = pa.assetType || 'Physical';
      otherArr.push({ label, column: col, amount: val });
    });

    const sumAllAssets = totalAccounts + totalPhysical;

    // Build final row strings
    const cashRows   = buildNetWorthRows(cashArr,   singleClient);
    const investRows = buildNetWorthRows(investArr, singleClient);
    const otherRows  = buildNetWorthRows(otherArr,  singleClient);

    // Liabilities
    // pull _all_ liabilities for the household, then filter in JS
    const allLiabilities = await Liability.find({ household: householdId }).lean();
    const liabilities = allLiabilities.filter(li => {
      // unify your “owners” list: handle both array (`owners`) or legacy single (`owner`)
      const ownersList = Array.isArray(li.owners)
        ? li.owners.map(String)
        : li.owner
          ? [String(li.owner)]
          : [];
      // include any that are marked "joint"
      if (ownersList.includes('joint')) return true;
      // otherwise include if one of the owners matches a real client ID
      return ownersList.some(ownerId =>
        clientIds.map(id => id.toString()).includes(ownerId)
      );
    });


    let totalLiabilities = 0;
    let liabilityItems = [];

    liabilities.forEach(li => {
      const col = determineOwnerColumn(li.owners, c1Id, c2Id);
      const val = li.outstandingBalance || 0;
      totalLiabilities += val;

      const label = li.liabilityType || 'Other Liability';
      liabilityItems.push({
        label,
        column: col,
        amount: val
      });
    });
    const allLiabilityRows = buildNetWorthRows(liabilityItems, singleClient);

    // Net worth
    const netWorth = sumAllAssets - totalLiabilities;

    // Prepare currentData
    const currentData = {
      netWorth,
      totalAccounts,
      totalAssets: totalPhysical,
      totalLiabilities,
      sumAllAssets,
      accounts,
      assets,
      liabilities,
      // The table row strings:
      cashTableRows:    cashRows,
      investTableRows:  investRows,
      otherTableRows:   otherRows,
      allLiabilityRows
    };

    const warnings = [];
    if (sumAllAssets <= 0) warnings.push('No assets found for this household.');
    if (totalLiabilities <= 0) warnings.push('No liabilities found for this household.');

    const newVA = new ValueAdd({
      household: householdId,
      type: 'NET_WORTH',
      currentData,
      history: [{ date: new Date(), data: currentData }],
      warnings
    });
    await newVA.save();
    console.log('[NetWorth] pulled liabilities:', allLiabilities.length, 'filtered:', liabilities.length);

    console.log('[createNetWorthValueAdd] Created new NET_WORTH =>', newVA._id);
    return res.status(201).json({
      message: 'Net Worth ValueAdd created successfully',
      valueAdd: newVA
    });

  } catch (err) {
    console.error('Error in createNetWorthValueAdd =>', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// --------------------------------------------------------------
// UPDATE NetWorth ValueAdd
// --------------------------------------------------------------
exports.updateNetWorthValueAdd = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('[updateNetWorthValueAdd] ValueAdd =>', id);

    const valueAdd = await ValueAdd.findById(id).populate('household');
    if (!valueAdd) {
      console.error('[updateNetWorthValueAdd] Not found =>', id);
      return res.status(404).json({ message: 'Value Add not found.' });
    }
    if (valueAdd.type !== 'NET_WORTH') {
      console.error('[updateNetWorthValueAdd] Wrong type =>', valueAdd.type);
      return res.status(400).json({ message: 'Value Add is not of type NET_WORTH.' });
    }

    const householdId = valueAdd.household._id;
    const household = await Household.findById(householdId).lean();
    if (!household) {
      return res.status(404).json({ message: 'Household no longer exists.' });
    }

    const householdClients = await Client.find({ household: householdId }).lean();
    const c1Id = householdClients[0]?._id;
    const c2Id = householdClients[1]?._id;
    const singleClient = (householdClients.length === 1);

    // Recalc accounts
    const accounts = await Account.find({ household: householdId }).lean();
    let cashArr = [], investArr = [], otherArr = [];
    let totalAccounts = 0;

    accounts.forEach(acc => {
      const category = categorizeAccountType(acc);
      const col = determineOwnerColumn(acc.accountOwner, c1Id, c2Id);
      const val = acc.accountValue || 0;
      totalAccounts += val;

      // Show type + last 4 of account number (if present)
let label = determineDisplayType(acc);
if (acc.accountNumber) {
  const last4 = String(acc.accountNumber).slice(-4);
  if (last4) label += ` - ${last4}`;
}


      if (category === 'CASH_EQUIVALENT') {
        cashArr.push({ label, column: col, amount: val });
      } else if (category === 'INVESTABLE') {
        investArr.push({ label, column: col, amount: val });
      } else {
        otherArr.push({ label, column: col, amount: val });
      }
    });

    // Physical
    const clientIds = householdClients.map(c => c._id);
    const assets = await Asset.find({ owners: { $in: clientIds } }).lean();
    let totalPhysical = 0;
    assets.forEach(pa => {
      const col = determineOwnerColumn(pa.owners, c1Id, c2Id);
      const val = pa.assetValue || 0;
      totalPhysical += val;
      const label = pa.assetType || 'Physical Asset';
      otherArr.push({ label, column: col, amount: val });
    });

    const sumAllAssets = totalAccounts + totalPhysical;

    // Build the row strings
    const cashRows   = buildNetWorthRows(cashArr,   singleClient);
    const investRows = buildNetWorthRows(investArr, singleClient);
    const otherRows  = buildNetWorthRows(otherArr,  singleClient);

    // Liabilities
    // pull _all_ liabilities for the household, then filter in JS
    const allLiabilities = await Liability.find({ household: householdId }).lean();
    const liabilities = allLiabilities.filter(li => {
      // unify your “owners” list: handle both array (`owners`) or legacy single (`owner`)
      const ownersList = Array.isArray(li.owners)
        ? li.owners.map(String)
        : li.owner
          ? [String(li.owner)]
          : [];
      // include any that are marked "joint"
      if (ownersList.includes('joint')) return true;
      // otherwise include if one of the owners matches a real client ID
      return ownersList.some(ownerId =>
        clientIds.map(id => id.toString()).includes(ownerId)
      );
    });


    let totalLiabilities = 0;
    let liabilityItems = [];
    liabilities.forEach(li => {
      const col = determineOwnerColumn(li.owners, c1Id, c2Id);
      const val = li.outstandingBalance || 0;
      totalLiabilities += val;

      const label = li.liabilityType || 'Other Liability';
      liabilityItems.push({
        label,
        column: col,
        amount: val
      });
    });
    const allLiabilityRows = buildNetWorthRows(liabilityItems, singleClient);

    const netWorth = sumAllAssets - totalLiabilities;

    const updatedData = {
      netWorth,
      totalAccounts,
      totalAssets: totalPhysical,
      totalLiabilities,
      sumAllAssets,
      accounts,
      assets,
      liabilities,

      // Strings
      cashTableRows:    cashRows,
      investTableRows:  investRows,
      otherTableRows:   otherRows,
      allLiabilityRows
    };

    const warnings = [];
    if (sumAllAssets <= 0) warnings.push('No assets found for this household.');
    if (totalLiabilities <= 0) warnings.push('No liabilities found for this household.');

    valueAdd.currentData = updatedData;
    valueAdd.history.push({ date: new Date(), data: updatedData });
    valueAdd.warnings = warnings;
    await valueAdd.save();

    console.log('[updateNetWorthValueAdd] NetWorth updated =>', valueAdd._id);
    return res.json({ message: 'Net Worth updated successfully', valueAdd });
  } catch (err) {
    console.error('Error in updateNetWorthValueAdd =>', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// --------------------------------------------------------------
// VIEW NetWorth
// --------------------------------------------------------------
exports.viewNetWorthPage = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('[viewNetWorthPage: NET_WORTH] ValueAdd =>', id);

    // Attempt auto-update each time
    try {
      await exports.updateNetWorthValueAdd(
        { params: { id } },
        {
          status: () => ({ json: () => {} }),
          json: () => {},
        }
      );
      console.log('[viewNetWorthPage: NET_WORTH] Auto-updated successfully');
    } catch (autoErr) {
      console.error('[viewNetWorthPage: NET_WORTH] Auto-update error =>', autoErr);
    }

     const valueAdd = await ValueAdd.findById(id)
       .populate({
         path: 'household',
         populate: [
           { path: 'leadAdvisors', select: 'firstName lastName avatar email' },
           { path: 'firmId' }
         ]
       })
       .lean();

    if (!valueAdd || valueAdd.type !== 'NET_WORTH') {
      console.error('[viewNetWorthPage] Not found or not NET_WORTH =>', id);
      return res.status(404).send('Net Worth Value Add not found');
    }

    const d = valueAdd.currentData || {};
    console.log('[viewNetWorthPage: NET_WORTH] final currentData =>', d);

    const Client = require('../models/Client');
    let clients = [];
    if (valueAdd.household) {
      clients = await Client.find({ household: valueAdd.household._id })
        .select('firstName lastName')
        .lean();
      console.log('[viewNetWorthPage: NET_WORTH] Household clients =>', clients);
    }

    // 1) Build your top-line name
    const clientNameLine = dynamicNameLine(clients);


    // 2) If 1 or 2 clients => show their actual names
    //    If 3+ => fallback
    const singleClient = (clients.length === 1);

    let client1Label = 'Client1';
    let client2Label = 'Client2';

    if (clients.length === 1) {
      client1Label = clients[0]?.firstName || 'Client';
      client2Label = '';
    } else if (clients.length === 2) {
      client1Label = clients[0]?.firstName || 'Client1';
      client2Label = clients[1]?.firstName || 'Client2';
    }

    // 3) Load networth.html
    const fs = require('fs');
    const path = require('path');
    const networthPath = path.join(__dirname, '..', 'views', 'valueAdds', 'networth.html');
    let networthHtml = fs.readFileSync(networthPath, 'utf8');

    // 4) Insert numeric sums etc.
    const netWorthDisplay = formatMoney(d.netWorth || 0);
    const totalAssetsDisp = formatMoney(d.sumAllAssets || 0);
    const totalLiabDisp   = formatMoney(d.totalLiabilities || 0);
    const clientCountInt  = clients.length;
    

    networthHtml = networthHtml.replace(/{{TOTAL_NET_WORTH}}/g, netWorthDisplay);
    networthHtml = networthHtml.replace(/{{TOTAL_ASSETS}}/g, totalAssetsDisp);
    networthHtml = networthHtml.replace(/{{TOTAL_LIABILITIES}}/g, totalLiabDisp);

    networthHtml = networthHtml.replace(/{{CASH_EQUIVALENT_ROWS}}/g, d.cashTableRows || '');
    networthHtml = networthHtml.replace(/{{INVESTABLE_ROWS}}/g,       d.investTableRows || '');
    networthHtml = networthHtml.replace(/{{OTHER_ASSETS_ROWS}}/g,     d.otherTableRows || '');
    networthHtml = networthHtml.replace(/{{LIABILITY_ROWS}}/g,        d.allLiabilityRows || '');
    

    networthHtml = networthHtml.replace(/{{CLIENT1_LABEL}}/g, client1Label);
    networthHtml = networthHtml.replace(/{{CLIENT2_LABEL}}/g, client2Label);
    networthHtml = networthHtml.replace(/{{CLIENT_COUNT_INT}}/g, String(clientCountInt));

    networthHtml = networthHtml.replace(/{{CLIENT_NAME_LINE}}/g, clientNameLine);
    const dateStr = new Date().toLocaleDateString();
    networthHtml = networthHtml.replace(/{{REPORT_DATE}}/g, dateStr);

    // 5) Use firm’s netWorthTitle (no fallback) and netWorthDisclaimer (no fallback)
    const firm = valueAdd.household?.firmId || {};


    // Title (no fallback)
    const networthTitle = firm.netWorthTitle;
    networthHtml = networthHtml.replace(/{{NETWORTH_TITLE}}/g, networthTitle);

    // Disclaimer (no fallback)
    const networthDisclaimer = buildDisclaimer({
       household : valueAdd.household,
       customText: firm.netWorthDisclaimer || ''
     });
    networthHtml = networthHtml.replace(/{{NETWORTH_DISCLAIMER}}/g, networthDisclaimer);

    // Logo
    const firmLogo = firm.companyLogo || '';
    networthHtml = networthHtml.replace(/{{FIRM_LOGO}}/g, firmLogo);
    const firmColor = firm.companyBrandingColor || '#282e38';

    networthHtml = networthHtml.replace(/{{BRAND_COLOR}}/g, firmColor);
    // Footer
    const fPhone   = firm.phoneNumber    || '';
    const fAddress = firm.companyAddress || '';
    const fWebsite = firm.companyWebsite || '';
    const footerParts = [];
    if (fAddress) footerParts.push(`<span class="firmField">${fAddress}</span>`);
    if (fPhone)   footerParts.push(`<span class="firmField">${fPhone}</span>`);
    if (fWebsite) footerParts.push(`<span class="firmField">${fWebsite}</span>`);
    const footerCombined = footerParts.join(`<div class="footerBall"></div>`);
    networthHtml = networthHtml.replace(/{{FIRM_FOOTER_INFO}}/g, footerCombined);

    console.log('[viewNetWorthPage: NET_WORTH] final replaced. Sending...');

    // If exactly 1 client => remove columns for Client2 + Joint
    if (singleClient) {
      networthHtml = networthHtml.replace(
        /<th[^>]*>{{CLIENT2_LABEL}}<\/th>\s*<th[^>]*>Joint<\/th>/g,
        ''
      );
      networthHtml = networthHtml.replace(
        /(<td class="curencyCell tableCellWidth56">[^<]*<\/td>\s*)(<td class="curencyCell tableCellWidth56">[^<]*<\/td>\s*<td class="curencyCell tableCellWidth56">[^<]*<\/td>)/g,
        '$1'
      );
    }

    return res.send(networthHtml);

  } catch (err) {
    console.error('Error in viewNetWorthPage =>', err);
    return res.status(500).send('Server error');
  }
};


// controllers/valueAddController.js
exports.getAllSnapshotsForHousehold = async (req, res) => {
  try {
    const { householdId } = req.params;

    // 1) Pull every ValueAdd doc for this household
    const valueAdds = await ValueAdd.find({ household: householdId })
      .select('_id type snapshots')        // snapshots = embedded array
      .lean();

    // 2) Flatten into one array
    const list = [];
    valueAdds.forEach(va => {
      (va.snapshots || []).forEach(snap => {
        list.push({
          snapshotId : snap._id,
          valueAddId : va._id,
          type       : va.type,            // BUCKETS, GUARDRAILS …
          timestamp  : snap.timestamp
        });
      });
    });

    res.json(list);
  } catch (err) {
    console.error('[getAllSnapshotsForHousehold]', err);
    res.status(500).json({ message: 'Failed to load snapshots.' });
  }
};

/**
 * GET /api/value-add/:id/snapshot/:snapshotId/notes
 * Returns { notes: '…' } or 404.
 */
exports.getSnapshotNotes = async (req, res) => {
  try {
    const { id, snapshotId } = req.params;
    const va = await ValueAdd.findById(id).select('snapshots').lean();
    if (!va) return res.status(404).json({ message: 'Value Add not found' });

    const snap = va.snapshots.find(s => s._id.toString() === snapshotId);
    if (!snap) return res.status(404).json({ message: 'Snapshot not found' });

    res.json({ notes: snap.notes || '' });
  } catch (err) {
    console.error('[getSnapshotNotes]', err);
    res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/value-add/household/:householdId/all-snapshots
 * Optional query: ?page=1&limit=10
 * Returns { total, page, limit, snapshots:[ … ] }
 */
exports.getAllSnapshotsForHouseholdPaginated = async (req, res) => {
  try {
    const { householdId } = req.params;
    const page  = Math.max(parseInt(req.query.page  || '1', 10), 1);
    const limit = Math.max(parseInt(req.query.limit || '10', 10), 1);
    const skip  = (page - 1) * limit;

    // 1) Pull VA docs but only project snapshots we will flatten
    const valueAdds = await ValueAdd.find({ household: householdId })
      .select('_id type snapshots')
      .lean();

    // 2) Flatten and sort newest → oldest
    const flat = [];
    valueAdds.forEach(va => {
      (va.snapshots || []).forEach(snap => {
        flat.push({
          snapshotId : snap._id,
          valueAddId : va._id,
          type       : va.type,
          timestamp  : snap.timestamp,
          notes      : (snap.notes || '').trim()
        });
      });
    });
    flat.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const total = flat.length;
    const pageItems = flat.slice(skip, skip + limit);

    return res.json({ total, page, limit, snapshots: pageItems });
  } catch (err) {
    console.error('[getAllSnapshotsForHouseholdPaginated]', err);
    res.status(500).json({ message: 'Failed to load snapshots.' });
  }
};


/**
 * DELETE  /api/value-add/:id/snapshot/:snapshotId
 * Permanently removes one snapshot from the ValueAdd document.
 */
exports.deleteValueAddSnapshot = async (req, res) => {
  try {
    const { id, snapshotId } = req.params;               // ValueAdd id & snap id

    const va = await ValueAdd.findById(id);
    if (!va) return res.status(404).json({ message: 'Value Add not found.' });

    // Locate and remove
    const idx = va.snapshots.findIndex(s => s._id.toString() === snapshotId);
    if (idx === -1) return res.status(404).json({ message: 'Snapshot not found.' });

    va.snapshots.splice(idx, 1);
    await va.save();

    return res.json({ message: 'Snapshot deleted successfully.' });
  } catch (err) {
    console.error('[deleteValueAddSnapshot]', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

const HWDBG = process.env.HW_DEBUG === '1';



// UPDATE Homework ValueAdd (refresh shared header/branding; keep content placeholder)
exports.updateHomeworkValueAdd = async (req, res) => {
  try {
    const { id } = req.params;
    
    

    // Fetch VA + firm so we can refresh branding each time
    const va = await ValueAdd.findById(id)
      .populate({ path: 'household', populate: [{ path: 'firmId' }] });
    if (!va) return res.status(404).json({ message: 'Value Add not found.' });
    if (va.type !== 'HOMEWORK') {
      return res.status(400).json({ message: 'Value Add is not of type HOMEWORK.' });
    }

    // Helper for "Doe, John & Jane" line
    function dynamicNameLine(clients, household) {
      if (Array.isArray(clients) && clients.length > 0) {
        if (clients.length === 1) {
          const c = clients[0]; return `${c.lastName}, ${c.firstName}`;
        }
        if (clients.length === 2) {
          const [a, b] = clients;
          return (a.lastName && b.lastName &&
                  a.lastName.toLowerCase() === b.lastName.toLowerCase())
            ? `${a.lastName}, ${a.firstName} & ${b.firstName}`
            : `${a.lastName}, ${a.firstName} & ${b.lastName}, ${b.firstName}`;
        }
        const c = clients[0];
        return `${c.lastName}, ${c.firstName}`;
      }
      // Fallbacks: household display name helper or '---'
      if (typeof getDisplayName === 'function') return getDisplayName(household._id);
      return '---';
    }

    // Load clients for name line (optional)
    let clients = [];
    if (Client) {
      clients = await Client.find({ household: va.household._id })
        .select('firstName lastName')
        .lean();
    }

    const firm = va.household?.firmId || {};
    const header = {
      clientNameLine: dynamicNameLine(clients, va.household),
      reportDate: new Date().toLocaleDateString(),
      firmLogo: firm.companyLogo || '',
      brandColor: firm.companyBrandingColor || '#282e38',
      homeworkTitle: firm.homeworkTitle || 'Homework',
      homeworkDisclaimer: firm.homeworkDisclaimer || '', // optional; safe placeholder
      firmName: firm.companyName || ''
    };






// Build fresh body content using calculators
const asOf = new Date();
const data = await computeValueAdd(va.household._id, { asOf });

// settings must be present before rendering (notes/homework blocks)
// settings must be present before rendering (notes/homework blocks)
data.settings = await HomeworkSettings.findOne({ household: va.household._id }).lean() || {};
const s = data.settings || {};
data.page1 = data.page1 || {};

// 1) provide outside investments to the renderer (for the grid cell)
data.page1.outsideInv = Array.isArray(s.outsideInvestments) ? s.outsideInvestments : [];

// 2) MANUAL‑ONLY TAX FIELDS: remove any computed values first
delete data.page1.agiPriorYear;
delete data.page1.taxableIncomePY;
delete data.page1.totalTaxesEstimate;
delete data.page1.bracketPct;
delete data.page1.taxesYear; // label shown next to "AGI / Taxable Income"


// >>> NEW: load clients with DOB and map for the renderer
const clientsRaw = await Client.find({ household: va.household._id })
  .select('firstName lastName dob occupation employer retirementDate birthMonth birthDay birthYear profile details')
  .lean({ virtuals: true }); // include age virtual

data.clients = (clientsRaw || []).slice(0, 2).map(c => ({
  firstName: c.firstName,
  lastName : c.lastName,
  age      : c.age ?? null,        // virtual from schema
  dob      : c.dob || null,        // key the renderer already checks first
  // keep extras the renderer already displays
  occupation: c.occupation || '',
  employer  : c.employer || '',
  retirementDate: c.retirementDate || null,
  // pass-throughs so getClientDobDate() has more options if needed
  birthMonth: c.birthMonth, birthDay: c.birthDay, birthYear: c.birthYear,
  profile: c.profile, details: c.details,
}));

// >>> pull accounts + liabilities
const [accounts, liabilities] = await Promise.all([
  Account.find({ household: va.household._id }).lean(),
  Liability.find({ household: va.household._id }).lean(),
]);

console.log('[HW] fetched accounts', accounts);

if (HWDBG) {
  const bal100 = accounts.reduce((n, a) => {
    const raw = a && a.balance;
    if (raw == null) return n;
    const num = (typeof raw === 'number') ? raw :
      Number(String(raw).replace(/[^0-9.-]/g, ''));
    return n + (num === 100 ? 1 : 0);
  }, 0);
  console.log('[HW] fetched accounts', {
    household: String(va.household._id),
    count: accounts.length,
    topLevelBalanceEq100: bal100
  });
}



data.accounts = accounts;
data.liabilities = liabilities;

// --- helpers (controller-side) ---
const normType = a =>
  (a?.accountType || a?.subType || a?.subtype || a?.type || a?.category || '').toString().trim().toLowerCase();

const parseMoney = v => {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const pickBal = a => {
  const id   = a?._id?.toString?.() || a?.id || 'n/a';
  const type = normType(a);

  if (a?.plaid?.balances) {
    const rawC = a.plaid.balances.current;
    const rawA = a.plaid.balances.available;
    const v = parseMoney(rawC ?? rawA);
    if (v !== 0) { if (HWDBG) console.log('[HW] pickBal winner', { id, type, via: 'plaid.balances', rawCurrent: rawC, rawAvailable: rawA, parsed: v }); return v; }
  }

  if (a?.yodlee?.balance) {
    const y = a.yodlee.balance;
    const raw = y.amount ?? y.current ?? y.available ?? y.balance;
    const v = parseMoney(raw);
    if (v !== 0) { if (HWDBG) console.log('[HW] pickBal winner', { id, type, via: 'yodlee.balance', raw, parsed: v }); return v; }
  }

  if (a?.mx) {
    const raw = a.mx.balance ?? a.mx.available_balance ?? a.mx.current_balance;
    const v = parseMoney(raw);
    if (v !== 0) { if (HWDBG) console.log('[HW] pickBal winner', { id, type, via: 'mx.*', raw, parsed: v }); return v; }
  }

  if (a?.balances && typeof a.balances === 'object') {
    const raw = a.balances.current ?? a.balances.available ?? a.balances.ledger;
    const v = parseMoney(raw);
    if (v !== 0) { if (HWDBG) console.log('[HW] pickBal winner', { id, type, via: 'balances.*', raw, parsed: v }); return v; }
  }

  if (a?.totals && typeof a.totals === 'object') {
    const named = parseMoney(a.totals.current ?? a.totals.cash ?? a.totals.value);
    if (named !== 0) { if (HWDBG) console.log('[HW] pickBal winner', { id, type, via: 'totals.named', parsed: named }); return named; }
    for (const [k, raw] of Object.entries(a.totals)) {
      const v = parseMoney(raw);
      if (v !== 0) { if (HWDBG) console.log('[HW] pickBal winner', { id, type, via: `totals.${k}`, raw, parsed: v }); return v; }
    }
  }

  const keys = [
    'accountValue',                
    'currentBalance', 'availableBalance',
    'marketValue', 'currentValue', 'value', 'total', 'totalValue', 'cash', 'amount',
    'balance' // last on purpose
  ];
  for (const k of keys) {
    if (a[k] != null && a[k] !== '') {
      const v = parseMoney(a[k]);
      if (v !== 0) { if (HWDBG) console.log('[HW] pickBal winner', { id, type, via: `direct:${k}`, raw: a[k], parsed: v }); return v; }
    }
  }

  if (HWDBG) console.log('[HW] pickBal fallback0', { id, type });
  return 0;
};


// --- totals using substring matches ("checking", "saving") ---
const checkingTotal = accounts
  .filter(a => normType(a).includes('checking'))
  .reduce((t, a) => t + pickBal(a), 0);

const savingsTotal = accounts
  .filter(a => normType(a).includes('saving')) // matches "saving"/"savings"
  .reduce((t, a) => t + pickBal(a), 0);

  if (HWDBG) {
    console.log('[HW] controller totals', { checkingTotal, savingsTotal });
  }
  

// put totals into page1.cashFlow for the renderer (and as fallback)
data.page1 = data.page1 || {};
data.page1.cashFlow = data.page1.cashFlow || {};
data.page1.cashFlow.checking = checkingTotal;
data.page1.cashFlow.savings  = savingsTotal;

// Optional: prebuild debts for fallback paths (renderer prefers data.liabilities)
data.page1.debts = (liabilities || [])
  .filter(l => !/primary residence/i.test(String(l.liabilityType || l.type || l.name || l.description || '')))
  .map(l => ({
    label: l.liabilityType || l.creditorName || 'Liability',
    amount: parseMoney(l.outstandingBalance ?? l.balance ?? l.currentBalance ?? l.amount ?? 0)
  }));

// --- Manual tax overrides from HomeworkSettings ---
{
  const t = data.settings?.taxes || {};
  data.page1 = data.page1 || {};
  if (t.year != null)            data.page1.taxesYear         = Number(t.year);
  if (t.agi != null)             data.page1.agiPriorYear      = Number(t.agi);
  if (t.taxableIncome != null)   data.page1.taxableIncomePY   = Number(t.taxableIncome);
  if (t.totalTaxes != null)      data.page1.totalTaxesEstimate= Number(t.totalTaxes);
  if (t.bracketPct != null)      data.page1.bracketPct        = Number(t.bracketPct);
}



// now render with clients + settings present
const { page1, page2 } = renderMeetingWorksheetPages(data);

// Pack settings back in (for page 1 notes/action/homework display)
const nextData = {
  header,
  page1Html: page1,
  page2Html: page2,
  homeworkRows: undefined,
  sections: Array.isArray(va.currentData?.sections) ? va.currentData.sections : [],
  tasks: Array.isArray(va.currentData?.tasks) ? va.currentData.tasks : []
};

va.currentData = nextData;
va.history.push({ date: new Date(), data: nextData });
va.warnings = [];

await va.save();

return res.json({ message: 'Homework ValueAdd updated successfully.', valueAdd: va });



  } catch (err) {
    console.error('[updateHomeworkValueAdd]', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};





// CREATE Homework ValueAdd
exports.createHomeworkValueAdd = async (req, res) => {
  try {
    const { householdId } = req.params;

    // If it already exists, return 400—mirror Net Worth behavior
    const existing = await ValueAdd.findOne({ household: householdId, type: 'HOMEWORK' }).lean();
    if (existing) {
      return res.status(400).json({ message: 'Homework ValueAdd already exists. Use update.' });
    }

    // Load household + firm for header/footer branding
    const household = await Household.findById(householdId).populate('firmId').lean();
    if (!household) return res.status(404).json({ message: 'Household not found.' });

    // Clients for “Doe, John & Jane” top line
    const clients = await Client.find({ household: householdId }).select('firstName lastName').lean();
    const clientNameLine = (function dynamicNameLine(arr) {
      if (!arr.length) return '---';
      if (arr.length === 1) return `${arr[0].lastName}, ${arr[0].firstName}`;
      if (arr.length === 2) {
        const [a,b] = arr;
        return (a.lastName && b.lastName &&
                a.lastName.toLowerCase() === b.lastName.toLowerCase())
          ? `${a.lastName}, ${a.firstName} & ${b.firstName}`
          : `${a.lastName}, ${a.firstName} & ${b.lastName}, ${b.firstName}`;
      }
      const c = arr[0];
      return `${c.lastName}, ${c.firstName}`;
    })(clients);

    const firm = household.firmId || {};
    const reportDate = new Date().toLocaleDateString();

    // Footer (same pattern used elsewhere)
    const footerParts = [];
    if (firm.companyAddress) footerParts.push(`<span class="firmField">${firm.companyAddress}</span>`);
    if (firm.phoneNumber)    footerParts.push(`<span class="firmField">${firm.phoneNumber}</span>`);
    if (firm.companyWebsite) footerParts.push(`<span class="firmField">${firm.companyWebsite}</span>`);
    const footerCombined = footerParts.join(`<div class="footerBall"></div>`);

    // Placeholder currentData – leave the guts for later
    const currentData = {
      header: {
        clientNameLine,
        reportDate,
        firmLogo: firm.companyLogo || '',
        brandColor: firm.companyBrandingColor || '#282e38',
        homeworkTitle: firm.homeworkTitle || 'Homework',
        homeworkDisclaimer: '', // optional placeholder if you’ll store one in CompanyID
        firmName: firm.companyName || ''
      },
      // Everything below is intentionally a placeholder for “rows/cells”
      homeworkRows: '<!-- TODO: inject homework rows here -->',
      sections: [], // future structure if you prefer
      tasks: []     // future structure if you prefer
    };

    const va = new ValueAdd({
      household: householdId,
      type: 'HOMEWORK',
      currentData,
      history: [{ date: new Date(), data: currentData }],
      warnings: [] // any checks later
    });

    await va.save();
    return res.status(201).json({ message: 'Homework ValueAdd created successfully.', valueAdd: va });
  } catch (err) {
    console.error('[createHomeworkValueAdd]', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};


// VIEW Homework (returns fully substituted HTML for the iframe/PDF)
exports.viewHomeworkPage = async (req, res) => {
  try {
    const { id } = req.params;

    // Optionally auto-refresh header each time (mirrors Net Worth)
    try {
      // robust no-op response stub
      const noop = () => {};
      const chain = { json: noop, send: noop, end: noop };
      await exports.updateHomeworkValueAdd(
        { params: { id } },
        { status: () => chain, json: noop, send: noop, end: noop }
      );
    } catch (e) {
      console.warn('[viewHomeworkPage] auto-update skipped:', e?.message || e);
    }

    // Load the VA + firm
    const va = await ValueAdd.findById(id)
      .populate({ path: 'household', populate: [{ path: 'firmId' }] })
      .lean();
    if (!va || va.type !== 'HOMEWORK') {
      return res.status(404).send('Homework Value Add not found');
    }

    // Load template
    let html;
    try {
      html = fs.readFileSync(
        path.join(__dirname, '..', 'views', 'valueAdds', 'meetingworksheet.html'),
        'utf8'
      );
    } catch (readErr) {
      console.error('[viewHomeworkPage] Missing views/valueAdds/meetingworksheet.html:', readErr);
      return res.status(500).send('Homework template not found');
    }

    const firm = va.household?.firmId || {};
    const header = va.currentData?.header || {};
    const homeworkRows = va.currentData?.homeworkRows || '<!-- TODO: inject homework rows here -->';

    // Footer (same as others)
    const footerParts = [];
    if (firm.companyAddress) footerParts.push(`<span class="firmField">${firm.companyAddress}</span>`);
    if (firm.phoneNumber)    footerParts.push(`<span class="firmField">${firm.phoneNumber}</span>`);
    if (firm.companyWebsite) footerParts.push(`<span class="firmField">${firm.companyWebsite}</span>`);
    const footerCombined = footerParts.join(`<div class="footerBall"></div>`);

    // Disclaimer helper fallback
    const disclaimerText =
      (typeof buildDisclaimer === 'function')
        ? buildDisclaimer({ household: va.household, customText: header.homeworkDisclaimer || '' })
        : (header.homeworkDisclaimer || '');

    // Basic replacements (keep homework‑specific area as a placeholder)
    html = html.replace(/{{FIRM_LOGO}}/g, header.firmLogo || '');
    html = html.replace(/{{BRAND_COLOR}}/g, header.brandColor || '#282e38');
    html = html.replace(/{{HOMEWORK_TITLE}}/g, header.homeworkTitle || 'Homework');
    html = html.replace(/{{CLIENT_NAME_LINE}}/g, header.clientNameLine || '---');
    html = html.replace(/{{REPORT_DATE}}/g, header.reportDate || new Date().toLocaleDateString());
    html = html.replace(/{{HOMEWORK_DISCLAIMER}}/g, disclaimerText);
    html = html.replace(/{{FIRM_FOOTER_INFO}}/g, footerCombined);

    // ← The main content placeholder you’ll fill later
    // after loading template string `html`
html = html.replace(/{{HOMEWORK_PAGE1}}/g, va.currentData?.page1Html || '');
html = html.replace(/{{HOMEWORK_PAGE2}}/g, va.currentData?.page2Html || '');


    return res.send(html);
  } catch (err) {
    console.error('[viewHomeworkPage]', err);
    return res.status(500).send('Server error');
  }
};



// GET settings for a household (used by householdHomework.pug)
// GET settings for a household (used by householdHomework.pug)
exports.getHomeworkSettings = async (req, res) => {
  const { householdId } = req.params;

  let settings = await HomeworkSettings.findOne({ household: householdId }).lean();
  if (!settings) {
    settings = await HomeworkSettings.create({ household: householdId });
    settings = settings.toObject();
  }

  // NEW: include household marginalTaxBracket so the modal can prefill
  const household = await Household.findById(householdId)
    .select('marginalTaxBracket')
    .lean();

  res.json({ settings, household });
};


exports.saveHomeworkSettings = async (req, res) => {
  const { householdId } = req.params;
  const payload = req.body || {};

  const settings = await HomeworkSettings.findOneAndUpdate(
    { household: householdId },
    { $set: payload },
    { upsert: true, new: true }
  );

  // NEW: if the modal sent a bracket, also sync it to Household.marginalTaxBracket (allow null to clear)
  if (Object.prototype.hasOwnProperty.call(payload, 'taxBracketPct')) {
    const v = payload.taxBracketPct;
    await Household.findByIdAndUpdate(
      householdId,
      { $set: { marginalTaxBracket: (v === null || v === '') ? null : Number(v) } },
      { new: true }
    );
  }

  const va = await ValueAdd.findOne({ household: householdId, type: 'HOMEWORK' });
  if (va) {
    const data = await computeValueAdd(householdId, { asOf: new Date() });
    data.settings = settings.toObject();
    



    // >>> NEW: load clients for renderer (age/birthday/retirement row)
    const clientsRaw = await Client.find({ household: householdId })
      .select('firstName lastName dob occupation employer retirementDate birthMonth birthDay birthYear profile details')
      .lean({ virtuals: true });
    data.clients = (clientsRaw || []).slice(0, 2).map(c => ({
      firstName: c.firstName,
      lastName : c.lastName,
      age      : c.age ?? null,
      dob      : c.dob || null,
      occupation: c.occupation || '',
      employer  : c.employer || '',
      retirementDate: c.retirementDate || null,
      birthMonth: c.birthMonth, birthDay: c.birthDay, birthYear: c.birthYear,
      profile: c.profile, details: c.details,
    }));

    

// >>> pull accounts + liabilities (use householdId here)
const [accounts, liabilities] = await Promise.all([
  Account.find({ household: householdId }).lean(),
  Liability.find({ household: householdId }).lean(),
]);

data.accounts = accounts;
data.liabilities = liabilities;

// --- helpers (controller-side) ---
const normType = a =>
  (a?.accountType || a?.subType || a?.subtype || a?.type || a?.category || '').toString().trim().toLowerCase();

const parseMoney = v => {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};

const pickBal = a => {
  // Prefer vendor/nested first
  if (a.plaid?.balances) {
    const v = parseMoney(a.plaid.balances.current ?? a.plaid.balances.available);
    if (v !== 0) return v;
  }
  if (a.yodlee?.balance) {
    const y = a.yodlee.balance;
    const v = parseMoney(y.amount ?? y.current ?? y.available ?? y.balance);
    if (v !== 0) return v;
  }
  if (a.mx) {
    const v = parseMoney(a.mx.balance ?? a.mx.available_balance ?? a.mx.current_balance);
    if (v !== 0) return v;
  }
  if (a.balances && typeof a.balances === 'object') {
    const v = parseMoney(a.balances.current ?? a.balances.available ?? a.balances.ledger);
    if (v !== 0) return v;
  }
  if (a.totals && typeof a.totals === 'object') {
    const named = parseMoney(a.totals.current ?? a.totals.cash ?? a.totals.value);
    if (named !== 0) return named;
    for (const raw of Object.values(a.totals)) {
      const v = parseMoney(raw);
      if (v !== 0) return v;
    }
  }
  // Then plain fields; put "balance" last
  const keys = [
    'accountValue',                
    'currentBalance', 'availableBalance',
    'marketValue', 'currentValue', 'value', 'total', 'totalValue', 'cash', 'amount',
    'balance'
  ];
  for (const k of keys) {
    if (a[k] != null && a[k] !== '') {
      const v = parseMoney(a[k]);
      if (v !== 0) return v;
    }
  }
  return 0;
};

// --- totals using substring matches ("checking", "saving") ---
const checkingTotal = accounts
  .filter(a => normType(a).includes('checking'))
  .reduce((t, a) => t + pickBal(a), 0);

const savingsTotal = accounts
  .filter(a => normType(a).includes('saving'))
  .reduce((t, a) => t + pickBal(a), 0);

  if (HWDBG) {
    console.log('[HW] controller totals', { checkingTotal, savingsTotal });
  }
  

// put totals into page1.cashFlow for the renderer (and as fallback)
data.page1 = data.page1 || {};
data.page1.cashFlow = data.page1.cashFlow || {};
data.page1.cashFlow.checking = checkingTotal;
data.page1.cashFlow.savings  = savingsTotal;

// Optional: prebuild debts for fallback paths
data.page1.debts = (liabilities || [])
  .filter(l => !/primary residence/i.test(String(l.liabilityType || l.type || l.name || l.description || '')))
  .map(l => ({
    label: l.liabilityType || l.creditorName || 'Liability',
    amount: parseMoney(l.outstandingBalance ?? l.balance ?? l.currentBalance ?? l.amount ?? 0)
  }));



    const { page1, page2 } = renderMeetingWorksheetPages(data);
    va.currentData.page1Html = page1;
    va.currentData.page2Html = page2;
    va.currentData.homeworkRows = undefined;

    va.history.push({ date: new Date(), data: va.currentData });
    await va.save();
  }

  res.json({ message: 'Saved', settings });
};


