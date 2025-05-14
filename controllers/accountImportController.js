// controllers/accountImportController.js

const mongoose = require('mongoose');
const xlsx = require('xlsx');
const axios = require('axios');
const Account = require('../models/Account');
const Client = require('../models/Client');
const Household = require('../models/Household'); // Possibly needed if you link accounts to households
const { uploadFile } = require('../utils/s3');

/**
 * Below are helper functions ("normalizers") that allow us to gracefully handle
 * any variations a user might input (e.g. "bi-yearly", "semi-annual", etc.) and 
 * convert them into the enum values our Account model expects. You can expand
 * these as needed for other fields.
 */

/**
 * Normalizes a user-supplied frequency to the recognized enum values:
 * ['', 'Monthly', 'Quarterly', 'Semi-annual', 'Annually']
 */
function normalizeSystematicWithdrawFrequency(input) {
  if (!input) return '';
  const val = input.trim().toLowerCase();

  // Check for keywords or partial words:
  if (val.includes('month')) return 'Monthly';
  if (val.includes('quarter')) return 'Quarterly';
  // This covers "bi-annual", "biannual", "semi-annual", "semi-yearly",
  // "bi-yearly", "biyearly", etc.
  if (
    val.includes('semi') ||
    val.includes('biannual') ||
    val.includes('bi-annual') ||
    val.includes('biyear') ||
    val.includes('bi-year') ||
    val.includes('semi-year') ||
    val.includes('semi year') ||
    val.includes('bi year')
  ) {
    return 'Semi-annual';
  }
  if (val.includes('annual') || val.includes('year')) return 'Annually';

  return '';
}

/**
 * Normalizes taxStatus to one of:
 * ['Taxable', 'Tax-Free', 'Tax-Deferred', 'Tax-Exempt', 'Non-Qualified']
 */
function normalizeTaxStatus(input) {
  if (!input) return '';
  const val = input.trim().toLowerCase();

  if (val.includes('taxable')) return 'Taxable';
  if (val.includes('tax free') || val.includes('tax-free')) return 'Tax-Free';
  if (val.includes('deferred')) return 'Tax-Deferred';
  if (val.includes('exempt')) return 'Tax-Exempt';
  if (val.includes('non-qualified') || val.includes('non qualified')) return 'Non-Qualified';

  // Fallback if not matched
  return '';
}

/**
 * Normalizes accountType to your recognized list. If not found, default to 'Other'.
 * Adjust synonyms as needed for your scenario.
 */
function normalizeAccountType(input) {
  if (!input) return 'Other';
  const val = input.trim().toLowerCase();

  // Example synonyms (expand as needed):
  if (val === 'individual') return 'Individual';
  if (val === 'tod') return 'TOD';
  if (val.includes('joint')) return 'Joint';
  if (val.includes('tenants in common')) return 'Tenants in Common';
  if (val.includes('ira') && val.includes('roth')) return 'Roth IRA';
  if (val.includes('inherited ira')) return 'Inherited IRA';
  if (val.includes('sep ira')) return 'SEP IRA';
  if (val.includes('simple ira')) return 'Simple IRA';
  if (val.includes('401')) return '401(k)';
  if (val.includes('403')) return '403(b)';
  if (val.includes('529')) return '529 Plan';
  if (val.includes('utma')) return 'UTMA';
  if (val.includes('trust')) return 'Trust';
  if (val.includes('custodial')) return 'Custodial';
  if (val.includes('annuity') && val.includes('variable')) return 'Variable Annuity';
  if (val.includes('annuity') && val.includes('fixed')) return 'Fixed Annuity';
  if (val.includes('deferred annuity')) return 'Deferred Annuity';
  if (val.includes('immediate annuity')) return 'Immediate Annuity';
  if (val.includes('annuity')) return 'Annuity';

  // If we don't match, return 'Other'
  return 'Other';
}

function normalizeCustodian(input) {
  if (!input || !input.trim()) {
    // Return null or undefined when there's absolutely no actual input
    return null;
  }
  return input.trim(); // Or further normalization if needed
}

