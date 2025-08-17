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


const Liability       = require('../models/Liability');         // NEW
const Asset           = require('../models/Asset');             // NEW
const ValueAdd        = require('../models/ValueAdd');          // NEW
const ImportedAdvisor = require('../models/ImportedAdvisor');   // NEW
const RedtailAdvisor  = require('../models/RedtailAdvisor');    // NEW
const Surge           = require('../models/Surge');           // ← for surge metadata
const SurgeSnapshot   = require('../models/SurgeSnapshot');   // ← for prepared-at snapshots
const { generatePreSignedUrl } = require('../utils/s3');       



const CompanyID = require('../models/CompanyID');

const ImportReport = require('../models/ImportReport');


const {
  validateGuardrailsInputs,
  calculateGuardrails
} = require('../services/valueadds/guardrailsService');

const {
  validateBucketsInputs,
  calculateBuckets
} = require('../services/valueadds/bucketsService');

// paths we usually ignore in audit diffs
const AUDIT_IGNORE = new Set(['__v', 'createdAt', 'updatedAt']);

// get nested value by dotted path: 'leadAdvisors.0'
function getByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}



// ─────────────────────────────────────────────────────────────
// CLIENT AUDIT HELPERS
// ─────────────────────────────────────────────────────────────
function attachClientCreateCtx(doc, baseCtx, householdId) {
  doc.$locals = doc.$locals || {};
  doc.$locals.activityCtx = {
    ...baseCtx,
    entity: 'Client',
    action: 'CREATE',
    snapshot: doc.toObject({ depopulate: true }),
    household: householdId || doc.household || undefined
  };
}

