// scripts/deleteAllUsers.js

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User'); // Adjust the path to your User model

const MONGODB_URI =
  process.env.NODE_ENV === 'production'
    ? process.env.MONGODB_URI_PROD
    : process.env.MONGODB_URI_DEV;

mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB');

    try {
      const result = await User.deleteMany({});
      console.log(`Deleted ${result.deletedCount} users.`);
    } catch (err) {
      console.error('Error deleting users:', err);
    } finally {
      mongoose.connection.close();
    }
  })
  .catch((err) => {
    console.error('Error connecting to MongoDB:', err);
  });
