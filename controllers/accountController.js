const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const crypto = require('crypto');
const { uploadFile } = require('../utils/s3'); 
// ^ same usage as your household import, if applicable
const { generatePreSignedUrl } = require('../utils/s3'); 

const Account = require('../models/Account');
const Client = require('../models/Client');
const Household = require('../models/Household');
const Beneficiary = require('../models/Beneficiary');
const HouseholdSnapshot = require('../models/HouseholdSnapshot');
// const AccountHistory = require('../models/AccountHistory'); // If using AccountHistory
const { normalizeFrequencySafe } = require('../utils/normalizers');
const { monthlyRateFromWithdrawals } = require('../services/monthlyDistribution');

const AccountHistory = require('../models/AccountHistory');

const ImportReport = require('../models/ImportReport'); // <--- MAKE SURE THIS IS HERE
const User = require('../models/User'); 

const { TRACKED_FIELDS } = require('../utils/accountHistory');   // <-- NEW







/** 
 * STEP 1: importAccounts
 * Upload + parse the file, return the header row + s3Key
 */
exports.importAccounts = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded.' });
    }

    const filePath = path.resolve(req.file.path);
    const userId = req.session.user._id.toString();

    // If using AWS S3 or another external storage
    const fileBuffer = fs.readFileSync(filePath);
    const originalName = req.file.originalname;
    const s3Key = await uploadFile(fileBuffer, originalName, userId);

    // Remove the file from local server
    fs.unlinkSync(filePath);

    // Parse the XLSX in memory
    const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

    // The first row = headers
    const headers = data[0];
    if (!headers || headers.length === 0) {
      return res.status(400).json({ message: 'No headers found in the uploaded file.' });
    }

    const uploadedData = data.slice(1);
    if (uploadedData.length === 0) {
      return res.status(400).json({ message: 'No data rows found in the uploaded file.' });
    }

    // Return them so the front-end can show the mapping modal
    res.status(200).json({ headers, uploadedData, s3Key });
  } catch (err) {
    console.error('Error processing file:', err);
    res.status(500).json({ message: 'Error processing file.', error: err.message });
  }
};


// (NEW) We can define our valid account types array here:
const VALID_ACCOUNT_TYPES = [
  'Individual',
  'TOD',
  'Joint',
  'Joint Tenants',
  'Tenants in Common',
  'IRA',
  'Roth IRA',
  'Inherited IRA',
  'SEP IRA',
  'Simple IRA',
  '401(k)',
  '403(b)',
  '529 Plan',
  'UTMA',
  'Trust',
  'Custodial',
  'Annuity',
  'Variable Annuity',
  'Fixed Annuity',
  'Deferred Annuity',
  'Immediate Annuity',
  'Other'
];

/**
 * (UPDATED) parseTaxStatus:
 *   - Now returns "Non-Qualified" (instead of "Taxable") when it detects "non-qualified".
 *   - Ensure your Account schema includes "Non-Qualified" in its enum if you want to store it distinctly.
 */
function parseTaxStatus(rawStatus) {
  if (!rawStatus || typeof rawStatus !== 'string') {
    return 'Taxable'; // fallback
  }

  // Remove parentheses
  let cleaned = rawStatus.replace(/\(.*?\)/g, '').trim();

  const lower = cleaned.toLowerCase();

  // Match logic
  if (lower.includes('tax deferred') || lower.includes('pre-tax')) {
    return 'Tax-Deferred';
  }
  if (lower.includes('non-qualified')) {
    // Instead of forcing it to "Taxable", we store "Non-Qualified".
    return 'Non-Qualified';
  }
  if (lower.includes('tax exempt') || lower.includes('roth')) {
    return 'Tax-Free';
  }

  return 'Taxable';
}

/**
 * (UPDATED) normalizeAccountType:
 *   - Removes parentheses and does an "includes" match 
 *     so something like "Inherited IRA (Qual)" can match "Inherited IRA".
 */
function normalizeAccountType(value) {
  if (!value || typeof value !== 'string') return 'Other';

  // Remove parentheses to handle e.g. "IRA (Pre-tax)" or "Annuity (Qualified)".
  const cleaned = value.replace(/\(.*?\)/g, '').trim().toLowerCase();

  // We'll check if cleaned "includes" the known type (also lowercased).
  // If found, we return the official type name.
  for (const type of VALID_ACCOUNT_TYPES) {
    const lowerType = type.toLowerCase();
    if (cleaned.includes(lowerType)) {
      return type; // Return the exact case from VALID_ACCOUNT_TYPES
    }
  }

  return 'Other';
}

/**
 * Enhanced name parsing for a single "Client Full Name" column.
 * If you have multiple owners (e.g., "Doe, John & Jane"), you’d expand similarly.
 */
