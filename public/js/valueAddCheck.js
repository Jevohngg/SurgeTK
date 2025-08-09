// public/js/valueAddCheck.js
/* -----------------------------------------------------------------------------
 * Value Add Status Checker (household/client-data only)
 * Updated: 2025-08-09
 *
 * Rules:
 *  - Do NOT base status on whether a VA has been "generated".
 *  - Error if household has NO accounts (applies to ALL value adds).
 *  - Buckets: Error if >= 1 account is missing an asset allocation.
 *  - Beneficiary: Error if 0 accounts have any beneficiary data.
 *  - Homework: Only error is NO accounts; otherwise always green.
 *  - Guardrails / Net Worth: Only error is NO accounts.
 *
 * Data sources (in order of preference):
 *  1) window.householdData (fast, no network)
 *  2) /api/... accounts endpoints (best-effort, optional)
 *  If we cannot determine accounts at all, default to SUCCESS to avoid false errors.
 * --------------------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', async () => {
  try {
    /* ------------------------------ Household ID ------------------------------ */
    const householdIdEl = document.getElementById('household-id');
    const householdId = householdIdEl ? householdIdEl.value : null;
    if (!householdId) {
      console.warn('valueAddCheck: No household ID found in the DOM.');
      return;
    }

    /* ----------------------------- DOM: Card Icons ---------------------------- */
    const guardrailsIcon  = document.getElementById('openGuardrails') ?.querySelector('.status-icon') || null;
    const bucketsIcon     = document.getElementById('openBuckets')    ?.querySelector('.status-icon') || null;
    const beneficiaryIcon = document.getElementById('openBeneficiary')?.querySelector('.status-icon') || null;
    const netWorthIcon    = document.getElementById('openNetWorth')   ?.querySelector('.status-icon') || null;
    const homeworkIcon    = document.getElementById('openHomework')   ?.querySelector('.status-icon') || null;

    /* ------------------------------ Tooltip Shell ----------------------------- */
    const tooltip = document.createElement('div');
    tooltip.classList.add('value-add-tooltip');
    document.body.appendChild(tooltip);

    let isTooltipVisible = false;

    function showTooltip(iconElement, message, isWarning) {
      tooltip.textContent = message || '';
      tooltip.classList.remove('fade-out', 'green-mode', 'warning-mode');
      tooltip.classList.add(isWarning ? 'warning-mode' : 'green-mode');

      tooltip.style.display = 'block';
      const rect = iconElement.getBoundingClientRect();
      const tooltipWidth = tooltip.offsetWidth;
      const left = rect.left + window.scrollX + (rect.width / 2) - (tooltipWidth / 2);
      const top  = rect.top  + window.scrollY + rect.height + 8;
      tooltip.style.left = `${left}px`;
      tooltip.style.top  = `${top}px`;

      requestAnimationFrame(() => {
        tooltip.classList.add('show');
        isTooltipVisible = true;
      });
    }

    function hideTooltip() {
      if (!isTooltipVisible) return;
      tooltip.classList.remove('show');
      tooltip.classList.add('fade-out');
      setTimeout(() => {
        tooltip.style.display = 'none';
        tooltip.classList.remove('fade-out', 'green-mode', 'warning-mode');
        isTooltipVisible = false;
      }, 200);
    }

    function attachTooltipEvents(iconElement, text, isWarning) {
      if (!iconElement) return;
      iconElement.addEventListener('mouseenter', () => text && showTooltip(iconElement, text, isWarning));
      iconElement.addEventListener('mouseleave', hideTooltip);
    }

    function setWarning(iconElement, message) {
      if (!iconElement) return;
      iconElement.textContent = 'warning';
      iconElement.classList.remove('green-icon');
      iconElement.classList.add('warning-icon');
      attachTooltipEvents(iconElement, message || 'Issue detected.', true);
    }

    function setSuccess(iconElement, message) {
      if (!iconElement) return;
      iconElement.textContent = 'check_circle';
      iconElement.classList.remove('warning-icon');
      iconElement.classList.add('green-icon');
      
    }
    function last4DigitsFromAccountNumber(acct) {
      const raw = (acct && acct.accountNumber) ? String(acct.accountNumber) : '';
      const digits = raw.replace(/\D/g, '');
      if (digits.length >= 4) return digits.slice(-4);
      return raw ? raw.slice(-4) : '????';
    }
    

    /* ------------------------------ Data Helpers ------------------------------ */
    const isNonEmptyObject = (obj) =>
      obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length > 0;

    function extractAccountsFrom(obj) {
      // Try common shapes; return [] if none found
      if (!obj || typeof obj !== 'object') return [];
      if (Array.isArray(obj.accounts))           return obj.accounts;
      if (Array.isArray(obj.allAccounts))        return obj.allAccounts;
      if (Array.isArray(obj.linkedAccounts))     return obj.linkedAccounts;
      if (Array.isArray(obj.financialAccounts))  return obj.financialAccounts;
      if (isNonEmptyObject(obj.household) && Array.isArray(obj.household.accounts)) {
        return obj.household.accounts;
      }
      return [];
    }

    function numericSum(arr, pick) {
      let sum = 0;
      for (const x of arr || []) {
        const v = typeof pick === 'function' ? pick(x) : x;
        const n = Number(v);
        if (!Number.isNaN(n)) sum += n;
      }
      return sum;
    }

    function accountHasAssetAllocation(acct) {
      if (!acct || typeof acct !== 'object') return false;
    
      // --- Your schema: split fields on the Account model ---
      // Treat as allocated if any of these are positive numbers
      const split = {
        cash      : Number(acct.cash),
        income    : Number(acct.income),
        annuities : Number(acct.annuities),
        growth    : Number(acct.growth),
      };
      const splitSum = Object.values(split).reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
      if (splitSum > 0) return true;
    
      // --- Fallbacks for other shapes (keep these for robustness) ---
      const oa = acct.assetAllocation ?? acct.targetAssetAllocation ?? acct.allocation ?? acct.assetMix ?? null;
    
      const looksLikeAllocationObject = (obj) => {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
        const keys = Object.keys(obj);
        if (keys.length === 0) return false;
        const indicative = /(equity|stock|fixed|bond|income|cash|alt|alternative|intl|international|real\s?estate)/i;
        const hasIndicativeKey = keys.some(k => indicative.test(k));
        const numericTotal = keys.reduce((sum, k) => {
          const n = Number(obj[k]);
          return sum + (Number.isFinite(n) ? n : 0);
        }, 0);
        return hasIndicativeKey || numericTotal > 0;
      };
    
      const looksLikeAllocationArray = (arr) => {
        if (!Array.isArray(arr) || arr.length === 0) return false;
        const numericTotal = arr.reduce((sum, row) => {
          const n = Number(row?.weight ?? row?.percent ?? row?.percentage ?? row?.allocation);
          return sum + (Number.isFinite(n) ? n : 0);
        }, 0);
        if (numericTotal > 0) return true;
        const indicative = /(asset|class|category|equity|stock|fixed|bond|income|cash|alt|alternative|intl|international|real\s?estate)/i;
        return arr.some(row => Object.keys(row || {}).some(k => indicative.test(k)) || row?.name || row?.class || row?.assetClass || row?.category);
      };
    
      if (looksLikeAllocationObject(oa) || looksLikeAllocationArray(oa)) return true;
    
      const modelAlloc = acct.model?.allocations ?? acct.model?.assetAllocation ?? null;
      if (looksLikeAllocationObject(modelAlloc) || looksLikeAllocationArray(modelAlloc)) return true;
    
      const holdings = Array.isArray(acct.holdings) ? acct.holdings : [];
      if (holdings.length > 0) {
        const hasClassification = holdings.some(h => h?.assetClass || h?.category || h?.class || h?.securityType);
        const hasWeights = holdings.some(h => Number.isFinite(Number(h?.weight ?? h?.percent ?? h?.percentage)));
        if (hasClassification || hasWeights) return true;
      }
    
      return false;
    }
    


