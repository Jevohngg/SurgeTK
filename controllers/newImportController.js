// File: controllers/newImportController.js

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

const CompanyID = require('../models/CompanyID');
const ImportReport = require('../models/ImportReport');
const ValueAdd = require('../models/ValueAdd');

const ImportedAdvisor = require('../models/ImportedAdvisor');  // <-- NEW MODEL for imported advisors


const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { getMarginalTaxBracket } = require('../utils/taxBrackets');
const { uploadFile } = require('../utils/s3');

const { logActivity } = require('../utils/activityLogger');
const { DateTime } = require('luxon');

/**
 * Excel serial (days since 1899-12-30) -> Date (normalized to start of day in tz)
 * We treat values as "date only" and pin them to midnight in the user's tz, then to UTC.
 */
function excelSerialToDate(serial, tz = 'UTC') {
  const base = DateTime.fromISO('1899-12-30', { zone: 'UTC' });
  // Excel serial can be float; we care about the date part for "date only"
  const dt = base.plus({ days: Number(serial) }).setZone(tz).startOf('day').toUTC();
  return new Date(dt.toISO());
}

/**
 * Parse a wide variety of date inputs safely with timezone.
 * Returns a JS Date (UTC) or null. Never throws.
 */
function parseImportedDate(input, tz = 'UTC') {
  if (input === null || input === undefined || input === '') return null;

  // Numeric => likely Excel serial
  if (typeof input === 'number' && !Number.isNaN(input)) {
    return excelSerialToDate(input, tz);
  }

  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;

  // Try ISO first (handles "2025-08-10", "2025-08-10T00:00:00Z", etc.)
  let dt = DateTime.fromISO(s, { zone: tz });
  if (!dt.isValid) {
    // Try several common CSV/Excel formats (US + Intl)
    const formats = [
      'M/d/yyyy', 'M/d/yy', 'MM/dd/yyyy', 'MM/dd/yy',
      'd/M/yyyy', 'd/M/yy', 'dd/MM/yyyy', 'dd/MM/yy',
      'd-M-yyyy', 'd-M-yy', 'yyyy-MM-dd',
      'd MMM yyyy', 'MMM d, yyyy', 'MMMM d, yyyy'
    ];
    for (const f of formats) {
      dt = DateTime.fromFormat(s, f, { zone: tz });
      if (dt.isValid) break;
    }
  }
  if (!dt.isValid) return null;

  // Treat as "date only": lock to midnight *in the user's tz*, then convert to UTC.
  const asUtc = dt.startOf('day').toUTC();
  return new Date(asUtc.toISO());
}


/**
 * Helper: parse single name string
 * If string has comma => treat as "LastName, FirstName"
 * If no comma => last token is firstName, prior tokens are lastName
 */
function parseSingleName(fullName) {
  if (!fullName || typeof fullName !== 'string') {
    return { firstName: '', lastName: '' };
  }
  const trimmed = fullName.trim();
  if (!trimmed) return { firstName: '', lastName: '' };

  if (trimmed.includes(',')) {
    const [last, first] = trimmed.split(',').map(s => s.trim());
    return { firstName: first || '', lastName: last || '' };
  } else {
    const tokens = trimmed.split(/\s+/);
    if (tokens.length === 1) {
      return { firstName: tokens[0], lastName: '' };
    } else {
      const firstName = tokens.pop();
      const lastName = tokens.join(' ');
      return { firstName, lastName };
    }
  }
}

/**
 * Helper: Parse a spreadsheet from a remote URL (S3).
 * Returns a 2D array (each row is an array).
 * The first row is headers; subsequent rows contain data.
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
 * 1) Upload Handler (no changes to your original)
 */
