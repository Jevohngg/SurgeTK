// services/valueAdd/computeValueAdd.js
const Household = require('../../models/Household');
const Client = require('../../models/Client');
const Account = require('../../models/Account');
const Asset = require('../../models/Asset');
const Liability = require('../../models/Liability');
const OneTimeTransaction = require('../../models/OneTimeTransaction');
const HomeworkSettings = require('../../models/HomeworkSettings');

const { fmtCurrency, last4, ownerLabel } = require('./formatters');
const { buildTrailingMonths, monthLabelShort, calcAge, startOfMonthUTC, addMonthsUTC } = require('./dateUtils');
const { computeNetWorth } = require('./netWorth');
const { computeInvestable } = require('./investableAssets');
const { computeAGI } = require('./tax/agi');
const { priorYear, estimateTaxes, computeTaxableIncome } = require('./tax/helpers');
const { buildGrids } = require('./flows/withdrawalsDeposits');
const { computeRMDRows } = require('./rmd');

async function computeValueAdd(householdId, { asOf=new Date() } = {}) {
  // Load household context
  const household = await Household.findById(householdId).populate('firmId').lean();
  if (!household) throw new Error('Household not found');
  const filingStatus = (await Client.find({ household: householdId }).select('taxFilingStatus').lean())[0]?.taxFilingStatus || 'single';

  // Load related docs
  const clients = await Client.find({ household: householdId })
  .select('firstName lastName dob occupation monthlyIncome retirementDate')

    .lean();

  const accounts = await Account.find({ household: householdId })
    .populate('accountOwner', 'firstName lastName dob')
    .lean();

  // Assets = by owners (since schema lacks direct household link)
  const clientIds = clients.map(c => String(c._id));
  const assets = await Asset.find({ owners: { $in: clientIds } }).lean();

  const liabilities = await Liability.find({ household: householdId }).lean();

  // One-time transactions for trailing 12-month window AND prior year
  const months = buildTrailingMonths(asOf);                  // oldest → current; current is last
  const rangeStart = startOfMonthUTC(months[0]);             // first (oldest) month start
  const rangeEnd   = addMonthsUTC(startOfMonthUTC(months[months.length - 1]), 1); // month after current (exclusive)

  const oneTimeInWindow = await OneTimeTransaction.find({
    account: { $in: accounts.map(a => a._id) },
    occurredOn: { $gte: rangeStart, $lt: rangeEnd }
  }).lean();

  const py = priorYear(asOf);
  const pyStart = new Date(Date.UTC(py,0,1)), pyEnd = new Date(Date.UTC(py+1,0,1));
  const oneTimePriorYear = await OneTimeTransaction.find({
    account: { $in: accounts.map(a => a._id) },
    occurredOn: { $gte: pyStart, $lt: pyEnd }
  }).populate('account', 'taxStatus').lean();

  const oneTimesByYear = { [py]: oneTimePriorYear };

  // Settings
  const settings = await HomeworkSettings.findOne({ household: householdId }).lean();
  // Normalize debts: prefer array; fallback to legacy single number
  const debts = Array.isArray(settings?.debts) ? settings.debts
    : (settings?.cashFlow?.debt
       ? [{ label: 'Debt', amount: Number(settings.cashFlow.debt) || 0 }]
       : []);

  // Enrich account labels
  accounts.forEach(a => {
    a._ownerLabel = ownerLabel({ accountOwner: a.accountOwner, accountOwnerName: a.accountOwnerName });
    a._last4 = last4(a.accountNumber);
  });

  // Core calcs
  const { netWorth, accountSum, assetSum, debtSum } = computeNetWorth({ accounts, assets, liabilities });
  const investAssets = computeInvestable(accounts);

  const agiPriorYear = computeAGI({ clients, accounts, oneTimesByYear, year: py });
  const taxableIncomePY = computeTaxableIncome({ agi: agiPriorYear, year: py, filingStatus });
  const totalTaxesEstimate = estimateTaxes(taxableIncomePY, household.marginalTaxBracket || 0);

  // Cash Flow (manual) for page 1
  const cashFlow = settings?.cashFlow || { checking: 0, savings: 0, income: 0, spending: 0, debt: 0 };
  const outsideInv = settings?.outsideInvestments || [];

  // Primary residence and mortgage (heuristic)
  const primaryAsset = assets.find(a => (a.assetType||'').toLowerCase().includes('primary'));
  const homeLoans = liabilities.filter(l => (l.liabilityType||'').toLowerCase().includes('primary') || (l.creditorName||'').toLowerCase().includes('mortgage'));
  const homeLoanBalance = homeLoans.reduce((s,l)=>s+(l.outstandingBalance||0),0);
  const homeLoanRate = homeLoans[0]?.interestRate || null;
  const homeLoanPayment = homeLoans[0]?.monthlyPayment || null;

  // Ages + overrides
  const asOfDate = new Date(asOf);
  const clientAges = clients.map(c => ({
    id: String(c._id),
    name: `${c.firstName} ${c.lastName}`,
    age: calcAge(c.dob, asOfDate)
  }));

  // page 2 grids
  const { withdrawals, deposits } = buildGrids({
    accounts, oneTimeTxns: oneTimeInWindow, months, anchor: asOfDate
  });

  // Current month index (months are oldest → current)
  const currIdx = months.length - 1;
  // Sum gross and tax across all accounts for the current month
  const distGross = withdrawals.reduce((s, r) => s + (r.gross?.[currIdx] || 0), 0);
  const distTax   = withdrawals.reduce((s, r) => s + (r.tax?.[currIdx]   || 0), 0);
  const distNet   = distGross - distTax;

  // RMD rows – use oldest owner’s age for a quick approximation
  const ownerAgesByAccount = {};
  accounts.forEach(a => {
    const ages = (a.accountOwner||[]).map(o => calcAge(o.dob, asOfDate)).filter(x => x!=null);
    ownerAgesByAccount[a._id] = ages.length ? Math.max(...ages) : null;
  });
  const rmdRows = computeRMDRows({ accounts, ownerAgesByAccount });

  return {
    header: {
      firmName: household.firmId?.companyName || '',
      reportedAsOf: asOfDate,
      meetingType: settings?.meetingType || '',
      meetingDateTime: settings?.meetingDateTime || null,
      taxBracketPct: household.marginalTaxBracket || 0
    },
    clients: clients.map(c => ({
      id: c._id, firstName: c.firstName, lastName: c.lastName,
      age: calcAge(c.dob, asOfDate),
      occupation: c.occupation || '',
      employer: (settings?.clientOverrides||[]).find(o => String(o.client)===String(c._id))?.employer || '',
      retirementDate:
        (settings?.clientOverrides||[])
          .find(o => String(o.client)===String(c._id))?.retirementDate
        ?? c.retirementDate
        ?? null
    })),
    page1: {
      netWorth, investAssets, accountSum, assetSum, debtSum,
      agiPriorYear, taxableIncomePY, totalTaxesEstimate, bracketPct: household.marginalTaxBracket || 0,
      cashFlow, outsideInv, debts,
      primaryResidence: primaryAsset ? {
        value: primaryAsset.assetValue,
      } : null,
      mortgage: homeLoans.length ? {
        balance: homeLoanBalance,
        rate: homeLoanRate,
        monthlyPayment: homeLoanPayment
      } : null,
      distributions: { gross: distGross, net: distNet }
    },
    page2: {
      // renderer expects months[i].key (ISO) → header uses mmYYYYshort(key)
      months: months.map(m => ({ key: m.toISOString(), label: monthLabelShort(m) })), // oldest … current (last)
      withdrawals, deposits, rmdRows
    },
    meta: { py }
  };
}

module.exports = { computeValueAdd };