// Replace existing accountHasBeneficiaries with this:
function accountHasBeneficiaries(acct) {
  if (!acct || typeof acct !== 'object') return false;

  // Your schema (from backend): beneficiaries.primary[] / beneficiaries.contingent[]
  const prim = acct?.beneficiaries?.primary;
  const cont = acct?.beneficiaries?.contingent;

  const hasPrim = Array.isArray(prim) && prim.some(p =>
    p && (
      p.beneficiary || p.name || p.fullName ||
      p.relationship || p.percentage != null || p.share != null || p.allocation != null
    )
  );

  const hasCont = Array.isArray(cont) && cont.some(p =>
    p && (
      p.beneficiary || p.name || p.fullName ||
      p.relationship || p.percentage != null || p.share != null || p.allocation != null
    )
  );

  if (hasPrim || hasCont) return true;

  // Other common shapes we still support as fallback:
  if (Array.isArray(acct.beneficiaries) && acct.beneficiaries.length > 0) return true;
  if (Array.isArray(acct.beneficiaryDesignations) && acct.beneficiaryDesignations.length > 0) return true;
  if (Array.isArray(acct.primaryBeneficiaries) && acct.primaryBeneficiaries.length > 0) return true;
  if (Array.isArray(acct.contingentBeneficiaries) && acct.contingentBeneficiaries.length > 0) return true;
  if (typeof acct.primaryBeneficiary === 'string' && acct.primaryBeneficiary.trim()) return true;
  if (typeof acct.contingentBeneficiary === 'string' && acct.contingentBeneficiary.trim()) return true;
  if (typeof acct.beneficiaryName === 'string' && acct.beneficiaryName.trim()) return true;
  if (acct.beneficiaryPercentages && typeof acct.beneficiaryPercentages === 'object' && Object.keys(acct.beneficiaryPercentages).length > 0) return true;

  return false;
}


    async function tryFetchJson(url) {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }

    async function loadAccounts(hid) {
      // 1) Prefer window.householdData if available
      if (typeof window.householdData === 'object' && window.householdData) {
        const acctsFromWindow = extractAccountsFrom(window.householdData);
        if (acctsFromWindow.length) return { accounts: acctsFromWindow, inferredFromValue: null };

        // If no explicit accounts but totalAccountValue is positive, treat as "has accounts"
        if (typeof window.householdData.totalAccountValue === 'number') {
          return { accounts: [], inferredFromValue: window.householdData.totalAccountValue > 0 };
        }
      }

      // 2) Try common endpoints (best-effort; silently ignore failures)
      //    If any returns an array → assume it's the accounts array.
      //    If it returns an object with .accounts → use that.
      const endpoints = [
        `/api/households/${hid}/accounts`,
        `/api/household/${hid}/accounts`,
        `/api/households/${hid}`,
        `/api/household/${hid}`,
      ];

      for (const url of endpoints) {
        const data = await tryFetchJson(url);
        if (!data) continue;

        if (Array.isArray(data)) return { accounts: data, inferredFromValue: null };
        if (Array.isArray(data?.accounts)) return { accounts: data.accounts, inferredFromValue: null };

        // If the object provides a totalAccountValue, we can infer "has accounts"
        if (typeof data?.totalAccountValue === 'number') {
          return { accounts: [], inferredFromValue: data.totalAccountValue > 0 };
        }
        if (typeof data?.household?.totalAccountValue === 'number') {
          return { accounts: [], inferredFromValue: data.household.totalAccountValue > 0 };
        }
      }

      // 3) If everything fails, return empty (unknown). We'll treat unknown as success.
      return { accounts: [], inferredFromValue: null };
    }

    /* --------------------------- Load + Compute Facts -------------------------- */
    const { accounts, inferredFromValue } = await loadAccounts(householdId);

    const accountsCount = Array.isArray(accounts) ? accounts.length : 0;
    const hasAccounts =
      accountsCount > 0 ||
      (inferredFromValue === true) ||
      // Historical fallback: some pages expose householdData.totalAccountValue only
      (typeof window.householdData?.totalAccountValue === 'number' &&
       window.householdData.totalAccountValue > 0);

    // Compute detailed facts only if accounts array is known
    const accountsWithoutAllocationCount = accountsCount
      ? accounts.reduce((acc, a) => acc + (accountHasAssetAllocation(a) ? 0 : 1), 0)
      : 0;

    const accountsWithBeneficiariesCount = accountsCount
      ? accounts.reduce((acc, a) => acc + (accountHasBeneficiaries(a) ? 1 : 0), 0)
      : 0;

    /* ------------------------------- Paint Status ------------------------------ */
    // Universal error if NO accounts (applies to every VA)
    const NO_ACCOUNTS_MSG = 'Household has no accounts.';

    // Guardrails: only error condition is no accounts
    if (guardrailsIcon) {
      if (!hasAccounts) setWarning(guardrailsIcon, NO_ACCOUNTS_MSG);
      else setSuccess(guardrailsIcon, 'No issues!');
    }

    // Buckets: error if (no accounts) OR (>=1 account lacks asset allocation)
