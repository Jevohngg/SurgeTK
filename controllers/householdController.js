// controllers/householdController.js

const mongoose = require('mongoose');
const Household = require('../models/Household');
const Client = require('../models/Client');
const Account = require('../models/Account');
const Beneficiary = require('../models/Beneficiary');
const User = require('../models/User');

const { ensureAuthenticated } = require('../middleware/authMiddleware');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const crypto = require('crypto');
const { Table } = require('pdfkit-table');
const PDFDocument = require('pdfkit');
const axios = require('axios');
const { uploadFile } = require('../utils/s3');

const { getMarginalTaxBracket } = require('../utils/taxBrackets');
const CompanyID = require('../models/CompanyID');

const ImportReport = require('../models/ImportReport');

const ValueAdd = require('../models/ValueAdd');

const {
  validateGuardrailsInputs,
  calculateGuardrails
} = require('../services/valueadds/guardrailsService');

const {
  validateBucketsInputs,
  calculateBuckets
} = require('../services/valueadds/bucketsService');



exports.importHouseholds = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded.' });
        }

        const filePath = path.resolve(req.file.path);
        const userId = req.session.user._id.toString();

        // Read the file buffer
        const fileBuffer = fs.readFileSync(filePath);
        const originalName = req.file.originalname;

        // Upload the file to S3
        const s3Key = await uploadFile(fileBuffer, originalName, userId);

        // Clean up the uploaded file from the server
        fs.unlinkSync(filePath);

        // Proceed with processing the file
        const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

        // Extract headers from the first row
        const headers = data[0];
        if (!headers || headers.length === 0) {
            return res.status(400).json({ message: 'No headers found in the uploaded file.' });
        }

        // Store the remaining rows as uploaded data
        const uploadedData = data.slice(1);
        if (uploadedData.length === 0) {
            return res.status(400).json({ message: 'No data rows found in the uploaded file.' });
        }

        res.status(200).json({ headers, uploadedData, s3Key }); // Return s3Key to the frontend
    } catch (err) {
        console.error('Error processing file:', err);
        res.status(500).json({ message: 'Error processing file.', error: err.message });
    }
};


const { generatePreSignedUrl } = require('../utils/s3');


function splitMultiNameString(fullString) {
  if (!fullString || typeof fullString !== 'string') return [];

  // Normalize " and " => " & " for consistency
  let normalized = fullString.trim().replace(/\s+and\s+/gi, ' & ');

  // Now split by " & "
  const parts = normalized.split(/\s*&\s*/);

  // Trim each piece
  return parts.map((p) => p.trim()).filter(Boolean);
}

// (NEW) Utility function to parse "Last, First Middle" into { firstName, middleName, lastName }
function parseFullName(nameStr) {
  const result = { firstName: '', middleName: '', lastName: '' };

  if (!nameStr || typeof nameStr !== 'string') return result;

  const trimmed = nameStr.trim();

  // Check if there's a comma
  if (!trimmed.includes(',')) {
    // No comma => treat entire string as firstName
    result.firstName = trimmed;
    return result;
  }

  // Split on the comma
  const [last, rest] = trimmed.split(',', 2).map((s) => s.trim());
  result.lastName = last || '';

  // The "rest" might have 1 or 2 tokens => first / middle
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    result.firstName = tokens[0];
  } else if (tokens.length >= 2) {
    result.firstName = tokens[0];
    result.middleName = tokens.slice(1).join(' ');
  }

  return result;
}


// (NEW) Enhanced name parsing: handle "Doe John" (no comma), "Doe John & Jane", etc.
function enhancedParseFullName(nameStr) {
  // This function extends existing logic: 
  // - If we see a comma (e.g., "Doe, John Albert"), we keep old behavior 
  //   (middle name is only recognized if there's a comma).
  // - If no comma, we do "Doe John" => lastName="Doe", firstName="John".
  // - If no comma and 3 tokens => lastName = first token, firstName = the rest.
  // - We do NOT parse a middle name unless there's a comma.

  const result = { firstName: '', middleName: '', lastName: '' };
  if (!nameStr || typeof nameStr !== 'string') return result;

  const trimmed = nameStr.trim();
  if (trimmed.includes(',')) {
    // Keep existing logic
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
    // (NEW) No comma => "Doe John" => lastName="Doe", firstName="John"
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (tokens.length === 1) {
      // e.g. "John" => treat entire string as firstName, no lastName
      // (But you might also decide to treat it as lastName only if you prefer)
      // We'll keep the existing idea that if no comma and only 1 token => firstName
      result.firstName = tokens[0];
    } else {
      // e.g. "Doe John" => lastName="Doe", firstName="John"
      result.lastName = tokens[0];
      result.firstName = tokens.slice(1).join(' ');
    }
  }
  return result;
}

function enhancedSplitMultiNameString(fullString) {
  // Identical to old logic, but still normalizes " and " => " & "
  if (!fullString || typeof fullString !== 'string') return [];

  let normalized = fullString.trim().replace(/\s+and\s+/gi, ' & ');
  // Now split by " & "
  const parts = normalized.split(/\s*&\s*/);
  // Trim each piece
  return parts.map((p) => p.trim()).filter(Boolean);
}

