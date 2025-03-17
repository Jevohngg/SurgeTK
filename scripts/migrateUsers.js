// migrateUsers.js
const express = require('express');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('../models/User');
const CompanyID = require('../models/CompanyID'); // Import CompanyID model
const sgMail = require('@sendgrid/mail');
const axios = require('axios');
const ipinfo = require('ipinfo');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const router = express.Router();

async function fixMissingCompanyIds() {
  try {
    await mongoose.connect('mongodb://localhost:27017/yourdb'); // adapt to your DB

    // Find users who have firmId but a missing or empty companyId
    const usersNeedingFix = await User.find({
      firmId: { $ne: null },
      $or: [
        { companyId: { $exists: false } },
        { companyId: '' },
        { companyId: null }
      ]
    });

    console.log(`Found ${usersNeedingFix.length} users who need their companyId field fixed.`);

    for (const user of usersNeedingFix) {
      // 1) Find the firm doc
      const firm = await CompanyID.findById(user.firmId);
      if (!firm || !firm.companyId) {
        console.log(`User ${user.email} references a firm with no 'companyId' string.`);
        continue;
      }
      
      // 2) Set user.companyId
      user.companyId = firm.companyId;
      await user.save();

      console.log(`Fixed user ${user.email}, set companyId to ${firm.companyId}`);
    }

    console.log('All done!');
    process.exit(0);
  } catch (err) {
    console.error('Error fixing missing companyId fields:', err);
    process.exit(1);
  }
}

fixMissingCompanyIds();