exports.uploadContactFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded.' });
    }

    // userId for S3 path logic
    const userId = req.session?.user?._id || 'anonymous';

    // 1) Upload the file to S3
    let s3Key;
    try {
      s3Key = await uploadFile(req.file.buffer, req.file.originalname, userId);
    } catch (err) {
      console.error('S3 upload error:', err);
      return res.status(500).json({
        message: 'Failed to upload file to S3. Please try again or contact support.'
      });
    }

    // 2) Construct a direct S3 URL
    const s3Url = `https://${process.env.IMPORTS_S3_BUCKET_NAME}.s3.amazonaws.com/${s3Key}`;

    // 3) Parse the spreadsheet from memory to extract headers
    let rawData;
    try {
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      rawData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
    } catch (parseErr) {
      console.error('Spreadsheet parsing error:', parseErr);
      return res.status(400).json({
        message: 'Failed to parse spreadsheet. Ensure file is a valid CSV or Excel file.'
      });
    }

    if (!rawData || rawData.length === 0) {
      return res.status(400).json({ message: 'The uploaded file appears to be empty.' });
    }

    const headers = rawData[0];
    if (!headers || headers.length === 0) {
      return res.status(400).json({ message: 'No headers found in the file.' });
    }

    return res.json({
      message: 'File uploaded successfully.',
      headers,
      tempFile: s3Url,
      s3Key
    });
  } catch (err) {
    console.error('Error uploading contact file:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * 2) Process Handler (Mapping + Upsert) - Now storing leadAdvisor on Household
 */
exports.processContactImport = async (req, res) => {
  try {
    const { mapping, tempFile, nameMode, s3Key } = req.body;

    // Generate a batchId for this run (lets us group any row-level logs too)
    const batchId = crypto.randomUUID();                // ← NEW
    const baseCtx = {                                   // ← NEW
      ...(req.activityCtx || {}),
      meta: {
        ...((req.activityCtx && req.activityCtx.meta) || {}),
        path: req.originalUrl,
        batchId,
        extra: {
          importType: 'Household Data Import',
          fileKey: s3Key || null
        }
      }
    };

    // [DEBUG] 
    console.log('DEBUG: processContactImport received body:', {
      mapping,
      tempFile,
      nameMode,
    });

    if (!tempFile || !mapping) {
      return res.status(400).json({ message: 'Missing file or mapping data.' });
    }

    const rawData = await parseSpreadsheetFromUrl(tempFile);
    if (!rawData || rawData.length <= 1) {
      return res.status(400).json({ message: 'No data rows found in the file.' });
    }

    // Remove header row
    rawData.shift();

    // Arrays for final results
    const createdRecords = [];
    const updatedRecords = [];
    const failedRecords = [];
    const duplicateRecords = [];

    // Track clientIds to detect duplicates in the same file
    const usedClientIds = new Set();

    // For real-time progress
    const io = req.app.locals.io;
    const userRoom = req.session.user._id;
    const totalRecords = rawData.length;

    let processedCount = 0;
    let totalChunks = 0;
    let rollingAvgSecPerRow = 0;
    const CHUNK_SIZE = 50;

    for (let chunkStart = 0; chunkStart < totalRecords; chunkStart += CHUNK_SIZE) {
      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalRecords);
      const chunkSize = chunkEnd - chunkStart;
      const chunkStartTime = Date.now();

      for (let i = chunkStart; i < chunkEnd; i++) {
        let rowObj;
        const row = rawData[i];
        try {
          const tz = req.session?.user?.timezone || req.session?.user?.timeZone || process.env.DEFAULT_IMPORT_TIMEZONE || 'UTC';
          rowObj = extractRowData(row, mapping, nameMode, tz);
          console.log(`DEBUG: Row ${i} extracted data:`, rowObj);

          if (!rowObj.householdId || !rowObj.clientId) {
            failedRecords.push({
              firstName: rowObj.firstName || 'N/A',
              lastName: rowObj.lastName || 'N/A',
              clientId: rowObj.clientId || 'N/A',
              householdId: rowObj.householdId || 'N/A',
              reason: 'Missing required householdId or clientId'
            });
          } else {
            if (usedClientIds.has(rowObj.clientId)) {
              duplicateRecords.push({
                reason: `Duplicate clientId in the same spreadsheet: ${rowObj.clientId}`,
                clientId: rowObj.clientId,
                rowIndex: i,
                firstName: rowObj?.firstName || 'N/A',
                lastName: rowObj?.lastName || 'N/A',
                clientId: rowObj?.clientId || 'N/A',
                householdId: rowObj?.householdId || 'N/A',
              });
            } else {
              usedClientIds.add(rowObj.clientId);

              // 1) Upsert the Household (advisors are stored here!)
              let household = await Household.findOne({
                userHouseholdId: rowObj.householdId,
                firmId: req.session.user.firmId
              });
              const isNewHousehold = !household;
              if (!household) {
                household = new Household({
                  userHouseholdId: rowObj.householdId,
                  firmId: req.session.user.firmId,
                  owner: req.session.user._id
                });
                await household.save();
              }

              // 2) Upsert the Client (but only to store data that is truly client-level)
              let client = await Client.findOne({
                firmId: req.session.user.firmId,
                clientId: rowObj.clientId
              });
              const isNewClient = !client;
              if (!client) {
                client = new Client({
                  firmId: req.session.user.firmId,
                  clientId: rowObj.clientId,
                  household: household._id
                });
              } else if (!client.household) {
                client.household = household._id;
              }

              // Partial updates for the Client
              client.firstName = rowObj.firstName || client.firstName;
              client.lastName = rowObj.lastName || client.lastName;
              if (rowObj.middleName && rowObj.middleName.trim()) {
                client.middleName = rowObj.middleName.trim();
              }

              if ('dob' in mapping) {
                const newDob = rowObj.dob;
                if (newDob && !isNaN(newDob.getTime())) {
                  if (!client.dob || client.dob.getTime() !== newDob.getTime()) {
                    client.dob = newDob;
                  }
                }
              }

              if (typeof rowObj.ssn === 'string' && rowObj.ssn.trim()) {
                client.ssn = rowObj.ssn.trim();
              }
              if (typeof rowObj.taxFilingStatus === 'string' && rowObj.taxFilingStatus.trim()) {
                client.taxFilingStatus = rowObj.taxFilingStatus.trim();
              }
              if (typeof rowObj.maritalStatus === 'string' && rowObj.maritalStatus.trim()) {
                client.maritalStatus = rowObj.maritalStatus.trim();
              }
              if (typeof rowObj.mobileNumber === 'string' && rowObj.mobileNumber.trim()) {
                client.mobileNumber = rowObj.mobileNumber.trim();
              } else if (typeof rowObj.mobileNumber === 'number') {
                client.mobileNumber = rowObj.mobileNumber.toString();
              }
              if (typeof rowObj.homePhone === 'string' && rowObj.homePhone.trim()) {
                client.homePhone = rowObj.homePhone.trim();
              } else if (typeof rowObj.homePhone === 'number') {
                client.homePhone = rowObj.homePhone.toString();
              }
              if (typeof rowObj.email === 'string' && rowObj.email.trim()) {
                client.email = rowObj.email.trim();
              }
              if (typeof rowObj.homeAddress === 'string' && rowObj.homeAddress.trim()) {
                client.homeAddress = rowObj.homeAddress.trim();
              }
              if (typeof rowObj.deceasedLiving === 'string' && rowObj.deceasedLiving.trim()) {
                client.deceasedLiving = rowObj.deceasedLiving.trim();
              }
              // Job / Employer: optional string, never throws
              if (typeof rowObj.occupation === 'string' && rowObj.occupation.trim()) {
                client.occupation = rowObj.occupation.trim();
              }
              if (typeof rowObj.employer === 'string' && rowObj.employer.trim()) {
                client.employer = rowObj.employer.trim();
              }
              
              // Retirement Date: store only if a valid Date
              if ('retirementDate' in mapping) {
                const rd = rowObj.retirementDate;
                if (rd && !isNaN(rd.getTime())) {
                  client.retirementDate = rd;
                }
              }
              

              if (rowObj.monthlyIncome !== null && rowObj.monthlyIncome !== '') {
                const inc = parseFloat(rowObj.monthlyIncome);
                if (!isNaN(inc)) {
                  client.monthlyIncome = inc;
                }
              }
              /* ---  Marginal Tax Bracket aggregation  -------------------------- */
              if (rowObj.marginalTaxBracket !== null && rowObj.marginalTaxBracket !== '') {
                let newMTB = rowObj.marginalTaxBracket;
                // treat >100 as data error but keep going
                if (typeof newMTB === 'number' && newMTB < 0) newMTB = null;
              
                // Rule:
                //  - if household has no value, set it
                //  - else if new value > existing, overwrite
                if (newMTB !== null) {
                  if (
                    household.marginalTaxBracket === null ||
                    household.marginalTaxBracket === undefined ||
                    newMTB > household.marginalTaxBracket
                  ) {
                    household.marginalTaxBracket = newMTB;
                  }
                }
              }
              
              // =========================================
              // NEW: Store leadAdvisor info on the CLIENT:
              // =========================================
              if (rowObj.leadAdvisorFirstName && rowObj.leadAdvisorFirstName.trim()) {
                client.leadAdvisorFirstName = rowObj.leadAdvisorFirstName.trim();
              }
              if (rowObj.leadAdvisorLastName && rowObj.leadAdvisorLastName.trim()) {
                client.leadAdvisorLastName = rowObj.leadAdvisorLastName.trim();
              }

              // Because the platform doesn't support storing leadAdvisors on Client, we store them on Household:
              // If the Household doesn't have a leadAdvisor name, set it now
              let hadAdvisorInfo = false;
              if (!household.leadAdvisorFirstName && rowObj.leadAdvisorFirstName) {
                household.leadAdvisorFirstName = rowObj.leadAdvisorFirstName;
                hadAdvisorInfo = true;
              }
              if (!household.leadAdvisorLastName && rowObj.leadAdvisorLastName) {
                household.leadAdvisorLastName = rowObj.leadAdvisorLastName;
                hadAdvisorInfo = true;
              }

              // [DEBUG] Show the updated household lead advisor fields
              console.log('DEBUG: Household leadAdvisor fields (pre-save):', {
                leadAdvisorFirstName: household.leadAdvisorFirstName,
                leadAdvisorLastName: household.leadAdvisorLastName,
              });

              // Now do the ImportedAdvisor creation if leadAdvisor is present
              try {
                const fullImportedName = [
                  household.leadAdvisorFirstName,
                  household.leadAdvisorLastName
                ]
                  .filter(Boolean)
                  .join(' ')
                  .trim();

                if (fullImportedName) {
                  // 1) Check if we have an ImportedAdvisor doc
                  let importedAdv = await ImportedAdvisor.findOne({
                    firmId: req.session.user.firmId,
                    importedAdvisorName: fullImportedName
                  });

                  if (!importedAdv) {
                    console.log(`[DEBUG] Creating ImportedAdvisor for name="${fullImportedName}"`);

                    // Attempt auto-match
                    let matchedUser = null;
                    try {
                      const nameParts = fullImportedName.split(/\s+/);
                      const first = nameParts.shift() || '';
                      const last = nameParts.join(' ') || '';

                      matchedUser = await User.findOne({
                        firmId: req.session.user.firmId,
                        firstName: new RegExp(`^${first}$`, 'i'),
                        lastName: new RegExp(`^${last}$`, 'i'),
                      });

                      if (matchedUser) {
                        console.log('[DEBUG] Auto-link found user:', matchedUser.email);
                      }
                    } catch (autoErr) {
                      console.error('[DEBUG] Auto-link error:', autoErr);
                    }

                    // Create the ImportedAdvisor doc
                    importedAdv = new ImportedAdvisor({
                      firmId: req.session.user.firmId,
                      importedAdvisorName: fullImportedName,
                    });

                    if (matchedUser) {
                      importedAdv.linkedUser = matchedUser._id;
                      // If matched, let's also store it on the Household
                      // e.g., household.leadAdvisors.addToSet(matchedUser._id)
                      household.leadAdvisors = household.leadAdvisors || [];
                      household.leadAdvisors.addToSet(matchedUser._id);
                    }
                    await importedAdv.save();
                    console.log(`[DEBUG] ImportedAdvisor doc created for "${fullImportedName}" with linkedUser=${matchedUser?._id || null}`);
                  } else {
                    console.log(`[DEBUG] ImportedAdvisor already exists for "${fullImportedName}". ID=${importedAdv._id}`);
                    // If that importedAdv is already linked to a user, we can optionally
                    // reflect that in the Household immediately if you want.
                    if (importedAdv.linkedUser) {
                      household.leadAdvisors = household.leadAdvisors || [];
                      household.leadAdvisors.addToSet(importedAdv.linkedUser);
                    }
                  }
                }
              } catch (impAdvErr) {
                console.error('[DEBUG] Error with ImportedAdvisor logic:', impAdvErr);
              }

              // Save the Household if we changed anything
              if (hadAdvisorInfo || isNewHousehold) {
                await household.save();
                console.log('[DEBUG] Household saved with updated lead advisor info:', household._id);
              }

              // Finally, handle new/updated client
              if (isNewClient) {
                await client.save();
                createdRecords.push({
                  clientId: client.clientId,
                  firstName: client.firstName,
                  lastName: client.lastName
                });
              } else {
                const changes = client.modifiedPaths();
                console.log('DEBUG: Mongoose client modifiedPaths() =>', changes);
                await client.save();
                updatedRecords.push({
                  clientId: client.clientId,
                  firstName: client.firstName,
                  lastName: client.lastName,
                  updatedFields: changes
                });
              }

              // Ensure a headOfHousehold
              if (!household.headOfHousehold) {
                household.headOfHousehold = client._id;
                await household.save();
              }
            }
          }
        } catch (rowErr) {
          console.error('Row error:', rowErr);
          failedRecords.push({
            firstName: rowObj?.firstName || 'N/A',
            lastName: rowObj?.lastName || 'N/A',
            clientId: rowObj?.clientId || 'N/A',
            householdId: rowObj?.householdId || 'N/A',
            reason: rowErr.message
          });
        }

        processedCount++;
      } // chunk row loop

      // end chunk => progress
      const chunkEndTime = Date.now();
      const chunkElapsedMs = chunkEndTime - chunkStartTime;
      const chunkSecPerRow = chunkElapsedMs / 1000 / chunkSize;

      totalChunks++;
      rollingAvgSecPerRow =
        ((rollingAvgSecPerRow * (totalChunks - 1)) + chunkSecPerRow) / totalChunks;

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
    } // chunk loop

    // Final summary
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
      importReportId: null 
    });
    // return res.json({
    //   message: 'Processing complete',
    //   createdRecords,
    //   updatedRecords,
    //   failedRecords,
    //   duplicateRecords
    // });

   // =====================================
   // CREATE ImportReport for Contact Import
   // =====================================
   try {
     const newReport = new ImportReport({
       user: req.session.user._id,
       importType: 'Household Data Import', 
       originalFileKey: s3Key, // pass in from req.body
       createdRecords: createdRecords.map(r => ({
         firstName: r.firstName || '',
         lastName: r.lastName || ''
       })),
       updatedRecords: updatedRecords.map(r => ({
         firstName: r.firstName || '',
         lastName: r.lastName || '',
         updatedFields: r.updatedFields || []
       })),
       failedRecords: failedRecords.map(r => ({
        firstName: r.firstName || 'N/A',
        lastName: r.lastName || 'N/A',
        clientId: r.clientId || 'N/A',
        householdId: r.householdId || 'N/A',
        reason: r.reason || ''
       })),
       duplicateRecords: duplicateRecords.map(r => ({
        firstName: r.firstName || 'N/A',
        lastName: r.lastName || 'N/A',
        clientId: r.clientId || 'N/A',
        householdId: r.householdId || 'N/A',
        reason: r.reason || ''
       })),
     });
     // (optional) let the audit plugin log a "create" for ImportReport
     newReport.$locals = newReport.$locals || {};
     newReport.$locals.activityCtx = baseCtx;    

     await newReport.save();

     // Optionally let the front-end know a new ImportReport is available:
     io.to(userRoom).emit('newImportReport', {
       _id: newReport._id,
       importType: newReport.importType,
       createdAt: newReport.createdAt
     });

     // 🔵 MAIN: one concise "import" activity entry (summary)
     try {
       await logActivity(
         {
           ...baseCtx,
           // keep the same batchId; also include the report id in extra
           meta: {
             ...baseCtx.meta,
             extra: {
               ...(baseCtx.meta?.extra || {}),
               importReportId: newReport._id
             }
           }
         },
         {
           entity: {
             type: 'ImportReport',
             id: newReport._id,
             display: `Contacts import • ${path.basename(s3Key || 'file')}`
           },
           action: 'import',
           before: null,
           // Keep this small: counts only (no PII/raw rows)
           after: {
             totalRecords,
             created: createdRecords.length,
             updated: updatedRecords.length,
             failed: failedRecords.length,
             duplicates: duplicateRecords.length
             },
           diff: null
         }
       );
     } catch (actErr) {
       console.error('[import] activity log failed:', actErr);
     }


     // Return final
     return res.json({
       message: 'Processing complete',
       createdRecords,
       updatedRecords,
       failedRecords,
       duplicateRecords,
       importReportId: newReport._id
     });
   } catch (reportErr) {
     console.error('Error creating ImportReport:', reportErr);
     // Return final but note the report creation failed
     return res.json({
       message: 'Processing complete (report creation failed)',
       createdRecords,
       updatedRecords,
       failedRecords,
       duplicateRecords,
       error: reportErr.message
     });
   }

  } catch (error) {
    console.error('Error processing contact import:', error);
    return res.status(500).json({
      message: 'Server error while processing contact import',
      error: error.message
    });
  }
};

