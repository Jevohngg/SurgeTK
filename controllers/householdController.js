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


const ImportReport = require('../models/ImportReport');



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

exports.importHouseholdsWithMapping = async (req, res) => {
    try {
        const { mapping, uploadedData, s3Key } = req.body; // Accept s3Key from the frontend

        if (!s3Key) {
            console.error('S3 Key is missing.');
            return res.status(400).json({ message: 'S3 Key is required for import.' });
        }

        // Validate uploaded data
        if (!uploadedData || uploadedData.length === 0) {
            console.error('No uploaded data available.');
            return res.status(400).json({ message: 'No uploaded data available.' });
        }

        // Validate mapping
        if (!mapping || Object.keys(mapping).length === 0) {
            console.error('No mapping provided.');
            return res.status(400).json({ message: 'No mapping provided.' });
        }

        // Normalize mapping keys by removing 'mapping[' and ']'
        const normalizedMapping = {};
        for (const key in mapping) {
            const normalizedKey = key.replace('mapping[', '').replace(']', '');
            normalizedMapping[normalizedKey] = mapping[key];
        }

      

        // Initialize counters and logs
        const totalRecords = uploadedData.length;
        let processedRecords = 0;
        const createdRecords = []; // Store newly created records
        const updatedRecords = []; // Store updated records
        const failedRecords = [];
        const duplicateRecords = [];

        // Initialize Socket.io and user room
        const io = req.app.locals.io;
        const userId = req.session.user._id.toString();

        // Initialize progressMap
        const progressMap = req.app.locals.importProgress;

        // Record the start time for estimating remaining time
        const startTime = Date.now();

        // Initialize a Map to track unique records within the uploaded data
        const uniqueRecordsMap = new Map();

        // Map to track userHouseholdId to Household
        const userHouseholdIdToHouseholdMap = new Map();

        // Iterate over each uploaded data row
        for (const row of uploadedData) {
            let householdData = {}; // Declare outside the try block
            try {
                // Construct household data based on mapping
                householdData = {
                    firstName: normalizedMapping['Client First'] !== undefined ? row[normalizedMapping['Client First']] : null,
                    middleName: normalizedMapping['Client Middle'] !== undefined ? row[normalizedMapping['Client Middle']] : null,
                    lastName: normalizedMapping['Client Last'] !== undefined ? row[normalizedMapping['Client Last']] : null,
                    dob: normalizedMapping['DOB'] !== undefined ? row[normalizedMapping['DOB']] : null,
                    ssn: normalizedMapping['SSN'] !== undefined ? row[normalizedMapping['SSN']] : null,
                    taxFilingStatus: normalizedMapping['Tax Filing Status'] !== undefined ? row[normalizedMapping['Tax Filing Status']] : null,
                    mobileNumber: normalizedMapping['Mobile'] !== undefined ? row[normalizedMapping['Mobile']] : null,
                    homePhone: normalizedMapping['Home'] !== undefined ? row[normalizedMapping['Home']] : null,
                    email: normalizedMapping['Email'] !== undefined ? row[normalizedMapping['Email']] : null,
                    homeAddress: normalizedMapping['Home Address'] !== undefined ? row[normalizedMapping['Home Address']] : null,
                    maritalStatus: normalizedMapping['Marital Status'] !== undefined ? row[normalizedMapping['Marital Status']] : 'Single',
                    userHouseholdId: normalizedMapping['Household ID'] !== undefined ? row[normalizedMapping['Household ID']] : null,
                };

            

                // Validate required fields
                const requiredFields = ['firstName', 'lastName'];
                const missingFields = requiredFields.filter((field) => !householdData[field]);

                if (missingFields.length > 0) {
                    console.warn(`Missing required fields: ${missingFields.join(', ')} for row:`, row);
                    failedRecords.push({
                        firstName: householdData.firstName || 'N/A',
                        lastName: householdData.lastName || 'N/A',
                        reason: `Missing fields: ${missingFields.join(', ')}`
                    });
                

                    // Increment processedRecords
                    processedRecords++;

                    // Calculate percentage and estimated time
                    const percentage = Math.round((processedRecords / totalRecords) * 100);
                    const elapsedTime = (Date.now() - startTime) / 1000; // in seconds
                    const timePerRecord = elapsedTime / processedRecords;
                    const remainingRecords = totalRecords - processedRecords;
                    const estimatedTime = remainingRecords > 0
                        ? `${Math.round(timePerRecord * remainingRecords)} seconds`
                        : 'Completed';

                    // Update progress data
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

                    // Emit progress update
                    io.to(userId).emit('importProgress', progressMap.get(userId));

                    continue; // Skip to the next record
                }

                // Initialize an array to collect validation errors
                const validationErrors = [];

                // Validate names
                const nameFields = ['firstName', 'middleName', 'lastName'];
                nameFields.forEach((field) => {
                    if (householdData[field]) {
                        const nameValue = householdData[field];

                        // Check if the name contains any numbers
                        if (/\d/.test(nameValue)) {
                            validationErrors.push(`${field} contains numbers.`);
                        }

                        if (field === 'firstName' || field === 'lastName') {
                            // Check if firstName or lastName has fewer than 2 characters
                            if (nameValue.length < 2) {
                                validationErrors.push(`${field} must be at least 2 characters long.`);
                            }

                            // Check for invalid special characters (allowing letters, spaces, hyphens, and apostrophes)
                            if (/[^a-zA-Z-' ]/.test(nameValue)) {
                                validationErrors.push(`${field} contains invalid characters.`);
                            }
                        }

                        if (field === 'middleName') {
                            if (nameValue.length <= 2) {
                                // Allow periods
                                if (/[^a-zA-Z-'. ]/.test(nameValue)) {
                                    validationErrors.push(`${field} contains invalid characters.`);
                                }
                            } else {
                                // Do not allow periods
                                if (/[^a-zA-Z-' ]/.test(nameValue)) {
                                    validationErrors.push(`${field} contains invalid characters.`);
                                }
                            }
                        }
                    }
                });

                // Validate phone numbers
                const phoneFields = ['mobileNumber', 'homePhone'];
                phoneFields.forEach((field) => {
                    if (householdData[field]) {
                        // Check if the phone number contains any letters
                        if (/[a-zA-Z]/.test(householdData[field])) {
                            validationErrors.push(`${field} contains letters.`);
                        }
                    }
                });

                // Validate maritalStatus and taxFilingStatus
                const statusFields = ['maritalStatus', 'taxFilingStatus'];
                statusFields.forEach((field) => {
                    if (householdData[field]) {
                        // Check if the status contains any numbers
                        if (/\d/.test(householdData[field])) {
                            validationErrors.push(`${field} contains numbers.`);
                        }
                    }
                });

                // Validate email
                if (householdData.email) {
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(householdData.email)) {
                        validationErrors.push('Email is not in a valid format.');
                    }
                }

                // Validate date of birth
                if (householdData.dob) {
                    // Handle Excel serial dates by checking if dob is a number
                    let dobDate;
                    if (typeof householdData.dob === 'number') {
                        // Excel serial date to JavaScript Date
                        dobDate = parseExcelDate(householdData.dob);
                    } else if (typeof householdData.dob === 'string') {
                        dobDate = new Date(householdData.dob);
                    } else if (householdData.dob instanceof Date) {
                        dobDate = householdData.dob;
                    } else {
                        dobDate = null;
                    }

                    const currentDate = new Date();
                    if (isNaN(dobDate.getTime())) {
                        validationErrors.push('Date of birth is not a valid date.');
                    } else if (dobDate > currentDate) {
                        validationErrors.push('Date of birth cannot be in the future.');
                    }
                }

                // Validate SSN
                if (householdData.ssn) {
                    const ssnRegex = /^\d{3}-\d{2}-\d{4}$/;
                    if (!ssnRegex.test(householdData.ssn)) {
                        validationErrors.push('SSN is not in a valid format (XXX-XX-XXXX).');
                    }
                }

                // If there are validation errors, add the record to failedRecords and continue
                if (validationErrors.length > 0) {
                    failedRecords.push({
                        firstName: householdData.firstName || 'N/A',
                        lastName: householdData.lastName || 'N/A',
                        reason: validationErrors.join(' ')
                    });
               

                    // Increment processedRecords
                    processedRecords++;

                    // Calculate percentage and estimated time
                    const percentage = Math.round((processedRecords / totalRecords) * 100);
                    const elapsedTime = (Date.now() - startTime) / 1000; // in seconds
                    const timePerRecord = elapsedTime / processedRecords;
                    const remainingRecords = totalRecords - processedRecords;
                    const estimatedTime = remainingRecords > 0
                        ? `${Math.round(timePerRecord * remainingRecords)} seconds`
                        : 'Completed';

                    // Update progress data
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

                    // Emit progress update
                    io.to(userId).emit('importProgress', progressMap.get(userId));

                    continue; // Skip to the next record
                }

                // Normalize specific fields
                if (householdData.taxFilingStatus) {
                    householdData.taxFilingStatus = normalizeTaxFilingStatus(householdData.taxFilingStatus);
                }

                if (householdData.maritalStatus) {
                    householdData.maritalStatus = normalizeMaritalStatus(householdData.maritalStatus);
                }

                // Duplicate Detection within Uploaded Data

                // Generate a unique identifier by hashing firstName and lastName
                const uniqueString = JSON.stringify({
                    firstName: normalizeString(householdData.firstName, true),
                    lastName: normalizeString(householdData.lastName, true),
                });

                const hash = crypto.createHash('sha256').update(uniqueString).digest('hex');

                if (uniqueRecordsMap.has(hash)) {
                    // Duplicate found within uploaded data
                    duplicateRecords.push({
                        firstName: householdData.firstName || 'N/A',
                        lastName: householdData.lastName || 'N/A',
                        reason: 'Duplicate record in uploaded data.'
                    });

                 

                    // Increment processedRecords
                    processedRecords++;

                    // Calculate percentage and estimated time
                    const percentage = Math.round((processedRecords / totalRecords) * 100);
                    const elapsedTime = (Date.now() - startTime) / 1000;
                    const timePerRecord = elapsedTime / processedRecords;
                    const remainingRecords = totalRecords - processedRecords;
                    const estimatedTime = remainingRecords > 0
                        ? `${Math.round(timePerRecord * remainingRecords)} seconds`
                        : 'Completed';

                    // Update progress data
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

                    // Emit progress update
                    io.to(userId).emit('importProgress', progressMap.get(userId));

                    continue; // Skip to the next record
                } else {
                    // New unique record within uploaded data, add to the map
                    uniqueRecordsMap.set(hash, householdData);
                }

                // Logic for Updating or Creating Records

                // Normalize names for matching
                const firstNameNormalized = normalizeString(householdData.firstName, true);
                const lastNameNormalized = normalizeString(householdData.lastName, true);

                // Build matching criteria based solely on firstName and lastName
                let matchingCriteria = {
                    firstName: { $regex: `^${firstNameNormalized}$`, $options: 'i' },
                    lastName: { $regex: `^${lastNameNormalized}$`, $options: 'i' },
                };

                // Find clients matching firstName and lastName
                const matchingClients = await Client.find(matchingCriteria).populate('household');

                // Filter matchingClients to only include those whose household owner matches the current user
                const userMatchingClients = matchingClients.filter(client => {
                    return client.household && client.household.owner.equals(req.session.user._id);
                });

                if (userMatchingClients.length === 0) {
                    // No matching client found, create a new household and client

                    // Determine which household to use
                    let household;
                    const userHouseholdId = householdData.userHouseholdId ? householdData.userHouseholdId.trim() : null;

                    // Use userHouseholdIdToHouseholdMap to group clients
                    if (userHouseholdId) {
                        if (userHouseholdIdToHouseholdMap.has(userHouseholdId)) {
                            // Use the existing household from the map
                            household = userHouseholdIdToHouseholdMap.get(userHouseholdId);
                        
                        } else {
                            // Check if a household already exists with this userHouseholdId
                            let existingHousehold = await Household.findOne({
                                owner: req.session.user._id,
                                userHouseholdId: userHouseholdId
                            });

                            if (existingHousehold) {
                                household = existingHousehold;
                            } else {
                                // Create new household with userHouseholdId
                                household = new Household({
                                    householdId: generateHouseholdId(),
                                    totalAccountValue: 0,
                                    owner: req.session.user._id,
                                    userHouseholdId: userHouseholdId
                                });
                                await household.save();
                            }

                            // Add to the map
                            userHouseholdIdToHouseholdMap.set(userHouseholdId, household);
                          
                        }
                    } else {
                        // No userHouseholdId provided, create a new household
                        household = new Household({
                            householdId: generateHouseholdId(),
                            totalAccountValue: 0,
                            owner: req.session.user._id,
                        });
                        await household.save();
                     
                    }

                    // Create new client
                    const client = new Client({
                        firstName: householdData.firstName,
                        middleName: householdData.middleName,
                        lastName: householdData.lastName,
                        dob: householdData.dob ? (typeof householdData.dob === 'number' ? parseExcelDate(householdData.dob) : new Date(householdData.dob)) : null,
                        ssn: householdData.ssn,
                        taxFilingStatus: householdData.taxFilingStatus,
                        maritalStatus: householdData.maritalStatus,
                        mobileNumber: householdData.mobileNumber,
                        homePhone: householdData.homePhone,
                        email: householdData.email,
                        homeAddress: householdData.homeAddress,
                        household: household._id,
                    });
                    await client.save();
                  

                    // Set headOfHousehold if not set
                    if (!household.headOfHousehold) {
                        household.headOfHousehold = client._id;
                        await household.save();
                    }

                    // Add to createdRecords
                    createdRecords.push({
                        firstName: householdData.firstName,
                        lastName: householdData.lastName
                    });
             

                } else if (userMatchingClients.length === 1) {
                    // Single matching client found, update the existing client

                    const client = userMatchingClients[0];

                    // Update fields if new data is provided
                    const fieldsToUpdate = [
                        'middleName',
                        'dob',
                        'ssn',
                        'taxFilingStatus',
                        'maritalStatus',
                        'mobileNumber',
                        'homePhone',
                        'email',
                        'homeAddress'
                    ];

                    let isUpdated = false;
                    const updatedFields = []; // Track which fields were updated

                    fieldsToUpdate.forEach(field => {
                        if (householdData[field] !== null && householdData[field] !== undefined) {
                            let importedValue = householdData[field];
                            let existingValue = client[field];

                            if (field === 'dob') {
                                // Parse the imported DOB
                                let importedDob;
                                if (typeof importedValue === 'number') {
                                    importedDob = parseExcelDate(importedValue);
                                } else if (typeof importedValue === 'string') {
                                    importedDob = new Date(importedValue);
                                } else if (importedValue instanceof Date) {
                                    importedDob = importedValue;
                                } else {
                                    importedDob = null;
                                }

                                // Compare dates
                                if (!areDatesEqual(importedDob, existingValue)) {
                                    client[field] = importedDob;
                                    isUpdated = true;
                                    updatedFields.push(field);
                              
                                }
                            } else if (typeof importedValue === 'string') {
                                // Normalize strings before comparison
                                const normalizedImported = normalizeString(importedValue, true);
                                const normalizedExisting = normalizeString(existingValue, true);

                                if (!areStringsEqual(normalizedImported, normalizedExisting)) {
                                    client[field] = importedValue;
                                    isUpdated = true;
                                    updatedFields.push(field);
                                  
                                }
                            } else {
                                // For other data types, perform a direct comparison
                                if (importedValue !== existingValue) {
                                    client[field] = importedValue;
                                    isUpdated = true;
                                    updatedFields.push(field);
                                
                                }
                            }
                        }
                    });

                    if (isUpdated) {
                        await client.save();
                    

                        // Optionally, update household head if needed
                        const household = await Household.findById(client.household);
                        if (!household.headOfHousehold) {
                            household.headOfHousehold = client._id;
                            await household.save();
                        }

                        // Add to updatedRecords, including updated fields
                        updatedRecords.push({
                            firstName: householdData.firstName,
                            lastName: householdData.lastName,
                            updatedFields: updatedFields
                        });
                       
                    } else {
            
        
      
                    }

                } else {
                    // Multiple matching clients found, add to failedRecords
                    failedRecords.push({
                        firstName: householdData.firstName || 'N/A',
                        lastName: householdData.lastName || 'N/A',
                        reason: 'Multiple clients with the same first and last name exist. Manual resolution required.'
                    });
                  
                }

                // Increment processedRecords for successful processing
                processedRecords++;

                // Calculate percentage and estimated time
                const percentage = Math.round((processedRecords / totalRecords) * 100);
                const elapsedTime = (Date.now() - startTime) / 1000;
                const timePerRecord = elapsedTime / processedRecords;
                const remainingRecords = totalRecords - processedRecords;
                const estimatedTime = remainingRecords > 0
                    ? `${Math.round(timePerRecord * remainingRecords)} seconds`
                    : 'Completed';

                // Update progress data
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

                // Emit progress update
                io.to(userId).emit('importProgress', progressMap.get(userId));

            } catch (error) {
                console.error('Error processing row:', row, error);
                failedRecords.push({
                    firstName: householdData.firstName || 'N/A',
                    lastName: householdData.lastName || 'N/A',
                    reason: error.message
                });
             

                // Increment processedRecords
                processedRecords++;

                // Calculate percentage and estimated time
                const percentage = Math.round((processedRecords / totalRecords) * 100);
                const elapsedTime = (Date.now() - startTime) / 1000;
                const timePerRecord = elapsedTime / processedRecords;
                const remainingRecords = totalRecords - processedRecords;
                const estimatedTime = remainingRecords > 0
                    ? `${Math.round(timePerRecord * remainingRecords)} seconds`
                    : 'Completed';

                // Update progress data
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

                // Emit progress update
                io.to(userId).emit('importProgress', progressMap.get(userId));
            }
        }

        // After processing all records, save ImportReport
        try {
            // Create ImportReport document
            const importReport = new ImportReport({
                user: req.session.user._id,
                importType: 'Household Data Import',
                createdRecords: createdRecords,
                updatedRecords: updatedRecords,
                failedRecords: failedRecords,
                duplicateRecords: duplicateRecords,
                originalFileKey: s3Key,
            });

            await importReport.save();

            // Associate the import report ID with the progressMap
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

            // Emit 'importComplete' with the updated progress data
            io.to(userId).emit('importComplete', progressMap.get(userId));


            // Emit 'newImportReport' for Import History update
            io.to(userId).emit('newImportReport', {
                _id: importReport._id,
                importType: importReport.importType,
                createdAt: importReport.createdAt
            });

            // Respond to the client to acknowledge the completion of the import process
            res.status(200).json({ message: 'Import process completed.', importReportId: importReport._id });

        } catch (error) {
            console.error('Error saving ImportReport:', error);
            // Optionally, set failed state and emit 'importComplete' with error
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

            // Emit 'importComplete' with the updated progress data
            io.to(userId).emit('importComplete', progressMap.get(userId));

            // Respond with error
            res.status(500).json({ message: 'Error saving ImportReport.', error: error.message });
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

    try {
        // Query households associated with the logged-in user
        const households = await Household.find({ user: user._id }) || [];

        // Render the households page with the queried data
        res.render('households', { 
            user: user,
            avatar: user.avatar,
            households: households, // Pass the households array to the template
        });
    } catch (error) {
        console.error('Error fetching households:', error);

        // Render the page with an empty households array in case of an error
        res.render('households', { 
            user: user,
            avatar: user.avatar,
            households: [], // Fallback to an empty array
        });
    }
};



/**
 * GET /api/households
 * Fetches households with pagination, search, and sorting capabilities.
 * Supports fetching all households when limit=all is specified.
 */
exports.getHouseholds = async (req, res) => {
    // Ensure user is authenticated
    if (!req.session.user) {
        return res.status(401).json({ message: 'User not authenticated.' });
    }

    try {
        // Extract query parameters with default values
        let { page = 1, limit = 10, search = '', sortField = 'headOfHouseholdName', sortOrder = 'asc' } = req.query;

        // Handle 'limit=all' to fetch all records across pages
        if (limit === 'all') {
            limit = 0; // In MongoDB, limit=0 removes the limit
            page = 1; // Reset to first page when fetching all records
        } else {
            limit = parseInt(limit, 10);
            page = parseInt(page, 10);
            if (isNaN(limit) || limit < 1) limit = 10; // Fallback to default if invalid
            if (isNaN(page) || page < 1) page = 1;
        }

        const skip = (page - 1) * limit;

        const sortDirection = sortOrder === 'asc' ? 1 : -1;

        // Build the initial match query to ensure households belong to the authenticated user
        const match = { owner: new mongoose.Types.ObjectId(req.session.user._id) };

        // Initialize the aggregation pipeline
        const initialPipeline = [
            { $match: match },
            {
                $lookup: {
                    from: 'clients',
                    localField: 'headOfHousehold',
                    foreignField: '_id',
                    as: 'headOfHousehold',
                },
            },
            { $unwind: '$headOfHousehold' },
        ];

        // Add search functionality if a search term is provided
        if (search) {
            const [lastNameSearch, firstNameSearch] = search.split(',').map(s => s.trim());
            if (firstNameSearch) {
                // Search in "Last Name, First Name" format
                initialPipeline.push({
                    $match: {
                        'headOfHousehold.firstName': { $regex: firstNameSearch, $options: 'i' },
                        'headOfHousehold.lastName': { $regex: lastNameSearch, $options: 'i' },
                    },
                });
            } else {
                // Search both first and last names separately
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

        // Add a computed field for the head of household's name in "Last Name, First Name" format
        initialPipeline.push({
            $addFields: {
                headOfHouseholdName: {
                    $concat: ['$headOfHousehold.lastName', ', ', '$headOfHousehold.firstName'],
                },
            },
        });

        // Handle sorting based on the specified sortField and sortOrder
        if (sortField === 'headOfHouseholdName') {
            initialPipeline.push({ $sort: { headOfHouseholdName: sortDirection } });
        } else if (sortField === 'totalAccountValue') {
            initialPipeline.push({ $sort: { totalAccountValue: sortDirection } });
        } else {
            // Default sorting by headOfHouseholdName ascending
            initialPipeline.push({ $sort: { headOfHouseholdName: 1 } });
        }

        // Construct the final aggregation pipeline
        const facetPipeline = [
            {
                $facet: {
                    households: limit > 0 ? [{ $skip: skip }, { $limit: limit }] : [], // Apply skip and limit only if limit > 0
                    totalCount: [{ $count: 'total' }],
                },
            },
        ];

        // If limit=all, remove the $skip and $limit to fetch all households
        if (limit === 0) {
            facetPipeline[0].$facet.households = []; // Remove any skip/limit
            // Instead of applying $skip and $limit, fetch all households
            // Modify the facet to include all households without skip and limit
            facetPipeline[0].$facet.households = [
                // No $skip and $limit
            ];
        }

        const pipeline = initialPipeline.concat(facetPipeline);

        // Execute the aggregation pipeline
        const results = await Household.aggregate(pipeline);
        const households = results[0].households;
        const total = results[0].totalCount.length > 0 ? results[0].totalCount[0].total : 0;

        // If limit=all, set total to all fetched households
        const totalHouseholds = limit === 0 ? total : total;

        // Fetch clients associated with the fetched households
        const householdIds = households.map(hh => hh._id);

        const clients = await Client.find({ household: { $in: householdIds } }, 'firstName lastName household').lean();

        // Map household IDs to their clients for easy lookup
        const clientsMap = new Map();
        clients.forEach(client => {
            const hhId = client.household.toString();
            if (!clientsMap.has(hhId)) {
                clientsMap.set(hhId, []);
            }
            clientsMap.get(hhId).push(client);
        });

        // Format the households data for the response
        const formattedHouseholds = households.map(hh => {
            const hhId = hh._id.toString();
            const householdClients = clientsMap.get(hhId) || [];

            let displayName;

            if (householdClients.length === 2) {
                const [client1, client2] = householdClients;

                if (client1.lastName === client2.lastName) {
                    // Determine head of household
                    const headClientId = hh.headOfHousehold ? hh.headOfHousehold._id.toString() : null;
                    const headClient = householdClients.find(c => c._id.toString() === headClientId) || client1;
                    const otherClient = householdClients.find(c => c._id.toString() !== headClientId) || client2;

                    displayName = `${headClient.lastName}, ${headClient.firstName} & ${otherClient.firstName}`;
                } else {
                    // Different last names, use the head of household name
                    displayName = `${hh.headOfHousehold.lastName}, ${hh.headOfHousehold.firstName}`;
                }
            } else {
                // Not exactly two members, use the head of household name
                displayName = `${hh.headOfHousehold.lastName}, ${hh.headOfHousehold.firstName}`;
            }

            return {
                _id: hh._id,
                householdId: hh.householdId,
                headOfHouseholdName: displayName,
                totalAccountValue: hh.totalAccountValue ? hh.totalAccountValue.toFixed(2) : '0.00',
            };
        });

        // If limit=all, return all households without pagination
        if (limit === 0) {
            return res.json({
                households: formattedHouseholds,
                currentPage: 1,
                totalPages: 1,
                totalHouseholds: totalHouseholds,
            });
        }

        // Send the response with pagination details
        res.json({
            households: formattedHouseholds,
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            totalHouseholds: totalHouseholds,
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
            additionalMembers, // Expecting an array of additional members
        } = req.body;

        if (!firstName || !lastName) {
            return res.status(400).json({ message: 'First Name and Last Name are required.' });
        }

        // Create the household
        const household = new Household({
            owner: req.session.user._id,
        });
        await household.save();

        // Validate and sanitize the head of household's DOB
        const validHeadDob = dob && dob.trim() !== '' && Date.parse(dob) ? new Date(dob) : null;

        // Create the head of household
        const headOfHousehold = new Client({
            household: household._id,
            firstName,
            lastName,
            dob: validHeadDob, // Ensure null is explicitly set if dob is invalid or empty
            ssn: ssn || null,
            taxFilingStatus: taxFilingStatus || null,
            maritalStatus: maritalStatus || null,
            mobileNumber: mobileNumber || null,
            homePhone: homePhone || null,
            email: email || null,
            homeAddress: homeAddress || null,
        });
        await headOfHousehold.save();

        // Link head of household to the household
        household.headOfHousehold = headOfHousehold._id;
        await household.save();

       

        const additionalMemberIds = [];
        if (Array.isArray(additionalMembers)) {
            for (const memberData of additionalMembers) {
                if (memberData.firstName && memberData.lastName) {
                    // Validate and sanitize the member's DOB
                    const validMemberDob = memberData.dob && memberData.dob.trim() !== '' && Date.parse(memberData.dob)
                        ? new Date(memberData.dob)
                        : null;

                    const member = new Client({
                        household: household._id,
                        firstName: memberData.firstName,
                        lastName: memberData.lastName,
                        dob: validMemberDob, // Ensure null is explicitly set if dob is invalid or empty
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

  
  
  
  
  
  




exports.getHouseholdById = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid Household ID format.' });
        }

        // Fetch the household and verify ownership
        const household = await Household.findById(id)
            .populate('headOfHousehold')
            .lean();
        if (!household || household.owner.toString() !== req.session.user._id.toString()) {
            return res.status(403).json({ message: 'Access denied or Household not found.' });
        }

        // Fetch all clients linked to the household
        const clients = await Client.find({ household: household._id }).lean();

        res.json({ household, clients });
    } catch (err) {
        console.error('Error fetching household:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.renderHouseholdDetailsPage = async (req, res) => {
    try {
      const { id } = req.params;
  
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
        // Add more fields as needed
      ];
  
      // Fetch the household data
      const household = await Household.findById(id)
        .populate('headOfHousehold')
        .populate({
          path: 'accounts',
          populate: [
            { path: 'accountOwner', select: 'firstName lastName dob' },
            {
              path: 'beneficiaries.primary.beneficiary',
              model: 'Beneficiary',
            },
            {
              path: 'beneficiaries.contingent.beneficiary',
              model: 'Beneficiary',
            },
          ],
        })
        .lean();
  
      if (!household) {
        return res.status(404).render('error', {
          message: 'Household not found.',
          user: req.session.user,
        });
      }
  
      if (household.owner.toString() !== req.session.user._id.toString()) {
        return res.status(403).render('error', {
          message: 'Access denied.',
          user: req.session.user,
        });
      }
  
      const clients = await Client.find({ household: household._id }).lean();
      const user = req.session.user;
      const userData = {
        ...user,
        is2FAEnabled: Boolean(user.is2FAEnabled), // Ensure it's a boolean
        avatar: user.avatar || '/images/defaultProfilePhoto.png', // Set default avatar if none exists
      };
  
      // Format all client names, including the head of household
      const formattedClients = clients.map((client) => ({
        ...client,
        formattedName: `${client.lastName}, ${client.firstName}`,
      }));
  
      // Limit displayed records to only two, including the head of household
      const displayedClients = [
        {
          ...household.headOfHousehold,
          formattedName: `${household.headOfHousehold.lastName}, ${household.headOfHousehold.firstName}`,
        },
        ...formattedClients
          .filter(
            (client) => client._id.toString() !== household.headOfHousehold._id.toString()
          )
          .slice(0, 1),
      ];
  
      // Modal should now include all household members
      const modalClients = [
        {
          ...household.headOfHousehold,
          formattedName: `${household.headOfHousehold.lastName}, ${household.headOfHousehold.firstName}`,
        },
        ...formattedClients.filter(
          (client) => client._id.toString() !== household.headOfHousehold._id.toString()
        ),
      ];
  
      // Determine if the modal should be shown based on remaining members
      const additionalMembersCount = modalClients.length - displayedClients.length;
      const showMoreModal = additionalMembersCount > 0;
  
      // Fetch account types and custodians to pass to the view
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
  
      res.render('householdDetails', {
        household,
        clients,
        accounts: household.accounts,
        displayedClients, // Includes only head of household and one member
        modalClients, // All household members for tabs
        additionalMembersCount,
        formattedHeadOfHousehold: `${household.headOfHousehold.lastName}, ${household.headOfHousehold.firstName}`,
        avatar: user.avatar,
        user: userData,
        showMoreModal,
        clientFields, // Pass the clientFields array
        formatDate,
        formatSSN,
        formatPhoneNumber,
        accountTypes,
        custodians,
      });
    } catch (err) {
      console.error('Error rendering household details page:', err);
      res
        .status(500)
        .render('error', { message: 'Server error.', user: req.session.user });
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

        // Delete associated clients
        const householdObjectIds = validHouseholds.map(hh => hh._id);
        await Client.deleteMany({ household: { $in: householdObjectIds } });

        // Delete households
        await Household.deleteMany({ _id: { $in: householdObjectIds } });

        res.status(200).json({ message: 'Households and associated clients deleted successfully.' });
    } catch (error) {
        console.error('Error deleting households:', error);
        res.status(500).json({ message: 'Server error while deleting households.', error: error.message });
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

        // Fetch import history for the user, sorted by newest first
        const importReports = await ImportReport.find({ user: userId })
            .sort({ createdAt: -1 })
            .lean();

        res.render('import', {
            user: user,
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
      const userId = req.session.user._id;
  
      // Find the household and ensure it belongs to the user
      const household = await Household.findOne({ _id: householdId, owner: userId });
      if (!household) {
        return res.status(404).json({ success: false, message: 'Household not found.' });
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
  