function enhancedParseFullNameForAccount(nameStr) {
  const result = { firstName: '', middleName: '', lastName: '' };
  if (!nameStr || typeof nameStr !== 'string') return result;

  const trimmed = nameStr.trim();
  if (trimmed.includes(',')) {
    // If there's a comma => "Doe, John Albert"
    const [last, rest] = trimmed.split(',', 2).map((s) => s.trim());
    result.lastName = last || '';
    const tokens = (rest || '').split(/\s+/).filter(Boolean);
    if (tokens.length === 1) {
      result.firstName = tokens[0];
    } else if (tokens.length >= 2) {
      result.firstName = tokens[0];
      result.middleName = tokens.slice(1).join(' ');
    }
  } else {
    // No comma => "Doe John"
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (tokens.length === 1) {
      result.firstName = tokens[0];
    } else {
      result.lastName = tokens[0];
      result.firstName = tokens.slice(1).join(' ');
    }
  }
  return result;
}

/**
 * Legacy CSV rows supply ONE amount/frequency pair.  Convert to the
 * new array-of-objects schema.  If either piece is missing we ignore it.
 *
 * @param {Number|String|undefined} amt
 * @param {String|undefined} freq
 * @returns {Array<{amount:Number,frequency:String}>}
 */
function buildWithdrawalArrayFromCsvRow(amt, freq) {
  if (amt === undefined || amt === null || amt === '') return [];
  const num = Number(amt);
  if (Number.isNaN(num) || num <= 0) return [];
  return [
    {
      amount: num,
      frequency: normalizeFrequencySafe(freq),
    },
  ];
}


// exports.importAccountsWithMapping = async (req, res) => {
//   const user = req.session.user;
//   if (!user) {
//     return res.status(401).json({ message: 'Not authorized' });
//   }

//   try {
//     const { headers, mapping, uploadedData, s3Key } = req.body;

//     if (!headers || headers.length === 0) {
//       return res.status(400).json({
//         message: 'No headers array provided in request body. Cannot map columns.',
//       });
//     }
//     if (!s3Key) {
//       return res.status(400).json({ message: 'Missing s3Key for import.' });
//     }
//     if (!uploadedData || uploadedData.length === 0) {
//       return res.status(400).json({ message: 'No uploaded data available.' });
//     }
//     if (!mapping || Object.keys(mapping).length === 0) {
//       return res.status(400).json({ message: 'No mapping provided.' });
//     }

//     // Socket.io + progress map
//     const io = req.app.locals.io;
//     const userId = user._id.toString();
//     const progressMap = req.app.locals.importProgress;

//     // Initialize progress
//     const totalRecords = uploadedData.length;
//     let processedRecords = 0;
//     const createdRecords = [];
//     const updatedRecords = [];
//     const failedRecords = [];
//     const duplicateRecords = [];
//     const startTime = Date.now();

//     progressMap.set(userId, {
//       totalRecords,
//       createdRecords: 0,
//       updatedRecords: 0,
//       failedRecords: 0,
//       duplicateRecords: 0,
//       percentage: 0,
//       estimatedTime: 'Calculating...',
//       currentRecord: null,
//       status: 'in-progress',
//       createdRecordsData: [],
//       updatedRecordsData: [],
//       failedRecordsData: [],
//       duplicateRecordsData: [],
//     });

//     // 1) Build finalMapping from user-chosen column names
//     const finalMapping = {};
//     for (const key in mapping) {
//       const strippedKey = key.replace('mapping[', '').replace(']', '');
//       const chosenHeaderName = mapping[key];
//       if (!chosenHeaderName || chosenHeaderName === 'None') {
//         finalMapping[strippedKey] = -1; // Means "not mapped"
//         continue;
//       }
//       // Find the column index in headers
//       const colIndex = headers.findIndex(
//         (hdr) => hdr.toLowerCase().trim() === chosenHeaderName.toLowerCase().trim()
//       );
//       finalMapping[strippedKey] = colIndex;
//     }

//     // 2) Track duplicates within this CSV
//     const accountNumberSet = new Set();

//     // (Helper) getValue
//     function getValue(row, index) {
//       if (typeof index !== 'number' || index < 0 || index >= row.length) return '';
//       return row[index];
//     }

//     // (Helper) getUpdatedFields
//     function getUpdatedFields(oldData, newData, fields) {
//       const changed = [];
//       for (const field of fields) {
//         const oldVal = String(oldData[field] || '');
//         const newVal = String(newData[field] || '');
//         if (oldVal !== newVal) {
//           changed.push(field);
//         }
//       }
//       return changed;
//     }

//     // (Helper) escapeRegex
//     function escapeRegex(str) {
//       return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
//     }

//     // (NEW HELPER) parseAssetAllocation
//     // - Removes '%' if present
//     // - Converts to float (defaulting to 0 if invalid)
//     function parseAssetAllocation(value) {
//       if (!value) return 0;
//       const cleaned = String(value).replace('%', '').trim();
//       const numeric = parseFloat(cleaned);
//       return isNaN(numeric) ? 0 : numeric;
//     }

