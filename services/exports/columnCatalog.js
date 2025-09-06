// services/exports/columnCatalog.js
/**
 * Column catalog per export type.
 * Keys are stable IDs (used by front-end & export); values define label + path or compute.
 *
 * IMPORTANT: Labels here must EXACTLY match the import templates you provided.
 * Additional (non-template) columns are kept as-is.
 */

module.exports = {
  // -----------------------------
  // ACCOUNTS
  // -----------------------------
  accounts: {
    groups: [
      {
        name: 'Account',
        columns: [
          // Import Template exacts
          { id: 'accountOwnerId',        label: 'Client ID',                           type: 'string',  compute: 'accountOwnerId' },
          { id: 'accountOwnerName',      label: 'Account Owner Name',                  type: 'string',  compute: 'accountOwnerName' },
          { id: 'accountNumber',         label: 'Account Number',                      type: 'string',  path: 'accountNumber' },
          { id: 'accountValue',          label: 'Account Value',                       type: 'number',  path: 'accountValue' },
          { id: 'accountType',           label: 'Account Type',                        type: 'string',  path: 'accountType' },
          { id: 'custodian',             label: 'Custodian',                           type: 'string',  path: 'custodian' },
          { id: 'taxStatus',             label: 'Tax Status',                          type: 'string',  path: 'taxStatus' },

          { id: 'federalTaxWithholding', label: 'Federal Tax Withholding (%)',         type: 'number',  path: 'federalTaxWithholding' },
          { id: 'stateTaxWithholding',   label: 'State Tax Withholding (%)',           type: 'number',  path: 'stateTaxWithholding' },
          { id: 'valueAsOf12_31',        label: '12/31 Value',                         type: 'number',  path: 'valueAsOf12_31' },
          { id: 'cash',                  label: 'Cash (%)',                                type: 'number',  path: 'cash' },
          { id: 'income',                label: 'Income (%)',                              type: 'number',  path: 'income' },
          { id: 'annuities',             label: 'Annuities (%)',                           type: 'number',  path: 'annuities' },
          { id: 'growth',                label: 'Growth (%)',                              type: 'number',  path: 'growth' },

          // Other (keep)
          { id: 'asOfDate',              label: 'As of Date',                          type: 'date',    path: 'asOfDate' },
          { id: 'quarterlyBilledAmount', label: 'Quarterly Billed Amount',             type: 'number',  path: 'quarterlyBilledAmount' },
          { id: 'isUnlinked',            label: 'Is Unlinked',                         type: 'boolean', path: 'isUnlinked' },
          { id: 'redtailAccountId',      label: 'Redtail Account ID',                  type: 'number',  path: 'redtailAccountId' },
          { id: 'createdAt',             label: 'Created At',                          type: 'date',    path: 'createdAt' },
          { id: 'updatedAt',             label: 'Updated At',                          type: 'date',    path: 'updatedAt' },
        ]
      },
      {
        name: 'Household',
        columns: [
          { id: 'household.userHouseholdId',           label: 'Household ID',                  type: 'string', lookup: 'household', path: 'userHouseholdId' },
          { id: 'household.totalAccountValue',         label: 'Household Total Account Value', type: 'number', lookup: 'household', path: 'totalAccountValue' },
          { id: 'household.redtailFamilyId',           label: 'Redtail Family ID',             type: 'string', lookup: 'household', path: 'redtailFamilyId' },
          { id: 'household.servicingLeadAdvisor.name', label: 'Servicing Lead Advisor',        type: 'string', lookup: 'household.servicingLeadAdvisor', path: 'name' },
          { id: 'household.writingLeadAdvisor.name',   label: 'Writing Lead Advisor',          type: 'string', lookup: 'household.writingLeadAdvisor',   path: 'name' },
        ]
      }
    ],
    // Defaults can be changed by the user in the Columns modal
    defaults: ['accountNumber','accountOwnerName','custodian']
  },

  // -----------------------------
  // CONTACTS
  // -----------------------------
  contacts: {
    groups: [
      {
        name: 'Client',
        columns: [
          { id: 'household.userHouseholdId', label: 'Household ID',              type: 'string', lookup: 'household', path: 'userHouseholdId' },
          { id: 'clientId',                  label: 'Client ID',                 type: 'string', path: 'clientId' },
          { id: 'clientName',                label: 'Client Name',               type: 'string', compute: 'clientName' },
          { id: 'leadAdvisor',               label: 'Lead Advisor',              type: 'string', compute: 'leadAdvisor' },

          { id: 'gender',                    label: 'Gender',                    type: 'string', path: 'gender' },
          { id: 'dob',                       label: 'Date of Birth',             type: 'date',   path: 'dob' },
          { id: 'taxFilingStatus',           label: 'Tax Filing Status',         type: 'string', path: 'taxFilingStatus' },
          { id: 'maritalStatus',             label: 'Marital Status',            type: 'string', path: 'maritalStatus' },
          { id: 'mobileNumber',              label: 'Mobile Phone',              type: 'string', path: 'mobileNumber' },
          { id: 'email',                     label: 'Email Address',             type: 'string', path: 'email' },
          { id: 'homeAddress',               label: 'Home Address',              type: 'string', path: 'homeAddress' },
          { id: 'deceasedLiving',            label: 'Living/Deceased',           type: 'string', path: 'deceasedLiving' },
          { id: 'monthlyIncome',             label: 'Monthly Income',            type: 'number', path: 'monthlyIncome' },
          { id: 'marginalTaxBracket',        label: 'Marginal Tax Bracket (%)',  type: 'number', path: 'marginalTaxBracket' },
          { id: 'occupation',                label: 'Occupation',                type: 'string', path: 'occupation' },
          { id: 'employer',                  label: 'Employer',                  type: 'string', path: 'employer' },
          { id: 'retirementDate',            label: 'Retirement Date',           type: 'date',   path: 'retirementDate' },

          // Keep granular fields available (not defaults)
          { id: 'firstName',                 label: 'First Name',                type: 'string', path: 'firstName' },
          { id: 'lastName',                  label: 'Last Name',                 type: 'string', path: 'lastName' },
          { id: 'age',                       label: 'Age (virtual)',             type: 'number', compute: 'age' },
          { id: 'redtailId',                 label: 'Redtail Contact ID',        type: 'number', path: 'redtailId' },
          { id: 'createdAt',                 label: 'Created At',                type: 'date',   path: 'createdAt' },
        ]
      }
    ],
    defaults: ['clientName','email','clientId','household.userHouseholdId','leadAdvisor']

  },

  // -----------------------------
  // INSURANCE (unchanged except household)
  // -----------------------------
// -----------------------------
// INSURANCE (updated headers)
// -----------------------------
insurance: {
  groups: [
    {
      name: 'Policy',
      columns: [
        // EXACT template labels below:
        { id: 'clientId',       label: 'Client ID',                           type: 'string', compute: 'clientId' },
        { id: 'policyNumber',   label: 'Policy Number',                       type: 'string', path: 'policyNumber' },
        { id: 'policyFamily',   label: 'Policy Type (Term / Permanent)',      type: 'string', path: 'policyFamily' },
        { id: 'policySubtype',  label: 'Policy Sub-Type (Level Term, etc)',   type: 'string', path: 'policySubtype' },
        { id: 'effectiveDate',  label: 'Effective Date',                      type: 'date',   path: 'effectiveDate' },
        { id: 'expirationDate', label: 'Expiration Date',                     type: 'date',   path: 'expirationDate' },
        { id: 'carrierName',    label: 'Carrier Name',                        type: 'string', path: 'carrierName' },
        { id: 'faceAmount',     label: 'Face / Coverage Amount',              type: 'number', path: 'faceAmount' },
        { id: 'cashValue',      label: 'Cash Value',                          type: 'number', path: 'cashValue' },

        // Optional extras (keep available; not in template)
        { id: 'status',         label: 'Status',                              type: 'string', path: 'status' },
        { id: 'hasCashValue',   label: 'Has Cash Value',                      type: 'boolean', path: 'hasCashValue' },
        { id: 'premiumAmount',  label: 'Premium Amount',                      type: 'number', path: 'premiumAmount' },
        { id: 'premiumMode',    label: 'Premium Mode',                        type: 'string', path: 'premiumMode' },
        { id: 'productName',    label: 'Product Name',                        type: 'string', path: 'productName' },
        { id: 'notes',          label: 'Notes',                               type: 'string', path: 'notes' },
      ]
    },
    {
      name: 'People',
      columns: [
        // still available as additional fields if you want names:
        { id: 'ownerClient.name',   label: 'Owner (Client)',   type: 'string', lookup: 'ownerClient',   path: 'name' },
        { id: 'insuredClient.name', label: 'Insured (Client)', type: 'string', lookup: 'insuredClient', path: 'name' },
      ]
    },
    {
      name: 'Household',
      columns: [
        { id: 'household.userHouseholdId', label: 'Household ID', type: 'string', lookup: 'household', path: 'userHouseholdId' }
      ]
    }
  ],
  // Sensible defaults; users can change in the Columns modal
  defaults: ['clientId','policyNumber','policyFamily','carrierName']
},

  // -----------------------------
  // LIABILITIES
  // -----------------------------
  liabilities: {
    groups: [
      {
        name: 'Liability',
        columns: [
          // Import Template exacts (and the new owner handling)
          { id: 'clientId',             label: 'Client ID',                 type: 'string', compute: 'liabilityClientId' },
          { id: 'accountLoanNumber',    label: 'Account / Loan Number',     type: 'string', path: 'accountLoanNumber' },
          { id: 'liabilityOwnerName',   label: 'Liability Owner Name',      type: 'string', compute: 'liabilityOwnerName' },
          { id: 'liabilityType',        label: 'Liability Type',            type: 'string', path: 'liabilityType' },
          { id: 'liabilityName',        label: 'Liability Display Name',    type: 'string', path: 'liabilityName' },
          { id: 'outstandingBalance',   label: 'Outstanding Balance',       type: 'number', path: 'outstandingBalance' },
          { id: 'creditorName',         label: 'Creditor Name',             type: 'string', path: 'creditorName' },
          { id: 'interestRate',         label: 'Interest Rate (%)',         type: 'number', path: 'interestRate' },
          { id: 'monthlyPayment',       label: 'Monthly Payment',           type: 'number', path: 'monthlyPayment' },
          { id: 'estimatedPayoffDate',  label: 'Estimated Payoff Date',     type: 'date',   path: 'estimatedPayoffDate' },

          // Keep extras
          { id: 'createdAt',            label: 'Created At',                type: 'date',   path: 'createdAt' },
          { id: 'updatedAt',            label: 'Updated At',                type: 'date',   path: 'updatedAt' },
        ]
      },
      {
        name: 'Household',
        columns: [
          { id: 'household.userHouseholdId', label: 'Household ID', type: 'string', lookup: 'household', path: 'userHouseholdId' }
        ]

      }
    ],
    defaults: ['liabilityType','creditorName']
  },

  // -----------------------------
  // ASSETS (NEW)
  // -----------------------------
  assets: {
    groups: [
      {
        name: 'Asset',
        columns: [
          // Import Template exacts
          { id: 'clientId',           label: 'Client ID',           type: 'string', compute: 'assetClientId' },
          { id: 'assetNumber',        label: 'Asset Number',        type: 'string', path: 'assetNumber' },
          { id: 'assetOwnerName',     label: 'Asset Owner Name',    type: 'string', compute: 'assetOwnerName' },
          { id: 'assetType',          label: 'Asset Type',          type: 'string', path: 'assetType' },
          { id: 'assetValue',         label: 'Asset Value',         type: 'number', path: 'assetValue' },
          { id: 'assetDisplayName',   label: 'Asset Display Name',  type: 'string', path: 'assetDisplayName' },

          // Keep extras
          { id: 'createdAt',          label: 'Created At',          type: 'date',   path: 'createdAt' },
          { id: 'updatedAt',          label: 'Updated At',          type: 'date',   path: 'updatedAt' },
        ]
      },
      {
        name: 'Household',
        columns: [
          { id: 'household.userHouseholdId', label: 'Household ID', type: 'string', lookup: 'household', path: 'userHouseholdId' }
        ]

      }
    ],
    defaults: ['assetNumber','assetOwnerName','assetType']
  },

  // -----------------------------
  // BILLING (unchanged)
  // -----------------------------
  billing: {
    groups: [
      {
        name: 'Billing Entry',
        columns: [
          { id: 'entityType', label: 'Entity', type: 'string', compute: 'entityType' },  // 'Account' | 'Household'
          { id: 'entityKey',  label: 'Entity Key', type: 'string', compute: 'entityKey' }, // Account Number or Household userHouseholdId
          { id: 'billType',   label: 'Bill Type', type: 'string', path: 'billType' },       // 'account'|'household'
          { id: 'periodType', label: 'Period Type', type: 'string', path: 'periodType' },
          { id: 'periodKey',  label: 'Period Key', type: 'string', path: 'periodKey' },
          { id: 'amount',     label: 'Amount', type: 'number', path: 'amount' },
          { id: 'source',     label: 'Source', type: 'string', path: 'source' },
          { id: 'note',       label: 'Note', type: 'string', path: 'note' },
          { id: 'importedAt', label: 'Imported At', type: 'date', path: 'importedAt' },
        ]
      }
    ],
    defaults: ['entityType','entityKey','periodType','periodKey','amount']
  }
};