/**
 * Utility: Extract row data
 */
function extractRowData(row, mapping, nameMode, tz = 'UTC') {
  const getValue = (field) => {
    if (!mapping[field] && mapping[field] !== 0) return '';
    const idx = mapping[field];
    return row[idx] || '';
  };

  const householdId = getValue('householdId');
  const clientId = getValue('clientId');

  let firstName = '';
  let lastName = '';

  if (nameMode === 'single') {
    const singleName = getValue('fullName');
    const parsed = parseSingleName(singleName);
    firstName = parsed.firstName;
    lastName = parsed.lastName;
  } else {
    firstName = getValue('firstName');
    lastName = getValue('lastName');
  }

  const middleName = getValue('middleName');

  // Possibly parse a date
  let dob;
  if (typeof mapping.dob !== 'undefined') {
    const dobRaw = getValue('dob');
    if (typeof dobRaw === 'number') {
      dob = new Date(Math.round((dobRaw - 25569) * 86400 * 1000));
    } else if (typeof dobRaw === 'string' && dobRaw.trim()) {
      const parsedDate = new Date(dobRaw);
      dob = isNaN(parsedDate.getTime()) ? null : parsedDate;
    } else {
      dob = null;
    }
  }

  const ssn = getValue('ssn');
  const taxFilingStatus = getValue('taxFilingStatus');
  const maritalStatus = getValue('maritalStatus');
  const mobileNumber = getValue('mobileNumber');
  const homePhone = getValue('homePhone');
  const email = getValue('email');
  const homeAddress = getValue('homeAddress');
  const deceasedLiving = getValue('deceasedLiving');
  const monthlyIncome = getValue('monthlyIncome');

// New fields
const occupation = (() => {
  // Back-compat: accept either occupation or legacy jobEmployer mapping key
  const key = (typeof mapping.occupation !== 'undefined')
    ? 'occupation'
    : (typeof mapping.jobEmployer !== 'undefined' ? 'jobEmployer' : null);
  if (!key) return '';
  const raw = getValue(key);
  return (typeof raw === 'string') ? raw.trim() : String(raw ?? '').trim();
})();


// New fields
const employer = (() => {
  // Back-compat: accept either employer or legacy jobEmployer mapping key
  const key = (typeof mapping.employer !== 'undefined')
    ? 'employer'
    : (typeof mapping.jobEmployer !== 'undefined' ? 'jobEmployer' : null);
  if (!key) return '';
  const raw = getValue(key);
  return (typeof raw === 'string') ? raw.trim() : String(raw ?? '').trim();
})();


let retirementDate = null;
if (typeof mapping.retirementDate !== 'undefined') {
  const raw = getValue('retirementDate');
  retirementDate = parseImportedDate(
    (typeof raw === 'number') ? raw
      : (typeof raw === 'string' ? raw : ''),
    tz
  );
}

  

 // NEW – Marginal Tax Bracket
 let marginalTaxBracket = null;
 if (typeof mapping.marginalTaxBracket !== 'undefined') {
   const raw = getValue('marginalTaxBracket');
   if (typeof raw === 'string') {
     const cleaned = raw.replace(/[%\s]/g,'');
     const num = parseFloat(cleaned);
     if (!isNaN(num)) marginalTaxBracket = num;
   } else if (typeof raw === 'number') {
     marginalTaxBracket = raw;
   }
 }


  // We are no longer storing leadAdvisor on the Client doc,
  // but we do parse it from the CSV so we can place it on Household:
  const leadAdvisorRaw = getValue('leadAdvisor');
  const parsedAdvisor = parseSingleName(leadAdvisorRaw);

  return {
    householdId,
    clientId,
    firstName,
    lastName,
    middleName,
    dob,
    ssn,
    taxFilingStatus,
    maritalStatus,
    mobileNumber,
    homePhone,
    email,
    homeAddress,
    deceasedLiving,
    monthlyIncome,
    marginalTaxBracket,
    occupation,
    employer,
    retirementDate,
    leadAdvisorFirstName: parsedAdvisor.firstName,
    leadAdvisorLastName: parsedAdvisor.lastName
  };
}