//     // 3) Process each row
//     for (const row of uploadedData) {
//       let rowData = {};
//       try {
//         // ------------------------------
//         // (A) REQUIRED FIELDS (always parse if mapped)
//         // ------------------------------
//         rowData.accountNumber = getValue(row, finalMapping['Account Number']);
//         rowData.accountValue = parseFloat(getValue(row, finalMapping['Account Value']) || '0');
//         rowData.accountType = getValue(row, finalMapping['Account Type']);
//         rowData.firstName = getValue(row, finalMapping['Client First']);
//         rowData.lastName = getValue(row, finalMapping['Client Last']);
//         rowData.taxStatus = getValue(row, finalMapping['Tax Status']);
//         rowData.custodian = getValue(row, finalMapping['Custodian']);

//         // If "Client Full Name" is mapped, parse it with enhanced logic:
//         const fullNameIndex = finalMapping['Client Full Name'];
//         if (fullNameIndex !== undefined && fullNameIndex !== -1) {
//           const rawFullName = getValue(row, fullNameIndex);
//           if (rawFullName) {
//             const parsed = enhancedParseFullNameForAccount(rawFullName);
//             if (parsed.firstName || parsed.lastName) {
//               rowData.firstName = parsed.firstName;
//               rowData.lastName = parsed.lastName;
//             }
//           }
//         }

//         // ------------------------------
//         // (B) OPTIONAL FIELDS (Only parse if mapped AND not blank)
//         // ------------------------------

//         // 1) Systematic Withdraw Amount
//         let sysAmt;
//         if (finalMapping['Systematic Withdraw Amount'] !== -1) {
//           const rawAmt = getValue(row, finalMapping['Systematic Withdraw Amount']);
//           if (rawAmt?.toString().trim()) {
//             const parsedAmt = parseFloat(rawAmt);
//             // If parsed is valid, store it. If invalid, we ignore it.
//             if (!isNaN(parsedAmt)) {
//               sysAmt = parsedAmt;
//             }
//           }
//         }
//         // // Store in rowData only if non-undefined
//         // if (sysAmt !== undefined) {
//         //   rowData.systematicWithdrawAmount = sysAmt;
//         // }

//         // 2) Systematic Withdraw Frequency
//         let sysFreq;
//         if (finalMapping['Systematic Withdraw Frequency'] !== -1) {
//           const rawFreq = getValue(row, finalMapping['Systematic Withdraw Frequency']);
//           if (rawFreq?.toString().trim()) {
//             // e.g., "Monthly", "Quarterly", or "Annually"
//             sysFreq = rawFreq;
//           }
//         }

//         // if (sysFreq !== undefined) {
//         //   rowData.systematicWithdrawFrequency = sysFreq;
//         // }

//         // ------------------------------
//         // (NEW) convert legacy fields ➜ array
//         // ------------------------------
//         rowData.systematicWithdrawals = buildWithdrawalArrayFromCsvRow(
//           sysAmt,
//           sysFreq
//         );
        


//         // 3) Asset allocation fields
//         let rawCash, rawIncome, rawAnnuities, rawGrowth;
//         if (finalMapping['Cash'] !== -1) {
//           rawCash = getValue(row, finalMapping['Cash']);
//           rowData.cash = parseAssetAllocation(rawCash);
//         }
//         if (finalMapping['Income'] !== -1) {
//           rawIncome = getValue(row, finalMapping['Income']);
//           rowData.income = parseAssetAllocation(rawIncome);
//         }
//         if (finalMapping['Annuities'] !== -1) {
//           rawAnnuities = getValue(row, finalMapping['Annuities']);
//           rowData.annuities = parseAssetAllocation(rawAnnuities);
//         }
//         if (finalMapping['Growth'] !== -1) {
//           rawGrowth = getValue(row, finalMapping['Growth']);
//           rowData.growth = parseAssetAllocation(rawGrowth);
//         }

//         // Convert accountNumber to string
//         if (rowData.accountNumber !== null && rowData.accountNumber !== undefined) {
//           rowData.accountNumber = String(rowData.accountNumber).trim();
//         } else {
//           rowData.accountNumber = '';
//         }

//         // If missing or empty, fail
//         if (!rowData.accountNumber) {
//           failedRecords.push({
//             firstName: rowData.firstName || '',
//             lastName: rowData.lastName || '',
//             accountNumber: 'N/A',
//             reason: 'Missing account number.',
//           });
//           processedRecords++;
//           updateProgress();
//           continue;
//         }

//         // Check for duplicates within the same spreadsheet
//         const lowerAcct = rowData.accountNumber.toLowerCase();
//         if (accountNumberSet.has(lowerAcct)) {
//           duplicateRecords.push({
//             firstName: rowData.firstName || '',
//             lastName: rowData.lastName || '',
//             accountNumber: rowData.accountNumber,
//             reason: 'Duplicate within the same spreadsheet.',
//           });
//           processedRecords++;
//           updateProgress();
//           continue;
//         } else {
//           accountNumberSet.add(lowerAcct);
//         }

//         // Validate sum of asset allocation if any are > 0
//         const sumAlloc = (rowData.cash || 0) + (rowData.income || 0) + (rowData.annuities || 0) + (rowData.growth || 0);
//         const anyAllocProvided = (rowData.cash || rowData.income || rowData.annuities || rowData.growth);
//         if (anyAllocProvided && sumAlloc !== 100) {
//           failedRecords.push({
//             firstName: rowData.firstName || '',
//             lastName: rowData.lastName || '',
//             accountNumber: rowData.accountNumber,
//             reason: `Asset allocation does not sum to 100%. (Got ${sumAlloc}%)`,
//           });
//           processedRecords++;
//           updateProgress();
//           continue;
//         }

