// scripts/createAdminUser.js

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../models/User');

const MONGODB_URI =
  process.env.NODE_ENV === 'production'
    ? process.env.MONGODB_URI_PROD
    : process.env.MONGODB_URI_DEV;

mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(async () => {
    console.log('Connected to MongoDB');

    const adminEmail = 'jevohngentry@gmail.com'; // Replace with your admin email
    const adminPassword = 'Jg38502!'; // Replace with your admin password

    // Check if admin user already exists
    const existingAdmin = await User.findOne({ email: adminEmail });

    if (existingAdmin) {
      console.log('Admin user already exists');
      process.exit(0);
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    // Create the admin user
    const adminUser = new User({
      companyId: '000000',
      companyName: 'Admin Company',
      email: adminEmail,
      password: hashedPassword,
      emailVerified: true,
      isAdmin: true,
    });

    await adminUser.save();
    console.log('Admin user created successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1);
  });
