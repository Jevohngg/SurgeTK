// scripts/updateAdminCompanyName.js

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User'); // Adjust the path if necessary

const MONGODB_URI =
  process.env.NODE_ENV === 'production'
    ? process.env.MONGODB_URI_PROD
    : process.env.MONGODB_URI_DEV;

mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB');

    const adminEmail = 'jevohngentry@gmail.com'; // Replace with your admin email

    try {
      // Find the admin user
      const adminUser = await User.findOne({ email: adminEmail });

      if (!adminUser) {
        console.log('Admin user not found.');
      } else {
        // Update the companyName to 'admin'
        adminUser.companyName = 'admin';
        await adminUser.save();
        console.log('Admin user companyName updated to "admin".');
      }
    } catch (error) {
      console.error('Error updating admin user:', error);
    } finally {
      mongoose.connection.close();
    }
  })
  .catch((err) => {
    console.error('Error connecting to MongoDB:', err);
  });