function attachClientUpdateCtx(doc, beforeObj, baseCtx, householdId) {
  const changedPaths = doc.modifiedPaths().filter(p => !AUDIT_IGNORE.has(p));
  if (!changedPaths.length) return null;

  const fieldsChanged = {};
  for (const p of changedPaths) {
    fieldsChanged[p] = { from: getByPath(beforeObj, p), to: doc.get(p) };
  }

  doc.$locals = doc.$locals || {};
  doc.$locals.activityCtx = {
    ...baseCtx,
    entity: 'Client',
    action: 'UPDATE',
    fieldsChanged,
    household: householdId || doc.household || undefined
  };

  return fieldsChanged;
}




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
                      computedName = `${lastName}, ${firstName} & ${secondLastName}, ${secondFirstName}`;
                  }
              } else {
                  // More than two members, fallback to HOH
                  computedName = `${lastName}, ${firstName}`;
              }
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
          },
      // NEW: lookup all Accounts for this household
      {
        $lookup: {
          from: 'accounts',
          localField: '_id',
          foreignField: 'household',
          as: 'accounts'
        }
      },
      // NEW: sum their accountValue into totalAccountValue
      {
        $addFields: {
          totalAccountValue: { $sum: '$accounts.accountValue' }
        }
      }
      ];

      if (search) {
        const searchTerm = search.trim();
        const [lastNameSearch, firstNameSearch] = searchTerm.split(',').map(s => s.trim());
      
        initialPipeline.push({
          $lookup: {
            from: 'clients',
            localField: '_id',
            foreignField: 'household',
            as: 'allClients'
          }
        });
      
        const searchConditions = [];
      
        if (firstNameSearch) {
          // Search format: "Smith, John"
          searchConditions.push({
            $and: [
              { 'allClients.firstName': { $regex: firstNameSearch, $options: 'i' } },
              { 'allClients.lastName': { $regex: lastNameSearch, $options: 'i' } }
            ]
          });
        } else {
          // Search by just one word (last name or general match)
          searchConditions.push(
            { 'allClients.firstName': { $regex: searchTerm, $options: 'i' } },
            { 'allClients.lastName': { $regex: searchTerm, $options: 'i' } }
          );
        }
      
        initialPipeline.push({ $match: { $or: searchConditions } });
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



      // If no results
      if (!results || results.length === 0) {

          return res.json({ households: [], currentPage: page, totalPages: 0, totalHouseholds: 0 });
      }

      // Houses from facet
      const households = results[0].households;
      const total = results[0].totalCount.length > 0 ? results[0].totalCount[0].total : 0;
      const totalPages = limit === 0 ? 1 : Math.ceil(total / limit);

     
         if (sortField === 'totalAccountValue') {
           // Ascending
           households.sort((a, b) => a.totalAccountValue - b.totalAccountValue);
           if (sortOrder === 'desc') {
             households.reverse(); // Flip for descending
           }
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
                    computedName = `${lastName}, ${firstName} & ${secondLastName}, ${secondFirstName}`;
                }
            } else {
                // More than two members, fallback to HOH
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
        marginalTaxBracket,
      } = req.body;
  
      if (!firstName || !lastName) {
        return res.status(400).json({ message: 'First Name and Last Name are required.' });
      }
  
      const user = req.session.user;
      const household = new Household({
        owner: user._id,
        firmId: user.firmId,
        marginalTaxBracket: marginalTaxBracket !== undefined && marginalTaxBracket !== ''
        ? Number(marginalTaxBracket)
        : null
      });
      household.$locals = household.$locals || {};
      household.$locals.activityCtx = req.activityCtx;      // ← log CREATE
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

      attachClientCreateCtx(headOfHousehold, req.activityCtx || {}, household._id);
      console.log('[createHousehold] Client CREATE (HOH)', {
        firstName: headOfHousehold.firstName,
        lastName: headOfHousehold.lastName
      });



      await headOfHousehold.save();
      household.headOfHousehold = headOfHousehold._id;
      household.$locals.activityCtx = req.activityCtx;
      await household.save();
  
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

      household.$locals.activityCtx = req.activityCtx; 
  
      await household.save();
      console.log('Household leadAdvisors after saving:', household.leadAdvisors);
  
      household.headOfHousehold = headOfHousehold._id;
      household.$locals.activityCtx = req.activityCtx; 
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

            attachClientCreateCtx(member, req.activityCtx || {}, household._id);
            console.log('[createHousehold] Client CREATE (additional member)', {
              firstName: member.firstName, lastName: member.lastName
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
      // ──── NEW: load all prepared packets for this household ────
console.log('[householdController] loading packets for household:', id);
const snaps = await SurgeSnapshot
  .find({ household: id })
  .sort('-preparedAt')
  .lean();

// grab the parent Surge docs
const surgeIds = snaps.map(s => s.surgeId);
const surges   = await Surge
  .find({ _id: { $in: surgeIds } })
  .select('name startDate endDate')
  .lean();
const surgeById = Object.fromEntries(surges.map(s => [s._id.toString(), s]));

// build a simple array your template can loop over
const packets = await Promise.all(snaps.map(async snap => {
  const meta = surgeById[snap.surgeId.toString()] || {};
  return {
    surgeName : meta.name    || '(deleted surge)',
    startDate : meta.startDate,
    endDate   : meta.endDate,
    packetUrl : await generatePreSignedUrl(snap.packetKey, 60*60)
  };
}));
console.log('[householdController] → packets.length =', packets.length);

      console.log(`Household ID param: ${id}`);

      // ---------------------------------------------------------------------
      // NEW LINES: Determine which tab is active based on the URL path
      // ---------------------------------------------------------------------
      let activeTab = 'client-info';
      if (req.path.endsWith('/accounts')) {
        activeTab = 'accounts';
      } else if (req.path.endsWith('/value-adds')) {
        activeTab = 'value-adds';
      } else if (req.path.endsWith('/assets')) {
        activeTab = 'assets';
      } else if (req.path.endsWith('/liabilities')) {
        activeTab = 'liabilities';
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
          select: 'bucketsEnabled bucketsTitle bucketsDisclaimer guardrailsEnabled guardrailsTitle guardrailsDisclaimer beneficiaryEnabled beneficiaryTitle beneficiaryDisclaimer netWorthEnabled netWorthTitle netWorthDisclaimer bucketsAvailableRate bucketsUpperRate bucketsLowerRate guardrailsAvailableRate guardrailsUpperRate guardrailsLowerRate homeworkEnabled homeworkTitle homeworkDisclaimer'
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
// Calculate totals (account value + monthly distribution)
// ---------------------------------------------------------------------
const { totalMonthlyDistribution } = require('../services/monthlyDistribution');

let totalAccountValue      = 0;
let monthlyDistribution    = 0;

// Safety: make sure we have an array
const accountArr = Array.isArray(householdDoc.accounts) ? householdDoc.accounts : [];

// 1) Total household account value
totalAccountValue = accountArr.reduce(
  (sum, acc) => sum + (Number(acc.accountValue) || 0),
  0
);

// 2) Total monthly distribution ($)
//    This helper handles both the new `systematicWithdrawals` array
//    **and** the legacy scalar fields, so no extra switch‑case needed.
monthlyDistribution = totalMonthlyDistribution(accountArr);


      if (householdDoc.accounts && Array.isArray(householdDoc.accounts)) {
        householdDoc.accounts.forEach((account) => {


          // Convert systematicWithdrawAmount to monthly
          if (account.systematicWithdrawAmount && account.systematicWithdrawAmount > 0) {
            let monthlyAmount = 0;
            switch (account.systematicWithdrawFrequency) {
              case 'Quarterly':
                monthlyAmount = account.systematicWithdrawAmount / 3;
              break;
              case 'Semi-annual':
                monthlyAmount = account.systematicWithdrawAmount / 6;
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
      householdDoc.totalAccountValue = totalAccountValue;
      householdDoc.actualMonthlyDistribution = monthlyDistribution;

      // 3) Save the doc so future Value Adds can pull correct data
      await householdDoc.save();

// ------------------------------------------------------------
// AUTOMATICALLY GENERATE / UPDATE VALUE‑ADDS
// (Buckets, Guardrails, Beneficiary, Net‑Worth)
// ------------------------------------------------------------
async function autoGenerateValueAdd(hhDoc, type) {
  // 1) Upsert the ValueAdd shell
  let valAdd = await ValueAdd.findOne({ household: hhDoc._id, type });
  if (!valAdd) {
    valAdd = new ValueAdd({ household: hhDoc._id, type });
  }

  // 2) Pull firm‑level settings (needed for explicit rates)
  const firm = await CompanyID.findById(hhDoc.firmId).lean();

  // 3) Normalise household numbers
  const householdWithSum = {
    ...hhDoc.toObject(),
    accounts: hhDoc.accounts || [],
    totalAccountValue: hhDoc.totalAccountValue || 0,
    actualMonthlyDistribution: hhDoc.actualMonthlyDistribution || 0,
    firm,
  };

  /* ---------- BUCKETS ---------- */
  if (type === 'BUCKETS') {
    // If user has not supplied an explicit rate, calculate a “current” one
    let distributionRate = 0;
    if (
      householdWithSum.totalAccountValue > 0 &&
      householdWithSum.actualMonthlyDistribution > 0
    ) {
      distributionRate =
        (householdWithSum.actualMonthlyDistribution * 12) /
        householdWithSum.totalAccountValue;
    }

    const bucketsData = calculateBuckets(householdWithSum, {
      distributionRate,
      distributionRate : firm?.bucketsAvailableRate ?? distributionRate,
      upperRate        : firm?.guardrailsUpperRate,
      lowerRate        : firm?.guardrailsLowerRate,
      // keep existing factor logic (upper = *0.8, lower = *1.2)

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

  /* ---------- GUARDRAILS ---------- */
  if (type === 'GUARDRAILS') {
    // Use explicit firm‑level rates if present; otherwise fall back to factors
    const guardrailsData = calculateGuardrails(householdWithSum, {
      distributionRate : firm?.guardrailsAvailableRate,   // correct param name
      upperRate     : firm?.guardrailsUpperRate,
      lowerRate     : firm?.guardrailsLowerRate,
      // fallback multiplicative factors

    });

    valAdd.currentData = guardrailsData;
    valAdd.history.push({ date: new Date(), data: guardrailsData });
    await valAdd.save();

    console.log('[autoGenerateValueAdd] GUARDRAILS doc =>', valAdd);
  }
}

// 4) Generate or update all four value‑adds
await autoGenerateValueAdd(householdDoc, 'BUCKETS');
await autoGenerateValueAdd(householdDoc, 'GUARDRAILS');
await autoGenerateValueAdd(householdDoc, 'BENEFICIARY');
await autoGenerateValueAdd(householdDoc, 'NET_WORTH');
await autoGenerateValueAdd(householdDoc, 'HOMEWORK');

// 5) Force a quick re‑query so we have the latest docs in memory
await ValueAdd.find({ household: householdDoc._id }).lean();

// 6) Convert the household document to a plain object
const household = householdDoc.toObject();

/* -------------------------------------------------------------------------
 *  Flag if ANY account has beneficiaries
 * -----------------------------------------------------------------------*/
let hasAnyBeneficiary = false;

if (Array.isArray(household.accounts)) {
  for (const acct of household.accounts) {
    const primaryCnt    = acct.beneficiaries?.primary?.length     || 0;
    const contingentCnt = acct.beneficiaries?.contingent?.length  || 0;
    if (primaryCnt > 0 || contingentCnt > 0) {
      hasAnyBeneficiary = true;
      break;
    }
  }
}

const beneficiaryVA = await ValueAdd.findOne({
  household: householdDoc._id,
  type: 'BENEFICIARY',
}).lean();

const homeworkVA = await ValueAdd.findOne({
  household: householdDoc._id,
  type: 'HOMEWORK',
}).lean();

let beneficiaryHasWarnings =
  Array.isArray(beneficiaryVA?.warnings) && beneficiaryVA.warnings.length > 0;

let homeworkHasWarnings =
  Array.isArray(homeworkVA?.warnings) && homeworkVA.warnings.length > 0;


      let annualBilling = household.annualBilling;
      if (!annualBilling || annualBilling <= 0) {
        annualBilling = null;
      }

      // ---------------------------------------------------------------------
      // Fetch all clients in the household
      // ---------------------------------------------------------------------
      const clients = await Client.find({ household: household._id }).lean({ virtuals: true });

      // // 1) Calculate the Household's total annual income from all Clients
      // const householdAnnualIncome = calculateHouseholdAnnualIncome(clients);

      // // 2) Determine the household's actual filing status
      // const filingStatus = household.taxFilingStatus || 'Single';

      // // 3) Get marginal tax bracket
      // const marginalTaxBracket = getMarginalTaxBracket(householdAnnualIncome, filingStatus);
      const marginalTaxBracket = household.marginalTaxBracket;


      clients.forEach((c, i) => {
        console.log(`Client #${i + 1}:`, {
          _id: c._id,
          firstName: c.firstName,
          lastName: c.lastName,
          dob: c.dob,
          age: c.age,
        });
      });

      // Map each client's total Account Value
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
        client.totalAccountValue = assetMap[client._id.toString()] || 0;
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
            userHouseholdId: household.userHouseholdId || null,
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
              'Individual',
              'Brokerage',
              'Joint Tenants',
              'Joint',
              'Tenants in Common',
              'Community Property',
              'TOD',
              'Transfer on Death',
              'Custodial',
              'UTMA',
              'UGMA',
              'Corporate Account',
              'Partnership Account',
              'LLC Account',
              'Sole Proprietorship',
              'IRA',
              'Roth IRA',
              'Inherited IRA',
              'SEP IRA',
              'Simple IRA',
              '401(k)',
              'Solo 401(k)',
              '403(b)',
              '457(b)',
              'Pension Plan',
              'Profit Sharing Plan',
              'Keogh Plan',
              'Rollover IRA',
              'Beneficiary IRA',
              '529 Plan',
              'Coverdell ESA',
              'Trust',
              'Revocable Trust',
              'Irrevocable Trust',
              'Testamentary Trust',
              'Charitable Remainder Trust',
              'Estate',
              'Conservatorship',
              'Guardianship',
              'Annuity',
              'Variable Annuity',
              'Fixed Annuity',
              'Deferred Annuity',
              'Immediate Annuity',
              'Equity-Indexed Annuity',
              'Registered Index-Linked Annuity (RILA)',
              'Checking Account',
              'Savings Account',
              'Money Market Account',
              'Certificate of Deposit (CD)',
              'Health Savings Account (HSA)',
              'Flexible Spending Account (FSA)',
              'Donor-Advised Fund',
              'Charitable Lead Trust',
              'Municipal Account',
              'Endowment',
              'Foundation',
              'Other',
            ],
            custodians: [
              'Fidelity','Morgan Stanley','Vanguard','Charles Schwab','TD Ameritrade','Other'
            ],
            householdData: {},
            hasAnyBeneficiary,
            beneficiaryEnabled: householdDoc.firmId.beneficiaryEnabled,
            homeworkEnabled: householdDoc.firmId.homeworkEnabled,
            beneficiaryHasWarnings,
            homeworkHasWarnings,
            totalAccountValue: 0,
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

      const LIABILITY_TYPES = [
        'Auto Loan',
        'Boat Loan',
        'Business Loan',
        'Construction Loan',
        'Credit Card',
        'Credit Card Debt',
        'Equipment Loan',
        'HELOC',
        'Home Equity Loan',
        'Home Loan (Primary Residence)',
        'Home Loan (Secondary)',
        'Home Loan',
        'Investment Property Loan',
        'Legal Settlement Obligation (LSO)',
        'Line of Credit',
        'Lines of Credit',
        'Margin Loan',
        'Medical Debt',
        'Medical Payment Plan',
        'Mortgage',
        'Motorcycle Loan',
        'Payday Loan',
        'Personal Loan',
        'RV Loan',
        'Student Loan',
        'Tax Liability',
        'Vehicle Loan',
        'Other'
      ];
      

      const ASSET_TYPES = [
        'Home (Primary Residence)',
        'Home (Secondary Residence)',
        'Cash',
        'Investment',
        'Real Estate',
        'Business',
        'Vehicle',
        'Other',
      ]

      const accountTypes = [
        'Individual',
        'Brokerage',
        'Joint Tenants',
        'Joint',
        'Tenants in Common',
        'Community Property',
        'TOD',
        'Transfer on Death',
        'Custodial',
        'UTMA',
        'UGMA',
        'Corporate Account',
        'Partnership Account',
        'LLC Account',
        'Sole Proprietorship',
        'IRA',
        'Roth IRA',
        'Traditional IRA',
        'Inherited IRA',
        'SEP IRA',
        'Simple IRA',
        '401(k)',
        'Solo 401(k)',
        '403(b)',
        '457(b)',
        'Pension Plan',
        'Profit Sharing Plan',
        'Keogh Plan',
        'Rollover IRA',
        'Beneficiary IRA',
        '529 Plan',
        'Coverdell ESA',
        'Trust',
        'Revocable Trust',
        'Irrevocable Trust',
        'Testamentary Trust',
        'Charitable Remainder Trust',
        'Estate',
        'Conservatorship',
        'Guardianship',
        'Annuity',
        'Variable Annuity',
        'Fixed Annuity',
        'Deferred Annuity',
        'Immediate Annuity',
        'Equity-Indexed Annuity',
        'Registered Index-Linked Annuity (RILA)',
        'Checking Account',
        'Savings Account',
        'Money Market Account',
        'Certificate of Deposit (CD)',
        'Health Savings Account (HSA)',
        'Flexible Spending Account (FSA)',
        'Donor-Advised Fund',
        'Charitable Lead Trust',
        'Municipal Account',
        'Endowment',
        'Foundation',
        'Other',
      ];

      const custodians = [
        'Fidelity',
        'Charles Schwab',
        'TD Ameritrade',
        'Vanguard',
        'Morgan Stanley',
        'Merrill Lynch',
        'Pershing',
        'Raymond James',
        'Wells Fargo',
        'LPL Financial',
        'Apex Clearing',
        'Altruist',
        'SEI Private Trust',
        'Equity Trust',
        'Kingdom Trust',
        'Pacific Premier Trust',
        'Millennium Trust',
        'U.S. Bank',
        'First Clearing',
        'Interactive Brokers',
        'DriveWealth',
        'TradeStation',
        'Robinhood',
        'SS&C Advent',
        'Empower Retirement',
        'Ascensus',
        'T. Rowe Price',
        'Transamerica',
        'John Hancock',
        'Voya',
        'Newport Trust',
        'GoldStar Trust',
        'Reliance Trust',
        'Coinbase Custody',
        'Gemini Trust',
        'Anchorage Digital',
        'BitGo Trust',
        'Bakkt',
        'Other'
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

      const totalAccountValueRounded   = Math.round(totalAccountValue);
      const monthlyDistributionRounded = Math.round(monthlyDistribution);

      // Render the page
      res.render('householdDetails', {
        household,
        userHouseholdId: household.userHouseholdId || null,
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
        LIABILITY_TYPES,
        ASSET_TYPES,
        householdData,
        totalAccountValueRounded,
        monthlyDistributionRounded,
        marginalTaxBracket,
        annualBilling,
        householdId: household._id.toString(),
        hasAnyBeneficiary,
        beneficiaryEnabled: householdDoc.firmId.beneficiaryEnabled,
        beneficiaryHasWarnings,
        homeworkEnabled: householdDoc.firmId.homeworkEnabled,
        homeworkHasWarnings,

        // Pass the new variable so the Pug template knows which tab is active
        activeTab: activeTab,
        packets,  
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


/***********************************************************************
 *  PRIVATE HELPER – purgeHouseholds
 *  ---------------------------------------------------------------
 *  Executes the full cascade‑deletion for one or many households:
 *    • Households                • Clients
 *    • Accounts                  • Liabilities
 *    • Assets                    • Value‑Add snapshots / docs
 *    • *Un‑linked* ImportedAdvisors  (CSV imports)
 *    • *Un‑linked* RedtailAdvisors   (Redtail sync)
 **********************************************************************/
async function purgeHouseholds(user, householdObjectIds, ctx, { logEachHousehold = true } = {}) {
  // -----------------------------------
  // 1) Pull all clients in the households
  // -----------------------------------
  const clients = await Client.find(
    { household: { $in: householdObjectIds } },
    '_id leadAdvisorFirstName leadAdvisorLastName contactLevelServicingAdvisorId contactLevelWritingAdvisorId'
  );
  const clientIds = clients.map(c => c._id);

  // -----------------------------------
  // 2) Collect advisor names/IDs (Imported/Redtail) to prune unlinked only
  // -----------------------------------
  const importedNameSet = new Set();
  const redtailIdSet    = new Set();

  const householdsMeta = await Household.find(
    { _id: { $in: householdObjectIds } },
    'leadAdvisorFirstName leadAdvisorLastName redtailServicingAdvisorId redtailWritingAdvisorId'
  ).lean();

  householdsMeta.forEach(hh => {
    const full = [hh.leadAdvisorFirstName, hh.leadAdvisorLastName].filter(Boolean).join(' ').trim();
    if (full) importedNameSet.add(full);
    if (hh.redtailServicingAdvisorId) redtailIdSet.add(hh.redtailServicingAdvisorId);
    if (hh.redtailWritingAdvisorId)   redtailIdSet.add(hh.redtailWritingAdvisorId);
  });

  clients.forEach(cl => {
    const full = [cl.leadAdvisorFirstName, cl.leadAdvisorLastName].filter(Boolean).join(' ').trim();
    if (full) importedNameSet.add(full);
    if (cl.contactLevelServicingAdvisorId) redtailIdSet.add(cl.contactLevelServicingAdvisorId);
    if (cl.contactLevelWritingAdvisorId)   redtailIdSet.add(cl.contactLevelWritingAdvisorId);
  });

  const importedNames = [...importedNameSet];
  const redtailIds    = [...redtailIdSet];

  // -----------------------------------
  // 3) Delete dependent collections first
  // -----------------------------------
  await Promise.all([
    // Accounts
    Account.deleteMany({
      $or: [
        { household: { $in: householdObjectIds } },
        { accountOwner: { $in: clientIds } },
      ],
    }),

    // Liabilities
    Liability.deleteMany({
      $or: [
        { household: { $in: householdObjectIds } },
        { owners:    { $in: clientIds } },
      ],
    }),

    // Assets
    Asset.deleteMany({ owners: { $in: clientIds } }),

    // Value‑Adds
    ValueAdd.deleteMany({ household: { $in: householdObjectIds } }),

    // Clients
    Client.deleteMany({ _id: { $in: clientIds } }),

    // Imported Advisors – only those still unlinked
    importedNames.length
      ? ImportedAdvisor.deleteMany({
          firmId: user.firmId,
          importedAdvisorName: { $in: importedNames },
          linkedUser: null,
        })
      : Promise.resolve(),

    // Redtail Advisors – only those still unlinked
    redtailIds.length
      ? RedtailAdvisor.deleteMany({
          firmId: user.firmId,
          redtailAdvisorId: { $in: redtailIds },
          linkedUser: null,
        })
      : Promise.resolve(),
  ]);

  // -----------------------------------
  // 4) Delete each Household with auditing
  // -----------------------------------
  if (logEachHousehold) {
    for (const hhId of householdObjectIds) {
      await Household.findOneAndDelete({ _id: hhId }, { activityCtx: ctx });
    }
  } else {
    // Fallback: one big delete (no per-doc audit)
    await Household.deleteMany({ _id: { $in: householdObjectIds } });
  }
}




/***********************************************************************
 *  DELETE‑MULTIPLE HOUSEHOLDS
 **********************************************************************/
exports.deleteHouseholds = async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'User not authenticated.' });
  }

  try {
    const { householdIds } = req.body;

    if (!householdIds || !Array.isArray(householdIds) || householdIds.length === 0) {
      return res.status(400).json({ message: 'No household IDs provided.' });
    }

    // Only allow households owned by the current user
    const validHouseholds = await Household.find({
      _id:   { $in: householdIds },
      owner: req.session.user._id,
    }, '_id');

    if (validHouseholds.length !== householdIds.length) {
      return res.status(403).json({ message: 'One or more households do not belong to the user.' });
    }

    const householdObjectIds = validHouseholds.map(hh => hh._id);

    // ---- FULL CASCADE DELETION ----
    await purgeHouseholds(
      req.session.user,
      householdObjectIds,
      req.activityCtx,                 // ← pass ctx
      { logEachHousehold: true }       // ← per-document audit log
    );

    return res.status(200).json({ message: 'Households and all associated data deleted successfully.' });
  } catch (error) {
    console.error('Error deleting households:', error);
    return res.status(500).json({ message: 'Server error while deleting households.', error: error.message });
  }
};




/***********************************************************************
 *  DELETE‑SINGLE HOUSEHOLD
 *  – re‑uses the same helper for consistency
 **********************************************************************/
exports.deleteSingleHousehold = async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: 'Not authorized.' });
  }

  try {
    const householdId = req.params.id;

    const household = await Household.findOne(
      { _id: householdId, owner: req.session.user._id },
      '_id'
    );
    if (!household) {
      return res.status(404).json({ message: 'Household not found or not accessible.' });
    }

    await purgeHouseholds(
      req.session.user,
      [household._id],
      req.activityCtx,                 // ← pass ctx
      { logEachHousehold: true }       // ← per-document audit log
    );

    return res.json({ message: 'Household and all associated data deleted successfully.' });
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
        const logoPath = path.join(__dirname, '..', 'public', 'images', 'surgeTKLogo.png'); // Ensure this path is correct
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
                <title>Import Report | SurgeTk</title>
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
                        color: #000000 !important;
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
                    ${createTable(importReport.createdRecords, importReport.importType, 'created')}
                </div>

                <div class="section">
                    <h3>Updated Records</h3>
                    ${createTable(importReport.updatedRecords, importReport.importType, 'updated')}
                </div>

                <div class="section">
                    <h3>Failed Records</h3>
                    ${createTable(importReport.failedRecords, importReport.importType, 'failed')}
                </div>

                <div class="section">
                    <h3>Duplicate Records</h3>
                    ${createTable(importReport.duplicateRecords, importReport.importType, 'duplicates')}
                </div>
            </body>
            </html>
        `;

        // Function to create HTML tables, dynamically switching columns for "Contact" or "Account" imports
        function createTable(records, importType, recordType) {
            if (records.length === 0) {
                return '<p style="font-size:8px; font-style:italic;">No records found.</p>';
            }

            let headers = [];
            let keys = [];

            // If importType is 'Account Data Import', we use account-based columns
            // Otherwise, we use contact-based columns
            if (importType === 'Account Data Import' || importType === 'Liability Import' || importType === 'Asset Import') {
                // For account imports
                switch (recordType) {
                    case 'created':
                        headers = ['Account Number', 'Owner Name'];
                        keys = ['accountNumber', 'accountOwnerName'];
                        break;
                    case 'updated':
                        headers = ['Account Number', 'Owner Name', 'Updated Fields'];
                        keys = ['accountNumber', 'accountOwnerName', 'updatedFields'];
                        break;
                    case 'failed':
                    case 'duplicates':
                        headers = ['Account Number', 'Owner Name', 'Reason'];
                        keys = ['accountNumber', 'accountOwnerName', 'reason'];
                        break;
                }
            } else {
                // For contact imports (or household, anything else)
                switch (recordType) {
                    case 'created':
                        headers = ['First Name', 'Last Name'];
                        keys = ['firstName', 'lastName'];
                        break;
                    case 'updated':
                        headers = ['First Name', 'Last Name', 'Updated Fields'];
                        keys = ['firstName', 'lastName', 'updatedFields'];
                        break;
                    case 'failed':
                    case 'duplicates':
                        headers = ['First Name', 'Last Name', 'Reason'];
                        keys = ['firstName', 'lastName', 'reason'];
                        break;
                }
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
                    // If we're showing updated fields, join them as a string
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
                test: false,
                prince_options: {
                    media: 'screen', // Use screen styles instead of print
                    baseurl: `${req.protocol}://${req.get('host')}`, // For absolute URLs in accounts
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
        if (!res.headersSent) {
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
    const startedAt = Date.now();
    const householdId = req.params.id;
    const user = req.session.user;
    const userId = user._id;

    console.log('[updateHousehold] START', {
      householdId,
      byUser: userId?.toString?.(),
      firmId: user.firmId?.toString?.()
    });

    // ─────────────────────────────────────────────────────────────
    // Local helpers (self-contained so you can paste this function)
    // ─────────────────────────────────────────────────────────────
    const AUDIT_IGNORE = new Set(['__v', 'createdAt', 'updatedAt']);
    const getByPath = (obj, path) =>
      path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

    // Compare two arrays of ObjectIds/strings ignoring order
    const idsEqual = (a = [], b = []) => {
      if (a.length !== b.length) return false;
      const as = a.map(x => x.toString()).sort();
      const bs = b.map(x => x.toString()).sort();
      for (let i = 0; i < as.length; i++) if (as[i] !== bs[i]) return false;
      return true;
    };

    // Normalize user input like "22", "22%", "0.22", " 22 % "
    const normalizeTaxBracketInput = (raw) => {
      if (raw === undefined) return undefined;       // not provided
      if (raw === null || raw === '') return null;   // explicit clear
      let s = String(raw).trim();
      const hadPercent = s.endsWith('%');
      if (hadPercent) s = s.slice(0, -1);
      s = s.replace(/,/g, '').trim();
      let n = Number(s);
      if (!Number.isFinite(n)) return null;          // treat bad input as clearing
      if (!hadPercent && n > 0 && n <= 1) n = n * 100; // allow 0.22 => 22
      if (n < 0) n = 0;
      if (n > 100) n = 100;
      n = Math.round(n * 100) / 100;                 // 2 decimals
      return n;
    };

    // Useful for structured logging
    const baseCtx = req.activityCtx || {};
    const logCtx = { householdId, byUser: userId?.toString?.() };

    // Find the household and ensure it belongs to the user + firm
    const household = await Household.findOne({
      _id: householdId,
      owner: userId,
      firmId: user.firmId
    });

    if (!household) {
      console.warn('[updateHousehold] Household not found or not accessible', logCtx);
      return res
        .status(404)
        .json({ success: false, message: 'Household not found or not accessible.' });
    }

    // Snapshot BEFORE changes so we can compute diffs later
    const before = household.toObject({ depopulate: true });
    console.log('[updateHousehold] Loaded household BEFORE snapshot', {
      headOfHousehold: before.headOfHousehold?.toString?.(),
      leadAdvisorsCount: (before.leadAdvisors || []).length,
      marginalTaxBracket: before.marginalTaxBracket
    });

    // ─────────────────────────────────────────────────────────────
    // Update Head of Household (Client) and audit its diffs
    // ─────────────────────────────────────────────────────────────
    const headClientId = household.headOfHousehold;
    const headClient = headClientId ? await Client.findById(headClientId) : null;

    if (headClient) {
      const headBefore = headClient.toObject({ depopulate: true });

      headClient.firstName       = req.body.firstName       || headClient.firstName;
      headClient.lastName        = req.body.lastName        || headClient.lastName;
      headClient.dob             = req.body.dob ? parseDateFromInput(req.body.dob) : headClient.dob;
      headClient.ssn             = req.body.ssn             || headClient.ssn;
      headClient.taxFilingStatus = req.body.taxFilingStatus || headClient.taxFilingStatus;
      headClient.maritalStatus   = req.body.maritalStatus   || headClient.maritalStatus;
      headClient.mobileNumber    = req.body.mobileNumber    || headClient.mobileNumber;
      headClient.homePhone       = req.body.homePhone       || headClient.homePhone;
      headClient.email           = req.body.email           || headClient.email;
      headClient.homeAddress     = req.body.homeAddress     || headClient.homeAddress;

      const headChangedPaths = headClient.modifiedPaths().filter(p => !AUDIT_IGNORE.has(p));
      if (headChangedPaths.length) {
        const headFieldsChanged = {};
        for (const p of headChangedPaths) {
          headFieldsChanged[p] = { from: getByPath(headBefore, p), to: headClient.get(p) };
        }
        headClient.$locals = headClient.$locals || {};
        headClient.$locals.activityCtx = {
          ...baseCtx,
          entity: 'Client',
          action: 'UPDATE',
          fieldsChanged: headFieldsChanged,
          household: household._id
        };
        console.log('[updateHousehold] HOH updated', { changedPaths: headChangedPaths, headClientId: headClient._id.toString() });
      } else {
        console.log('[updateHousehold] HOH had no changes to persist');
      }
      await headClient.save();
    } else {
      console.log('[updateHousehold] No Head of Household doc found to update');
    }

    // ─────────────────────────────────────────────────────────────
    // Handle leadAdvisors ONLY if the payload includes it
    // ─────────────────────────────────────────────────────────────
    let leadAdvisorsChange = null; // { from: string[], to: string[] }
    let nextAdvisorIdsForUpdate = null;

    if (Object.prototype.hasOwnProperty.call(req.body, 'leadAdvisors')) {
      let leadAdvisors = req.body.leadAdvisors;
      if (typeof leadAdvisors === 'string') {
        leadAdvisors = leadAdvisors.split(',').map(id => id.trim()).filter(Boolean);
      }
      if (!Array.isArray(leadAdvisors)) {
        console.warn('[updateHousehold] Invalid leadAdvisors payload (not an array/string)', { providedType: typeof req.body.leadAdvisors });
        return res.status(400).json({
          success: false,
          message: 'leadAdvisors must be an array or comma-separated string.'
        });
      }

      const validAdvisors = await User.find({
        _id: { $in: leadAdvisors },
        firmId: user.firmId,
        roles: { $in: ['leadAdvisor'] }
      }).select('_id');

      const nextAdvisorIds = validAdvisors.map(v => v._id);
      const currAdvisorIds = (household.leadAdvisors || []).map(id => id);

      console.log('[updateHousehold] leadAdvisors compare', {
        current: currAdvisorIds.map(x => x.toString()).sort(),
        next: nextAdvisorIds.map(x => x.toString()).sort(),
        providedCount: Array.isArray(leadAdvisors) ? leadAdvisors.length : 0,
        validCount: validAdvisors.length
      });

      if (!idsEqual(currAdvisorIds, nextAdvisorIds)) {
        household.leadAdvisors = nextAdvisorIds; // update the in-memory doc (we'll persist via FOU)
        nextAdvisorIdsForUpdate = nextAdvisorIds; // keep for $set
        leadAdvisorsChange = {
          from: currAdvisorIds.map(x => x.toString()).sort(),
          to:   nextAdvisorIds.map(x => x.toString()).sort()
        };
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Handle additional members ONLY if the payload includes it
    // ─────────────────────────────────────────────────────────────
    if (Object.prototype.hasOwnProperty.call(req.body, 'additionalMembers')) {
      const additionalMembers = req.body.additionalMembers;
      if (!Array.isArray(additionalMembers)) {
        console.warn('[updateHousehold] additionalMembers provided but not an array');
        return res
          .status(400)
          .json({ success: false, message: 'additionalMembers must be an array when provided.' });
      }

      console.log('[updateHousehold] Processing additionalMembers', { count: additionalMembers.length });

      const membersToUpdate = [];
      const membersToCreate = [];
      const keepIds = [];
      let updatedCount = 0;
      let createdCount = 0;
      let deletedCount = 0;

      for (const memberData of additionalMembers) {
        if (memberData._id) {
          membersToUpdate.push(memberData);
          keepIds.push(new mongoose.Types.ObjectId(memberData._id));
        } else {
          membersToCreate.push(memberData);
        }
      }

      // Update existing members
      for (const memberData of membersToUpdate) {
        const member = await Client.findById(memberData._id);
        if (member) {
          const memberBefore = member.toObject({ depopulate: true });

          member.firstName       = memberData.firstName       || member.firstName;
          member.lastName        = memberData.lastName        || member.lastName;
          member.dob             = memberData.dob ? parseDateFromInput(memberData.dob) : member.dob;
          member.ssn             = memberData.ssn             || member.ssn;
          member.taxFilingStatus = memberData.taxFilingStatus || member.taxFilingStatus;
          member.maritalStatus   = memberData.maritalStatus   || member.maritalStatus;
          member.mobileNumber    = memberData.mobileNumber    || member.mobileNumber;
          member.homePhone       = memberData.homePhone       || member.homePhone;
          member.email           = memberData.email           || member.email;
          member.homeAddress     = memberData.homeAddress     || member.homeAddress;

          const memberChangedPaths = member.modifiedPaths().filter(p => !AUDIT_IGNORE.has(p));
          if (memberChangedPaths.length) {
            const memberFieldsChanged = {};
            for (const p of memberChangedPaths) {
              memberFieldsChanged[p] = { from: getByPath(memberBefore, p), to: member.get(p) };
            }
            member.$locals = member.$locals || {};
            member.$locals.activityCtx = {
              ...baseCtx,
              entity: 'Client',
              action: 'UPDATE',
              fieldsChanged: memberFieldsChanged,
              household: household._id
            };
            updatedCount++;
            console.log('[updateHousehold] Member updated', { memberId: member._id.toString(), changedPaths: memberChangedPaths });
          } else {
            console.log('[updateHousehold] Member had no changes', { memberId: member._id.toString() });
          }
          await member.save();
        } else {
          console.warn('[updateHousehold] Skipped updating: member not found', { memberId: memberData._id });
        }
      }

      // Create new members
      for (const memberData of membersToCreate) {
        const newMember = new Client({
          household: household._id,
          firmId: household.firmId,
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

        newMember.$locals = newMember.$locals || {};
        newMember.$locals.activityCtx = {
          ...baseCtx,
          entity: 'Client',
          action: 'CREATE',
          snapshot: newMember.toObject({ depopulate: true }),
          household: household._id
        };
        await newMember.save();
        keepIds.push(newMember._id);
        createdCount++;
        console.log('[updateHousehold] Member created', { newMemberId: newMember._id.toString() });
      }

      // Always keep the head of household
      if (headClientId) keepIds.push(new mongoose.Types.ObjectId(headClientId));

      // Remove members not in keepIds — audit each delete
      const toDelete = await Client.find({
        household: household._id,
        _id: { $nin: keepIds }
      }).select('_id');

      for (const { _id } of toDelete) {
        await Client.findOneAndDelete(
          { _id },
          {
            activityCtx: {
              ...baseCtx,
              entity: 'Client',
              action: 'DELETE',
              reason: 'Removed via updateHousehold.additionalMembers',
              household: household._id
            }
          }
        );
        deletedCount++;
        console.log('[updateHousehold] Member deleted', { memberId: _id.toString() });
      }

      console.log('[updateHousehold] additionalMembers summary', { updatedCount, createdCount, deletedCount });
    }

    // ─────────────────────────────────────────────────────────────
    // Marginal Tax Bracket — robust parse + guaranteed audit diff
    // ─────────────────────────────────────────────────────────────
    let explicitTaxChange = null;
    let nextTaxBracketForUpdate = undefined; // undefined: do not touch; null/number: set

    if (Object.prototype.hasOwnProperty.call(req.body, 'marginalTaxBracket')) {
      const prev = (before && typeof before === 'object')
        ? (before.marginalTaxBracket ?? null)
        : null;
      const next = normalizeTaxBracketInput(req.body.marginalTaxBracket);

      console.log('[updateHousehold] Tax bracket compare', { prev, raw: req.body.marginalTaxBracket, normalizedNext: next });

      // Only set if value actually changed (including null⇄number)
      if (!Object.is(prev, next)) {
        // Update in-memory doc (not saving it) so modifiedPaths works if needed
        household.marginalTaxBracket = next;
        household.markModified('marginalTaxBracket');
        explicitTaxChange = { from: prev, to: next };
        nextTaxBracketForUpdate = next;
      } else {
        // explicitly provided but no change; we won't include it in $set
        console.log('[updateHousehold] Tax bracket provided but unchanged');
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Build Household $set and fieldsChanged, then persist via FOU
    // so audit plugin (query middleware) will log it reliably.
    // ─────────────────────────────────────────────────────────────
    const fieldsChanged = {};
    const householdSet = {};
    let didTouchHousehold = false;

    if (explicitTaxChange) {
      fieldsChanged.marginalTaxBracket = explicitTaxChange;
      householdSet.marginalTaxBracket = nextTaxBracketForUpdate; // null or number
      didTouchHousehold = true;
    }

    if (leadAdvisorsChange) {
      fieldsChanged.leadAdvisors = leadAdvisorsChange;
      householdSet.leadAdvisors = nextAdvisorIdsForUpdate; // ObjectId[]
      didTouchHousehold = true;
    }

    // If you later add more Household fields in this function by mutating `household`,
    // this will capture them generically:
    const residualPaths = household
      .modifiedPaths()
      .filter(p => !AUDIT_IGNORE.has(p) && p !== 'marginalTaxBracket' && p !== 'leadAdvisors');

    if (residualPaths.length) {
      console.log('[updateHousehold] Residual household changes detected', { residualPaths });
      for (const p of residualPaths) {
        fieldsChanged[p] = { from: getByPath(before, p), to: household.get(p) };
        householdSet[p] = household.get(p);
        didTouchHousehold = true;
      }
    }

    if (didTouchHousehold) {
      console.log('[updateHousehold] Committing Household changes via findOneAndUpdate', {
        $set: householdSet,
        fieldsChanged
      });

      const updated = await Household.findOneAndUpdate(
        { _id: householdId, owner: userId, firmId: user.firmId },
        { $set: householdSet },
        {
          new: true,
          runValidators: true,
          // IMPORTANT: activityCtx on query options for audit plugin
          activityCtx: {
            ...baseCtx,
            entity: 'Household',
            action: 'UPDATE',
            fieldsChanged
          }
        }
      );

      if (!updated) {
        console.error('[updateHousehold] findOneAndUpdate returned null (unexpected)', { householdId });
        // Not failing the request since client updates may still have succeeded
      }
    } else {
      console.log('[updateHousehold] No Household-level changes to persist (only client/member updates may have occurred)');
    }

    console.log('[updateHousehold] DONE', { ms: Date.now() - startedAt });
    return res.json({ success: true, message: 'Household updated successfully.' });
  } catch (error) {
    console.error('Error updating household:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
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
      hh.$locals = hh.$locals || {};
      hh.$locals.activityCtx = req.activityCtx;           // ← log UPDATE
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


// Add near the top of the controller file:
function parseDateOnlyToUTC(value) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      return new Date(Date.UTC(y, mo - 1, d));
    }
  }
  const dt = new Date(value);
  if (isNaN(dt.getTime())) return undefined;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}


/**
 * Update a single client by ID (with optional photo upload).
 * We'll accept multipart/form-data so we can handle the profile photo if provided.
 */
// controllers/householdController.js
exports.updateClient = [
  upload.single('profilePhoto'),
  async (req, res) => {
    try {
      const baseCtx = req.activityCtx || {};
      const { clientId } = req.params;
      const {
        firstName,
        lastName,
        deceasedLiving,
        email,
        phoneNumber,
        dob,
        monthlyIncome,
        occupation,
        employer,
        retirementDate,
        // add any other form fields you support here
      } = req.body;

      console.log('[updateClient] START', { clientId });

      const client = await Client.findById(clientId);
      if (!client) {
        console.warn('[updateClient] Client not found', { clientId });
        return res.status(404).json({ message: 'Client not found' });
      }

      // Snapshot BEFORE
      const before = client.toObject({ depopulate: true });

      // ---- Mutations (only set if provided) ----
      if (firstName !== undefined)      client.firstName = firstName;
      if (lastName !== undefined)       client.lastName = lastName;
      if (deceasedLiving !== undefined) client.deceasedLiving = deceasedLiving;
      if (email !== undefined)          client.email = email;
      if (occupation !== undefined)     client.occupation = occupation;
      if (employer !== undefined)       client.employer = employer;
      if (phoneNumber !== undefined)    client.mobileNumber = phoneNumber;

      // DOB: accept '', null, or valid YYYY-MM-DD
      if (dob !== undefined) {
        const parsedDOB = parseDateOnlyToUTC(dob);
        if (parsedDOB) client.dob = parsedDOB;
        if (dob === '') client.dob = undefined; // clears field
      }

      // Retirement Date: same handling
      if (retirementDate !== undefined) {
        const parsedRD = parseDateOnlyToUTC(retirementDate);
        if (parsedRD) client.retirementDate = parsedRD;
        if (retirementDate === '') client.retirementDate = undefined;
      }

      if (monthlyIncome !== undefined) {
        const incomeVal = parseFloat(monthlyIncome);
        if (!isNaN(incomeVal)) client.monthlyIncome = incomeVal;
      }

      // Profile photo upload (if provided)
      if (req.file) {
        const s3Url = await uploadToS3(req.file, 'clientPhotos');
        client.profilePhoto = s3Url;
        console.log('[updateClient] Uploaded profile photo to S3');
      }

      // Compute diffs + attach audit context
      const fieldsChanged = attachClientUpdateCtx(client, before, baseCtx, client.household);

      if (!fieldsChanged) {
        console.log('[updateClient] No changes detected, saving anyway to run hooks');
      } else {
        console.log('[updateClient] Fields changed', { fieldsChanged });
      }

      await client.save();
      console.log('[updateClient] DONE', {
        clientId: client._id.toString(),
        changedCount: fieldsChanged ? Object.keys(fieldsChanged).length : 0
      });

      return res.json({
        message: fieldsChanged ? 'Client updated successfully' : 'No changes detected',
        client
      });
    } catch (err) {
      console.error('Error updating client:', err);
      return res.status(500).json({ message: 'Server error' });
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
        household.$locals = household.$locals || {};
        household.$locals.activityCtx = req.activityCtx;   // ← log UPDATE (HOH reassignment)
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
    // ───────────────────────────────────────────
// Fix timezone‐shift: build a local‐midnight date
// ───────────────────────────────────────────
clients.forEach(c => {
  if (c.dob) {
    // grab the YYYY-MM-DD portion
    const [Y,M,D] = c.dob.toISOString().slice(0,10).split('-').map(Number);
    // build a local‐midnight Date
    const localMidnight = new Date(Y, M - 1, D);
    c.formattedDOB = localMidnight
      .toLocaleDateString('en-US',{ month: 'short', day: 'numeric', year: 'numeric' });
  } else {
    c.formattedDOB = 'No DOB';
  }
});

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

// controllers/householdController.js

exports.showBeneficiaryPage = async (req, res) => {
  try {
    const householdId = req.params.householdId;

    // 1) Load user + firm
    const user = req.session.user || null;
    let firm = null;
    if (user && user.firmId) {
      firm = await CompanyID.findById(user.firmId);
    }
    const userData = {
      ...user,
      name: user?.name || '',
      email: user?.email || '',
      companyName: firm?.companyName || '',
      companyWebsite: firm?.companyWebsite || '',
      companyAddress: firm?.companyAddress || '',
      phoneNumber: firm?.phoneNumber || '',
      companyLogo: firm?.companyLogo || '',
      is2FAEnabled: Boolean(user?.is2FAEnabled),
      avatar: user?.avatar || '/images/defaultProfilePhoto.png'
    };

    // 2) Fetch household
    const household = await Household.findById(householdId)
        .populate({
            path: 'accounts',
            populate: [
              { path: 'accountOwner', select: 'firstName lastName' },
              { path: 'beneficiaries.primary.beneficiary',
                select: 'firstName lastName relationship share' },
              { path: 'beneficiaries.contingent.beneficiary',
                select: 'firstName lastName relationship share' }
            ]
          })
          .populate('leadAdvisors', 'firstName lastName avatar')
          .populate({
            path: 'firmId',
            select: [
              'beneficiaryEnabled beneficiaryTitle beneficiaryDisclaimer',
              'netWorthEnabled netWorthTitle netWorthDisclaimer',
              'companyLogo'
            ].join(' ')
          })
      .lean();
    if (!household) {
      return res.status(404).send('Household not found');
    }



    // totals
const totalAccountValue = household.accounts
.reduce((sum, a) => sum + (Number(a.accountValue)||0), 0);
const monthlyDistribution = require('../services/monthlyDistribution')
.totalMonthlyDistribution(household.accounts);

// load value‐adds
const beneficiaryVA = await ValueAdd
.findOne({ household: household._id, type: 'BENEFICIARY' })
.lean() || {};
const netWorthVA = await ValueAdd
.findOne({ household: household._id, type: 'NET_WORTH' })
.lean() || {};
const homeworkVA = await ValueAdd
.findOne({ household: household._id, type: 'HOMEWORK' })
.lean() || {};

    // 3) Load all clients (so we can do name logic)
    const clients = await Client.find({ household: household._id })
      .lean({ virtuals: true });
    // 4) Load accounts + beneficiaries
    const accounts = await Account.find({ household: household._id })
      .populate('accountOwner', 'firstName lastName')
      .populate('beneficiaries.primary.beneficiary', 'firstName lastName relationship share')
      .populate('beneficiaries.contingent.beneficiary', 'firstName lastName relationship share')
      .lean();

    // If no clients, bail early
    if (!clients.length) {
      return res.render('householdsBeneficiary', {
        user: userData,
        companyData: firm,
        avatar: userData.avatar,
        householdId,
        householdName: '---',
        clients: [],
        accounts: [],
        hideStatsBanner: true,
        totalAccountValue,
        monthlyDistribution,
        beneficiaryEnabled:    household.firmId.beneficiaryEnabled,
        beneficiaryTitle:      household.firmId.beneficiaryTitle,
        beneficiaryDisclaimer: household.firmId.beneficiaryDisclaimer,
        beneficiaryData:       beneficiaryVA.currentData,
        beneficiaryWarnings:   beneficiaryVA.warnings || [],
        netWorthEnabled:       household.firmId.netWorthEnabled,
        netWorthTitle:         household.firmId.netWorthTitle,
        netWorthDisclaimer:    household.firmId.netWorthDisclaimer,
        netWorthData:          netWorthVA.currentData,
        homeworkEnabled:       household.firmId.homeworkEnabled,
        homeworkTitle:         household.firmId.homeworkTitle,
        homeworkDisclaimer:    household.firmId.homeworkDisclaimer,
        homeworkData:          homeworkVA.currentData,
        homeworkWarnings:      homeworkVA.warnings || [],
        leadAdvisors,
        companyLogo:           household.firmId.companyLogo,
      });
    }

    // 5) Identify HOH and build modal/display lists
    let hoh = null;
    if (household.headOfHousehold) {
      hoh = clients.find(c => c._id.toString() === household.headOfHousehold._id.toString());
    }
    if (!hoh) hoh = clients[0];

    const modalClients = [
      hoh,
      ...clients.filter(c => c._id.toString() !== hoh._id.toString())
    ];
    const displayedClients = [
      hoh,
      ...clients
        .filter(c => c._id.toString() !== hoh._id.toString())
        .slice(0, 1)
    ];
    const additionalMembersCount = modalClients.length - displayedClients.length;
    const showMoreModal = additionalMembersCount > 0;

    // 6) Compute householdName (same rules as guardrails/buckets)
    let householdName = '---';
    if (displayedClients.length === 1) {
      householdName = `${displayedClients[0].lastName}, ${displayedClients[0].firstName}`;
    } else if (displayedClients.length === 2) {
      const [a,b] = displayedClients;
      if (a.lastName.toLowerCase() === b.lastName.toLowerCase()) {
        householdName = `${a.lastName}, ${a.firstName} & ${b.firstName}`;
      } else {
        householdName = `${a.lastName}, ${a.firstName}`;
      }
    } else {
      householdName = `${hoh.lastName}, ${hoh.firstName}`;
    }

    // 7) Render
    res.render('householdsBeneficiary', {
      user: userData,
      companyData: firm,
      avatar: userData.avatar,
      householdId,
      householdName,
      clients,
      accounts,
      displayedClients,
      modalClients,
      additionalMembersCount,
      showMoreModal,
      hideStatsBanner: true,
    });
  } catch (err) {
    console.error('Error in showBeneficiaryPage:', err);
    res.status(500).send('Server error while loading Beneficiaries page');
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


exports.showHomeworkPage = async (req, res) => {
  try {
    const householdId = req.params.householdId;

    // 1) User + Firm
    const user = req.session.user || null;
    const firm = user?.firmId ? await CompanyID.findById(user.firmId).lean() : null;
    const userData = {
      ...user,
      avatar: user?.avatar || '/images/defaultProfilePhoto.png',
      companyLogo: firm?.companyLogo || ''
    };

    // 2) Household (with headOfHousehold + firm settings for Homework)
    const household = await Household.findById(householdId)
      .populate('headOfHousehold')
      .populate({
        path: 'firmId',
        select: 'homeworkEnabled homeworkTitle homeworkDisclaimer companyLogo'
      })
      .lean();
    if (!household) return res.status(404).send('Household not found');

    // 3) Clients (include DOB so Homework has it)
    const clients = await Client.find({ household: household._id })
      .select('firstName lastName dob email mobileNumber homePhone homeAddress maritalStatus taxFilingStatus ssn')
      .lean({ virtuals: true });

    // 4) Accounts (owners + beneficiaries for the sheet)
    const accounts = await Account.find({ household: household._id })
      .populate('accountOwner', 'firstName lastName dob')
      .populate('beneficiaries.primary.beneficiary',   'firstName lastName relationship share')
      .populate('beneficiaries.contingent.beneficiary','firstName lastName relationship share')
      .lean();

    // 5) Liabilities (optional—include if you have a model/collection)
    // const liabilities = await Liability.find({ household: household._id }).lean();
    const liabilities = []; // keep empty if you don’t have a model yet

    // 6) Build a household display name like your other pages
    let hoh = null;
    if (household.headOfHousehold) {
      hoh = clients.find(c => c._id.toString() === household.headOfHousehold._id.toString());
    }
    if (!hoh) hoh = clients[0];

    const displayedClients = [
      hoh,
      ...clients.filter(c => c._id.toString() !== hoh?._id?.toString()).slice(0, 1)
    ];

    let householdName = '---';
    if (displayedClients?.length === 1) {
      householdName = `${displayedClients[0].lastName || ''}, ${displayedClients[0].firstName || ''}`;
    } else if (displayedClients?.length === 2) {
      const [a, b] = displayedClients;
      if ((a.lastName || '').toLowerCase() === (b.lastName || '').toLowerCase()) {
        householdName = `${a.lastName || ''}, ${a.firstName || ''} & ${b.firstName || ''}`;
      } else {
        householdName = `${a.lastName || ''}, ${a.firstName || ''}`;
      }
    } else if (hoh) {
      householdName = `${hoh.lastName || ''}, ${hoh.firstName || ''}`;
    }

    // 7) Company object for template (you already pass companyData elsewhere)
    const companyData = await CompanyID.findOne({ companyId: user.companyId }).lean();

    // 8) Render Homework view
    return res.render('householdHomework', {
      user: userData,
      companyData,
      avatar: userData.avatar,

      householdId,
      householdName,

      // For the iframe/sheet:
      clients,
      accounts,
      liabilities,

      // Firm/feature bits
      homeworkEnabled:    household.firmId?.homeworkEnabled !== false,
      homeworkTitle:      household.firmId?.homeworkTitle || 'Homework',
      homeworkDisclaimer: household.firmId?.homeworkDisclaimer || '',

      hideStatsBanner: true
    });
  } catch (err) {
    console.error('Error in showHomeworkPage:', err);
    res.status(500).send('Server error while loading Homework page');
  }
};



exports.showNetWorthPage = async (req, res) => {
/**
   * Renders the Net Worth page for a specific household
   * 
   * @description Retrieves household, client, and account details to display net worth information
   * @route GET /households/:householdId/net-worth
   * 
   * @param {Object} req - Express request object containing household ID in params
   * @param {Object} res - Express response object for rendering net worth page
   * 
   * @returns {Object} Renders 'householdNetWorth' view with household details
   * @throws {Error} Handles and logs any server-side errors during page generation
   */
    try {

    const householdId = req.params.householdId;

    // 1) Load user + firm
    const user = req.session.user || null;
    let firm = null;
    if (user && user.firmId) {
      firm = await CompanyID.findById(user.firmId);
    }
    const userData = {
      ...user,
      name: user?.name || '',
      email: user?.email || '',
      companyName: firm?.companyName || '',
      companyWebsite: firm?.companyWebsite || '',
      companyAddress: firm?.companyAddress || '',
      phoneNumber: firm?.phoneNumber || '',
      companyLogo: firm?.companyLogo || '',
      is2FAEnabled: Boolean(user?.is2FAEnabled),
      avatar: user?.avatar || '/images/defaultProfilePhoto.png'
    };

    // 2) Fetch household
    const household = await Household.findById(householdId)
    .populate('headOfHousehold')
      .populate({
        path: 'accounts',
        populate: [
          { path: 'accountOwner', select: 'firstName lastName' },
          { path: 'beneficiaries.primary.beneficiary',
            select: 'firstName lastName relationship share' },
          { path: 'beneficiaries.contingent.beneficiary',
            select: 'firstName lastName relationship share' }
        ]
      })
      .populate('leadAdvisors', 'firstName lastName avatar')
      .populate({
        path: 'firmId',
        select: 'netWorthEnabled netWorthTitle netWorthDisclaimer companyLogo'
      })
       .lean();
    
    if (!household) {
      return res.status(404).send('Household not found');
    }

    const totalAccountValue = household.accounts
  .reduce((sum,a) => sum + (Number(a.accountValue)||0), 0);
const monthlyDistribution = require('../services/monthlyDistribution')
  .totalMonthlyDistribution(household.accounts);

const netWorthVA = await ValueAdd
  .findOne({ household: household._id, type: 'NET_WORTH' })
  .lean() || {};

const leadAdvisors = (household.leadAdvisors || []).map(a => ({
  name:   `${a.lastName}, ${a.firstName}`,
  avatar: a.avatar
}));


    // 3) Load all clients (so we can do name logic)
    const clients = await Client.find({ household: household._id })
      .lean({ virtuals: true });
    // 4) Load accounts + beneficiaries
    const accounts = await Account.find({ household: household._id })
      .populate('accountOwner', 'firstName lastName')
      .populate('beneficiaries.primary.beneficiary', 'firstName lastName relationship share')
      .populate('beneficiaries.contingent.beneficiary', 'firstName lastName relationship share')
      .lean();

    // If no clients, bail early
    if (!clients.length) {
      return res.render('householdsBeneficiary', {
        user: userData,
        companyData: firm,
        avatar: userData.avatar,
        householdId,
        householdName: '---',
        clients: [],
        accounts: [],
        hideStatsBanner: true,
      });
    }

    // 5) Identify HOH and build modal/display lists
    let hoh = null;
    if (household.headOfHousehold) {
      hoh = clients.find(c => c._id.toString() === household.headOfHousehold._id.toString());
    }
    if (!hoh) hoh = clients[0];

    const modalClients = [
      hoh,
      ...clients.filter(c => c._id.toString() !== hoh._id.toString())
    ];
    const displayedClients = [
      hoh,
      ...clients
        .filter(c => c._id.toString() !== hoh._id.toString())
        .slice(0, 1)
    ];
    const additionalMembersCount = modalClients.length - displayedClients.length;
    const showMoreModal = additionalMembersCount > 0;

    // 6) Compute householdName (same rules as guardrails/buckets)
    let householdName = '---';
    if (displayedClients.length === 1) {
      householdName = `${displayedClients[0].lastName}, ${displayedClients[0].firstName}`;
    } else if (displayedClients.length === 2) {
      const [a,b] = displayedClients;
      if (a.lastName.toLowerCase() === b.lastName.toLowerCase()) {
        householdName = `${a.lastName}, ${a.firstName} & ${b.firstName}`;
      } else {
        householdName = `${a.lastName}, ${a.firstName}`;
      }
    } else {
      householdName = `${hoh.lastName}, ${hoh.firstName}`;
    }

    return res.render('householdNetWorth', {
      user:        userData,
     companyData: firm,
     avatar:      userData.avatar,
     householdId,
     householdName,
     leadAdvisors,
     companyLogo:         household.firmId.companyLogo,

     totalAccountValue,
     monthlyDistribution,

     netWorthEnabled:    household.firmId.netWorthEnabled,
     netWorthTitle:      household.firmId.netWorthTitle,
     netWorthDisclaimer: household.firmId.netWorthDisclaimer,
     netWorthData:       netWorthVA.currentData,
     netWorthWarnings:   netWorthVA.warnings || [],
    hideStatsBanner: true
    });
  } catch (error) {
    console.error('Error in showNetWorthPage:', error);
    res.status(500).send('Server error');
  }
};