//         // Parse the Tax Status (can return "Non-Qualified")
//         const finalTaxStatus = parseTaxStatus(rowData.taxStatus);

//         // Normalize the accountType with partial matching
//         const finalAccountType = normalizeAccountType(rowData.accountType);

//         // Attempt to find existing account
//         const existingAccount = await Account.findOne({
//           firmId:   user.firmId,                // <-- NEW guard
//           accountNumber: rowData.accountNumber,
//         }).populate('accountOwner');
        

//         if (existingAccount) {
//           // (A) Update scenario
//           const oldData = {
//             accountValue: existingAccount.accountValue,
//             accountType: existingAccount.accountType,
//             taxStatus: existingAccount.taxStatus,
//             custodian: existingAccount.custodian,
//             cash: existingAccount.cash,
//             income: existingAccount.income,
//             annuities: existingAccount.annuities,
//             growth: existingAccount.growth,
            
//             systematicWithdrawals: JSON.stringify(existingAccount.systematicWithdrawals || []),

//           };

//           // Update relevant fields only if rowData has them (non-blank)
//           if (rowData.accountValue) {
//             existingAccount.accountValue = rowData.accountValue;
//           }
//           existingAccount.accountType = finalAccountType;
//           existingAccount.taxStatus = finalTaxStatus;
//           if (rowData.custodian) {
//             existingAccount.custodian = rowData.custodian;
//           }

//           if (rowData.systematicWithdrawals.length) {
//             // here we **overwrite**; change to .push() if you prefer additive behaviour
//             existingAccount.systematicWithdrawals = rowData.systematicWithdrawals;
//           }
          

//           // Asset allocation
//           if (rowData.cash !== undefined) existingAccount.cash = rowData.cash;
//           if (rowData.income !== undefined) existingAccount.income = rowData.income;
//           if (rowData.annuities !== undefined) existingAccount.annuities = rowData.annuities;
//           if (rowData.growth !== undefined) existingAccount.growth = rowData.growth;

//           // Save changes
//           await existingAccount.save();

//           const diffsCsv = TRACKED_FIELDS.reduce((a,f)=>{
//             if (JSON.stringify(oldData[f]) !== JSON.stringify(existingAccount[f])) {
//               a.push({ field: f, prev: oldData[f] ?? null, next: existingAccount[f] });
//             }
//             return a;
//           },[]);
//           if (diffsCsv.length) {
//             await AccountHistory.create({
//               account:   existingAccount._id,
//               changedBy: user._id,
//               asOfDate:  existingAccount.asOfDate,
//               changes:   diffsCsv,
//             });
//           }
          

//           // Determine which fields actually changed
//           const updatedFieldNames = getUpdatedFields(
//             oldData,
//             {
//               accountValue: existingAccount.accountValue,
//               accountType: existingAccount.accountType,
//               taxStatus: existingAccount.taxStatus,
//               custodian: existingAccount.custodian,
//               cash: existingAccount.cash,
//               income: existingAccount.income,
//               annuities: existingAccount.annuities,
//               growth: existingAccount.growth,
          
//               systematicWithdrawals: JSON.stringify(existingAccount.systematicWithdrawals || []),
//             },
//             [
//               'accountValue',
//               'accountType',
//               'taxStatus',
//               'custodian',
//               'cash',
//               'income',
//               'annuities',
//               'growth',
//               'systematicWithdrawals',
//             ]
//           );
          

//           let ownerFirst = existingAccount.accountOwner
//             ? existingAccount.accountOwner.firstName || ''
//             : rowData.firstName || '';
//           let ownerLast = existingAccount.accountOwner
//             ? existingAccount.accountOwner.lastName || ''
//             : rowData.lastName || '';

//           updatedRecords.push({
//             firstName: ownerFirst,
//             lastName: ownerLast,
//             accountNumber: rowData.accountNumber,
//             updatedFields: updatedFieldNames,
//           });
//         } else {
//           // (B) Create scenario
//           const firstTrim = (rowData.firstName || '').trim().toLowerCase();
//           const lastTrim = (rowData.lastName || '').trim().toLowerCase();

//           if (!firstTrim || firstTrim === 'n/a' || !lastTrim || lastTrim === 'n/a') {
//             failedRecords.push({
//               firstName: rowData.firstName || 'N/A',
//               lastName: rowData.lastName || 'N/A',
//               accountNumber: rowData.accountNumber,
//               reason: 'Cannot create new account: missing or invalid household name (first/last).',
//             });
//             processedRecords++;
//             updateProgress();
//             continue;
//           }

//           const matchingClient = await Client.findOne({
//             firstName: new RegExp(`^${escapeRegex(rowData.firstName)}$`, 'i'),
//             lastName: new RegExp(`^${escapeRegex(rowData.lastName)}$`, 'i'),
//           }).populate({
//             path: 'household',
//             match: { firmId: user.firmId }, // only populate if household.firmId = user.firmId
//           });