function extractAccountRowData(row, mapping) {
  function getValue(field) {
    if (!mapping[field] && mapping[field] !== 0) return '';
    const idx = mapping[field];
    return row[idx] || '';
  }

  const rawFrequency = getValue('systematicWithdrawFrequency');
  const rawTaxStatus = getValue('taxStatus');

  // We'll read from "accountTypeRaw" in the UI. 
  // That way, if the user picks a column for "Account Type," 
  // it feeds into 'rawAccountType' here, which we can normalize.
  const rawAccountType = getValue('accountTypeRaw');
  const rawCustodian = getValue('custodianRaw');

  // Then we normalize as needed:
  const normalizedType = normalizeAccountType(rawAccountType);

  return {
    clientId: getValue('clientId'),
    accountNumber: getValue('accountNumber'),
    accountType: normalizedType,
    accountTypeRaw: rawAccountType,
    taxStatus: normalizeTaxStatus(rawTaxStatus),
    custodian: normalizeCustodian(rawCustodian),
    custodianRaw: getValue('custodianRaw'),
    accountValue: getValue('accountValue'),
    systematicWithdrawAmount: getValue('systematicWithdrawAmount'),
    systematicWithdrawFrequency: normalizeSystematicWithdrawFrequency(rawFrequency),
    federalTaxWithholding: getValue('federalTaxWithholding'),
    stateTaxWithholding: getValue('stateTaxWithholding'),
  };
}

/**
 * Helper: parse spreadsheet from S3 or memory
 */
