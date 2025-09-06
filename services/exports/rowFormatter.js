// services/exports/rowFormatter.js
const { DateTime } = require('luxon');



/** Safely read a value by dot path (e.g., 'household.userHouseholdId') */
function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
    else return undefined;
  }
  return cur;
}

/**
 * Format a JS Date or ISO string per timezone + format.
 * If value is null/undefined -> return '' for clean CSV/XLSX.
 */
function fmtDate(value, tz='UTC', fmt='iso') {
  if (!value) return '';
  const dt = DateTime.fromJSDate(value instanceof Date ? value : new Date(value), { zone: 'utc' });
  if (!dt.isValid) return '';
  const z = dt.setZone(tz);
  if (fmt === 'iso') return z.toISODate();              // YYYY-MM-DD
  if (fmt === 'datetime') return z.toISO();             // full ISO
  try { return z.toFormat(fmt); } catch (_) { return z.toISODate(); }
}

/**
 * Apply column typing to convert/format per selected columns.
 * @param {string[]} columns
 * @param {object} row
 * @param {{timezone:string,dateFormat:string}} options
 * @param {'accounts'|'contacts'|'insurance'|'liabilities'|'assets'|'billing'} exportType
 */
function formatRow(columns, row, options={}, exportType) {
  const out = {};
  const tz = options.timezone || 'UTC';
  const df = options.dateFormat || 'iso';

  for (const col of columns) {
    // Use dot-path aware accessor
    let raw = col.includes('.') ? getByPath(row, col) : row[col];
  
    // --- NEW: Fallback for Assets Household ID (use flat alias if nested is missing) ---
    if ((raw === undefined || raw === null) &&
        col === 'household.userHouseholdId' &&
        row && typeof row === 'object' &&
        row.householdId != null) {
      raw = row.householdId;
    }
  
    if (raw === undefined || raw === null) {
      out[col] = '';
      continue;
    }
  
    // Known date columns ...
    const isDate = col.endsWith('Date') || [
      'asOfDate','createdAt','updatedAt','effectiveDate','expirationDate','importedAt','dob','retirementDate','estimatedPayoffDate'
    ].includes(col);
  
    out[col] = isDate ? fmtDate(raw, tz, df) : raw;
  }
  

  // Virtuals
  if (exportType === 'contacts' && columns.includes('age')) {
    const dob = row['dob'];
    if (!dob) out['age'] = '';
    else {
      const now = DateTime.utc();
      const born = DateTime.fromJSDate(dob instanceof Date ? dob : new Date(dob), { zone: 'utc' });
      out['age'] = born.isValid ? Math.max(0, now.diff(born, 'years').years | 0) : '';
    }
  }

  // Fallback: ensure single-cell Client Name if pipeline omitted it
  if (exportType === 'contacts' && columns.includes('clientName') && !out['clientName']) {
    const last = (row['lastName'] || '').trim();
    const first = (row['firstName'] || '').trim();
    out['clientName'] = (last && first) ? `${last}, ${first}` : (last || first || '');
  }

  return out;
}

module.exports = { formatRow };