//           if (!matchingClient || !matchingClient.household) {
//             failedRecords.push({
//               firstName: rowData.firstName || 'N/A',
//               lastName: rowData.lastName || 'N/A',
//               accountNumber: rowData.accountNumber,
//               reason: `No matching household for ${rowData.firstName} ${rowData.lastName}.`,
//             });
//             processedRecords++;
//             updateProgress();
//             continue;
//           }

//           const userId = req.session.user._id;

//           // Build the new Account
//           const newAccount = new Account({
//             firmId: user.firmId,
//             accountOwner: matchingClient._id,
//             household: matchingClient.household._id,
//             accountNumber: rowData.accountNumber,
//             accountValue: rowData.accountValue || 0,
//             accountType: finalAccountType,
//             taxStatus: finalTaxStatus,
//             custodian: rowData.custodian || 'Unknown',

//             // Asset allocation
//             cash: rowData.cash !== undefined ? rowData.cash : 0,
//             income: rowData.income !== undefined ? rowData.income : 0,
//             annuities: rowData.annuities !== undefined ? rowData.annuities : 0,
//             growth: rowData.growth !== undefined ? rowData.growth : 0,

//             systematicWithdrawals: rowData.systematicWithdrawals,   // array from CSV

//           });
//           await newAccount.save();

//           await AccountHistory.create({
//             account:   newAccount._id,
//             changedBy: user._id,
//             asOfDate:  newAccount.asOfDate,
//             changes:   TRACKED_FIELDS.map(f => ({ field: f, prev: null, next: newAccount[f] }))
//           });
          

//           // Link account to household
//           matchingClient.household.accounts.push(newAccount._id);
//           await matchingClient.household.save();

//           createdRecords.push({
//             firstName: rowData.firstName,
//             lastName: rowData.lastName,
//             accountNumber: rowData.accountNumber,
//           });
//         }

//         processedRecords++;
//         updateProgress();
//       } catch (error) {
//         console.error('Error processing row:', row, error);
//         failedRecords.push({
//           firstName: rowData.firstName || '',
//           lastName: rowData.lastName || '',
//           accountNumber: rowData.accountNumber || 'N/A',
//           reason: error.message,
//         });
//         processedRecords++;
//         updateProgress();
//       }
//     }

//     // After processing all rows, build and save ImportReport
//     try {
//       const importReport = new ImportReport({
//         user: user._id,
//         importType: 'Account Data Import',
//         createdRecords: createdRecords.map(r => ({
//           firstName: r.firstName,
//           lastName: r.lastName,
//           accountNumber: r.accountNumber,
//         })),
//         updatedRecords: updatedRecords.map(r => ({
//           firstName: r.firstName,
//           lastName: r.lastName,
//           accountNumber: r.accountNumber,
//           updatedFields: r.updatedFields,
//         })),
//         failedRecords: failedRecords.map(r => ({
//           firstName: r.firstName,
//           lastName: r.lastName,
//           accountNumber: r.accountNumber,
//           reason: r.reason,
//         })),
//         duplicateRecords: duplicateRecords.map(r => ({
//           firstName: r.firstName,
//           lastName: r.lastName,
//           accountNumber: r.accountNumber,
//           reason: r.reason,
//         })),
//         originalFileKey: s3Key,
//       });
//       await importReport.save();

//       // Mark final progress
//       progressMap.set(userId, {
//         totalRecords,
//         createdRecords: createdRecords.length,
//         updatedRecords: updatedRecords.length,
//         failedRecords: failedRecords.length,
//         duplicateRecords: duplicateRecords.length,
//         percentage: 100,
//         estimatedTime: 'Completed',
//         currentRecord: null,
//         status: 'completed',
//         createdRecordsData: createdRecords,
//         updatedRecordsData: updatedRecords,
//         failedRecordsData: failedRecords,
//         duplicateRecordsData: duplicateRecords,
//         importReportId: importReport._id.toString(),
//       });

//       io.to(userId).emit('importComplete', progressMap.get(userId));
//       io.to(userId).emit('newImportReport', {
//         _id: importReport._id,
//         importType: importReport.importType,
//         createdAt: importReport.createdAt,
//       });

//       return res.status(200).json({
//         message: 'Account import process completed.',
//         importReportId: importReport._id,
//       });
//     } catch (error) {
//       console.error('Error saving account ImportReport:', error);
//       progressMap.set(userId, {
//         totalRecords,
//         createdRecords: createdRecords.length,
//         updatedRecords: updatedRecords.length,
//         failedRecords: failedRecords.length,
//         duplicateRecords: duplicateRecords.length,
//         percentage: 100,
//         estimatedTime: 'Completed (with errors)',
//         currentRecord: null,
//         status: 'completed',
//         createdRecordsData: createdRecords,
//         updatedRecordsData: updatedRecords,
//         failedRecordsData: failedRecords,
//         duplicateRecordsData: duplicateRecords,
//         importReportId: null,
//       });
//       io.to(userId).emit('importComplete', progressMap.get(userId));
//       return res.status(500).json({
//         message: 'Error saving account ImportReport.',
//         error: error.message,
//       });
//     }

