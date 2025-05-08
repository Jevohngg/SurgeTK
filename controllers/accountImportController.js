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

/**
 * Normalizes custodian. Your schema does not strictly enforce an enum here,
 * but you can still clean or standardize certain synonyms if desired.
 */
function normalizeCustodian(input) {
  if (!input) return 'UnknownCustodian';
  return input; // Or add your own logic if you have synonyms for custodians
}

/**
 * Helper: parse single row into an object with relevant fields
 */
function extractAccountRowData(row, mapping) {
  function getValue(field) {
    if (!mapping[field] && mapping[field] !== 0) return '';
    const idx = mapping[field];
    return row[idx] || '';
  }

  // We first get the raw input
  const rawFrequency = getValue('systematicWithdrawFrequency');
  const rawTaxStatus = getValue('taxStatus');
  const rawAccountType = getValue('accountType');
  const rawCustodian = getValue('custodian');

  // Then we normalize as needed
  return {
    clientId: getValue('clientId'),
    accountNumber: getValue('accountNumber'),
    accountType: normalizeAccountType(rawAccountType),
    accountTypeRaw: getValue('accountTypeRaw'),
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

/**
 * 2) Process Account Import
 * Reads rows, upserts Accounts linked to correct firm + client,
 * and adds the Account _id to the Household (if it exists).
 */
exports.processAccountImport = async (req, res) => {
    try {
      const { mapping, tempFile } = req.body;
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
  
      // 1) Parse from S3
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
  
      // Process in chunks
      for (let chunkStart = 0; chunkStart < totalRecords; chunkStart += CHUNK_SIZE) {
        const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalRecords);
        const chunkSize = chunkEnd - chunkStart;
        const chunkStartTime = Date.now();
  
        for (let i = chunkStart; i < chunkEnd; i++) {
          const row = rawData[i];
          try {
            const rowObj = extractAccountRowData(row, mapping);
  
            // Basic validation
            if (!rowObj.clientId || !rowObj.accountNumber) {
              failedRecords.push({
                accountNumber: rowObj.accountNumber || 'N/A',
                reason: 'Missing required clientId or accountNumber'
              });
            } else {
              // Check for duplicate in the same spreadsheet
              if (usedAccountNumbers.has(rowObj.accountNumber)) {
                duplicateRecords.push({
                  accountNumber: rowObj.accountNumber,
                  reason: `Duplicate accountNumber in the same spreadsheet: ${rowObj.accountNumber}`,
                  rowIndex: i
                });
              } else {
                usedAccountNumbers.add(rowObj.accountNumber);
  
                // 1) Find the Client
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
                } else {
                  // 2) Find or create Account
                  let account = await Account.findOne({
                    firmId: req.session.user.firmId,
                    accountNumber: rowObj.accountNumber
                  });
                  const isNew = !account;
  
                  if (!account) {
                    account = new Account({
                      firmId: req.session.user.firmId,
                      accountNumber: rowObj.accountNumber,
                      accountOwner: [client._id], // Link to client
                      household: client.household, // Link to client's household if available
                    });
                  }
  
                  // Update fields
                  if (rowObj.accountType) account.accountType = rowObj.accountType;
                  if (rowObj.accountTypeRaw) account.accountTypeRaw = rowObj.accountTypeRaw;
                  if (rowObj.taxStatus) account.taxStatus = rowObj.taxStatus;
                  if (rowObj.custodian) account.custodian = rowObj.custodian;
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
  
                  // Summation for asset allocation fields
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
  
                  // >>> NEW ALLOCATION VALIDATION SNIPPET <<<
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
  
                    // If total is neither 0 nor 100, fail this record
                    if (totalAllocation !== 0 && totalAllocation !== 100) {
                      failedRecords.push({
                        accountNumber: account.accountNumber,
                        clientId: rowObj.clientId,
                        reason: 'asset allocation fields do not equal 100%'
                      });
                      // Skip saving this record & proceed to next row
                      continue;
                    }
                  }
                  // <<< END NEW ALLOCATION VALIDATION SNIPPET >>>
  
                  // 1) Capture changed fields BEFORE saving
                  const changedFields = account.modifiedPaths();
  
                  await account.save();
  
                  // If new, we also push this account onto the Household doc (if client.household is set)
                  if (isNew) {
                    // Add to results
                    createdRecords.push({
                      accountNumber: account.accountNumber,
                      clientId: rowObj.clientId
                    });
  
                    // If the client has a household, push the account._id into Household.accounts:
                    if (client.household) {
                      await Household.findByIdAndUpdate(
                        client.household,
                        { $addToSet: { accounts: account._id } } // avoid duplicates
                      );
                    }
                  } else {
                    updatedRecords.push({
                      accountNumber: account.accountNumber,
                      clientId: rowObj.clientId,
                      updatedFields: changedFields
                    });
                  }
                }
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
  
  
