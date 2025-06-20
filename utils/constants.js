// utils/constants.js

// Warning taxonomy (§4.4)
const WARNING_TYPES = {
    NO_ACCTS: {
      severity: 'critical',
      badge:    'danger',
      icon:     'error',
      label:    'No Accounts'
    },
    NO_FIRM_LOGO: {
      severity: 'warning',
      badge:    'warning',
      icon:     'warning',
      label:    'Missing Firm Logo'
    },
    NO_ADVISOR: {
      severity: 'warning',
      badge:    'warning',
      icon:     'warning',
      label:    'No Advisor Assigned'
    },
    NO_SW: {
      severity: 'info',
      badge:    'info',
      icon:     'info',
      label:    'No Systematic Withdrawals'
    },
    MISSING_ALLOCATION: {
      severity: 'info',
      badge:    'info',
      icon:     'info',
      label:    'Some accounts missing asset allocation'
    }
  };
  
  module.exports = {
    VALUE_ADD_TYPES: ['BUCKETS', 'GUARDRAILS', 'BENEFICIARY', 'NET_WORTH'],
    WARNING_TYPES
  };
  