//     // === HELPER: Update real-time progress ===
//     function updateProgress() {
//       const percentage = Math.round((processedRecords / totalRecords) * 100);
//       const elapsedTime = (Date.now() - startTime) / 1000; // seconds
//       const timePerRecord = elapsedTime / processedRecords;
//       const remaining = totalRecords - processedRecords;
//       const estimatedTime = remaining > 0
//         ? `${Math.round(timePerRecord * remaining)} seconds`
//         : 'Completed';

//       progressMap.set(userId, {
//         totalRecords,
//         createdRecords: createdRecords.length,
//         updatedRecords: updatedRecords.length,
//         failedRecords: failedRecords.length,
//         duplicateRecords: duplicateRecords.length,
//         percentage,
//         estimatedTime,
//         currentRecord: null,
//         status: 'in-progress',
//         createdRecordsData: createdRecords,
//         updatedRecordsData: updatedRecords,
//         failedRecordsData: failedRecords,
//         duplicateRecordsData: duplicateRecords,
//       });
//       io.to(userId).emit('importProgress', progressMap.get(userId));
//     }
//   } catch (error) {
//     console.error('Error in importAccountsWithMapping:', error);
//     return res.status(500).json({
//       message: 'An unexpected error occurred during the account import process.',
//       error: error.message,
//     });
//   }
// };



// -------------- Helper functions --------------

/**
 * Safely returns row[index] or '' if index is invalid
 */
function getValue(row, index) {
  if (typeof index !== 'number' || index < 0 || index >= row.length) return '';
  return row[index];
}

/**
 * Compare old vs new for certain fields, return array of changed field names
 */
function getUpdatedFields(oldData, newData, fields) {
  const changed = [];
  for (const field of fields) {
    const oldVal = String(oldData[field] || '');
    const newVal = String(newData[field] || '');
    if (oldVal !== newVal) {
      changed.push(field);
    }
  }
  return changed;
}

/**
 * Escape regex special chars for safe usage in new RegExp
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


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

/**
 * Accepts either:
 *   ▸ body.systematicWithdrawals  (array of {amount,frequency})
 *   ▸ or legacy fields systematicWithdrawAmount / systematicWithdrawFrequency
 * and returns a sanitized array ready to write into the Account.
 */
function buildWithdrawalArrayFromBody(body = {}) {
  if (Array.isArray(body.systematicWithdrawals) && body.systematicWithdrawals.length) {
    return body.systematicWithdrawals
      .filter(w => w && w.amount)               // drop blanks
      .map(w => ({
        amount: Number(w.amount),
        frequency: normalizeFrequencySafe(w.frequency),
      }));
  }

  if (body.systematicWithdrawAmount) {
    return [
      {
        amount: Number(body.systematicWithdrawAmount),
        frequency: normalizeFrequencySafe(body.systematicWithdrawFrequency),
      },
    ];
  }
  return [];   // none supplied
}