exports.importHouseholdsWithMapping = async (req, res) => {
  const user = req.session.user;
  if (!user) {
    return res.status(401).json({ message: 'Not authorized' });
  }

  try {
    const { mapping, uploadedData, s3Key } = req.body;

    // ---------- Existing leadAdvisor fetch code ----------
    const firmAdvisors = await User.find({
      firmId: user.firmId,
      roles: { $in: ['leadAdvisor'] }
    }).select('firstName lastName _id').lean();

    function findAdvisors(advisorString) {
      if (!advisorString || typeof advisorString !== 'string') return [];
      const trimmed = advisorString.trim().toLowerCase();
      const lastFirstRegex = /^([^,]+),\s*(.+)$/;
      let matches = [];

      // Attempt "LastName, FirstName"
      const lastFirstMatch = trimmed.match(lastFirstRegex);
      if (lastFirstMatch) {
        const ln = lastFirstMatch[1].toLowerCase();
        const fn = lastFirstMatch[2].toLowerCase();
        matches = firmAdvisors.filter(a =>
          a.lastName && a.lastName.toLowerCase() === ln &&
          a.firstName && a.firstName.toLowerCase() === fn
        );
        if (matches.length > 0) return matches.map(m => m._id);
      }

      // Otherwise try just last name
      matches = firmAdvisors.filter(a =>
        a.lastName && a.lastName.toLowerCase() === trimmed
      );
      return matches.map(m => m._id);
    }

    // (We keep existing local definitions for parseFullName, etc.)
    // We'll just redirect them to our new enhanced parser.

    function enhancedApplyLastNameIfMissing(nameObjects) {
      if (!nameObjects.length) return nameObjects;
      const primaryLast = nameObjects[0].lastName;
      if (!primaryLast) return nameObjects; // can't fill if primary doesn't have it
      for (let i = 1; i < nameObjects.length; i++) {
        if (!nameObjects[i].lastName) {
          nameObjects[i].lastName = primaryLast;
        }
      }
      return nameObjects;
    }

    if (!s3Key) {
      console.error('S3 Key is missing.');
      return res.status(400).json({ message: 'S3 Key is required for import.' });
    }

    if (!uploadedData || uploadedData.length === 0) {
      console.error('No uploaded data available.');
      return res.status(400).json({ message: 'No uploaded data available.' });
    }

    if (!mapping || Object.keys(mapping).length === 0) {
      console.error('No mapping provided.');
      return res.status(400).json({ message: 'No mapping provided.' });
    }

    // Normalize mapping
    const normalizedMapping = {};
    for (const key in mapping) {
      const normalizedKey = key.replace('mapping[', '').replace(']', '');
      normalizedMapping[normalizedKey] = mapping[key];
    }

    const totalRecords = uploadedData.length;
    let processedRecords = 0;
    const createdRecords = [];
    const updatedRecords = [];
    const failedRecords = [];
    const duplicateRecords = [];
    const io = req.app.locals.io;
    const userId = user._id.toString();
    const progressMap = req.app.locals.importProgress;
    const startTime = Date.now();
    const uniqueRecordsMap = new Map();
    const userHouseholdIdToHouseholdMap = new Map();

    function parseExcelDate(serial) {
      if (typeof serial !== 'number') return null;
      return new Date((serial - 25569) * 86400 * 1000);
    }

    function normalizeString(value, toLowerCase = false) {
      if (value === null || value === undefined) return '';
      let str = String(value).trim();
      return toLowerCase ? str.toLowerCase() : str;
    }

    function areStringsEqual(str1, str2) {
      return normalizeString(str1, true) === normalizeString(str2, true);
    }

    function areDatesEqual(date1, date2) {
      if (!date1 && !date2) return true;
      if (!date1 || !date2) return false;
      return date1.getTime() === date2.getTime();
    }

    function generateHouseholdId() {
      const timestamp = Date.now().toString(36);
      const randomStr = Math.random().toString(36).substr(2, 5).toUpperCase();
      return `HH-${timestamp}-${randomStr}`;
    }

    function normalizeTaxFilingStatus(status) {
      if (!status) return '';
      const s = status.trim().toLowerCase();
      switch (s) {
        case 'married filing jointly':
          return 'Married Filing Jointly';
        case 'married filing separately':
          return 'Married Filing Separately';
        case 'single':
          return 'Single';
        case 'head of household':
          return 'Head of Household';
        case 'qualifying widower':
          return 'Qualifying Widower';
        default:
          return s;
      }
    }

    // (UPDATED) If no marital status is provided, we leave it blank ('') instead of 'Single'
    function normalizeMaritalStatus(status) {
      if (!status) return '';  // Return empty if none declared
      const s = status.trim().toLowerCase();
      switch (s) {
        case 'married':
          return 'Married';
        case 'single':
          return 'Single';
        case 'widowed':
          return 'Widowed';
        case 'divorced':
          return 'Divorced';
        default:
          return s; // fallback is the raw value in case user typed something else
      }
    }

    function updateProgress() {
      const percentage = Math.round((processedRecords / totalRecords) * 100);
      const elapsedTime = (Date.now() - startTime) / 1000;
      const timePerRecord = elapsedTime / processedRecords;
      const remainingRecords = totalRecords - processedRecords;
      const estimatedTime = remainingRecords > 0
        ? `${Math.round(timePerRecord * remainingRecords)} seconds`
        : 'Completed';

      progressMap.set(userId, {
        totalRecords,
        createdRecords: createdRecords.length,
        updatedRecords: updatedRecords.length,
        failedRecords: failedRecords.length,
        duplicateRecords: duplicateRecords.length,
        percentage,
        estimatedTime,
        currentRecord: null,
        status: 'in-progress',
        createdRecordsData: createdRecords,
        updatedRecordsData: updatedRecords,
        failedRecordsData: failedRecords,
        duplicateRecordsData: duplicateRecords
      });
      io.to(userId).emit('importProgress', progressMap.get(userId));
    }

    // --------------------------
    // Loop over each row
    // --------------------------
    for (const row of uploadedData) {
      try {
        // Extract mapped columns (if any)
        const fullNameKey = normalizedMapping['Client Full Name'];
        const firstNameKey = normalizedMapping['Client First'];
        const middleNameKey = normalizedMapping['Client Middle'];
        const lastNameKey = normalizedMapping['Client Last'];

        // Shared fields for this row
        let sharedHouseholdFields = {
          dob: normalizedMapping['DOB'] !== undefined ? row[normalizedMapping['DOB']] : null,
          ssn: normalizedMapping['SSN'] !== undefined ? row[normalizedMapping['SSN']] : null,
          taxFilingStatus: normalizedMapping['Tax Filing Status'] !== undefined ? row[normalizedMapping['Tax Filing Status']] : null,
          mobileNumber: normalizedMapping['Mobile'] !== undefined ? row[normalizedMapping['Mobile']] : null,
          homePhone: normalizedMapping['Home'] !== undefined ? row[normalizedMapping['Home']] : null,
          email: normalizedMapping['Email'] !== undefined ? row[normalizedMapping['Email']] : null,
          homeAddress: normalizedMapping['Home Address'] !== undefined ? row[normalizedMapping['Home Address']] : null,
          maritalStatus: normalizedMapping['Marital Status'] !== undefined ? row[normalizedMapping['Marital Status']] : null,
          userHouseholdId: normalizedMapping['Household ID'] !== undefined ? row[normalizedMapping['Household ID']] : null,
        };

        // Build nameObjects from either FullName or separate columns
        let nameObjects = [];
        if (
          fullNameKey !== undefined &&
          fullNameKey !== null &&
          fullNameKey !== 'None'
        ) {
          const rawFullName = row[fullNameKey] || '';
          // (NEW) use enhancedSplitMultiNameString + enhancedParseFullName
          const subNames = enhancedSplitMultiNameString(rawFullName);
          nameObjects = subNames
            .map(enhancedParseFullName)
            .filter(n => n.firstName || n.lastName);

          // Fill missing last name for subsequent if the first has it
          nameObjects = enhancedApplyLastNameIfMissing(nameObjects);
        } else {
          // use first/last
          const fName = firstNameKey !== undefined ? row[firstNameKey] : null;
          const mName = middleNameKey !== undefined ? row[middleNameKey] : null;
          const lName = lastNameKey !== undefined ? row[lastNameKey] : null;
          if (fName || lName) {
            nameObjects = [{
              firstName: fName || '',
              middleName: mName || '',
              lastName: lName || ''
            }];
          }
        }
        console.log('[DEBUG] Row data =>', { row, fullNameKey, firstNameKey, lastNameKey, nameObjects });


        if (!nameObjects.length) {
          console.error('[DEBUG] Could not parse name data. Full row =>', row);
          console.error('[DEBUG] current mappings =>', {
            fullNameKey,
            firstNameKey,
            middleNameKey,
            lastNameKey
          });
          failedRecords.push({
            firstName: 'N/A',
            lastName: 'N/A',
            reason: 'Missing name data.'
          });
          processedRecords++;
          updateProgress();
          continue;
        }

        // We'll handle each nameObject in the same household
        const primaryNameObj = nameObjects[0];

        if (!primaryNameObj.firstName && !primaryNameObj.lastName) {
          failedRecords.push({
            firstName: 'N/A',
            lastName: 'N/A',
            reason: 'Missing name data for primary client.'
          });
          processedRecords++;
          updateProgress();
          continue;
        }

        // Combine the primary name with shared fields for validation
        const householdData = {
          ...sharedHouseholdFields,
          firstName: primaryNameObj.firstName,
          middleName: primaryNameObj.middleName,
          lastName: primaryNameObj.lastName,
        };

        // Check required
        const requiredFields = ['firstName', 'lastName'];
        const missing = requiredFields.filter(field => !householdData[field]);
        if (missing.length > 0) {
          failedRecords.push({
            firstName: householdData.firstName || 'N/A',
            lastName: householdData.lastName || 'N/A',
            reason: `Missing fields: ${missing.join(', ')}`
          });
          processedRecords++;
          updateProgress();
          continue;
        }

        // Attempt to assign leadAdvisors
        let assignedAdvisors = [];
        if (normalizedMapping['leadAdvisors'] !== undefined) {
          const advisorValue = row[normalizedMapping['leadAdvisors']];
          if (advisorValue) {
            const matchedAdvisors = findAdvisors(advisorValue);
            if (matchedAdvisors.length > 0) {
              assignedAdvisors = matchedAdvisors;
            }
          }
        }

        // Normalize certain fields
        if (householdData.taxFilingStatus) {
          householdData.taxFilingStatus = normalizeTaxFilingStatus(householdData.taxFilingStatus);
        }
        if (householdData.maritalStatus) {
          householdData.maritalStatus = normalizeMaritalStatus(householdData.maritalStatus);
        }

        // Basic duplicate detection (for the primary name)
        const uniqueString = JSON.stringify({
          firstName: normalizeString(householdData.firstName, true),
          lastName: normalizeString(householdData.lastName, true),
        });
        const hash = crypto.createHash('sha256').update(uniqueString).digest('hex');
        if (uniqueRecordsMap.has(hash)) {
          duplicateRecords.push({
            firstName: householdData.firstName,
            lastName: householdData.lastName,
            reason: 'Duplicate record in uploaded data.'
          });
          processedRecords++;
          updateProgress();
          continue;
        } else {
          uniqueRecordsMap.set(hash, householdData);
        }

        // Attempt to find existing client
        const firstNameNormalized = normalizeString(householdData.firstName, true);
        const lastNameNormalized = normalizeString(householdData.lastName, true);
        const matchingCriteria = {
          firstName: { $regex: `^${firstNameNormalized}$`, $options: 'i' },
          lastName: { $regex: `^${lastNameNormalized}$`, $options: 'i' },
        };
        const matchingClients = await Client.find(matchingCriteria).populate('household');
        const userMatchingClients = matchingClients.filter(client => {
          return client.household &&
                 client.household.owner.equals(user._id) &&
                 client.household.firmId.equals(user.firmId);
        });

        let targetHousehold = null;

        // Decide if we need to create or update household
        if (userMatchingClients.length === 0) {
          // No client found => create new Household
          const userHouseholdId = householdData.userHouseholdId
            ? householdData.userHouseholdId.trim()
            : null;

          let newHousehold = null;
          if (userHouseholdId) {
            if (userHouseholdIdToHouseholdMap.has(userHouseholdId)) {
              newHousehold = userHouseholdIdToHouseholdMap.get(userHouseholdId);
            } else {
              const existingHousehold = await Household.findOne({
                owner: user._id,
                firmId: user.firmId,
                userHouseholdId: userHouseholdId
              });
              if (existingHousehold) {
                newHousehold = existingHousehold;
              } else {
                newHousehold = new Household({
                  householdId: generateHouseholdId(),
                  totalAccountValue: 0,
                  owner: user._id,
                  firmId: user.firmId,
                  userHouseholdId: userHouseholdId
                });
                await newHousehold.save();
              }
              userHouseholdIdToHouseholdMap.set(userHouseholdId, newHousehold);
            }
          } else {
            newHousehold = new Household({
              householdId: generateHouseholdId(),
              totalAccountValue: 0,
              owner: user._id,
              firmId: user.firmId
            });
            await newHousehold.save();
          }

          targetHousehold = newHousehold;

        } else if (userMatchingClients.length === 1) {
          // Single existing client => we use that Household
          targetHousehold = userMatchingClients[0].household;
        } else {
          // Multiple => fail
          failedRecords.push({
            firstName: householdData.firstName || 'N/A',
            lastName: householdData.lastName || 'N/A',
            reason: 'Multiple matching clients with same first/last. Manual resolution required.'
          });
          processedRecords++;
          updateProgress();
          continue;
        }

        if (!targetHousehold) {
          // Should never happen if logic above is correct
          failedRecords.push({
            firstName: householdData.firstName,
            lastName: householdData.lastName,
            reason: 'No valid household found or created.'
          });
          processedRecords++;
          updateProgress();
          continue;
        }

        // Now handle nameObjects
        let householdClients = await Client.find({ household: targetHousehold._id });
        let headAlreadySet = !!targetHousehold.headOfHousehold;

        for (let i = 0; i < nameObjects.length; i++) {
          const nObj = nameObjects[i];
          const clientData = {
            firmId: user.firmId,
            firstName: nObj.firstName || '',
            middleName: nObj.middleName || '',
            lastName: nObj.lastName || '',
            dob: sharedHouseholdFields.dob
              ? (typeof sharedHouseholdFields.dob === 'number'
                ? parseExcelDate(sharedHouseholdFields.dob)
                : new Date(sharedHouseholdFields.dob))
              : null,
            ssn: sharedHouseholdFields.ssn,
            taxFilingStatus: sharedHouseholdFields.taxFilingStatus,
            maritalStatus: sharedHouseholdFields.maritalStatus,
            mobileNumber: sharedHouseholdFields.mobileNumber,
            homePhone: sharedHouseholdFields.homePhone,
            email: sharedHouseholdFields.email,
            homeAddress: sharedHouseholdFields.homeAddress,
            household: targetHousehold._id,
          };

          const cFirst = normalizeString(clientData.firstName, true);
          const cLast = normalizeString(clientData.lastName, true);

          let existingClient = householdClients.find(c => {
            return (
              normalizeString(c.firstName, true) === cFirst &&
              normalizeString(c.lastName, true) === cLast
            );
          });

          if (!existingClient) {
            // Create new client
            const newClient = new Client(clientData);
            await newClient.save();
            if (!headAlreadySet) {
              targetHousehold.headOfHousehold = newClient._id;
              headAlreadySet = true;
            }
            await targetHousehold.save();

            createdRecords.push({
              firstName: newClient.firstName,
              lastName: newClient.lastName
            });

            householdClients.push(newClient);
          } else {
            // Update existing client
            let updatedFieldNames = [];
            let isClientUpdated = false;

            const fieldsToCheck = [
              'middleName', 'dob', 'ssn', 'taxFilingStatus', 'maritalStatus',
              'mobileNumber', 'homePhone', 'email', 'homeAddress'
            ];

            for (const field of fieldsToCheck) {
              const oldVal = existingClient[field];
              const newVal = clientData[field];

              if (field === 'dob') {
                if (!areDatesEqual(oldVal, newVal)) {
                  existingClient[field] = newVal;
                  updatedFieldNames.push(field);
                  isClientUpdated = true;
                }
              } else if (typeof newVal === 'string') {
                const oldNorm = normalizeString(oldVal, true);
                const newNorm = normalizeString(newVal, true);
                if (oldNorm !== newNorm) {
                  existingClient[field] = newVal;
                  updatedFieldNames.push(field);
                  isClientUpdated = true;
                }
              } else {
                if (String(oldVal) !== String(newVal)) {
                  existingClient[field] = newVal;
                  updatedFieldNames.push(field);
                  isClientUpdated = true;
                }
              }
            }

            if (isClientUpdated) {
              await existingClient.save();

              updatedRecords.push({
                firstName: existingClient.firstName,
                lastName: existingClient.lastName,
                updatedFields: updatedFieldNames
              });
            }
          }
        }

        if (assignedAdvisors.length > 0) {
          targetHousehold.leadAdvisors = assignedAdvisors;
          await targetHousehold.save();
        }

        if (!targetHousehold.headOfHousehold && householdClients.length) {
          targetHousehold.headOfHousehold = householdClients[0]._id;
          await targetHousehold.save();
        }

        processedRecords++;
        const percentage = Math.round((processedRecords / totalRecords) * 100);
        const elapsedTime = (Date.now() - startTime) / 1000;
        const timePerRecord = elapsedTime / processedRecords;
        const remainingRecords = totalRecords - processedRecords;
        const estimatedTime = remainingRecords > 0
          ? `${Math.round(timePerRecord * remainingRecords)} seconds`
          : 'Completed';

        progressMap.set(userId, {
          totalRecords,
          createdRecords: createdRecords.length,
          updatedRecords: updatedRecords.length,
          failedRecords: failedRecords.length,
          duplicateRecords: duplicateRecords.length,
          percentage,
          estimatedTime,
          currentRecord: {
            firstName: householdData.firstName,
            lastName: householdData.lastName
          },
          status: 'in-progress',
          createdRecordsData: createdRecords,
          updatedRecordsData: updatedRecords,
          failedRecordsData: failedRecords,
          duplicateRecordsData: duplicateRecords
        });
        io.to(userId).emit('importProgress', progressMap.get(userId));

      } catch (error) {
        console.error('Error processing row:', row, error);
        failedRecords.push({
          firstName: 'N/A',
          lastName: 'N/A',
          reason: error.message
        });
        processedRecords++;
        updateProgress();
      }
    }

    // After processing all records, save ImportReport
    try {
      const importReport = new ImportReport({
        user: user._id,
        importType: 'Household Data Import',
        createdRecords,
        updatedRecords,
        failedRecords,
        duplicateRecords,
        originalFileKey: s3Key
      });

      await importReport.save();

      progressMap.set(userId, {
        totalRecords,
        createdRecords: createdRecords.length,
        updatedRecords: updatedRecords.length,
        failedRecords: failedRecords.length,
        duplicateRecords: duplicateRecords.length,
        percentage: 100,
        estimatedTime: 'Completed',
        currentRecord: null,
        status: 'completed',
        createdRecordsData: createdRecords,
        updatedRecordsData: updatedRecords,
        failedRecordsData: failedRecords,
        duplicateRecordsData: duplicateRecords,
        importReportId: importReport._id.toString()
      });

      io.to(userId).emit('importComplete', progressMap.get(userId));
      io.to(userId).emit('newImportReport', {
        _id: importReport._id,
        importType: importReport.importType,
        createdAt: importReport.createdAt
      });

      res.status(200).json({
        message: 'Import process completed.',
        importReportId: importReport._id,
      });
    } catch (error) {
      console.error('Error saving ImportReport:', error);
      progressMap.set(userId, {
        totalRecords,
        createdRecords: createdRecords.length,
        updatedRecords: updatedRecords.length,
        failedRecords: failedRecords.length,
        duplicateRecords: duplicateRecords.length,
        percentage: 100,
        estimatedTime: 'Completed with errors',
        currentRecord: null,
        status: 'completed',
        createdRecordsData: createdRecords,
        updatedRecordsData: updatedRecords,
        failedRecordsData: failedRecords,
        duplicateRecordsData: duplicateRecords
      });
      io.to(userId).emit('importComplete', progressMap.get(userId));
      res.status(500).json({
        message: 'Error saving ImportReport.',
        error: error.message,
      });
    }

  } catch (error) {
    console.error('Error in importHouseholdsWithMapping:', error);
    res.status(500).json({
      message: 'An unexpected error occurred during the import process.',
      error: error.message
    });
  }
};
  


