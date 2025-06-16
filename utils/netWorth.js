// utils/netWorth.js  ← NEW
const Account           = require('../models/Account');
const HouseholdSnapshot = require('../models/HouseholdSnapshot');

exports.recalculateMonthlyNetWorth = async function (householdId) {
  const accounts = await Account.find({ household: householdId }).lean();
  const total    = accounts.reduce((t, a) => t + (a.accountValue || 0), 0);

  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();

  await HouseholdSnapshot.findOneAndUpdate(
    { household: householdId, year, month },
    { netWorth: total },
    { upsert: true }
  );
};