exports.createAccount = async (req, res) => {
  try {
    console.log('[createAccount] Incoming req.body:', req.body);

    const householdId = req.params.householdId;
    const userId = req.session.user._id;

    // 1) Ensure the household belongs to the user
    const household = await Household.findOne({ _id: householdId, owner: userId });
    if (!household) {
      console.log('[createAccount] Household not found or unauthorized =>', { householdId, userId });
      return res.status(404).json({ message: 'Household not found or access denied.' });
    }

    // 2) Extract form data (including new asset allocation fields)
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
      asOfDate,

      // Asset allocation fields
      cash,
      income,
      annuities,
      growth,
    } = req.body;

    // --- NEW: normalise the date the moment we receive it ---
const parsedAsOfDate = asOfDate ? new Date(asOfDate) : undefined;


    console.log('[createAccount] accountOwner from req.body =>', accountOwner);

    // Convert if needed
    const ownersArray = Array.isArray(accountOwner)
      ? accountOwner
      : [accountOwner].filter(Boolean);

    console.log('[createAccount] final ownersArray =>', ownersArray);

    const user = req.session.user;

    // 3) Build `accountData`
    const accountData = {
      firmId: user.firmId,
      accountOwner: ownersArray, // store as array
      household: householdId,
      accountNumber,
      accountValue,
      accountType,
      asOfDate: parsedAsOfDate,
      taxStatus,
      custodian,
      systematicWithdrawals: buildWithdrawalArrayFromBody(req.body),
    };

    // Optional fields

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

    // Asset allocation fields (only assign if present)
    if (cash !== undefined) accountData.cash = cash;
    if (income !== undefined) accountData.income = income;
    if (annuities !== undefined) accountData.annuities = annuities;
    if (growth !== undefined) accountData.growth = growth;

    // 4) Beneficiaries
    const beneficiaryIds = { primary: [], contingent: [] };
    if (beneficiaries) {
      console.log('[createAccount] Received beneficiaries =>', beneficiaries);
      // Save primary
      for (const primary of beneficiaries.primary || []) {
        const b = new Beneficiary({
          firstName: primary.firstName,
          lastName: primary.lastName,
          relationship: primary.relationship,
          dateOfBirth: primary.dateOfBirth || null,
          ssn: primary.ssn || null,
        });
        await b.save();
        beneficiaryIds.primary.push({
          beneficiary: b._id,
          percentageAllocation: primary.percentageAllocation,
        });
      }
      // Save contingent
      for (const cont of beneficiaries.contingent || []) {
        const b = new Beneficiary({
          firstName: cont.firstName,
          lastName: cont.lastName,
          relationship: cont.relationship,
          dateOfBirth: cont.dateOfBirth || null,
          ssn: cont.ssn || null,
        });
        await b.save();
        beneficiaryIds.contingent.push({
          beneficiary: b._id,
          percentageAllocation: cont.percentageAllocation,
        });
      }
      accountData.beneficiaries = beneficiaryIds;
    }

    // 5) Build `accountOwnerName`
    if (ownersArray.length > 0) {
      const owners = await Client.find({ _id: { $in: ownersArray } }, 'firstName lastName').lean();
      console.log('[createAccount] Fetched owners =>', owners);
      const nameList = owners.map(o => o.firstName).join(' & ');
      accountData.accountOwnerName = nameList || 'Unknown';
    } else {
      accountData.accountOwnerName = 'Unknown';
    }

    console.log('[createAccount] Final accountData =>', accountData);

    // 6) Create account
    const account = new Account(accountData);

    await account.save();
    // ---------- HISTORY (initial snapshot) ----------

// ---------- HISTORY (initial snapshot) ----------
await AccountHistory.create({
  account:   account._id,
  changedBy: user._id,
  asOfDate:  account.asOfDate,
  changes:   TRACKED_FIELDS.map(field => ({
    field,
    prev:  null,
    next:  account[field] ?? null
  }))
});




    household.accounts.push(account._id);
    await household.save();

    // Possibly record history...
    // ...

    await recalculateMonthlyNetWorth(householdId);

    console.log('[createAccount] Successfully created account =>', account._id, account.accountOwnerName);

    res.status(201).json({ message: 'Account created successfully.', account });
  } catch (error) {
    console.error('[createAccount] Error creating account:', error);
    res.status(400).json({ message: error.message });
  }
};


exports.getAccountsByHousehold = async (req, res) => {
  try {
    const householdId = req.params.householdId;
    const userId = req.session.user._id;
    const userFirmId = req.session.user.firmId;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    let { sortField = 'accountOwnerName', sortOrder = 'asc', search = '' } = req.query;

    const validSortFields = {
      accountOwnerName: 'accountOwnerName',
      accountType: 'accountType',
      // sort by the amount of the first withdrawal object
      systematicWithdrawAmount: 'systematicWithdrawals.0.amount',
      updatedAt: 'updatedAt',
      accountValue: 'accountValue',
      asOfDate: 'asOfDate',
    };
    

    if (!validSortFields[sortField]) {
      sortField = 'accountOwnerName';
    }

    const sortFieldDB = validSortFields[sortField];
    const sortOrderValue = sortOrder === 'desc' ? -1 : 1;

    // Validate the household's firm
    const household = await Household.findOne({ _id: householdId, firmId: userFirmId }).lean();
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
        { custodian: regex },
      ];
    }

    const totalAccounts = await Account.countDocuments(conditions);

    // Now that accountOwner is an array, we'll do .populate('accountOwner')
    // which returns an array of Clients if it's a joint account
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