// Utility function to normalize strings (trim and optionally lowercase)
function normalizeString(value, toLowerCase = false) {
    if (value === null || value === undefined) return '';
    let str = String(value).trim();
    return toLowerCase ? str.toLowerCase() : str;
}

// Utility function to parse Excel serial dates to JavaScript Date objects
function parseExcelDate(serial) {
    if (typeof serial !== 'number') return null;
    // Excel's epoch starts on 1899-12-30
    return new Date((serial - 25569) * 86400 * 1000);
}

// Utility function to compare two dates (ignoring time)
function areDatesEqual(date1, date2) {
    if (!date1 && !date2) return true;
    if (!date1 || !date2) return false;
    return date1.getTime() === date2.getTime();
}

// Utility function to compare two strings after normalization
function areStringsEqual(str1, str2) {
    return normalizeString(str1, true) === normalizeString(str2, true);
}



function safeString(value, toLowerCase = false) {
    if (value === null || value === undefined) return '';
    let str = String(value).trim();
    return toLowerCase ? str.toLowerCase() : str;
}




// Utility function to generate a unique householdId
const generateHouseholdId = () => {
    const timestamp = Date.now().toString(36);
    const randomStr = Math.random().toString(36).substr(2, 5).toUpperCase();
    return `HH-${timestamp}-${randomStr}`;
};


// GET /households - Render Households Page
exports.getHouseholdsPage = async (req, res) => {
    const user = req.session.user;
    const companyData = await CompanyID.findOne({ companyId: user.companyId });

    if (!user) {
        return res.redirect('/login');
    }

    try {
        const query = { firmId: user.firmId };

        // Populate leadAdvisors so that we have their name and avatar
        const households = await Household.find(query)
            .populate('leadAdvisors', 'name avatar')
            .populate('headOfHousehold') // In case we need HOH for naming
            .lean();

       

        if (households.length === 0) {
            console.log('No households found for this firm.');
        }

        for (let hh of households) {
           

            const clients = await Client.find({ household: hh._id }).lean({ virtuals: true });
        

            let computedName = '---';
            if (clients && clients.length > 0) {
                const hoh = clients[0];
                const lastName = hoh.lastName || '';
                const firstName = hoh.firstName || '';

            

                if (clients.length === 1) {
                    computedName = `${lastName}, ${firstName}`;
             
                } else if (clients.length === 2) {
                    const secondClient = clients[1];
                    const secondLastName = secondClient.lastName || '';
                    const secondFirstName = secondClient.firstName || '';

                   

                    if (lastName.toLowerCase() === secondLastName.toLowerCase()) {
                        computedName = `${lastName}, ${firstName} & ${secondFirstName}`;
                    
                    } else {
                        computedName = `${lastName}, ${firstName}`;
                      
                    }
                } else {
                    // More than two members, fallback to HOH
                    computedName = `${lastName}, ${firstName}`;
             
                }
            } else {
              
            }

            hh.headOfHouseholdName = computedName;
          
        }
      

        res.render('households', {
            user: user,
            companyData,
            avatar: user.avatar,
            households: households,
        });
    } catch (error) {
        console.error('Error fetching households:', error);
        res.render('households', {
            user: user,
            companyData,
            avatar: user.avatar,
            households: [],
        });
    }
};



