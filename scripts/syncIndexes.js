/*********************************************
 * scripts/syncIndexes.js
 *********************************************/
require('dotenv').config();
const mongoose = require('mongoose');

// Import ALL models that have indexes you need:
const Client = require('../models/Client');
const Account = require('../models/Account');
const Household = require('../models/Household');
const RedtailAdvisor = require('../models/RedtailAdvisor');
// If you have more indexed models, import them too

// Use your production DB URI here:
const MONGODB_URI = process.env.NODE_ENV === 'production'
  ? process.env.MONGODB_URI_PROD
  : process.env.MONGODB_URI_DEV;

(async function syncAllIndexes() {
  try {
    // Connect WITHOUT autoIndex—syncIndexes will handle it
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      autoIndex: false,
    });

    console.log('Connected to MongoDB. Syncing indexes...');

    // For each imported model, tell Mongoose to sync indexes
    await Promise.all([
      Client.syncIndexes(),
      Account.syncIndexes(),
      Household.syncIndexes(),
      RedtailAdvisor.syncIndexes(),
      // e.g. MoreModel.syncIndexes(),
    ]);

    console.log('✅ All indexes have been synced to match your schema definitions.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error syncing indexes:', err);
    process.exit(1);
  }
})();
