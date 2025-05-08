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

const { ensureAuthenticated } = require('../middleware/authMiddleware');
const { getMarginalTaxBracket } = require('../utils/taxBrackets');
const { uploadFile } = require('../utils/s3');

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
 * 1) Upload Handler
 * - Receives file from multer (in-memory)
 * - Uploads to S3 via uploadFile(file.buffer, file.originalname, userId)
 * - Immediately parses the file locally (from memory) to get headers
 * - Returns headers + S3 URL
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

    // 2) Construct a direct S3 URL from that key
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
      return res.status(400).json({
        message: 'The uploaded file appears to be empty.'
      });
    }

    const headers = rawData[0];
    if (!headers || headers.length === 0) {
      return res.status(400).json({ message: 'No headers found in the file.' });
    }

    return res.json({
      message: 'File uploaded successfully.',
      headers,
      tempFile: s3Url // We'll treat the S3 url as "tempFile"
    });
  } catch (err) {
    console.error('Error uploading contact file:', err);
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * 2) Process Handler (Mapping + Upsert) + Real-Time Progress
 *
 * If two rows in the same spreadsheet share the same `clientId`,
 * we import the first row and treat subsequent rows as duplicates.
 */
/**
 * 2) Process Handler (Mapping + Upsert) + Real-Time Progress
 *
 * If two rows in the same spreadsheet share the same `clientId`,
 * we import the first row and treat subsequent rows as duplicates.
 */
/**
 * 2) Process Handler (Mapping + Upsert) + Real-Time Progress
 *
 * If two rows in the same spreadsheet share the same `clientId`,
 * we import the first row and treat subsequent rows as duplicates.
 *
 * Now includes an estimated time calculation, so the front-end shows "X seconds left" or "X minutes Y seconds left."
 * It measures how many rows have been processed and how long it’s taken so far, then computes an estimated time remaining.
 */