// GET /households
exports.getHouseholds = async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ message: 'User not authenticated.' });
    }

    try {
        const user = req.session.user;

        console.log(`[DEBUG] getHouseholds route called. User ID: ${user._id}`);
        console.log(`[DEBUG] Query params => `, req.query);

        // ------------------------------------------------------
        // NEW: Parse selectedAdvisors from req.query
        // ------------------------------------------------------
        let {
            page = '1',
            limit = '10',
            search = '',
            sortField = 'headOfHouseholdName',
            sortOrder = 'asc',
            selectedAdvisors = '',  // <-- The new query param
        } = req.query;

        // Handle 'limit=all'
        if (limit === 'all') {
            limit = 0;
            page = 1;
        } else {
            limit = parseInt(limit, 10);
            page = parseInt(page, 10);
            if (isNaN(limit) || limit < 1) limit = 10;
            if (isNaN(page) || page < 1) page = 1;
        }

        const skip = (page - 1) * limit;
        const sortDirection = sortOrder === 'asc' ? 1 : -1;

        // Convert the user’s firmId to an ObjectId
        const firmIdObject = new mongoose.Types.ObjectId(user.firmId);

        // Start building a match object for the pipeline
        let match = { firmId: firmIdObject };

        // ------------------------------------------------------
        // STEP 1: Convert selectedAdvisors into an array, e.g.
        // "unassigned,123" => ["unassigned","123"]
        // "all" => ["all"], or it might be empty => []
        // ------------------------------------------------------
        const advisorArr = selectedAdvisors ? selectedAdvisors.split(',') : [];

        // ------------------------------------------------------
        // STEP 2: If NOT 'all' and array is non-empty, add logic
        // ------------------------------------------------------
        if (!advisorArr.includes('all') && advisorArr.length > 0) {
            const hasUnassigned = advisorArr.includes('unassigned');
            // Filter out 'unassigned' so the rest are real leadAdvisor IDs
            const realAdvisorIds = advisorArr.filter(id => id !== 'unassigned');

            if (hasUnassigned && realAdvisorIds.length > 0) {
                // e.g. user wants unassigned AND leadAdvisors 123, 456
                // So: leadAdvisors in [123,456] OR no leadAdvisors assigned
                match.$or = [
                    { leadAdvisors: { $in: realAdvisorIds.map(id => new mongoose.Types.ObjectId(id)) } },
                    { leadAdvisors: { $size: 0 } }
                ];
            } else if (hasUnassigned) {
                // user wants only unassigned
                match.leadAdvisors = { $size: 0 };
            } else {
                // user wants only real leadAdvisor IDs
                match.leadAdvisors = {
                    $in: realAdvisorIds.map(id => new mongoose.Types.ObjectId(id))
                };
            }
        }

        // ------------------------------------------------------
        // Build the pipeline
        // ------------------------------------------------------
        const initialPipeline = [
            // Match by firmId, and possibly filter by leadAdvisors
            { $match: match },

            // Lookup the head of household from 'clients'
            {
                $lookup: {
                    from: 'clients',
                    localField: 'headOfHousehold',
                    foreignField: '_id',
                    as: 'headOfHousehold',
                },
            },
            {
                $unwind: {
                    path: '$headOfHousehold',
                    preserveNullAndEmptyArrays: true
                }
            },
            // Lookup the leadAdvisors from 'users'
            {
                $lookup: {
                    from: 'users',
                    localField: 'leadAdvisors',
                    foreignField: '_id',
                    as: 'leadAdvisors'
                }
            },
            // Create or refine headOfHouseholdName
            {
                $addFields: {
                    headOfHouseholdName: {
                        $cond: {
                            if: { $ifNull: ['$headOfHousehold', false] },
                            then: { $concat: ['$headOfHousehold.lastName', ', ', '$headOfHousehold.firstName'] },
                            else: 'No Head of Household Assigned'
                        }
                    }
                }
            }
        ];

        // If user searches by first/last name
        if (search) {
            const [lastNameSearch, firstNameSearch] = search.split(',').map(s => s.trim());
            if (firstNameSearch) {
                initialPipeline.push({
                    $match: {
                        'headOfHousehold.firstName': { $regex: firstNameSearch, $options: 'i' },
                        'headOfHousehold.lastName': { $regex: lastNameSearch, $options: 'i' },
                    },
                });
            } else {
                initialPipeline.push({
                    $match: {
                        $or: [
                            { 'headOfHousehold.firstName': { $regex: lastNameSearch, $options: 'i' } },
                            { 'headOfHousehold.lastName': { $regex: lastNameSearch, $options: 'i' } },
                        ],
                    },
                });
            }
        }

        // Sorting logic
        let sortStage;
        if (sortField === 'headOfHouseholdName') {
            sortStage = { $sort: { headOfHouseholdName: sortDirection } };
        } else if (sortField === 'totalAccountValue') {
            sortStage = { $sort: { totalAccountValue: sortDirection } };
        } else {
            // Default fallback
            sortStage = { $sort: { headOfHouseholdName: 1 } };
        }
        initialPipeline.push(sortStage);

        // Facet pipeline for pagination
        const facetPipeline = [
            {
                $facet: {
                    households: limit > 0 ? [{ $skip: skip }, { $limit: limit }] : [],
                    totalCount: [{ $count: 'total' }],
                },
            },
        ];

        // If limit=0 ("all" records), remove skip/limit
        if (limit === 0) {
            facetPipeline[0].$facet.households = [];
        }

        // Combine
        const pipeline = initialPipeline.concat(facetPipeline);
        const results = await Household.aggregate(pipeline);

        console.log('[DEBUG] Aggregate pipeline results =>', JSON.stringify(results, null, 2));

        // If no results
        if (!results || results.length === 0) {
          console.log('[DEBUG] No results returned from the pipeline.');
            return res.json({ households: [], currentPage: page, totalPages: 0, totalHouseholds: 0 });
        }

        // Houses from facet
        const households = results[0].households;
        const total = results[0].totalCount.length > 0 ? results[0].totalCount[0].total : 0;
        const totalPages = limit === 0 ? 1 : Math.ceil(total / limit);

        // ========== ADD THIS LOOP TO SUM accountValue ==========
    for (let hh of households) {
        const accounts = await Account.find({ household: hh._id }).lean();
        let sum = 0;
        for (let acct of accounts) {
          sum += acct.accountValue || 0;
        }
        hh.totalAccountValue = sum;
      }
      // =======================================================

        // Recompute multi-member name logic
        for (let hh of households) {
            const clients = await Client.find({ household: hh._id }).lean({ virtuals: true });

            hh.clients = clients.map(c => ({
              _id: c._id,
              firstName: c.firstName,
              lastName: c.lastName,
              dob: c.dob,    // or c.formattedDOB if you prefer the formatted date
              age: c.age     // <--- the virtual "age"
            }));
              
            let computedName = '---';
            if (clients && clients.length > 0) {
                const hoh = clients[0];
                const lastName = hoh.lastName || '';
                const firstName = hoh.firstName || '';

                if (clients.length === 1) {
                    computedName = `${lastName}, ${firstName}`;
                } else if (clients.length === 2) {
                    const secondClient = clients[1];
                    const secondLastName = secondClient.lastName || '';
                    const secondFirstName = secondClient.firstName || '';
                    if (lastName.toLowerCase() === secondLastName.toLowerCase()) {
                        computedName = `${lastName}, ${firstName} & ${secondFirstName}`;
                    } else {
                        computedName = `${lastName}, ${firstName}`;
                    }
                } else {
                    // More than two
                    computedName = `${lastName}, ${firstName}`;
                }
            }
            hh.headOfHouseholdName = computedName;
        }

        // Format leadAdvisors
        const formattedHouseholds = households.map(hh => {
            const leadAdvisors = hh.leadAdvisors || [];
            const formattedAdvisors = leadAdvisors.map(a => ({
                name: a.name,
                avatar: a.avatar
            }));

            return {
                _id: hh._id,
                householdId: hh.householdId,
                headOfHouseholdName: hh.headOfHouseholdName,
                totalAccountValue: hh.totalAccountValue
                    ? hh.totalAccountValue.toFixed(2)
                    : '0.00',
                leadAdvisors: formattedAdvisors,
                redtailFamilyId: hh.redtailFamilyId,
            };
        });

        res.json({
            households: formattedHouseholds,
            currentPage: page,
            totalPages: totalPages,
            totalHouseholds: total,
        });
    } catch (err) {
        console.error('Error fetching households:', err);
        res.status(500).json({ message: 'Server error' });
    }
};



  


  exports.createHousehold = async (req, res) => {
    try {
      const {
        firstName,
        lastName,
        dob,
        ssn,
        taxFilingStatus,
        maritalStatus,
        mobileNumber,
        homePhone,
        email,
        homeAddress,
        additionalMembers,
      } = req.body;
  
      if (!firstName || !lastName) {
        return res.status(400).json({ message: 'First Name and Last Name are required.' });
      }
  
      const user = req.session.user;
      const household = new Household({
        owner: user._id,
        firmId: user.firmId,
      });
      await household.save();
  
      const validHeadDob = dob && dob.trim() !== '' && Date.parse(dob) ? new Date(dob) : null;
      const headOfHousehold = new Client({
        household: household._id,
        firmId: user.firmId,
        firstName,
        lastName,
        dob: validHeadDob,
        ssn: ssn || null,
        taxFilingStatus: taxFilingStatus || null,
        maritalStatus: maritalStatus || null,
        mobileNumber: mobileNumber || null,
        homePhone: homePhone || null,
        email: email || null,
        homeAddress: homeAddress || null,
      });
      await headOfHousehold.save();
  
      // Parse leadAdvisors from request
      let leadAdvisors = req.body.leadAdvisors;
      // If leadAdvisors is a comma-separated string, convert it to an array
      if (typeof leadAdvisors === 'string') {
        leadAdvisors = leadAdvisors.split(',').map(id => id.trim()).filter(Boolean);
      }
  
      if (!leadAdvisors || !Array.isArray(leadAdvisors)) {
        leadAdvisors = [];
      }
  
      // If user is an leadAdvisor and no leadAdvisors are selected, assign the creator by default
      if (Array.isArray(user.roles) && user.roles.includes('leadAdvisor') && leadAdvisors.length === 0) {
        leadAdvisors.push(user._id);
        console.log(`No leadAdvisors selected; defaulting to creator (User ID: ${user._id}) as leadAdvisor.`);
      }
  
      // Validate leadAdvisors
      if (leadAdvisors.length > 0) {
        const validAdvisors = await User.find({
          _id: { $in: leadAdvisors }, // Let Mongoose handle casting of strings to ObjectId
          firmId: user.firmId,
          roles: { $in: ['leadAdvisor'] }
        }).select('_id');
  
        const validAdvisorIds = validAdvisors.map(v => v._id);
        console.log('Received leadAdvisor IDs from form:', leadAdvisors);
        console.log('Valid leadAdvisors confirmed from DB:', validAdvisorIds);
  
        household.leadAdvisors = validAdvisorIds;
      } else {
        console.log('No leadAdvisors assigned to this household.');
        household.leadAdvisors = [];
      }
  
      await household.save();
      console.log('Household leadAdvisors after saving:', household.leadAdvisors);
  
      household.headOfHousehold = headOfHousehold._id;
      await household.save();
  
      const additionalMemberIds = [];
      if (Array.isArray(additionalMembers)) {
        for (const memberData of additionalMembers) {
          if (memberData.firstName && memberData.lastName) {
            const validMemberDob =
              memberData.dob && memberData.dob.trim() !== '' && Date.parse(memberData.dob)
                ? new Date(memberData.dob)
                : null;
  
            const member = new Client({
              household: household._id,
              firmId: user.firmId,
              firstName: memberData.firstName,
              lastName: memberData.lastName,
              dob: validMemberDob,
              ssn: memberData.ssn || null,
              taxFilingStatus: memberData.taxFilingStatus || null,
              mobileNumber: memberData.mobileNumber || null,
              email: memberData.email || null,
              homeAddress: memberData.homeAddress || null,
            });
            await member.save();
            additionalMemberIds.push(member.clientId);
          }
        }
      }
  
      res.status(201).json({
        message: 'Household created successfully.',
        householdId: household.householdId,
        headOfHouseholdId: headOfHousehold.clientId,
        additionalMemberIds,
      });
    } catch (err) {
      console.error('Error creating household:', err);
      res.status(500).json({ message: 'Error creating household.', error: err.message });
    }
  };
  
  
  
  
  const { getHouseholdTotals } = require('../services/householdUtils');



  exports.getHouseholdById = async (req, res) => {
    try {
        const user = req.session.user;
        const { id } = req.params;

        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid Household ID format.' });
        }

        // Fetch the household by ID and firmId to ensure it's in the same firm
        const household = await Household.findOne({
            _id: id,
            firmId: user.firmId, // Ensure the household belongs to the user's firm
        })
        .populate('headOfHousehold')
        .lean();

        if (!household) {
            return res.status(404).json({ message: 'Household not found or does not belong to this firm.' });
        }

        // Fetch all clients linked to the household
        const clients = await Client.find({ household: household._id }).lean({ virtuals: true });

        res.json({ household, clients }); // Return household data and linked clients
    } catch (err) {
        console.error('Error fetching household:', err);
        res.status(500).json({ message: 'Server error' });
    }
};



