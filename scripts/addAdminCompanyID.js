// scripts/addAdminCompanyID.js

require('dotenv').config();
const mongoose = require('mongoose');
const CompanyID = require('../models/CompanyID');

const MONGODB_URI =
  process.env.NODE_ENV === 'production'
    ? process.env.MONGODB_URI_PROD
    : process.env.MONGODB_URI_DEV;

mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB');

    const adminCompanyID = '000000';

    // Check if the company ID already exists
    let companyIDEntry = await CompanyID.findOne({ companyId: adminCompanyID });

    if (companyIDEntry) {
      console.log('Admin Company ID already exists.');
      // Ensure it's active
      if (!companyIDEntry.isActive) {
        companyIDEntry.isActive = true;
        await companyIDEntry.save();
        console.log('Admin Company ID activated.');
      } else {
        console.log('Admin Company ID is already active.');
      }
    } else {
      // Create the company ID
      const newCompanyID = new CompanyID({
        companyId: adminCompanyID,
        companyName: 'Admin Company',
        isActive: true,
        isUsed: false,
      });
      await newCompanyID.save();
      console.log('Admin Company ID created and activated.');
    }

    mongoose.connection.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1);
  });
