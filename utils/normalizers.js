// utils/normalizers.js

/**
 * Normalize the systematic withdrawal frequency to one of the
 * recognized enum values in Account systematicWithdrawFrequency:
 * ['', 'Monthly', 'Quarterly', 'Semi-annual', 'Annually']
 */
function normalizeSystematicWithdrawFrequency(input) {
    if (!input) return '';
  
    // Convert to lowercase for matching
    const val = input.trim().toLowerCase();
  
    // We'll check for certain keywords or partial words:
    if (val.includes('month')) {
      return 'Monthly';
    }
    if (val.includes('quarter')) {
      return 'Quarterly';
    }
    // This covers "bi-annual", "biannual", "semi-annual", "semi annual", "semi-yearly", "bi-yearly", etc.
    if (
      val.includes('semi') ||
      val.includes('biannual') ||
      val.includes('bi-annual') ||
      val.includes('biyear') ||
      val.includes('bi-year') ||
      val.includes('semi-year') ||
      val.includes('semi year') ||
      val.includes('bi year')
    ) {
      return 'Semi-annual';
    }
    if (val.includes('annual') || val.includes('year')) {
      return 'Annually';
    }
  
    // If it doesn't match anything, you can decide to return
    // an empty string or a default. Let’s return '' so it
    // doesn’t throw an error in Mongoose validation.
    return '';
  }

/**
 * Wrapper used by Account-controllers:
 * – delegates to normalizeSystematicWithdrawFrequency  
 * – ensures a non-empty, enum-valid value (`'Monthly'` as safe default)
 */
function normalizeFrequencySafe(input) {
    const out = normalizeSystematicWithdrawFrequency(input);
    return out || 'Monthly';
  }
  
  /**
   * Example of normalizing a "taxStatus" to one of our recognized enum values:
   * ['Taxable', 'Tax-Free', 'Tax-Deferred', 'Tax-Exempt', 'Non-Qualified']
   * 
   * You can expand this logic as needed.
   */
  function normalizeTaxStatus(input) {
    if (!input) return null;
    const val = input.trim().toLowerCase();
  
    // Match approximate synonyms
    if (val.includes('taxable')) return 'Taxable';
    if (val.includes('tax free') || val.includes('tax-free')) return 'Tax-Free';
    if (val.includes('tax deferred') || val.includes('tax-deferred')) return 'Tax-Deferred';
    if (val.includes('exempt')) return 'Tax-Exempt';
    if (val.includes('non-qualified') || val.includes('non qualified')) return 'Non-Qualified';
  
    // If we don't recognize it, we could return null or a default:
    return null;
  }
  
  /**
   * Add other normalizers similarly...
   * e.g. normalizeAccountType, normalizeCustodian, etc.
   */
  
  module.exports = {
    normalizeSystematicWithdrawFrequency,
    normalizeTaxStatus,
    normalizeFrequencySafe,
  };
  