exports.renderHouseholdDetailsPage = async (req, res) => {
  try {
      const { id } = req.params;

      console.log('--- renderHouseholdDetailsPage START ---');
      console.log(`Household ID param: ${id}`);

      // ---------------------------------------------------------------------
      // NEW LINES: Determine which tab is active based on the URL path
      // ---------------------------------------------------------------------
      let activeTab = 'client-info';
      if (req.path.endsWith('/assets')) {
        activeTab = 'assets';
      } else if (req.path.endsWith('/value-adds')) {
        activeTab = 'value-adds';
      }
      // ---------------------------------------------------------------------

      // Helper functions
      function formatDate(dateString) {
          if (!dateString) return '---';
          const date = new Date(dateString);
          if (isNaN(date)) return '---';
          return date.toLocaleDateString('en-US');
      }

      function formatSSN(ssn) {
          if (!ssn) return '---';
          const cleaned = ('' + ssn).replace(/\D/g, '');
          if (cleaned.length === 9) {
              return (
                  cleaned.substring(0, 3) +
                  '-' +
                  cleaned.substring(3, 5) +
                  '-' +
                  cleaned.substring(5, 9)
              );
          } else {
              return ssn;
          }
      }

      function formatPhoneNumber(phoneNumber) {
          if (!phoneNumber) return '---';
          const cleaned = ('' + phoneNumber).replace(/\D/g, '');
          if (cleaned.length === 10) {
              return (
                  '(' +
                  cleaned.substring(0, 3) +
                  ') ' +
                  cleaned.substring(3, 6) +
                  '-' +
                  cleaned.substring(6, 10)
              );
          } else {
              return phoneNumber;
          }
      }

      // Define the clientFields array
      const clientFields = [
          { label: 'Date of Birth', key: 'dob', formatter: 'formatDate', copyable: true },
          { label: 'SSN', key: 'ssn', formatter: 'formatSSN', copyable: true },
          { label: 'Email', key: 'email', copyable: true },
          {
              label: 'Mobile',
              key: 'mobileNumber',
              formatter: 'formatPhoneNumber',
              copyable: true,
          },
          {
              label: 'Home Phone',
              key: 'homePhone',
              formatter: 'formatPhoneNumber',
              copyable: true,
          },
          { label: 'Home Address', key: 'homeAddress', copyable: true },
          { label: 'Tax Filing Status', key: 'taxFilingStatus' },
          { label: 'Marital Status', key: 'maritalStatus' },
      ];

      console.log('Fetching household by ID...');

      // 1) Fetch the Household as a Mongoose document
      const householdDoc = await Household.findById(id)
        .populate('headOfHousehold')
        .populate({
          path: 'accounts',
          populate: [
            { path: 'accountOwner', select: 'firstName lastName dob' },
            { path: 'beneficiaries.primary.beneficiary', model: 'Beneficiary' },
            { path: 'beneficiaries.contingent.beneficiary', model: 'Beneficiary' },
          ],
        })
        .populate({
          path: 'leadAdvisors',
          select: '_id firstName lastName avatar'
        })
        .populate({
          path: 'firmId', 
          select: 'bucketsEnabled bucketsTitle bucketsDisclaimer'
        });

      if (!householdDoc) {
          console.log('No household found for ID:', id);
          return res.status(404).render('error', {
              message: 'Household not found.',
              user: req.session.user,
              error: {} // Ensure error is defined to avoid template issues
          });
      }

      console.log('householdDoc.firmId =>', householdDoc.firmId);
      console.log('householdDoc.firmId._id.toString() =>', householdDoc.firmId._id.toString());
      console.log('req.session.user.firmId =>', req.session.user.firmId);
      
      if (householdDoc.firmId._id.toString() !== req.session.user.firmId) {
        console.log('Firm ID mismatch. Access denied.');
        return res.status(403).render('error', {
          user: req.session.user,
          message: 'Access denied.',
          error: {}
        });
      }

      // ---------------------------------------------------------------------
      // Calculate totalAssets and monthlyDistribution with frequency logic
      // ---------------------------------------------------------------------
      let totalAssets = 0;
      let monthlyDistribution = 0;

      if (householdDoc.accounts && Array.isArray(householdDoc.accounts)) {
        householdDoc.accounts.forEach((account) => {
          // Sum the account's value
          totalAssets += account.accountValue || 0;

          // Convert systematicWithdrawAmount to monthly
          if (account.systematicWithdrawAmount && account.systematicWithdrawAmount > 0) {
            let monthlyAmount = 0;
            switch (account.systematicWithdrawFrequency) {
              case 'Quarterly':
                monthlyAmount = account.systematicWithdrawAmount / 3;
                break;
              case 'Annually':
                monthlyAmount = account.systematicWithdrawAmount / 12;
                break;
              default: // 'Monthly' or undefined
                monthlyAmount = account.systematicWithdrawAmount;
            }
            monthlyDistribution += monthlyAmount;
          }
        });
      }

      // 2) Persist these fields on the Household doc
      householdDoc.totalAccountValue = totalAssets;
      householdDoc.actualMonthlyDistribution = monthlyDistribution;

      // 3) Save the doc so future Value Adds can pull correct data
      await householdDoc.save();

      // ------------------------------------------------------------
      // AUTOMATICALLY GENERATE / UPDATE VALUE ADDS (Buckets, Guardrails)
      // ------------------------------------------------------------
      // Helper function: upsert "Buckets" or "Guardrails" ValueAdd doc
      async function autoGenerateValueAdd(hhDoc, type) {
        let valAdd = await ValueAdd.findOne({ household: hhDoc._id, type });
        if (!valAdd) {
          valAdd = new ValueAdd({ household: hhDoc._id, type });
        }
      
        const householdWithSum = {
          ...hhDoc.toObject(),
          accounts: hhDoc.accounts || [],
          totalAccountValue: hhDoc.totalAccountValue || 0,
          actualMonthlyDistribution: hhDoc.actualMonthlyDistribution || 0,
        };
      
        if (type === 'BUCKETS') {
          let distributionRate = 0;
          if (householdWithSum.totalAccountValue > 0 && householdWithSum.actualMonthlyDistribution > 0) {
            distributionRate = (householdWithSum.actualMonthlyDistribution * 12) / householdWithSum.totalAccountValue;
          }
      
          const bucketsData = calculateBuckets(householdWithSum, {
            distributionRate,
            upperFactor: 0.8,
            lowerFactor: 1.2,
          });
      
          const warnings = [];
          if (bucketsData.missingAllocationsCount > 0) {
            warnings.push(
              `There are ${bucketsData.missingAllocationsCount} account(s) missing asset allocation fields.`
            );
          }
      
          valAdd.currentData = bucketsData;
          valAdd.warnings = warnings;
          valAdd.history.push({ date: new Date(), data: bucketsData });
          await valAdd.save();
      
          console.log('[autoGenerateValueAdd] BUCKETS doc =>', valAdd);
        }
      }

      // 4) Generate or update both
      await autoGenerateValueAdd(householdDoc, 'BUCKETS');
      await autoGenerateValueAdd(householdDoc, 'GUARDRAILS');

      // 5) Force a quick re-query to ensure the new docs are in DB
      await ValueAdd.find({ household: householdDoc._id }).lean();

      // 6) Convert to plain object
      const household = householdDoc.toObject();

      let annualBilling = household.annualBilling;
      if (!annualBilling || annualBilling <= 0) {
        annualBilling = null;
      }

      // ---------------------------------------------------------------------
      // Fetch all clients in the household
      // ---------------------------------------------------------------------
      const clients = await Client.find({ household: household._id }).lean({ virtuals: true });

      // 1) Calculate the Household's total annual income from all Clients
      const householdAnnualIncome = calculateHouseholdAnnualIncome(clients);

      // 2) Determine the household's actual filing status
      const filingStatus = household.taxFilingStatus || 'Single';

      // 3) Get marginal tax bracket
      const marginalTaxBracket = getMarginalTaxBracket(householdAnnualIncome, filingStatus);

      clients.forEach((c, i) => {
        console.log(`Client #${i + 1}:`, {
          _id: c._id,
          firstName: c.firstName,
          lastName: c.lastName,
          dob: c.dob,
          age: c.age,
        });
      });

      // Map each client's total assets
      const assetMap = {};
      if (household.accounts && Array.isArray(household.accounts)) {
        household.accounts.forEach((account) => {
          if (!account.accountOwner || !Array.isArray(account.accountOwner)) {
            return;
          }
          account.accountOwner.forEach((owner) => {
            if (!owner || !owner._id) return;
            const ownerId = owner._id.toString();
            if (!assetMap[ownerId]) {
              assetMap[ownerId] = 0;
            }
            assetMap[ownerId] += account.accountValue || 0;
          });
        });
      }

      clients.forEach((client) => {
        client.totalAssets = assetMap[client._id.toString()] || 0;
      });

      const user = req.session.user;
      const userData = {
        ...user,
        is2FAEnabled: Boolean(user.is2FAEnabled),
        avatar: user.avatar || '/images/defaultProfilePhoto.png',
      };

      // Overwrite headOfHousehold with the doc from 'clients'
      if (household.headOfHousehold) {
        console.log('headOfHousehold from .populate():', {
          _id: household.headOfHousehold._id,
          firstName: household.headOfHousehold.firstName,
          lastName: household.headOfHousehold.lastName,
          dob: household.headOfHousehold.dob,
        });
        const hohClient = clients.find(
          (c) => c._id.toString() === household.headOfHousehold._id.toString()
        );
        if (hohClient) {
          console.log('Replacing HOH with hohClient that has virtuals:', {
            _id: hohClient._id,
            firstName: hohClient.firstName,
            lastName: hohClient.lastName,
            dob: hohClient.dob,
            age: hohClient.age,
          });
          household.headOfHousehold = hohClient;
        } else {
          console.log('No matching HOH found in clients array.');
        }
      } else {
        console.log('No headOfHousehold found in household doc.');
        // Fallback: if no HOH but we do have clients, pick the first client
        if (clients.length > 0) {
          console.log('Using the first client as HOH fallback...');
          household.headOfHousehold = clients[0];
        } else {
          // No HOH and no clients -> skip references to HOH and render minimal page
          console.log('No clients in the household. Rendering minimal data...');
          return res.render('householdDetails', {
            household,
            companyData: await CompanyID.findOne({ companyId: user.companyId }),
            clients: [],
            accounts: [],
            displayedClients: [],
            modalClients: [],
            additionalMembersCount: 0,
            formattedHeadOfHousehold: '---',
            avatar: user.avatar,
            user: userData,
            showMoreModal: false,
            clientFields,
            formatDate,
            formatSSN,
            formatPhoneNumber,
            accountTypes: [
              'Individual','TOD','Joint Tenants','Tenants in Common','IRA','Roth IRA','Inherited IRA',
              'SEP IRA','Simple IRA','401(k)','403(b)','529 Plan','UTMA','Trust','Custodial','Annuity',
              'Variable Annuity','Fixed Annuity','Deferred Annuity','Immediate Annuity','Other'
            ],
            custodians: [
              'Fidelity','Morgan Stanley','Vanguard','Charles Schwab','TD Ameritrade','Other'
            ],
            householdData: {},
            totalAssets: 0,
            monthlyDistribution: 0,
            marginalTaxBracket: null,
            annualBilling: null,
            householdId: household._id.toString(),

            // STILL PASS THE NEW activeTab, in case Pug references it
            activeTab: activeTab 
          });
        }
      }

      const advisorIds = (household.leadAdvisors || []).map((a) => a._id.toString());

      // Create a 'formattedClients' array with a 'formattedName' field
      const formattedClients = clients.map((client) => ({
        ...client,
        formattedName: `${client.lastName}, ${client.firstName}`,
      }));

      const displayedClients = [
        {
          ...household.headOfHousehold,
          formattedName: `${household.headOfHousehold.lastName}, ${household.headOfHousehold.firstName}`,
        },
        ...formattedClients
          .filter((c) => c._id.toString() !== household.headOfHousehold._id.toString())
          .slice(0, 1),
      ];

      const modalClients = [
        {
          ...household.headOfHousehold,
          formattedName: `${household.headOfHousehold.lastName}, ${household.headOfHousehold.firstName}`,
        },
        ...formattedClients.filter(
          (c) => c._id.toString() !== household.headOfHousehold._id.toString()
        ),
      ];

      const additionalMembersCount = modalClients.length - displayedClients.length;
      const showMoreModal = additionalMembersCount > 0;

      const accountTypes = [
        'Individual',
        'TOD',
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
        'Other',
      ];

      const custodians = [
        'Fidelity',
        'Morgan Stanley',
        'Vanguard',
        'Charles Schwab',
        'TD Ameritrade',
        'Other',
      ];

      const householdData = {
        headOfHousehold: {
          _id: household.headOfHousehold._id.toString(),
          firstName: household.headOfHousehold.firstName,
          lastName: household.headOfHousehold.lastName,
          dob: household.headOfHousehold.dob,
          ssn: household.headOfHousehold.ssn,
          taxFilingStatus: household.headOfHousehold.taxFilingStatus,
          maritalStatus: household.headOfHousehold.maritalStatus,
          mobileNumber: household.headOfHousehold.mobileNumber,
          homePhone: household.headOfHousehold.homePhone,
          email: household.headOfHousehold.email,
          homeAddress: household.headOfHousehold.homeAddress,
          age: household.headOfHousehold.age,
        },
        leadAdvisors: advisorIds,
      };

      const companyData = await CompanyID.findOne({ companyId: user.companyId });

      // Render the page
      res.render('householdDetails', {
        household,
        companyData,
        clients: formattedClients,
        accounts: household.accounts,
        displayedClients,
        modalClients,
        additionalMembersCount,
        formattedHeadOfHousehold: `${household.headOfHousehold.lastName}, ${household.headOfHousehold.firstName}`,
        avatar: user.avatar,
        user: userData,
        showMoreModal,
        clientFields,
        formatDate,
        formatSSN,
        formatPhoneNumber,
        accountTypes,
        custodians,
        householdData,
        totalAssets,
        monthlyDistribution,
        marginalTaxBracket,
        annualBilling,
        householdId: household._id.toString(),

        // Pass the new variable so the Pug template knows which tab is active
        activeTab: activeTab,
        hideStatsBanner: true,
      });
  } catch (err) {
    console.error('Error rendering household details page:', err);
    res.status(500).render('error', { 
      message: 'Server error.', 
      user: req.session.user,
      error: err || {} 
    });
  }
};










  const formatDate = (date) => {
    if (!date) return '-'; // Return placeholder if no date is provided
  
    // If the date is a string in 'YYYY-MM-DD' format, use it directly
    if (typeof date === 'string' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const [year, month, day] = date.split('-');
      return `${month}-${day}-${year}`;
    }
  
    // If the date is a Date object, extract the parts manually
    if (date instanceof Date && !isNaN(date)) {
      const year = date.getUTCFullYear();
      const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
      const day = date.getUTCDate().toString().padStart(2, '0');
      return `${month}-${day}-${year}`;
    }
  
    return '-'; // Fallback for unexpected values
  };
  
  
  
  
  
  
  function normalizeTaxFilingStatus(status) {
    if (!status) {
        throw new Error('No tax filing status provided.');
    }

    // Convert the input status to lowercase and trim whitespace
    const normalizedStatus = status.trim().toLowerCase();

    const taxFilingStatusMap = {
        "married filing jointly": "Married Filing Jointly",
        "married filing separately": "Married Filing Separately",
        "single": "Single",
        "head of household": "Head of Household",
        "qualifying widower": "Qualifying Widower",

        "married joint": "Married Filing Jointly",
        "married filing joint": "Married Filing Jointly",
        "mfj": "Married Filing Jointly",
        "joint": "Married Filing Jointly",

        "married separate": "Married Filing Separately",
        "mfs": "Married Filing Separately",
        "married filing separate": "Married Filing Separately",
        "separate": "Married Filing Separately",

        "head of household": "Head of Household",
        "hoh": "Head of Household",
        "head household": "Head of Household",

        "qualifying widow": "Qualifying Widower",
        "widow": "Qualifying Widower",
        "qualifying widower with dependent child": "Qualifying Widower"
    };

    if (!taxFilingStatusMap[normalizedStatus]) {
        throw new Error(`Invalid taxFilingStatus: ${status}`);
    }

    return taxFilingStatusMap[normalizedStatus];
}

function normalizeMaritalStatus(status) {
    if (!status) {
        throw new Error('No marital status provided.');
    }

    // Convert the input status to lowercase and trim whitespace
    const normalizedStatus = status.trim().toLowerCase();

    const maritalStatusMap = {
        "married": "Married",
        "single": "Single",
        "widowed": "Widowed",
        "divorced": "Divorced",

        "widow": "Widowed",
        "widower": "Widowed",
        "divorcee": "Divorced",
        "not married": "Single",
        "unmarried": "Single"
    };

    if (!maritalStatusMap[normalizedStatus]) {
        throw new Error(`Invalid maritalStatus: ${status}`);
    }

    return maritalStatusMap[normalizedStatus];
}