// Buckets: error if (no accounts) OR (>=1 account lacks asset allocation)
// Also list the last 4 of each problem account.
if (bucketsIcon) {
  if (!hasAccounts) {
    setWarning(bucketsIcon, 'Household has no accounts.');
  } else {
    const problemAccounts = (Array.isArray(accounts) ? accounts : []).filter(a => !accountHasAssetAllocation(a));
    if (problemAccounts.length > 0) {
      const bullets = problemAccounts
        .map(a => `• …${last4DigitsFromAccountNumber(a)}`)
        .join('\n');
      setWarning(
        bucketsIcon,
        `Some accounts are missing asset allocations:\n${bullets}`
      );
    } else {
      setSuccess(bucketsIcon, 'No issues!');
    }
  }
}

    // Beneficiary: error if (no accounts) OR (0 accounts have beneficiaries)
    if (beneficiaryIcon) {
      if (!hasAccounts) {
        setWarning(beneficiaryIcon, NO_ACCOUNTS_MSG);
      } else if (accountsWithBeneficiariesCount === 0) {
        setWarning(beneficiaryIcon, 'There is no beneficiary data for any accounts.');
      } else {
        setSuccess(beneficiaryIcon, 'No issues!');
      }
    }

    // Net Worth: only error condition is no accounts
    if (netWorthIcon) {
      if (!hasAccounts) setWarning(netWorthIcon, NO_ACCOUNTS_MSG);
      else setSuccess(netWorthIcon, 'No issues!');
    }

    // Homework: only error condition is no accounts (always green otherwise)
    if (homeworkIcon) {
      if (!hasAccounts) setWarning(homeworkIcon, NO_ACCOUNTS_MSG);
      else setSuccess(homeworkIcon, 'Open Homework');
    }
  } catch (err) {
    console.error('valueAddCheck: Unhandled error while displaying ValueAdd statuses:', err);
    // In case of a catastrophic failure, fail closed with green to avoid spurious warnings.
    const allIcons = [
      document.getElementById('openGuardrails')   ?.querySelector('.status-icon'),
      document.getElementById('openBuckets')      ?.querySelector('.status-icon'),
      document.getElementById('openBeneficiary')  ?.querySelector('.status-icon'),
      document.getElementById('openNetWorth')     ?.querySelector('.status-icon'),
      document.getElementById('openHomework')     ?.querySelector('.status-icon'),
    ].filter(Boolean);

    for (const icon of allIcons) {
      icon.textContent = 'check_circle';
      icon.classList.remove('warning-icon');
      icon.classList.add('green-icon');
    }
  }
});