exports.updateAccount = async (req, res) => {
  try {
    const accountId = req.params.accountId;
    const userFirmId = req.session.user.firmId;

    // Find the account and ensure it belongs to a household in the user's firm
    const account = await Account.findById(accountId).populate('household');


    if (!account) {
      return res.status(404).json({ message: 'Account not found.' });
    }

    if (!account.household || account.household.firmId.toString() !== userFirmId) {
      return res.status(403).json({ message: 'Access denied for this account.' });
    }
    const originalAccount = account.toObject();   // shallow copy before mutations

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
      asOfDate,
      taxForms,
      inheritedAccountDetails,
      iraAccountDetails,

      // Asset allocation fields
      cash,
      income,
      annuities,
      growth,
    } = req.body;

    // Convert to array if needed
    if (accountOwner) {
      const newOwners = Array.isArray(accountOwner) ? accountOwner : [accountOwner];
      account.accountOwner = newOwners;
    }

    if (accountNumber) account.accountNumber = accountNumber;
    if (accountValue !== undefined && accountValue !== '') account.accountValue = accountValue;
    if (accountType) account.accountType = accountType;
    if (taxStatus) account.taxStatus = taxStatus;
    if (custodian) account.custodian = custodian;

    if (asOfDate) {
      account.asOfDate = new Date(asOfDate);
    }
    

// ---------- Systematic withdrawals (array) ----------
const newArray = buildWithdrawalArrayFromBody(req.body);
if (newArray.length) {
  account.systematicWithdrawals = newArray;
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
      await Beneficiary.deleteMany({
        _id: [
          ...account.beneficiaries.primary.map(b => b.beneficiary),
          ...account.beneficiaries.contingent.map(b => b.beneficiary),
        ],
      });

      const beneficiaryIds = { primary: [], contingent: [] };
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

    // Asset allocation fields (update if provided)
    if (cash !== undefined) account.cash = cash;
    if (income !== undefined) account.income = income;
    if (annuities !== undefined) account.annuities = annuities;
    if (growth !== undefined) account.growth = growth;

    // Recompute accountOwnerName if owners changed
    if (account.accountOwner?.length > 0) {
      const owners = await Client.find({ _id: { $in: account.accountOwner } }, 'firstName lastName');
      const nameList = owners.map(o => o.firstName).join(' & ');
      account.accountOwnerName = nameList || 'Unknown';
    } else {
      account.accountOwnerName = 'Unknown';
    }

    await account.save();



const diffs = TRACKED_FIELDS.reduce((arr, f) => {
  // stringify arrays for reliable compare
  const before = JSON.stringify(originalAccount[f] ?? null);
  const after  = JSON.stringify(account[f]          ?? null);
  if (before !== after) {
    arr.push({ field: f, prev: originalAccount[f] ?? null, next: account[f] });
  }
  return arr;
}, []);

// RIGHT after you compute `const diffs = TRACKED_FIELDS.reduce(…)`
console.log('[updateAccount] TRACKED_FIELDS =', TRACKED_FIELDS);
console.log('[updateAccount] computed diffs =', diffs);


// build full change set
const changes = TRACKED_FIELDS.map(field => ({
  field,
  prev: originalAccount[field] ?? null,
  next: account[field]          ?? null
}));

// save one AccountHistory entry for *all* fields
const historyDoc = await AccountHistory.create({
  account:   account._id,
  changedBy: req.session.user._id,
  asOfDate:  account.asOfDate,
  changes
});

console.log('[updateAccount] History saved:', historyDoc._id);



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
    const userFirmId = req.session.user.firmId;

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

    // Ensure the account belongs to the correct firm
    if (!account.household || account.household.firmId.toString() !== userFirmId) {
      return res.status(403).json({ message: 'Access denied for this account.' });
    }

    // Include the new fields: cash, income, annuities, growth
    const fullAccountDetails = {
      _id: account._id,
      accountOwner: account.accountOwner || { firstName: '---', lastName: '---' },
      accountNumber: account.accountNumber || '---',
      accountValue: account.accountValue || '---',
      accountType: account.accountType || '---',
      custodian: account.custodian || '---',
      // array comes as-is; Front-end will iterate it
      systematicWithdrawals: account.systematicWithdrawals || [],

      federalTaxWithholding: account.federalTaxWithholding || '---',
      stateTaxWithholding: account.stateTaxWithholding || '---',
      taxStatus: account.taxStatus || '---',
      valueAsOf12_31: account.valueAsOf12_31 || '---',

      // NEW ASSET ALLOCATION FIELDS:
      cash: account.cash || '---',
      income: account.income || '---',
      annuities: account.annuities || '---',
      growth: account.growth || '---',

      beneficiaries: account.beneficiaries || { primary: [], contingent: [] },
      taxForms: account.taxForms || [],
      inheritedAccountDetails: account.inheritedAccountDetails || {},
      iraAccountDetails: account.iraAccountDetails || [],
      asOfDate: account.asOfDate || null,

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
    const userFirmId = req.session.user.firmId;

    // Validate household belongs to the user's firm
    const household = await Household.findOne({ _id: householdId, firmId: userFirmId }).lean();
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
          taxStatusSummary: { $push: { status: '$taxStatus', value: '$accountValue' } },
        },
      },
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

    const systematicWithdrawals = await Account.find({
      household: household._id,
      'systematicWithdrawals.0': { $exists: true },   // at least one element
    }).lean();
    

    res.json({
      totalNetWorth: (result && result.totalNetWorth) || 0,
      assetAllocation,
      taxStatusSummary,
      systematicWithdrawals,
    });
  } catch (error) {
    console.error('Error fetching account summary:', error);
    res.status(500).json({ message: 'Error fetching account summary.', error: error.message });
  }
};

exports.getMonthlyNetWorth = async (req, res) => {
  try {
    const { householdId } = req.params;
    const userFirmId = req.session.user.firmId;

    // Validate household belongs to the user's firm
    const household = await Household.findOne({ _id: householdId, firmId: userFirmId }).lean();
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
          month: { $gte: oneYearAgo.getMonth() },
        },
      ],
    })
      .sort({ year: 1, month: 1 })
      .lean();

    const monthlyNetWorth = snapshots.map(s => ({
      month: new Date(s.year, s.month, 1).toLocaleString('default', { month: 'short', year: 'numeric' }),
      netWorth: s.netWorth || 0,
    }));

    res.json({ monthlyNetWorth });
  } catch (error) {
    console.error('Error fetching monthly net worth:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
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