exports.deleteHouseholds = async (req, res) => {
  // Ensure user is authenticated
  if (!req.session.user) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  try {
    const { householdIds } = req.body;

    if (!householdIds || !Array.isArray(householdIds) || householdIds.length === 0) {
      return res.status(400).json({ message: 'No household IDs provided.' });
    }

    // Validate that all household IDs belong to the user
    const validHouseholds = await Household.find({
      _id: { $in: householdIds },
      owner: req.session.user._id
    });

    if (validHouseholds.length !== householdIds.length) {
      return res.status(403).json({ message: 'One or more households do not belong to the user.' });
    }

    // Extract the _id values
    const householdObjectIds = validHouseholds.map(hh => hh._id);

    // 1) Find all Clients in these households
    const clientsInHouseholds = await Client.find({ household: { $in: householdObjectIds } }, { _id: 1 });
    const clientIds = clientsInHouseholds.map(c => c._id);

    // 2) Remove all Accounts referencing these clients OR directly referencing these households
    //    (Depending on your schema, you might only need to filter on .household,
    //     but many designs also store accountOwner references. So you can do both.)
    await Account.deleteMany({
      $or: [
        { household: { $in: householdObjectIds } },
        { accountOwner: { $in: clientIds } },
      ],
    });

    // 3) Delete associated clients
    await Client.deleteMany({ _id: { $in: clientIds } });

    // 4) Finally, delete the households
    await Household.deleteMany({ _id: { $in: householdObjectIds } });

    return res.status(200).json({ message: 'Households and associated Clients/Accounts deleted successfully.' });
  } catch (error) {
    console.error('Error deleting households:', error);
    return res.status(500).json({ message: 'Server error while deleting households.', error: error.message });
  }
};



exports.deleteSingleHousehold = async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Not authorized.' });
  }

  try {
    const householdId = req.params.id;

    // Validate that the household belongs to the user (assuming 'owner' field on Household)
    const household = await Household.findOne({ _id: householdId, owner: req.session.user._id });
    if (!household) {
      return res.status(404).json({ message: 'Household not found or not accessible.' });
    }

    // 1) Find all Clients referencing this household
    const clientsInHousehold = await Client.find({ household: householdId }, { _id: 1 });
    const clientIds = clientsInHousehold.map(c => c._id);

    // 2) Remove all Accounts referencing these clients OR this household
    await Account.deleteMany({
      $or: [
        { household: householdId },
        { accountOwner: { $in: clientIds } },
      ],
    });

    // 3) Delete the clients
    await Client.deleteMany({ household: householdId });

    // 4) Finally delete the household
    await Household.deleteOne({ _id: householdId });

    return res.json({ message: 'Household and all associated Clients/Accounts deleted successfully.' });
  } catch (error) {
    console.error('Error deleting household:', error);
    return res.status(500).json({ message: 'Server error while deleting household.', error: error.message });
  }
};



/**
 * Generates a detailed PDF report for a specific import process using DocRaptor.
 *
 * @param {Object} req - The Express request object.
 * @param {Object} res - The Express response object.
 */
exports.generateImportReport = async (req, res) => {
    try {
        const { reportId } = req.query;

        if (!reportId) {
            return res.status(400).json({ message: 'reportId is required.' });
        }

        // Fetch the ImportReport document and populate the user
        const importReport = await ImportReport.findById(reportId).populate('user');

        if (!importReport) {
            return res.status(404).json({ message: 'Import report not found.' });
        }

        // Ensure the report belongs to the requesting user
        if (importReport.user._id.toString() !== req.session.user._id.toString()) {
            return res.status(403).json({ message: 'Access denied.' });
        }

        // Path to the company logo
        const logoPath = path.join(__dirname, '..', 'public', 'images', 'logo.png'); // Ensure this path is correct
        let logoBase64 = '';
        if (fs.existsSync(logoPath)) {
            const logoData = fs.readFileSync(logoPath);
            logoBase64 = logoData.toString('base64');
        } else {
            console.warn('Logo file not found at:', logoPath);
            // Optionally, set a placeholder or omit the logo
        }

        // Prepare summary data
        const createdCount = importReport.createdRecords.length;
        const updatedCount = importReport.updatedRecords.length;
        const failedCount = importReport.failedRecords.length;
        const duplicateCount = importReport.duplicateRecords.length;
        const totalRecords = createdCount + updatedCount + failedCount + duplicateCount;
        const formattedDate = new Date(importReport.createdAt).toLocaleString();

        const summaryText = `Created: ${createdCount} | Updated: ${updatedCount} | Failed: ${failedCount} | Duplicates: ${duplicateCount} | Total: ${totalRecords}`;

        // Create HTML content with embedded CSS
        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Import Report</title>
                <style>
                    /* Embedded CSS from importReport.css */
                    body{
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                        font-family: 'Roboto', sans-serif;
                        margin: 50px;
                    }

                    h2{
                        color: #000000;
                        font-size: 16px;
                    }

                    .header { 
                        text-align: center; 
                    }

                    .headerText{
                        display: flex;
                        align-content: center;
                        align-items: center;
                        justify-content: space-between;
                        width: 100%;
                        color: #000000 !important; /* Corrected typo */
                    }

                    .summary{
                        text-align: left;
                        margin-top: 8px;
                        font-size: 12px;
                        color: black;
                    }

                    .section { 
                        margin-top: 20px; 
                    }

                    .section h3{
                        font-size: 12px;
                        color: #000000;
                        text-align: left;
                    }

                    table { 
                        width: 100%; 
                        border-collapse: collapse; 
                        margin-top: 10px; 
                    }

                    th, td { 
                        border: 1px solid #ddd; 
                        padding: 8px; 
                        font-size: 8px; 
                    }

                    th { 
                        background-color: #f2f2f2; 
                        color: #000000; 
                    }

                    .footer { 
                        display: flex;
                        position: absolute; 
                        bottom: 40px; 
                        width: 100%; 
                        text-align: center; 
                        font-size: 8px; 
                        color: gray; 
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" alt="Company Logo" style="width:100px; height:auto;" />` : ''}
                    <div class="headerText">
                        <h2>Import Report</h2>
                        <p style="font-size:10px;">Date: ${formattedDate}</p>
                    </div>
                    <hr />
                </div>
                
                <div class="summary">
                    ${summaryText}
                </div>

                <div class="section">
                    <h3>Created Records</h3>
                    ${createTable(importReport.createdRecords, ['First Name', 'Last Name'], ['firstName', 'lastName'])}
                </div>

                <div class="section">
                    <h3>Updated Records</h3>
                    ${createTable(importReport.updatedRecords, ['First Name', 'Last Name', 'Updated Fields'], ['firstName', 'lastName', 'updatedFields'])}
                </div>

                <div class="section">
                    <h3>Failed Records</h3>
                    ${createTable(importReport.failedRecords, ['First Name', 'Last Name', 'Reason'], ['firstName', 'lastName', 'reason'])}
                </div>

                <div class="section">
                    <h3>Duplicate Records</h3>
                    ${createTable(importReport.duplicateRecords, ['First Name', 'Last Name', 'Reason'], ['firstName', 'lastName', 'reason'])}
                </div>


            </body>
            </html>
        `;

        // Function to create HTML tables
        function createTable(records, headers, keys) {
            if (records.length === 0) {
                return '<p style="font-size:8px; font-style:italic;">No records found.</p>';
            }

            let table = '<table>';
            table += '<thead><tr>';
            headers.forEach(header => {
                table += `<th>${header}</th>`;
            });
            table += '</tr></thead><tbody>';

            records.forEach(record => {
                table += '<tr>';
                keys.forEach(key => {
                    let value = record[key] || '-';
                    if (key === 'updatedFields' && Array.isArray(record[key])) {
                        value = record[key].join(', ');
                    }
                    table += `<td>${value}</td>`;
                });
                table += '</tr>';
            });

            table += '</tbody></table>';
            return table;
        }

        // Prepare DocRaptor payload
        const docRaptorPayload = {
            user_credentials: process.env.DOCRAPTOR_API_KEY, // Securely loaded from environment variables
            doc: {
                document_content: htmlContent,
                name: `Import_Report_${importReport.createdAt.toISOString()}.pdf`,
                document_type: 'pdf',
                prince_options: {
                    media: 'screen', // Use screen styles instead of print
                    baseurl: `${req.protocol}://${req.get('host')}`, // For absolute URLs in assets
                },
            },
        };

        // Configure Axios request
        const axiosConfig = {
            headers: {
                'Content-Type': 'application/json',
            },
            responseType: 'arraybuffer', // To handle binary data
        };

        // Make the POST request to DocRaptor
        const docRaptorResponse = await axios.post('https://docraptor.com/docs', docRaptorPayload, axiosConfig);

        // Check for successful response
        if (docRaptorResponse.status !== 200) {
            console.error('DocRaptor API responded with status:', docRaptorResponse.status);
            return res.status(500).json({ message: 'Failed to generate PDF via DocRaptor.' });
        }

        // Stream the PDF to the client
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            `inline; filename=Import_Report_${importReport.createdAt.toISOString()}.pdf`
        );
        res.send(docRaptorResponse.data);

    } catch (error) {
        console.error('Error generating import report PDF:', error);
        if (!res.headersSent) { // Check if headers have not been sent yet
            res.status(500).json({ message: 'Error generating import report.', error: error.message });
        }
    }
};




exports.getImportPage = async (req, res) => {
    try {
        const userId = req.session.user._id;
        const user = req.session.user;
        const companyData = await CompanyID.findOne({ companyId: user.companyId });

        // Fetch import history for the user, sorted by newest first
        const importReports = await ImportReport.find({ user: userId })
            .sort({ createdAt: -1 })
            .lean();

        res.render('import', {
            user: user,
            companyData,
            importReports,
            avatar: user.avatar,
            formatDate // Ensure formatDate is accessible in the view
        });
    } catch (error) {
        console.error('Error fetching import page:', error);
        res.status(500).render('error', { message: 'Server error.', user: req.session.user });
    }
};







exports.downloadImportFile = async (req, res) => {
    try {
        const importId = req.params.id;

  

        // Fetch the ImportReport
        const importReport = await ImportReport.findById(importId);

        if (!importReport) {
            console.warn(`Import report with ID ${importId} not found.`);
            return res.status(404).json({ message: 'Import report not found.' });
        }

        // Ensure the import belongs to the requesting user
        if (importReport.user.toString() !== req.session.user._id.toString()) {
            console.warn(
                `User ${req.session.user._id} attempted to access import report ${importId} without permission.`
            );
            return res.status(403).json({ message: 'Access denied.' });
        }

        const s3Key = importReport.originalFileKey;

        if (!s3Key) {
            console.warn(`Import report ${importId} has no associated S3 key.`);
            return res.status(400).json({ message: 'No original file associated with this import.' });
        }

      

        // Generate a pre-signed URL
        const preSignedUrl = generatePreSignedUrl(s3Key);

      

        // Redirect the user to the pre-signed URL to initiate download
        res.redirect(preSignedUrl);
    } catch (error) {
        console.error('Error generating pre-signed URL:', error);
        res.status(500).json({ message: 'Error generating download link.', error: error.message });
    }
};







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