async function parseSpreadsheetFromUrl(fileUrl) {
  const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
  const data = response.data;
  const workbook = xlsx.read(data, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
  return sheetData;
}

/**
 * 1) Upload Account File
 */
exports.uploadAccountFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded.' });
    }
    const userId = req.session?.user?._id || 'anonymous';

    // 1) Upload to S3
    let s3Key;
    try {
      s3Key = await uploadFile(req.file.buffer, req.file.originalname, userId);
    } catch (err) {
      console.error('S3 upload error:', err);
      return res.status(500).json({ message: 'Failed to upload file to S3.' });
    }
    const s3Url = `https://${process.env.IMPORTS_S3_BUCKET_NAME}.s3.amazonaws.com/${s3Key}`;

    // 2) Parse headers from memory
    let rawData;
    try {
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      rawData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
    } catch (err) {
      return res.status(400).json({ message: 'Failed to parse spreadsheet file.' });
    }
    if (!rawData || rawData.length === 0) {
      return res.status(400).json({ message: 'The uploaded file is empty.' });
    }
    const headers = rawData[0];
    if (!headers || headers.length === 0) {
      return res.status(400).json({ message: 'No headers found in the file.' });
    }

    return res.json({
      message: 'Account file uploaded successfully.',
      headers,
      tempFile: s3Url
    });
  } catch (err) {
    console.error('Error uploading account file:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

const Beneficiary = require('../models/Beneficiary');
// EXAMPLE name-split helper: "John Doe" => ["John","Doe"] 
// (Adjust or remove if your data already has separate first/last fields.)
function splitName(fullName) {
  if (!fullName) return ['', ''];
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return [parts[0], ''];
  const last = parts.pop();
  const first = parts.join(' ');
  return [first, last];
}

/**
 * 2) Process Account Import
 * Reads rows, upserts Accounts linked to correct firm + client,
 * and adds the Account _id to the Household (if it exists).
 */
exports.processAccountImport = async (req, res) => {
  try {
    // 1) Extract necessary data from req.body
    const { mapping, tempFile, importType } = req.body;
    if (!tempFile || !mapping) {
      return res.status(400).json({ message: 'Missing file or mapping data.' });
    }

    // Helper to sum multiple columns for a single field
    function sumAllocationColumns(row, colIndexes) {
      let total = 0;
      if (!colIndexes || !Array.isArray(colIndexes)) return total;
      colIndexes.forEach(index => {
        const val = parseFloat(row[index] || '0');
        if (!isNaN(val)) {
          total += val;
        }
      });
      return total;
    }

    // 2) Parse spreadsheet from S3 (or local buffer) using your existing helper
    const rawData = await parseSpreadsheetFromUrl(tempFile);
    if (!rawData || rawData.length <= 1) {
      return res.status(400).json({ message: 'No data rows found.' });
    }
    rawData.shift(); // remove header row

    // Prepare arrays for final results
    const createdRecords = [];
    const updatedRecords = [];
    const failedRecords = [];
    const duplicateRecords = [];

    // Track (accountNumber) used in this sheet to detect duplicates
    const usedAccountNumbers = new Set();

    // Socket info
    const io = req.app.locals.io;
    const userRoom = req.session.user._id;
    const totalRecords = rawData.length;

    // Time & chunk-based variables
    const startTime = Date.now();
    let processedCount = 0;
    let totalChunks = 0;
    let rollingAvgSecPerRow = 0.0;
    const CHUNK_SIZE = 50; // adjust as needed

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // (A) If importType === 'beneficiaries', handle beneficiary flow
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    if (importType === 'beneficiaries') {
      // Helper: Get cell value if mapped; return null if not mapped or empty
      const getVal = (row, idx) => {
        if (idx == null) return null;
        const val = row[idx];
        if (val === undefined || val === '') return null;
        return val;
      };

      // Process in chunks
      for (let chunkStart = 0; chunkStart < totalRecords; chunkStart += CHUNK_SIZE) {
        const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalRecords);
        const chunkSize = chunkEnd - chunkStart;
        const chunkStartTime = Date.now();

        for (let i = chunkStart; i < chunkEnd; i++) {
          const row = rawData[i];
          try {
            // 1) The only truly required field is accountNumber
            const accountNumberIndex = mapping.accountNumber;
            if (accountNumberIndex == null) {
              failedRecords.push({
                accountNumber: 'N/A',
                reason: 'No accountNumber mapping provided.'
              });
              continue;
            }
            const accountNumber = getVal(row, accountNumberIndex);
            if (!accountNumber) {
              failedRecords.push({
                accountNumber: 'N/A',
                reason: 'Missing required accountNumber'
              });
              continue;
            }

            // 2) Check for duplicate in the same spreadsheet
            if (usedAccountNumbers.has(accountNumber)) {
              duplicateRecords.push({
                accountNumber,
                reason: `Duplicate accountNumber in the same spreadsheet: ${accountNumber}`,
                rowIndex: i
              });
              // Skip this row
              continue;
            } else {
              usedAccountNumbers.add(accountNumber);
            }

            // 3) Find or fail to find existing account by (firmId + accountNumber)
            let account = await Account.findOne({
              firmId: req.session.user.firmId,
              accountNumber
            });

            if (!account) {
              failedRecords.push({
                accountNumber,
                reason: `No matching account found for accountNumber=${accountNumber}`
              });
              continue;
            }

            // 4) Extract beneficiary-related fields from the row
            // If not mapped or empty, we get null
            const clientIdIndex = mapping.clientId;
            const primaryNameIndex = mapping.primaryName;
            const primaryRelIndex = mapping.primaryRelationship;
            const primaryDOBIndex = mapping.primaryDOB;
            const primarySSNIndex = mapping.primarySSN;
            const primaryAllocIndex = mapping.primaryAllocation;

            const contNameIndex = mapping.contingentName;
            const contRelIndex = mapping.contingentRelationship;
            const contDOBIndex = mapping.contingentDOB;
            const contSSNIndex = mapping.contingentSSN;
            const contAllocIndex = mapping.contingentAllocation;

            const clientIdVal = getVal(row, clientIdIndex);
            const primaryNameVal = getVal(row, primaryNameIndex);
            const primaryRelVal = getVal(row, primaryRelIndex);
            const primaryDOBVal = getVal(row, primaryDOBIndex);
            const primarySSNVal = getVal(row, primarySSNIndex);
            const primaryAllocVal = getVal(row, primaryAllocIndex);

            const contNameVal = getVal(row, contNameIndex);
            const contRelVal = getVal(row, contRelIndex);
            const contDOBVal = getVal(row, contDOBIndex);
            const contSSNVal = getVal(row, contSSNIndex);
            const contAllocVal = getVal(row, contAllocIndex);

            // 5) Update account's beneficiaries
            if (!account.beneficiaries) {
              account.beneficiaries = { primary: [], contingent: [] };
            }
            if (!account.beneficiaries.primary) {
              account.beneficiaries.primary = [];
            }
            if (!account.beneficiaries.contingent) {
              account.beneficiaries.contingent = [];
            }

            // (A) If we have primary data
            if (primaryNameVal || primaryRelVal || primaryDOBVal || primarySSNVal || primaryAllocVal !== null) {
              if (account.beneficiaries.primary.length === 0) {
                account.beneficiaries.primary.push({
                  beneficiary: null,
                  percentageAllocation: null
                });
              }
              const primaryObj = account.beneficiaries.primary[0];

              // For demonstration, we handle the separate Beneficiary doc creation:
              if (primaryNameVal) {
                const [firstName, lastName] = splitName(primaryNameVal);
                let existingB = null;

                // Try matching by (firstName, lastName, ssn):
                if (firstName && lastName && primarySSNVal) {
                  existingB = await Beneficiary.findOne({
                    firstName,
                    lastName,
                    ssn: primarySSNVal
                  });
                }

                if (!existingB) {
                  // Create new doc
                  const newB = new Beneficiary({
                    firstName: firstName || 'N/A',
                    lastName: lastName || 'N/A',
                    relationship: primaryRelVal || ''
                  });
                  if (primaryDOBVal) {
                    newB.dateOfBirth = new Date(primaryDOBVal);
                  }
                  if (primarySSNVal) {
                    newB.ssn = primarySSNVal;
                  }
                  await newB.save();
                  existingB = newB;
                } else {
                  // Possibly update existing doc
                  existingB.relationship = primaryRelVal || existingB.relationship;
                  if (primaryDOBVal) existingB.dateOfBirth = new Date(primaryDOBVal);
                  if (primarySSNVal) existingB.ssn = primarySSNVal;
                  await existingB.save();
                }
                primaryObj.beneficiary = existingB._id;
              }

              // (B) Allocation
              if (primaryAllocVal !== null) {
                const parsedAlloc = parseFloat(primaryAllocVal);
                if (!isNaN(parsedAlloc)) {
                  primaryObj.percentageAllocation = parsedAlloc;
                }
              }

              // Additionally, store the name & relationship on the account doc for immediate view:
              if (primaryNameVal) {
                primaryObj.beneficiaryName = primaryNameVal;
              }
              if (primaryRelVal) {
                primaryObj.relationship = primaryRelVal;
              }
            }

            // (C) If we have contingent data
            if (contNameVal || contRelVal || contDOBVal || contSSNVal || contAllocVal !== null) {
              if (account.beneficiaries.contingent.length === 0) {
                account.beneficiaries.contingent.push({
                  beneficiary: null,
                  percentageAllocation: null
                });
              }
              const contObj = account.beneficiaries.contingent[0];

              if (contNameVal) {
                const [firstName, lastName] = splitName(contNameVal);
                let existingB = null;

                if (firstName && lastName && contSSNVal) {
                  existingB = await Beneficiary.findOne({
                    firstName,
                    lastName,
                    ssn: contSSNVal
                  });
                }

                if (!existingB) {
                  const newB = new Beneficiary({
                    firstName: firstName || 'N/A',
                    lastName: lastName || 'N/A',
                    relationship: contRelVal || ''
                  });
                  if (contDOBVal) {
                    newB.dateOfBirth = new Date(contDOBVal);
                  }
                  if (contSSNVal) {
                    newB.ssn = contSSNVal;
                  }
                  await newB.save();
                  existingB = newB;
                } else {
                  existingB.relationship = contRelVal || existingB.relationship;
                  if (contDOBVal) existingB.dateOfBirth = new Date(contDOBVal);
                  if (contSSNVal) existingB.ssn = contSSNVal;
                  await existingB.save();
                }
                contObj.beneficiary = existingB._id;
              }

              if (contAllocVal !== null) {
                const parsedAlloc = parseFloat(contAllocVal);
                if (!isNaN(parsedAlloc)) {
                  contObj.percentageAllocation = parsedAlloc;
                }
              }

              // Additionally, store the name & relationship on the account doc for immediate view:
              if (contNameVal) {
                contObj.beneficiaryName = contNameVal;
              }
              if (contRelVal) {
                contObj.relationship = contRelVal;
              }
            }

            // 6) Save changes
            const changedFields = account.modifiedPaths();
            await account.save();

            // Provide something for the "Updated" tab to display:
            updatedRecords.push({
              accountNumber,
              updatedFields: changedFields,
              firstName: primaryNameVal || accountNumber,
              lastName: ''
            });
          } catch (err) {
            failedRecords.push({
              accountNumber: 'N/A',
              reason: err.message
            });
          }

          processedCount++;
        } // end row loop for this chunk

        // --- CHUNK COMPLETE: update rolling average & emit progress ---
        const chunkEndTime = Date.now();
        const chunkElapsedMs = chunkEndTime - chunkStartTime;
        const chunkSecPerRow = chunkElapsedMs / 1000 / chunkSize;

        totalChunks++;
        rollingAvgSecPerRow =
          ((rollingAvgSecPerRow * (totalChunks - 1)) + chunkSecPerRow) / totalChunks;

        // Estimate time left
        const rowsLeft = totalRecords - processedCount;
        const secLeft = Math.round(rowsLeft * rollingAvgSecPerRow);

        let estimatedTimeStr = '';
        if (secLeft >= 60) {
          const minutes = Math.floor(secLeft / 60);
          const seconds = secLeft % 60;
          estimatedTimeStr = `${minutes}m ${seconds}s`;
        } else {
          estimatedTimeStr = `${secLeft}s`;
        }

        const percentage = Math.round((processedCount / totalRecords) * 100);

        // Emit progress for this chunk
        io.to(userRoom).emit('importProgress', {
          status: 'processing',
          totalRecords,
          createdRecords: createdRecords.length,
          updatedRecords: updatedRecords.length,
          failedRecords: failedRecords.length,
          duplicateRecords: duplicateRecords.length,
          percentage,
          estimatedTime: processedCount === 0 ? 'Calculating...' : `${estimatedTimeStr} left`,
          createdRecordsData: createdRecords,
          updatedRecordsData: updatedRecords,
          failedRecordsData: failedRecords,
          duplicateRecordsData: duplicateRecords
        });
      } // end chunk loop

      // Emit final
      io.to(userRoom).emit('importComplete', {
        status: 'completed',
        totalRecords,
        createdRecords: createdRecords.length,
        updatedRecords: updatedRecords.length,
        failedRecords: failedRecords.length,
        duplicateRecords: duplicateRecords.length,
        createdRecordsData: createdRecords,
        updatedRecordsData: updatedRecords,
        failedRecordsData: failedRecords,
        duplicateRecordsData: duplicateRecords,
        importReportId: null // optionally link an ImportReport if you have that logic
      });

      return res.json({
        message: 'Beneficiary import complete',
        createdRecords,
        updatedRecords,
        failedRecords,
        duplicateRecords
      });
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // (B) If importType === 'billing', handle billing import flow
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    else if (importType === 'billing') {
      // Helper: Get cell value if mapped; return null if not mapped or empty
      const getVal = (row, idx) => {
        if (idx == null) return null;
        const val = row[idx];
        if (val === undefined || val === '') return null;
        return val;
      };

      // Process in chunks
      for (let chunkStart = 0; chunkStart < totalRecords; chunkStart += CHUNK_SIZE) {
        const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalRecords);
        const chunkSize = chunkEnd - chunkStart;
        const chunkStartTime = Date.now();

        for (let i = chunkStart; i < chunkEnd; i++) {
          const row = rawData[i];
          try {
            // 1) The only truly required field is accountNumber
            const accountNumberIndex = mapping.accountNumber;
            if (accountNumberIndex == null) {
              failedRecords.push({
                accountNumber: 'N/A',
                reason: 'No accountNumber mapping provided.'
              });
              continue;
            }

            const accountNumber = getVal(row, accountNumberIndex);
            if (!accountNumber) {
              failedRecords.push({
                accountNumber: 'N/A',
                reason: 'Missing required accountNumber'
              });
              continue;
            }

            // 2) Check for duplicates in the same spreadsheet
            if (usedAccountNumbers.has(accountNumber)) {
              duplicateRecords.push({
                accountNumber,
                reason: `Duplicate accountNumber in the same spreadsheet: ${accountNumber}`,
                rowIndex: i
              });
              continue;
            } else {
              usedAccountNumbers.add(accountNumber);
            }

            // 3) Find existing account by (firmId + accountNumber)
            let account = await Account.findOne({
              firmId: req.session.user.firmId,
              accountNumber
            });

            if (!account) {
              // If we do NOT want to create new accounts for billing alone:
              failedRecords.push({
                accountNumber,
                reason: `No matching account found for accountNumber=${accountNumber}`
              });
              continue;
            }

            // 4) Read the billing amount from the row
            const billedIdx = mapping.quarterlyBilledAmount;
            let quarterlyBilledVal = 0;
            if (billedIdx != null) {
              const rawBilledVal = getVal(row, billedIdx);
              const parsed = parseFloat(rawBilledVal);
              if (!isNaN(parsed)) {
                quarterlyBilledVal = parsed;
              }
            }

            // 5) Update the account
            account.quarterlyBilledAmount = quarterlyBilledVal;
            const changedFields = account.modifiedPaths();
            await account.save();

            // 6) Mark as updated
            updatedRecords.push({
              accountNumber,
              updatedFields: changedFields,
              quarterlyBilledAmount: quarterlyBilledVal
            });
          } catch (err) {
            failedRecords.push({
              accountNumber: 'N/A',
              reason: err.message
            });
          }

          processedCount++;
        } // end row loop for this chunk

        // --- CHUNK COMPLETE: update rolling average & emit progress ---
        const chunkEndTime = Date.now();
        const chunkElapsedMs = chunkEndTime - chunkStartTime;
        const chunkSecPerRow = chunkElapsedMs / 1000 / chunkSize;

        totalChunks++;
        rollingAvgSecPerRow =
          ((rollingAvgSecPerRow * (totalChunks - 1)) + chunkSecPerRow) / totalChunks;

        // Estimate time left
        const rowsLeft = totalRecords - processedCount;
        const secLeft = Math.round(rowsLeft * rollingAvgSecPerRow);

        let estimatedTimeStr = '';
        if (secLeft >= 60) {
          const minutes = Math.floor(secLeft / 60);
          const seconds = secLeft % 60;
          estimatedTimeStr = `${minutes}m ${seconds}s`;
        } else {
          estimatedTimeStr = `${secLeft}s`;
        }

        const percentage = Math.round((processedCount / totalRecords) * 100);

        // Emit progress for this chunk
        io.to(userRoom).emit('importProgress', {
          status: 'processing',
          totalRecords,
          createdRecords: createdRecords.length,
          updatedRecords: updatedRecords.length,
          failedRecords: failedRecords.length,
          duplicateRecords: duplicateRecords.length,
          percentage,
          estimatedTime: processedCount === 0 ? 'Calculating...' : `${estimatedTimeStr} left`,
          createdRecordsData: createdRecords,
          updatedRecordsData: updatedRecords,
          failedRecordsData: failedRecords,
          duplicateRecordsData: duplicateRecords
        });
      } // end chunk loop

      // 7) Recalculate each affected Household's annualBilling
      // Summation approach: annual = sum(quarterlyBilledAmount) * 4
      try {
        // gather updated accountNumbers
        const updatedAccountNumbers = updatedRecords.map(r => r.accountNumber);
        if (updatedAccountNumbers.length > 0) {
          // find changed accounts
          const changedAccounts = await Account.find({
            firmId: req.session.user.firmId,
            accountNumber: { $in: updatedAccountNumbers },
          }).select('_id household quarterlyBilledAmount');

          // gather household IDs
          const householdIds = new Set(changedAccounts.map(a => a.household).filter(Boolean));

          // find households & populate accounts
          const affectedHouseholds = await Household.find({
            _id: { $in: Array.from(householdIds) },
          }).populate('accounts', 'quarterlyBilledAmount');

          // recalc for each household
          for (const hh of affectedHouseholds) {
            let sumQuarterly = 0;
            for (const acct of hh.accounts) {
              sumQuarterly += acct.quarterlyBilledAmount || 0;
            }
            hh.annualBilling = sumQuarterly * 4;
            await hh.save();
          }
        }
      } catch (err) {
        console.error('Failed to recalc household annual billing:', err);
      }

      // Emit final
      io.to(userRoom).emit('importComplete', {
        status: 'completed',
        totalRecords,
        createdRecords: createdRecords.length,
        updatedRecords: updatedRecords.length,
        failedRecords: failedRecords.length,
        duplicateRecords: duplicateRecords.length,
        createdRecordsData: createdRecords,
        updatedRecordsData: updatedRecords,
        failedRecordsData: failedRecords,
        duplicateRecordsData: duplicateRecords,
        importReportId: null // optionally link an ImportReport if you have that logic
      });

      return res.json({
        message: 'Billing import complete',
        createdRecords,
        updatedRecords,
        failedRecords,
        duplicateRecords
      });
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // (C) Otherwise, handle standard account import
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

    // Process in chunks
    for (let chunkStart = 0; chunkStart < totalRecords; chunkStart += CHUNK_SIZE) {
      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalRecords);
      const chunkSize = chunkEnd - chunkStart;
      const chunkStartTime = Date.now();

      for (let i = chunkStart; i < chunkEnd; i++) {
        const row = rawData[i];
        try {
          // rowObj is presumably from your "extractAccountRowData" function
          const rowObj = extractAccountRowData(row, mapping);

          // 1) Require accountNumber at a minimum
          if (!rowObj.accountNumber) {
            failedRecords.push({
              accountNumber: 'N/A',
              reason: 'Missing required accountNumber'
            });
            continue;
          }

          // 2) Check for duplicates in the same spreadsheet
          if (usedAccountNumbers.has(rowObj.accountNumber)) {
            duplicateRecords.push({
              accountNumber: rowObj.accountNumber,
              reason: `Duplicate accountNumber in the same spreadsheet: ${rowObj.accountNumber}`,
              rowIndex: i
            });
            continue;
          } else {
            usedAccountNumbers.add(rowObj.accountNumber);
          }

          // 3) Try to find existing account by (firmId + accountNumber)
          let account = await Account.findOne({
            firmId: req.session.user.firmId,
            accountNumber: rowObj.accountNumber
          });

          if (account) {
            // (A) Update standard fields
            if ('accountTypeRaw' in mapping) {
              const raw = rowObj.accountTypeRaw?.trim();
              if (raw) {
                account.accountTypeRaw = raw;
                account.accountType = rowObj.accountType;
              }
            }
            
            if (rowObj.taxStatus) account.taxStatus = rowObj.taxStatus;
            if (rowObj.custodian !== null) {
              account.custodian = rowObj.custodian;
            }
            if (rowObj.custodianRaw) account.custodianRaw = rowObj.custodianRaw;

            if (rowObj.accountValue) {
              const val = parseFloat(rowObj.accountValue);
              if (!isNaN(val)) account.accountValue = val;
            }
            if (rowObj.systematicWithdrawAmount) {
              const amt = parseFloat(rowObj.systematicWithdrawAmount);
              if (!isNaN(amt)) account.systematicWithdrawAmount = amt;
            }
            if (rowObj.systematicWithdrawFrequency) {
              account.systematicWithdrawFrequency = rowObj.systematicWithdrawFrequency;
            }
            if (rowObj.federalTaxWithholding) {
              const fed = parseFloat(rowObj.federalTaxWithholding);
              if (!isNaN(fed)) account.federalTaxWithholding = fed;
            }
            if (rowObj.stateTaxWithholding) {
              const st = parseFloat(rowObj.stateTaxWithholding);
              if (!isNaN(st)) account.stateTaxWithholding = st;
            }

            // (B) Summation for asset allocation fields
            if (mapping.cash && Array.isArray(mapping.cash) && mapping.cash.length > 0) {
              account.cash = sumAllocationColumns(row, mapping.cash);
            }
            if (mapping.income && Array.isArray(mapping.income) && mapping.income.length > 0) {
              account.income = sumAllocationColumns(row, mapping.income);
            }
            if (mapping.annuities && Array.isArray(mapping.annuities) && mapping.annuities.length > 0) {
              account.annuities = sumAllocationColumns(row, mapping.annuities);
            }
            if (mapping.growth && Array.isArray(mapping.growth) && mapping.growth.length > 0) {
              account.growth = sumAllocationColumns(row, mapping.growth);
            }

            // (C) Validate total allocation
            const anyAllocationMapped =
              (mapping.cash && mapping.cash.length > 0) ||
              (mapping.income && mapping.income.length > 0) ||
              (mapping.annuities && mapping.annuities.length > 0) ||
              (mapping.growth && mapping.growth.length > 0);

            if (anyAllocationMapped) {
              const totalAllocation =
                (account.cash || 0) +
                (account.income || 0) +
                (account.annuities || 0) +
                (account.growth || 0);
              if (totalAllocation !== 0 && totalAllocation !== 100) {
                failedRecords.push({
                  accountNumber: account.accountNumber,
                  reason: 'asset allocation fields do not equal 100%'
                });
                continue;
              }
            }

            // (D) Save
            const changedFields = account.modifiedPaths();
            await account.save();

            // (E) Add to updatedRecords
            updatedRecords.push({
              accountNumber: account.accountNumber,
              updatedFields: changedFields
            });
          } else {
            // (F) No existing account found: require clientId to create
            if (!rowObj.clientId) {
              failedRecords.push({
                accountNumber: rowObj.accountNumber,
                reason: 'Cannot create a new account without a clientId'
              });
              continue;
            }

            // 4) Look up the Client
            const client = await Client.findOne({
              firmId: req.session.user.firmId,
              clientId: rowObj.clientId
            });
            if (!client) {
              failedRecords.push({
                accountNumber: rowObj.accountNumber,
                clientId: rowObj.clientId,
                reason: `No matching client with clientId=${rowObj.clientId}`
              });
              continue;
            }

            // 5) Create new Account
            account = new Account({
              firmId: req.session.user.firmId,
              accountNumber: rowObj.accountNumber,
              accountOwner: [client._id],
              household: client.household
            });

            // (G) Update standard fields
            if ('accountTypeRaw' in mapping) {
              const raw = rowObj.accountTypeRaw?.trim();
              if (raw) {
                account.accountTypeRaw = raw;
                account.accountType = rowObj.accountType;
              }
            }
            
            if (rowObj.taxStatus) account.taxStatus = rowObj.taxStatus;
            if (rowObj.custodian !== null) {
              account.custodian = rowObj.custodian;
            }
            if (rowObj.custodianRaw) account.custodianRaw = rowObj.custodianRaw;

            if (rowObj.accountValue) {
              const val = parseFloat(rowObj.accountValue);
              if (!isNaN(val)) account.accountValue = val;
            }
            if (rowObj.systematicWithdrawAmount) {
              const amt = parseFloat(rowObj.systematicWithdrawAmount);
              if (!isNaN(amt)) account.systematicWithdrawAmount = amt;
            }
            if (rowObj.systematicWithdrawFrequency) {
              account.systematicWithdrawFrequency = rowObj.systematicWithdrawFrequency;
            }
            if (rowObj.federalTaxWithholding) {
              const fed = parseFloat(rowObj.federalTaxWithholding);
              if (!isNaN(fed)) account.federalTaxWithholding = fed;
            }
            if (rowObj.stateTaxWithholding) {
              const st = parseFloat(rowObj.stateTaxWithholding);
              if (!isNaN(st)) account.stateTaxWithholding = st;
            }

            // (H) Summation for asset allocation
            if (mapping.cash && Array.isArray(mapping.cash) && mapping.cash.length > 0) {
              account.cash = sumAllocationColumns(row, mapping.cash);
            }
            if (mapping.income && Array.isArray(mapping.income) && mapping.income.length > 0) {
              account.income = sumAllocationColumns(row, mapping.income);
            }
            if (mapping.annuities && Array.isArray(mapping.annuities) && mapping.annuities.length > 0) {
              account.annuities = sumAllocationColumns(row, mapping.annuities);
            }
            if (mapping.growth && Array.isArray(mapping.growth) && mapping.growth.length > 0) {
              account.growth = sumAllocationColumns(row, mapping.growth);
            }

            const anyAllocationMapped2 =
              (mapping.cash && mapping.cash.length > 0) ||
              (mapping.income && mapping.income.length > 0) ||
              (mapping.annuities && mapping.annuities.length > 0) ||
              (mapping.growth && mapping.growth.length > 0);

            if (anyAllocationMapped2) {
              const totalAllocation2 =
                (account.cash || 0) +
                (account.income || 0) +
                (account.annuities || 0) +
                (account.growth || 0);
              if (totalAllocation2 !== 0 && totalAllocation2 !== 100) {
                failedRecords.push({
                  accountNumber: account.accountNumber,
                  clientId: rowObj.clientId,
                  reason: 'asset allocation fields do not equal 100%'
                });
                continue;
              }
            }

            // (I) Save
            const changedFields = account.modifiedPaths();
            await account.save();

            // (J) If new, record
            createdRecords.push({
              accountNumber: account.accountNumber,
              clientId: rowObj.clientId
            });

            if (client.household) {
              await Household.findByIdAndUpdate(
                client.household,
                { $addToSet: { accounts: account._id } }
              );
            }
          }
        } catch (err) {
          failedRecords.push({
            accountNumber: 'N/A',
            reason: err.message
          });
        }

        processedCount++;
      } // end row loop for this chunk

      // --- CHUNK COMPLETE: update rolling average & emit progress ---
      const chunkEndTime = Date.now();
      const chunkElapsedMs = chunkEndTime - chunkStartTime;
      const chunkSecPerRow = chunkElapsedMs / 1000 / chunkSize;

      totalChunks++;
      rollingAvgSecPerRow =
        ((rollingAvgSecPerRow * (totalChunks - 1)) + chunkSecPerRow) / totalChunks;

      // Estimate time left
      const rowsLeft = totalRecords - processedCount;
      const secLeft = Math.round(rowsLeft * rollingAvgSecPerRow);

      let estimatedTimeStr = '';
      if (secLeft >= 60) {
        const minutes = Math.floor(secLeft / 60);
        const seconds = secLeft % 60;
        estimatedTimeStr = `${minutes}m ${seconds}s`;
      } else {
        estimatedTimeStr = `${secLeft}s`;
      }

      const percentage = Math.round((processedCount / totalRecords) * 100);

      // Emit progress for this chunk
      io.to(userRoom).emit('importProgress', {
        status: 'processing',
        totalRecords,
        createdRecords: createdRecords.length,
        updatedRecords: updatedRecords.length,
        failedRecords: failedRecords.length,
        duplicateRecords: duplicateRecords.length,
        percentage,
        estimatedTime: processedCount === 0 ? 'Calculating...' : `${estimatedTimeStr} left`,
        createdRecordsData: createdRecords,
        updatedRecordsData: updatedRecords,
        failedRecordsData: failedRecords,
        duplicateRecordsData: duplicateRecords
      });
    } // end chunk loop

    // Emit final
    io.to(userRoom).emit('importComplete', {
      status: 'completed',
      totalRecords,
      createdRecords: createdRecords.length,
      updatedRecords: updatedRecords.length,
      failedRecords: failedRecords.length,
      duplicateRecords: duplicateRecords.length,
      createdRecordsData: createdRecords,
      updatedRecordsData: updatedRecords,
      failedRecordsData: failedRecords,
      duplicateRecordsData: duplicateRecords,
      importReportId: null // optionally link an ImportReport if you have that logic
    });

    return res.json({
      message: 'Account import complete',
      createdRecords,
      updatedRecords,
      failedRecords,
      duplicateRecords
    });
  } catch (err) {
    console.error('Error processing account import:', err);
    return res.status(500).json({
      message: 'Server error while processing account import',
      error: err.message
    });
  }
};