/**
 * Retrieves paginated import reports for the authenticated user.
 *
 * @param {Object} req - The Express request object.
 * @param {Object} res - The Express response object.
 */
exports.getImportReports = async (req, res) => {
  try {
      const userId = req.session.user._id;

      // Extract query parameters
      let { page, limit, search, sortField, sortOrder } = req.query;

      // Set default values
      page = parseInt(page) || 1;
      limit = parseInt(limit) || 10;
      search = search ? search.trim() : '';
      sortField = sortField || 'createdAt';
      sortOrder = sortOrder === 'desc' ? -1 : 1; // Default to ascending

      // Build the filter object
      const filter = { user: userId };

      if (search) {
          // Example: Search by importType or other relevant fields
          filter.$or = [
              { importType: { $regex: search, $options: 'i' } },
              // Add more fields to search if necessary
          ];
      }

      // Count total documents matching the filter
      const totalReports = await ImportReport.countDocuments(filter);

      // Calculate total pages
      const totalPages = Math.ceil(totalReports / limit);

      // Ensure the current page isn't out of bounds
      if (page > totalPages && totalPages !== 0) page = totalPages;
      if (page < 1) page = 1;

      // Retrieve the import reports with pagination and sorting
      const importReports = await ImportReport.find(filter)
          .sort({ [sortField]: sortOrder })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(); // Use lean() for faster Mongoose queries as we don't need Mongoose documents

      res.json({
          importReports,
          currentPage: page,
          totalPages,
          totalReports,
      });

  } catch (error) {
      console.error('Error fetching import reports:', error);
      res.status(500).json({ message: 'Failed to fetch import reports.', error: error.message });
  }
};


// controllers/newImportController.js
exports.downloadImportedFile = async (req, res) => {
  try {
    const { reportId } = req.params;
    const report = await ImportReport.findById(reportId);
    if (!report) {
      return res.status(404).json({ message: 'ImportReport not found.' });
    }
    if (!report.originalFileKey) {
      return res.status(404).json({ message: 'No file key found on this report.' });
    }
    // For example, if you stored the file at:
    //   s3://your-bucket-name/{userId}/{originalFileKey}
    // and the file is public or you generate a signed URL:
    const s3Url = `https://${process.env.IMPORTS_S3_BUCKET_NAME}.s3.amazonaws.com/${report.originalFileKey}`;

    // 301 or 302 redirect to the S3 file
    return res.redirect(s3Url);
  } catch (err) {
    console.error('Error downloading imported file:', err);
    return res.status(500).json({ message: 'Server error fetching file.' });
  }
};