exports.updateHousehold = async (req, res) => {
    try {
      const householdId = req.params.id;
      const user = req.session.user;
      const userId = user._id;
  
      // Find the household and ensure it belongs to the user
      const household = await Household.findOne({ _id: householdId, owner: userId, firmId: user.firmId });
      if (!household) {
        return res.status(404).json({ success: false, message: 'Household not found or not accessible.' });
      }
  
      // Update head of household
      const headClientId = household.headOfHousehold;
      const headClient = await Client.findById(headClientId);
  
      if (headClient) {
        headClient.firstName = req.body.firstName || headClient.firstName;
        headClient.lastName = req.body.lastName || headClient.lastName;
        headClient.dob = req.body.dob ? parseDateFromInput(req.body.dob) : headClient.dob;
        headClient.ssn = req.body.ssn || headClient.ssn;
        headClient.taxFilingStatus = req.body.taxFilingStatus || headClient.taxFilingStatus;
        headClient.maritalStatus = req.body.maritalStatus || headClient.maritalStatus;
        headClient.mobileNumber = req.body.mobileNumber || headClient.mobileNumber;
        headClient.homePhone = req.body.homePhone || headClient.homePhone;
        headClient.email = req.body.email || headClient.email;
        headClient.homeAddress = req.body.homeAddress || headClient.homeAddress;
        await headClient.save();
      }
  
      // Handle leadAdvisors
      let leadAdvisors = req.body.leadAdvisors;
      if (typeof leadAdvisors === 'string') {
        leadAdvisors = leadAdvisors.split(',').map(id => id.trim()).filter(Boolean);
      }
      if (!leadAdvisors || !Array.isArray(leadAdvisors)) {
        leadAdvisors = [];
      }
  
      // Validate leadAdvisors
      let validAdvisorIds = [];
      if (leadAdvisors.length > 0) {
        const validAdvisors = await User.find({
          _id: { $in: leadAdvisors },
          firmId: user.firmId,
          roles: { $in: ['leadAdvisor'] }
        }).select('_id');
  
        validAdvisorIds = validAdvisors.map(v => v._id);
      }
  
      household.leadAdvisors = validAdvisorIds;
  
      // Handle additional members
      const additionalMembers = req.body.additionalMembers || [];
      const membersToUpdate = [];
      const membersToCreate = [];
      const existingMemberIds = [];
  
      for (const memberData of additionalMembers) {
        if (memberData._id) {
          // Existing member, update
          membersToUpdate.push(memberData);
          existingMemberIds.push(memberData._id);
        } else {
          // New member, create
          membersToCreate.push(memberData);
        }
      }
  
      // Update existing members
      for (const memberData of membersToUpdate) {
        const member = await Client.findById(memberData._id);
        if (member) {
          member.firstName = memberData.firstName || member.firstName;
          member.lastName = memberData.lastName || member.lastName;
          member.dob = memberData.dob ? parseDateFromInput(memberData.dob) : member.dob;
          member.ssn = memberData.ssn || member.ssn;
          member.taxFilingStatus = memberData.taxFilingStatus || member.taxFilingStatus;
          member.maritalStatus = memberData.maritalStatus || member.maritalStatus;
          member.mobileNumber = memberData.mobileNumber || member.mobileNumber;
          member.homePhone = memberData.homePhone || member.homePhone;
          member.email = memberData.email || member.email;
          member.homeAddress = memberData.homeAddress || member.homeAddress;
          await member.save();
        }
      }
  
      // Create new members
      for (const memberData of membersToCreate) {
        const newMember = new Client({
          household: household._id,
          firstName: memberData.firstName,
          lastName: memberData.lastName,
          dob: memberData.dob ? parseDateFromInput(memberData.dob) : null,
          ssn: memberData.ssn || null,
          taxFilingStatus: memberData.taxFilingStatus || null,
          maritalStatus: memberData.maritalStatus || null,
          mobileNumber: memberData.mobileNumber || null,
          homePhone: memberData.homePhone || null,
          email: memberData.email || null,
          homeAddress: memberData.homeAddress || null,
        });
        await newMember.save();
        existingMemberIds.push(newMember._id);
      }
  
      // Include head of household ID in existingMemberIds
      existingMemberIds.push(headClientId);
  
      // Remove members that are no longer in the list
      await Client.deleteMany({
        household: household._id,
        _id: { $nin: existingMemberIds },
      });
  
      await household.save(); // Save household updates (including leadAdvisors)
  
      res.json({ success: true, message: 'Household updated successfully.' });
    } catch (error) {
      console.error('Error updating household:', error);
      res.status(500).json({ success: false, message: 'Server error.' });
    }
  };
  
  

  
  
  
  function parseDateFromInput(dateString) {
    if (!dateString) return null;
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  


  // Add these functions near your other helper functions, like formatDate

// Helper function to format phone numbers
const formatPhoneNumber = (phoneNumber) => {
    if (!phoneNumber) return '---';
  
    // Remove all non-digit characters
    const cleaned = ('' + phoneNumber).replace(/\D/g, '');
  
    // Check if number has 10 digits
    if (cleaned.length === 10) {
      const formatted =
        '+1 (' +
        cleaned.substring(0, 3) +
        ')-' +
        cleaned.substring(3, 6) +
        '-' +
        cleaned.substring(6, 10);
      return formatted;
    } else {
      return phoneNumber; // Return original if not 10 digits
    }
  };
  
  // Helper function to format SSN
  const formatSSN = (ssn) => {
    if (!ssn) return '---';
  
    const cleaned = ('' + ssn).replace(/\D/g, '');
    if (cleaned.length === 9) {
      const formatted =
        cleaned.substring(0, 3) +
        '-' +
        cleaned.substring(3, 5) +
        '-' +
        cleaned.substring(5, 9);
      return formatted;
    } else {
      return ssn;
    }
  };
  

  exports.getFirmAdvisors = async (req, res) => {
    try {
      const user = req.session.user;
      if (!user) {
        return res.status(401).json({ message: 'Not authorized' });
      }
  
      // 1. Fetch all leadAdvisors with "leadAdvisor" in roles.
      const advisorsRaw = await User.find({
        firmId: user.firmId,
        roles: { $in: ['leadAdvisor'] }
      })
        .select('firstName lastName email avatar roles permission')
        .lean(); // You may still want .lean() for performance
  
      // 2. Manually add a .name field (combining firstName + lastName).
      const leadAdvisors = advisorsRaw.map(doc => {
        const fullName = [doc.firstName, doc.lastName].filter(Boolean).join(' ');
        return {
          ...doc,
          // If firstName/lastName are blank, fallback to email:
          name: fullName || doc.email 
        };
      });
  
      return res.json({ leadAdvisors });
    } catch (err) {
      console.error('Error fetching leadAdvisors:', err);
      return res.status(500).json({ message: 'Server error' });
    }
  };


  

  exports.getFilteredHouseholds = async (req, res) => {
    try {
      const user = req.session.user;
      if (!user) {
        return res.status(401).json({ message: 'User not authenticated.' });
      }
  
      // Parse leadAdvisors from query. It may be a single string or an array of strings.
      // Example: ?leadAdvisors=abc123&leadAdvisors=xyz456 OR ?leadAdvisors=unassigned
      let { leadAdvisors } = req.query;
  
      if (!leadAdvisors) {
        // If no leadAdvisors are selected, return all households in the firm.
        leadAdvisors = [];
      } else if (typeof leadAdvisors === 'string') {
        // Convert single string to array
        leadAdvisors = [leadAdvisors];
      }
  
      // Build our query for households
      const query = { firmId: user.firmId };
  
      // If “Unassigned” is the only item, filter households with an empty 'leadAdvisors' array
      // or no leadAdvisors field at all.
      const isUnassignedOnly = leadAdvisors.length === 1 && leadAdvisors[0] === 'unassigned';
  
      if (isUnassignedOnly) {
        // Households with no assigned leadAdvisors
        query.$or = [
          { leadAdvisors: { $exists: false } },
          { leadAdvisors: { $size: 0 } },
        ];
      } else if (leadAdvisors.length > 0) {
        // Filter households that have at least one leadAdvisor in the selected set
        // Also handle the case if “unassigned” is included among other IDs.
        const filteredAdvisors = leadAdvisors.filter((adv) => adv !== 'unassigned');
  
        if (filteredAdvisors.length > 0 && leadAdvisors.includes('unassigned')) {
          // Return households that have an leadAdvisor in filteredAdvisors OR are unassigned
          query.$or = [
            { leadAdvisors: { $in: filteredAdvisors } },
            { leadAdvisors: { $exists: false } },
            { leadAdvisors: { $size: 0 } },
          ];
        } else {
          // Return households with leadAdvisors in the filtered set
          query.leadAdvisors = { $in: filteredAdvisors };
        }
      }
  
      // Find matching households
      const households = await Household.find(query)
        .populate('leadAdvisors', 'firstName lastName avatar')
        .populate('headOfHousehold', 'firstName lastName')
        .lean();
  
      // (Optional) Format households for the frontend
      const formattedHouseholds = households.map((hh) => {
        const advisorList = hh.leadAdvisors || [];
        const advisorNames = advisorList.map(
          (a) => `${a.lastName}, ${a.firstName}`
        );
        return {
          _id: hh._id,
          householdId: hh.householdId,
          headOfHouseholdName: hh.headOfHousehold
            ? `${hh.headOfHousehold.lastName}, ${hh.headOfHousehold.firstName}`
            : 'No Head of Household',
          totalAccountValue: hh.totalAccountValue || 0,
          leadAdvisors: advisorNames,
        };
      });
  
      res.json({ households: formattedHouseholds });
    } catch (err) {
      console.error('Error fetching filtered households:', err);
      res.status(500).json({ message: 'Server error' });
    }
  };
  





// controllers/householdsController.js
exports.bulkAssignAdvisors = async (req, res) => {
  try {
    const { householdIds, advisorIds } = req.body;
    if (!Array.isArray(householdIds) || !Array.isArray(advisorIds)) {
      return res.status(400).json({ message: 'householdIds and advisorIds must be arrays.' });
    }
    if (householdIds.length === 0 || advisorIds.length === 0) {
      return res.status(400).json({ message: 'No households or leadAdvisors provided.' });
    }

    // Convert strings to ObjectIds if needed
    const householdObjectIds = householdIds.map(id => new mongoose.Types.ObjectId(id));
    const advisorObjectIds = advisorIds.map(id => new mongoose.Types.ObjectId(id));

    // Fetch all target households
    const households = await Household.find({ _id: { $in: householdObjectIds } });

    for (let hh of households) {
      // Merge without duplicates
      const existing = hh.leadAdvisors.map(a => a.toString());
      // For each advisorId, if not in existing, push it
      advisorObjectIds.forEach(aid => {
        if (!existing.includes(aid.toString())) {
          hh.leadAdvisors.push(aid);
        }
      });
      await hh.save();
    }

    return res.json({ success: true, message: 'leadAdvisors assigned successfully.' });
  } catch (error) {
    console.error('Error bulk-assigning leadAdvisors:', error);
    return res.status(500).json({ message: 'Server error while assigning leadAdvisors.' });
  }
};



/**
 * GET /households/banner-stats
 * Returns a JSON object of aggregated stats:
 *  - totalHouseholds
 *  - totalAccounts
 *  - totalValue  (sum of accountValue)
 */
exports.getBannerStats = async (req, res) => {
    try {
      const user = req.session.user;
      if (!user) {
        return res.status(401).json({ message: 'Not authenticated' });
      }
  
      // e.g. parse the same selectedAdvisors param
      let { selectedAdvisors = '' } = req.query;
      const advisorArr = selectedAdvisors ? selectedAdvisors.split(',') : [];
  
      // 1) Build a match for your Household find
      const firmMatch = { firmId: user.firmId };
      if (!advisorArr.includes('all') && advisorArr.length > 0) {
        const hasUnassigned = advisorArr.includes('unassigned');
        const realAdvisorIds = advisorArr.filter(a => a !== 'unassigned');
        if (hasUnassigned && realAdvisorIds.length > 0) {
          firmMatch.$or = [
            { leadAdvisors: { $in: realAdvisorIds.map(id => new mongoose.Types.ObjectId(id)) } },
            { leadAdvisors: { $size: 0 } },
          ];
        } else if (hasUnassigned) {
          firmMatch.leadAdvisors = { $size: 0 };
        } else {
          // only realAdvisorIds
          firmMatch.leadAdvisors = { $in: realAdvisorIds.map(id => new mongoose.Types.ObjectId(id)) };
        }
      }
      
      // 2) Find Households matching
      const households = await Household.find(firmMatch).select('_id').lean();
      const householdIds = households.map(hh => hh._id);
  
      // totalHouseholds is just households.length
      const totalHouseholds = households.length;
  
      // 3) Next, find Accounts referencing these householdIds
      const accounts = await Account.find({ household: { $in: householdIds } })
        .select('accountValue')
        .lean();
  
      // totalAccounts is simply accounts.length
      const totalAccounts = accounts.length;
  
      // totalValue is sum of accountValue
      let totalValue = 0;
      for (let acc of accounts) {
        totalValue += acc.accountValue || 0;
      }
  
      res.json({
        totalHouseholds,
        totalAccounts,
        totalValue
      });
    } catch (err) {
      console.error('Error fetching banner stats:', err);
      res.status(500).json({ message: 'Server error' });
    }
  };
  
// controllers/householdsController.js

const AWS = require('aws-sdk');
const multer = require('multer');


// AWS config
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});
const s3 = new AWS.S3();
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Helper to upload to S3
async function uploadToS3(file, folder = 'clientPhotos') {
  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: `${folder}/${Date.now()}_${file.originalname}`,
    Body: file.buffer,
    ContentType: file.mimetype,
  };
  const data = await s3.upload(params).promise();
  return data.Location; // Return the S3 URL
}