exports.processContactImport = async (req, res) => {
    try {
      const { mapping, tempFile, nameMode } = req.body;
      
      // [DEBUG] Log the incoming data for validation
      console.log('DEBUG: processContactImport received body:', {
        mapping,
        tempFile,
        nameMode,
      });
  
      if (!tempFile || !mapping) {
        return res.status(400).json({ message: 'Missing file or mapping data.' });
      }
  
      // 1) Fetch & parse from S3
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
  
      // Keep track of clientIds we've imported
      const usedClientIds = new Set();
  
      // Retrieve socket.io, userRoom, totalRecords, etc.
      const io = req.app.locals.io;
      const userRoom = req.session.user._id;
      const totalRecords = rawData.length;
  
      // Time & chunk-based variables
      const startTime = Date.now();
      let processedCount = 0;
      let totalChunks = 0;
      let rollingAvgSecPerRow = 0.0;
      const CHUNK_SIZE = 50; // adjust as needed for performance
  
      // Process data in chunks for better performance & stable time estimates
      for (let chunkStart = 0; chunkStart < totalRecords; chunkStart += CHUNK_SIZE) {
        const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalRecords);
        const chunkSize = chunkEnd - chunkStart;
        const chunkStartTime = Date.now();
  
        // Process each row in this chunk
        for (let i = chunkStart; i < chunkEnd; i++) {
          const row = rawData[i];
          try {
            // Extract data from the row
            const rowObj = extractRowData(row, mapping, nameMode);
  
            // [DEBUG] Show extracted row data
            console.log(`DEBUG: Row ${i} extracted data:`, rowObj);
  
            // Basic validation
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
                  rowIndex: i
                });
              } else {
                usedClientIds.add(rowObj.clientId);
  
                // 1) Upsert Household
                let household = await Household.findOne({
                  userHouseholdId: rowObj.householdId,
                  firmId: req.session.user.firmId
                });
                if (!household) {
                  household = new Household({
                    userHouseholdId: rowObj.householdId,
                    firmId: req.session.user.firmId,
                    owner: req.session.user._id
                  });
                  await household.save();
                }
  
                // 2) Upsert Client
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
  
                // Partial updates
                client.firstName = rowObj.firstName || client.firstName;
                client.lastName = rowObj.lastName || client.lastName;
                if (typeof rowObj.middleName === 'string' && rowObj.middleName.trim()) {
                  client.middleName = rowObj.middleName.trim();
                }
                if (rowObj.dob) {
                  client.dob = rowObj.dob;
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
                if (rowObj.monthlyIncome !== null && rowObj.monthlyIncome !== '') {
                  const inc = parseFloat(rowObj.monthlyIncome);
                  if (!isNaN(inc)) {
                    client.monthlyIncome = inc;
                  }
                }
  
                // Lead Advisor
                if (rowObj.leadAdvisorFirstName) {
                  client.leadAdvisorFirstName = rowObj.leadAdvisorFirstName;
                }
                if (rowObj.leadAdvisorLastName) {
                  client.leadAdvisorLastName = rowObj.leadAdvisorLastName;
                }
  
                // [DEBUG] Show the updated lead advisor fields before save
                console.log('DEBUG: Pre-save leadAdvisor fields:', {
                  leadAdvisorFirstName: client.leadAdvisorFirstName,
                  leadAdvisorLastName: client.leadAdvisorLastName
                });
  
                // Now handle new vs updated
                if (isNewClient) {
                  // Brand new record
                  await client.save();
                  createdRecords.push({
                    clientId: client.clientId,
                    firstName: client.firstName,
                    lastName: client.lastName
                  });
                } else {
                  // We do this before saving to see what changed
                  const changes = client.modifiedPaths();
  
                  // [DEBUG] Show all raw changed fields
                  console.log('DEBUG: Mongoose modifiedPaths() =>', changes);
  
                  // Convert "leadAdvisorFirstName"/"leadAdvisorLastName" to a single "leadAdvisor"
                  let finalChanges = changes;
                  if (
                    changes.includes('leadAdvisorFirstName') ||
                    changes.includes('leadAdvisorLastName')
                  ) {
                    finalChanges = changes.map(path => {
                      if (path === 'leadAdvisorFirstName' || path === 'leadAdvisorLastName') {
                        return 'leadAdvisor';
                      }
                      return path;
                    });
                    // Remove duplicates if both were updated
                    finalChanges = [...new Set(finalChanges)];
                  }
  
                  await client.save();
  
                  // [DEBUG] Confirm post-save data
                  console.log('DEBUG: Updated client =>', {
                    clientId: client.clientId,
                    leadAdvisorFirstName: client.leadAdvisorFirstName,
                    leadAdvisorLastName: client.leadAdvisorLastName
                  });
  
                  updatedRecords.push({
                    clientId: client.clientId,
                    firstName: client.firstName,
                    lastName: client.lastName,
                    updatedFields: finalChanges
                  });
                }
              }
            }
          } catch (rowErr) {
            console.error('Row error:', rowErr);
            failedRecords.push({
              firstName: 'N/A',
              lastName: 'N/A',
              clientId: 'N/A',
              householdId: 'N/A',
              reason: rowErr.message
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
  
        // Recalculate time left based on updated rolling average
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
      } // end chunk loop
  
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
  
      return res.json({
        message: 'Processing complete',
        createdRecords,
        updatedRecords,
        failedRecords,
        duplicateRecords
      });
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
function extractRowData(row, mapping, nameMode) {
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
    lastName  = parsed.lastName;
  } else {
    firstName = getValue('firstName');
    lastName  = getValue('lastName');
  }

  const middleName      = getValue('middleName');
  const dobRaw          = getValue('dob');
  let dob = null;
  if (dobRaw) {
    const parsedDate = new Date(dobRaw);
    if (!isNaN(parsedDate.getTime())) {
      dob = parsedDate;
    }
  }
  const ssn             = getValue('ssn');
  const taxFilingStatus = getValue('taxFilingStatus');
  const maritalStatus   = getValue('maritalStatus');
  const mobileNumber    = getValue('mobileNumber');
  const homePhone       = getValue('homePhone');
  const email           = getValue('email');
  const homeAddress     = getValue('homeAddress');
  const deceasedLiving  = getValue('deceasedLiving');
  const monthlyIncome   = getValue('monthlyIncome');

  // Lead Advisor => parse single name
  const leadAdvisorRaw  = getValue('leadAdvisor');
  const parsedAdvisor   = parseSingleName(leadAdvisorRaw);

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
    leadAdvisorFirstName: parsedAdvisor.firstName,
    leadAdvisorLastName:  parsedAdvisor.lastName
  };
}