/**
 * Get a single client by ID (JSON response).
 */
exports.getClientById = async (req, res) => {
  try {
    const { clientId } = req.params;
    const client = await Client.findById(clientId).lean();
    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }
    res.json({ client });
  } catch (err) {
    console.error('Error fetching client by ID:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Update a single client by ID (with optional photo upload).
 * We'll accept multipart/form-data so we can handle the profile photo if provided.
 */
exports.updateClient = [
  upload.single('profilePhoto'), // Multer middleware to handle single file input with name="profilePhoto"
  async (req, res) => {
    try {
      const { clientId } = req.params;
      const {
        firstName,
        lastName,
        deceasedLiving,
        email,
        phoneNumber,
        dob,
        monthlyIncome,
      } = req.body;

      const client = await Client.findById(clientId);
      if (!client) {
        return res.status(404).json({ message: 'Client not found' });
      }

      // Update textual fields
      if (firstName !== undefined) client.firstName = firstName;
      if (lastName !== undefined) client.lastName = lastName;
      if (deceasedLiving !== undefined) client.deceasedLiving = deceasedLiving;
      if (email !== undefined) client.email = email;
      if (phoneNumber !== undefined) {
        client.mobileNumber = phoneNumber;
      }
      if (dob !== undefined) {
        const parsedDOB = new Date(dob);
        if (!isNaN(parsedDOB.getTime())) {
          client.dob = parsedDOB;
        }
      }
      if (monthlyIncome !== undefined) {
        const incomeVal = parseFloat(monthlyIncome);
        if (!isNaN(incomeVal)) {
          client.monthlyIncome = incomeVal;
        }
      }

      // If a file (profilePhoto) is uploaded, upload to S3
      if (req.file) {
        const s3Url = await uploadToS3(req.file, 'clientPhotos');
        client.profilePhoto = s3Url; // store the returned S3 URL
      }

      await client.save();
      res.json({ message: 'Client updated successfully', client });
    } catch (err) {
      console.error('Error updating client:', err);
      res.status(500).json({ message: 'Server error' });
    }
  },
];



// controllers/householdController.js (or a dedicated clientController.js)
exports.deleteClient = async (req, res) => {
  try {
    const { clientId } = req.params;

    // 1. Find the client and populate the household field
    const client = await Client.findById(clientId).populate('household');
    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    const household = client.household; // The Household doc
    if (!household) {
      // If for some reason the client has no household (shouldn't happen), just delete
      await Client.findByIdAndDelete(clientId);
      return res.json({ message: 'Client deleted successfully' });
    }

    // 2. Fetch all clients in this household
    const allMembers = await Client.find({ household: household._id });
    if (!allMembers || allMembers.length === 0) {
      // No members? Odd edge case. Just remove the client.
      await Client.findByIdAndDelete(clientId);
      return res.json({ message: 'Client deleted successfully' });
    }

    // 3. If there's only 1 member (this client), delete the household
    if (allMembers.length === 1 && allMembers[0]._id.toString() === clientId.toString()) {
      // This is the only occupant, so remove the household
      await Client.findByIdAndDelete(clientId);         // remove the client
      await Household.findByIdAndDelete(household._id); // remove the household
      return res.json({
        message: 'Client and Household deleted successfully',
        redirect: '/households', // You can send a redirect path to the frontend if you wish
      });
    }

    // 4. Otherwise, there's more than one member in the household
    //    => check if the client is the headOfHousehold
    if (household.headOfHousehold && 
        household.headOfHousehold.toString() === clientId.toString()) {
      // 4a. We must reassign headOfHousehold
      // pick the first member that's not the one being deleted
      const newHOH = allMembers.find(m => m._id.toString() !== clientId.toString());
      if (newHOH) {
        // update the household to point to new HOH
        household.headOfHousehold = newHOH._id;
        await household.save();
      }
    }

    // 5. Now delete the client
    await Client.findByIdAndDelete(clientId);
    return res.json({ message: 'Client deleted successfully' });
  } catch (error) {
    console.error('Error deleting client:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};



function calculateHouseholdAnnualIncome(clients) {
  let totalMonthlyIncome = 0;
  clients.forEach((client) => {
    totalMonthlyIncome += (client.monthlyIncome || 0);
  });
  return totalMonthlyIncome * 12;
}


exports.showGuardrailsPage = async (req, res) => {
  try {
    const householdId = req.params.householdId;
    

    // 1) Check if user exists in session
    let user = req.session.user || null;
    let firm = null;

    if (user && user.firmId) {
      firm = await CompanyID.findById(user.firmId);
    }

    // Build userData safely
    const userData = {
      ...user, // If user is null, this is safe (or you can do user || {}).
      name: user?.name || '',
      email: user?.email || '',
      companyName: firm ? firm.companyName : '',
      companyWebsite: firm ? firm.companyWebsite : '',
      companyAddress: firm ? firm.companyAddress : '',
      phoneNumber: firm ? firm.phoneNumber : '',
      companyLogo: firm ? firm.companyLogo : '',
      is2FAEnabled: Boolean(user?.is2FAEnabled),
      avatar: user?.avatar || '/images/defaultProfilePhoto.png'
    };

    // 2) Fetch the Household and its clients
    const household = await Household.findById(householdId)
      .populate('headOfHousehold')
      .lean();

    if (!household) {
      return res.status(404).send('Household not found');
    }

    const clients = await Client.find({ household: household._id }).lean({ virtuals: true });
    if (!clients || clients.length === 0) {
      // No clients => householdName = '---'
      return res.render('householdGuardrails', {
        user: userData,
        companyData,
        avatar: userData.avatar,
        householdId,
        householdName: '---',
        hideStatsBanner: true, 
      });
    }

    // 3) Identify HOH
    let hohClient = null;
    if (household.headOfHousehold) {
      hohClient = clients.find(
        c => c._id.toString() === household.headOfHousehold._id.toString()
      );
    }
    // Fallback
    if (!hohClient) {
      hohClient = clients[0];
    }

    // 4) Build modalClients
    const modalClients = [
      hohClient,
      ...clients.filter(c => c._id.toString() !== hohClient._id.toString())
    ];

    // 5) displayedClients
    let displayedClients = [
      hohClient,
      ...clients
        .filter(c => c._id.toString() !== hohClient._id.toString())
        .slice(0, 1)
    ];

    // 6) replicate naming logic
    let householdName = '---';
    if (displayedClients && displayedClients.length > 0) {
      const c1 = displayedClients[0];
      const lastName1 = c1.lastName || '';
      const firstName1 = c1.firstName || '';
      if (displayedClients.length === 1) {
        householdName = `${lastName1}, ${firstName1}`;
      } else if (displayedClients.length === 2) {
        const c2 = displayedClients[1];
        const lastName2 = c2.lastName || '';
        const firstName2 = c2.firstName || '';
        if (lastName1.toLowerCase() === lastName2.toLowerCase()) {
          householdName = `${lastName1}, ${firstName1} & ${firstName2}`;
        } else {
          householdName = `${lastName1}, ${firstName1}`;
        }
      } else {
        // more than two => fallback HOH only
        householdName = `${lastName1}, ${firstName1}`;
      }
    }

    const companyData = await CompanyID.findOne({ companyId: user.companyId });

    // 7) Render
    return res.render('householdGuardrails', {
      user: userData,
      companyData,
      avatar: userData.avatar,
      householdId,
      householdName

    });

  } catch (error) {
    console.error('Error in showGuardrailsPage:', error);
    res.status(500).send('Server error while loading Guardrails page');
  }
};






exports.showBucketsPage = async (req, res) => {
  try {
    const householdId = req.params.householdId;
    

    // 1) Fetch user + firm (if needed)
    const user = req.session.user;
    const firm = await CompanyID.findById(user.firmId);
    const userData = {
      ...user,
      avatar: user.avatar || '/images/defaultProfilePhoto.png',
      companyLogo: firm ? firm.companyLogo : ''
      // ...whatever else you want
    };

    // 2) Fetch the Household
    const household = await Household.findById(householdId)
      .populate('headOfHousehold')
      .lean();
    if (!household) {
      return res.status(404).send('Household not found');
    }

   

    // 3) Fetch clients
    const clients = await Client.find({ household: household._id }).lean();
    if (!clients || clients.length === 0) {
      // No clients => fallback name
      return res.render('householdBuckets', {
        user: userData,
        companyData,
        avatar: userData.avatar,
        householdId,
        householdName: '---',

      });
    }

    // 4) Identify the HOH (if any)
    let hohClient = null;
    if (household.headOfHousehold) {
      hohClient = clients.find(
        c => c._id.toString() === household.headOfHousehold._id.toString()
      );
    }
    if (!hohClient) {
      hohClient = clients[0];
    }

    // 5) Build the list of clients: HOH first, then others
    const modalClients = [
      hohClient,
      ...clients.filter(c => c._id.toString() !== hohClient._id.toString())
    ];

    // 6) Compute displayedClients
    let displayedClients = [
      hohClient,
      ...clients
        .filter(c => c._id.toString() !== hohClient._id.toString())
        .slice(0, 1)
    ];

    // 7) Now replicate your naming logic
    //  - If displayedClients has 1 => "Last, First"
    //  - If 2 => "Last, First & First" if same last name
    //        => "Last, First & Last, First" if different last names
    //  - Else => fallback to HOH only
    let householdName = '---';
    if (displayedClients && displayedClients.length > 0) {
      const c1 = displayedClients[0];
      const lastName1 = c1.lastName || '';
      const firstName1 = c1.firstName || '';

      if (displayedClients.length === 1) {
        // Only one member
        householdName = `${lastName1}, ${firstName1}`;
      } else if (displayedClients.length === 2) {
        const c2 = displayedClients[1];
        const lastName2 = c2.lastName || '';
        const firstName2 = c2.firstName || '';

        if (lastName1.toLowerCase() === lastName2.toLowerCase()) {
          householdName = `${lastName1}, ${firstName1} & ${firstName2}`;
        } else {
          householdName = `${lastName1}, ${firstName1} & ${lastName2}, ${firstName2}`;
        }
      } else {
        // more than two => fallback to HOH
        householdName = `${lastName1}, ${firstName1}`;
      }
    }
    const companyData = await CompanyID.findOne({ companyId: user.companyId });

    // 8) Render the Buckets page with householdName
    return res.render('householdBuckets', {
      user: userData,
      companyData,
      avatar: userData.avatar,
      householdId,
      householdName,
      hideStatsBanner: true, 

    });
  } catch (error) {
    console.error('Error in showBucketsPage:', error);
    res.status(500).send('Server error while loading Buckets page');
  }
};