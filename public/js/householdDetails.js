// /public/js/householdDetails.js
import {
  monthlyRateFromWithdrawals,
  monthlyDollarFromWithdrawals,
  annualRateFromWithdrawals
} from './utils/monthlyDistribution.js';

/**
 * Returns 'xxx' + last 4 digits of an account number.
 * If account number is shorter than 4 digits or missing, returns '---'.
 * @param {string|number} num
 * @returns {string}
 */
function maskAccountNumber(num) {
  if (!num) return '---';
  const str = String(num).replace(/\D/g, '');      // strip non‑digits
  if (str.length < 4) return '---';
  return 'xxx' + str.slice(-4);
}



//─────────────────────────────────────────────────────────────────────────
//  Generic helper: create a withdrawal row HTML string for a given index
//─────────────────────────────────────────────────────────────────────────
function mkWithdrawalRowHTML(idx, amt = '', freq = '') {
    const freqs = ['Monthly','Quarterly','Semi-annual','Annually'];
    return `
    <div class="withdrawal-entry">
      <div class="row mb-2">
        <div class="col-md-6">
          <label class="form-label" for="swa_${idx}">Withdrawal Amount</label>
          <input class="form-control" type="number" step="0.01" min="0"
                 id="swa_${idx}"
                 name="systematicWithdrawals[${idx}][amount]"
                 value="${amt}">
        </div>
        <div class="col-md-6">
          <label class="form-label" for="swf_${idx}">Frequency</label>
          <select class="form-select" id="swf_${idx}"
                  name="systematicWithdrawals[${idx}][frequency]">
            ${freqs.map(f => `<option value="${f}" ${f===freq?'selected':''}>${f}</option>`).join('')}
          </select>
        </div>
      </div>
      <button type="button"
              class="btn btn-sm btn-outline-danger remove-withdrawal">
        <i class="fas fa-times me-1"></i>Remove
      </button>
    </div>`;
  }
  


document.addEventListener('DOMContentLoaded', () => {
  /* ───── Prepared Packets table ───────────────────────────── */
const packetsTbody   = document.querySelector('#preparedPacketsTable tbody');
const packetsEmpty   = document.getElementById('preparedPacketsEmpty');


  // public/js/householdDetails.js  (or whichever file is already linked)


  const openGuardrailsBtn = document.getElementById('openGuardrails');
  const householdIdEl = document.getElementById('household-id');

  if (openGuardrailsBtn && householdIdEl) {
    const householdId = householdIdEl.value;

    openGuardrailsBtn.addEventListener('click', () => {
      // Navigate to /households/:householdId/guardrails
      window.location.href = `/households/${householdId}/guardrails`;
    });
  }



const openNetWorthBtn = document.getElementById('openNetWorth');
if (openNetWorthBtn && householdIdEl) {
  const householdId = householdIdEl.value;
  openNetWorthBtn.addEventListener('click', () => {
    window.location.href = `/households/${householdId}/net-worth`;
  });
}

   
const homeworkCard = document.getElementById('openHomework');
if (homeworkCard) {
  homeworkCard.addEventListener('click', () => {
    const householdId = document.getElementById('household-id')?.value || window.householdId;
    if (!householdId) return;
    window.location.href = `/households/${householdId}/homework`;
  });
}

  const openBucketsBtn = document.getElementById('openBuckets');



  if (openBucketsBtn && householdIdEl) {
    const householdId = householdIdEl.value;

    openBucketsBtn.addEventListener('click', () => {
      // Navigate to /households/:householdId/guardrails
      window.location.href = `/households/${householdId}/buckets`;
    });
  }
  const openBeneficiaryBtn = document.getElementById('openBeneficiary');


  if (openBeneficiaryBtn && householdIdEl) {
    const householdId = householdIdEl.value;
    openBeneficiaryBtn.addEventListener('click', () => {
      window.location.href = `/households/${householdId}/beneficiary`;
    });
  }
  


  // Initialize modals and other elements
  const showMoreButton = document.getElementById('showMoreButton');
  const additionalMembersModalElement = document.getElementById('additionalMembersModal');
  const additionalMembersModal = additionalMembersModalElement
    ? new bootstrap.Modal(additionalMembersModalElement)
    : null;

  if (showMoreButton && additionalMembersModal) {
    showMoreButton.addEventListener('click', () => {
      additionalMembersModal.show();
    });
  }

 // References for Edit Household Modal
const editHouseholdModalElement = document.getElementById('editHouseholdModal');
const editHouseholdForm = document.getElementById('edit-household-form');
const editAdvisorDropdownButton = document.getElementById('editAdvisorDropdownButton');
const editAdvisorDropdownMenu = document.getElementById('editAdvisorDropdownMenu');
const editSelectedAdvisorsInput = document.getElementById('editSelectedAdvisorsInput');
const editHouseholdButton = document.getElementById('editHouseholdButton');

const editHouseholdModal = editHouseholdModalElement
  ? new bootstrap.Modal(editHouseholdModalElement)
  : null;

// Load leadAdvisors when showing edit household modal
editHouseholdModalElement.addEventListener('show.bs.modal', async () => {
  editAdvisorDropdownMenu.innerHTML = '<li class="dropdown-header">Loading advisors...</li>';

  try {
    const response = await fetch('/api/households/api/leadAdvisors', { credentials: 'include' });
    if (!response.ok) throw new Error('Failed to fetch leadAdvisors');
    const data = await response.json();

    // data.leadAdvisors is our array
    const leadAdvisors = data.leadAdvisors || [];
    editAdvisorDropdownMenu.innerHTML = '';

    let selectedAdvisorIds = new Set();
    // We’ll use 'advisorsMap' to stay consistent with how you map IDs to names
    let advisorsMap = new Map();

    // <-- FIXED (Was: if (leadAdvisor.length === 0))
    if (leadAdvisors.length === 0) {
      const noAdvisorsItem = document.createElement('li');
      noAdvisorsItem.classList.add('dropdown-item', 'text-muted');
      noAdvisorsItem.textContent = 'No advisors found';
      editAdvisorDropdownMenu.appendChild(noAdvisorsItem);
    } else {
      leadAdvisors.forEach((adv) => {
        // adv is a single advisor object
        advisorsMap.set(adv._id, adv.name);

        const li = document.createElement('li');
        li.classList.add('dropdown-item');

        const label = document.createElement('label');
        label.classList.add('d-flex', 'align-items-center');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.classList.add('form-check-input', 'me-2');
        checkbox.value = adv._id;

        const span = document.createElement('span');
        span.textContent = adv.name;

        label.appendChild(checkbox);
        label.appendChild(span);
        li.appendChild(label);
        editAdvisorDropdownMenu.appendChild(li);

        checkbox.addEventListener('change', () => {
          if (checkbox.checked) {
            selectedAdvisorIds.add(adv._id);
          } else {
            selectedAdvisorIds.delete(adv._id);
          }
          updateEditAdvisorSelectionDisplay();
        });
      });
    }

    function updateEditAdvisorSelectionDisplay() {
      if (selectedAdvisorIds.size === 0) {
        editAdvisorDropdownButton.textContent = 'Select advisors...';
        editSelectedAdvisorsInput.value = '';
      } else {
        const selectedIdsArray = Array.from(selectedAdvisorIds);
        // <-- FIXED (Was advisorsMap -> leadAdvisorsMap or vice versa)
        const selectedNames = selectedIdsArray.map((id) => advisorsMap.get(id));
        editAdvisorDropdownButton.textContent = selectedNames.join(', ');

        // Hidden input for form submission
        editSelectedAdvisorsInput.value = selectedIdsArray.join(',');
      }
    }

    // Pre-check existing leadAdvisors if householdData.leadAdvisors is defined
    // <-- FIXED (Changed .leadAdvisor to .leadAdvisors)
// after you build the checkbox list…
if (window.householdData && Array.isArray(window.householdData.leadAdvisors)) {
  window.householdData.leadAdvisors.forEach((adv) => {
    // extract the ID string
    const id = adv._id ? adv._id.toString() : adv.toString();
    const cb = editAdvisorDropdownMenu.querySelector(`input[value="${id}"]`);
    if (cb) {
      cb.checked = true;
      selectedAdvisorIds.add(id);
    }
  });
  updateEditAdvisorSelectionDisplay();
}


    // Optional manual toggle logic for the dropdown
    editAdvisorDropdownButton.addEventListener('click', (e) => {
      e.stopPropagation();
      editAdvisorDropdownMenu.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!editAdvisorDropdownMenu.contains(e.target) && !editAdvisorDropdownButton.contains(e.target)) {
        editAdvisorDropdownMenu.classList.remove('show');
      }
    });
  } catch (err) {
    editAdvisorDropdownMenu.innerHTML =
      '<li class="dropdown-item text-danger">Error loading leadAdvisors</li>';
  }
});

const editAdvisorsBtn = document.getElementById('editAdvisorsBtn');
if (editAdvisorsBtn) {
  editAdvisorsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openEditHouseholdModal();
  });
}

function openEditHouseholdModal() {
  // 1) Populate the #editHouseholdModal fields from window.householdData
  //    including checking all currently assigned leadAdvisor IDs
  const householdData = window.householdData || {};
  const selectedAdvisorIds = householdData.leadAdvisor || [];

  // Clear any existing checkboxes in #editAdvisorDropdownMenu
  const menu = document.getElementById('editAdvisorDropdownMenu');
  // ... code to rebuild the checkboxes from your existing list of firm leadAdvisor ...
  // Then mark the checkboxes that match selectedAdvisorIds

  // 2) Show the modal programmatically (if not using data-bs-toggle)
  const modalEl = document.getElementById('editHouseholdModal');
  const modal = new bootstrap.Modal(modalEl);
  modal.show();
}




// Add Account Modal
const addAccountButton = document.getElementById('add-account-button');
const addAccountModalElement = document.getElementById('addAccountModal');
const addPrimaryBeneficiaryBtn = addAccountModalElement?.querySelector('#add-primary-beneficiary');
const addContingentBeneficiaryBtn = addAccountModalElement?.querySelector('#add-contingent-beneficiary');
const addAccountModal = addAccountModalElement ? new bootstrap.Modal(addAccountModalElement) : null;
const addAccountForm = document.getElementById('add-account-form');
let addIdx = 1;

/* -------- new withdrawals rows in ADD modal -------- */
const addContainer = addAccountModalElement?.querySelector('.systematic-withdrawals-container');
document.getElementById('add-withdrawal')?.addEventListener('click', () => {
  addContainer.insertAdjacentHTML('beforeend', mkWithdrawalRowHTML(addIdx++));
});

// event-delegated row removal
addContainer?.addEventListener('click', e => {
  if (e.target.closest('.remove-withdrawal')) {
    e.target.closest('.withdrawal-entry').remove();
  }
});

//─────────────────────────────────────────────────────────────────────────
function initEditWithdrawalRows(existing = []) {
    const cont = document.querySelector('#editAccountModal .edit-systematic-withdrawals-container');
    if (!cont) return;
    cont.innerHTML = '';               // reset
  
    let idx = 0;
    const addRow = (amt = '', freq = '') => {
      cont.insertAdjacentHTML('beforeend', mkWithdrawalRowHTML(idx++, amt, freq));
    };
    // Pre-populate
    if (Array.isArray(existing) && existing.length) {
      existing.forEach(w => addRow(w.amount, w.frequency));
    } else {
      addRow(); // one blank row
    }
  
    // “Add row” button
    document.getElementById('edit-add-withdrawal')?.addEventListener('click', () => addRow());
    // Row removal
    cont.addEventListener('click', e => {
      if (e.target.closest('.remove-withdrawal')) {
        e.target.closest('.withdrawal-entry').remove();
      }
    });
  }
  


const emptyAddAccountButton = document.getElementById('empty-add-account-button');

// 2) Attach event listeners
if (addPrimaryBeneficiaryBtn) {
  addPrimaryBeneficiaryBtn.addEventListener('click', () => {
    addBeneficiaryFields('primary', addAccountModalElement);
  });
}
if (addContingentBeneficiaryBtn) {
  addContingentBeneficiaryBtn.addEventListener('click', () => {
    addBeneficiaryFields('contingent', addAccountModalElement);
  });
}

emptyAddAccountButton.addEventListener('click', (e) => {
  addAccountModal.show();
});

if (addAccountButton && addAccountForm) {
  addAccountButton.addEventListener('click', () => {
    addAccountForm.reset();
    resetDynamicSections(addAccountModalElement); // Reset any dynamic fields
    addAccountModal.show();
  });

  addAccountForm.addEventListener('submit', (event) => {
    event.preventDefault();
  
    const formData = new FormData(addAccountForm);
  
    // 1) Grab all form fields
    const rawOwner = formData.get('accountOwner');
    console.log('[AddAccount] rawOwner from form:', rawOwner);
  
    // Convert owner to array
    let ownersArray = [];
    if (rawOwner === 'joint') {
      if (clientsData.length >= 2) {
        ownersArray = [clientsData[0]._id, clientsData[1]._id];
      } else {
        console.warn('[AddAccount] Only one or zero household members, cannot set "joint"!');
        ownersArray = [];
      }
    } else {
      if (!rawOwner) {
        alert('Please select an Account Owner!');
        return;
      } else {
        ownersArray = [rawOwner];
      }
    }
  
    const data = Object.fromEntries(formData.entries());
    if (!data.asOfDate) delete data.asOfDate;

    // --- NEW -----------------------------------------------------
data.systematicWithdrawals = collectWithdrawals(addAccountModalElement);

// strip the flat bracket-keys so they don’t pollute req.body
Object.keys(data).forEach(k => {
  if (k.startsWith('systematicWithdrawals[')) delete data[k];
});
// -------------------------------------------------------------


    data.accountOwner = ownersArray;
    console.log('[AddAccount] final data.accountOwner =>', data.accountOwner);
  

    // Beneficiaries, IRA details, etc.
    data.beneficiaries = collectBeneficiaries(addAccountModalElement);
    data.iraAccountDetails = collectIraConversions(addAccountModalElement);
  
    // ------------------------------------------------------------
    // ASSET ALLOCATION CHECK: BLANK OK, ELSE MUST SUM 100
    // ------------------------------------------------------------
    const rawCash = data.cash?.trim() || '';
    const rawInc = data.income?.trim() || '';
    const rawAnn = data.annuities?.trim() || '';
    const rawGro = data.growth?.trim() || '';
  
    // Are all fields blank?
    const allBlank = (!rawCash && !rawInc && !rawAnn && !rawGro);
  
    if (!allBlank) {
      // parse them
      const cash = parseFloat(rawCash || '0');
      const inc = parseFloat(rawInc || '0');
      const ann = parseFloat(rawAnn || '0');
      const gro = parseFloat(rawGro || '0');
  
      if (
        Number.isNaN(cash) ||
        Number.isNaN(inc) ||
        Number.isNaN(ann) ||
        Number.isNaN(gro)
      ) {
        showAlert('danger', 'Please provide valid numeric values for allocations or leave them all blank.');
        return;
      }
  
      const totalAllocation = cash + inc + ann + gro;
      if (Math.abs(totalAllocation - 100) > 0.000001) {
        showAlert('danger','If any asset allocations are entered, their sum must equal 100%.');
        return; // block
      }
    } else {
      // all blank => user can do that => remove them from data if you prefer
      delete data.cash;
      delete data.income;
      delete data.annuities;
      delete data.growth;
    }
  
    console.log('[AddAccount] final data object about to send =>', data);
  
    // 4) Send to backend
    fetch(`/api/households/${householdData._id}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then((response) => {
        console.log('[AddAccount] Response status =>', response.status);
        return response.json();
      })
      .then((result) => {
        console.log('[AddAccount] Result from server =>', result);
        if (result.message && result.message.toLowerCase().includes('successfully')) {
          addAccountModal.hide();
          showAlert('success', result.message);
          fetchAccounts(); // Refresh account table
        } else {
          showAlert('danger', result.message || 'Failed to add account.');
        }
      })
      .catch((error) => {
        console.error('[AddAccount] Error adding account:', error);
        showAlert('danger', 'Unexpected error while adding account.');
      });
  });
  
}


document.addEventListener('click', function (e) {
  const target = e.target.closest('.value-adds-card.inactive');
  if (target) {
    e.stopImmediatePropagation();  // Stops all handlers including delegated ones
    e.preventDefault();            // Blocks any default browser behavior
    console.log('Click prevented on inactive card.');
  }
}, true); // <-- useCapture = true






/**
 * Populates the given container with the beneficiary data.
 * @param {HTMLElement} container - The .primary-beneficiary or .contingent-beneficiary container
 * @param {Object} beneficiaryData - The beneficiary object (includes firstName, lastName, relationship, etc.)
 * @param {string} type - 'primary' or 'contingent'
 */
function populateBeneficiaryFields(container, beneficiaryData, type) {
  if (!container) {
    console.error('populateBeneficiaryFields: Container not found.');
    return;
  }

  // Safely populate each field if it exists in the container
  const firstNameInput = container.querySelector(`[name="${type}FirstName"]`);
  const lastNameInput = container.querySelector(`[name="${type}LastName"]`);
  const relationshipInput = container.querySelector(`[name="${type}Relationship"]`);
  const dobInput = container.querySelector(`[name="${type}DateOfBirth"]`);
  const ssnInput = container.querySelector(`[name="${type}SSN"]`);
  const percentageInput = container.querySelector(`[name="${type}Percentage"]`);

  if (firstNameInput) firstNameInput.value = beneficiaryData.firstName || '';
  if (lastNameInput) lastNameInput.value = beneficiaryData.lastName || '';
  if (relationshipInput) relationshipInput.value = beneficiaryData.relationship || '';
  if (dobInput) dobInput.value = beneficiaryData.dateOfBirth ? beneficiaryData.dateOfBirth.split('T')[0] : '';
  if (ssnInput) ssnInput.value = beneficiaryData.ssn || '';
  if (percentageInput) {
    percentageInput.value = beneficiaryData.percentageAllocation !== undefined ? beneficiaryData.percentageAllocation : '';
  }

  // If there's a hidden ID field for referencing an existing beneficiary, populate that here
  // (only if you need to store the beneficiary’s ObjectId in the UI)
  // e.g., if (container.querySelector(`[name="${type}Id"]`)) {
  //   container.querySelector(`[name="${type}Id"]`).value = beneficiaryData._id || '';
  // }
}


function handleEditAccount(accountId) {
  console.log('handleEditAccount called with accountId:', accountId);

  fetch(`/api/accounts/${accountId}`)
    .then((response) => response.json())
    .then((data) => {
      console.log('Data received from API:', data);

      const editAccountModalElement = document.getElementById('editAccountModal');
      const editAccountModal = new bootstrap.Modal(editAccountModalElement);
      const editAccountForm = document.getElementById('edit-account-form');

      if (!editAccountModalElement || !editAccountForm) {
        console.error('Edit Account Modal or Form not found in DOM');
        return;
      }

      // 1) Reset beneficiary fields inside the Edit Account Modal
      resetDynamicSections(editAccountModalElement);

      // 2) Populate static fields and dynamic beneficiary fields
      populateFormFields(editAccountForm, data);

      // 2a) If accountOwner is an array, decide if it's "joint" or single
      const accountOwnerSelect = editAccountForm.querySelector('#editAccountOwner');
      console.log('[handleEditAccount] data.accountOwner =>', data.accountOwner);

      if (accountOwnerSelect && Array.isArray(data.accountOwner)) {
        // If data.accountOwner is an array of *objects*, e.g. [{_id: "...", firstName: "...", lastName: "..."}, ...]
        if (data.accountOwner.length === 2) {
          // Mark the dropdown as "joint"
          console.log('[handleEditAccount] Found exactly 2 owners. Setting dropdown to "joint".');
          accountOwnerSelect.value = 'joint';
        } else if (data.accountOwner.length === 1) {
          // Single owner case
          const singleOwner = data.accountOwner[0];
          // Might be an object with ._id
          if (typeof singleOwner === 'object' && singleOwner._id) {
            console.log('[handleEditAccount] Single owner is an object =>', singleOwner);
            accountOwnerSelect.value = singleOwner._id;
          } else {
            // If it's already a string or something else
            accountOwnerSelect.value = singleOwner;
          }
        } else {
          // 0 or >2 => fallback
          console.warn(`[handleEditAccount] Found ${data.accountOwner.length} owners => setting dropdown blank.`);
          accountOwnerSelect.value = '';
        }
      }

      // 3) Set the accountId in the hidden input
      const accountIdField = editAccountForm.querySelector('#editAccountId');
      if (accountIdField) {
        accountIdField.value = accountId;
      }

      // 4) Populate existing Primary Beneficiaries
      if (data.beneficiaries?.primary?.length > 0) {
        data.beneficiaries.primary.forEach(({ beneficiary, percentageAllocation }) => {
          if (beneficiary) {
            addBeneficiaryFields('primary', editAccountModalElement);
            const lastPrimary = editAccountModalElement.querySelector('.primary-beneficiaries-section .primary-beneficiary:last-child');
            populateBeneficiaryFields(lastPrimary, { ...beneficiary, percentageAllocation }, 'primary');
          } else {
            console.warn('Missing beneficiary details for primary entry:', { beneficiary, percentageAllocation });
          }
        });
      } else {
        console.warn('No primary beneficiaries found.');
      }

      // 5) Populate existing Contingent Beneficiaries
      if (data.beneficiaries?.contingent?.length > 0) {
        data.beneficiaries.contingent.forEach(({ beneficiary, percentageAllocation }) => {
          if (beneficiary) {
            addBeneficiaryFields('contingent', editAccountModalElement);
            const lastContingent = editAccountModalElement.querySelector('.contingent-beneficiaries-section .contingent-beneficiary:last-child');
            populateBeneficiaryFields(lastContingent, { ...beneficiary, percentageAllocation }, 'contingent');
          } else {
            console.warn('Missing beneficiary details for contingent entry:', { beneficiary, percentageAllocation });
          }
        });
      } else {
        console.warn('No contingent beneficiaries found.');
      }

      // 6) Build withdrawal rows
      initEditWithdrawalRows(data.systematicWithdrawals);

      // 7) Re-attach event listeners for dynamic beneficiary fields

      attachDynamicFieldHandlers('#editAccountModal');

      // 7) Ensure only one submit listener
      editAccountForm.removeEventListener('submit', handleFormSubmit);
      editAccountForm.addEventListener('submit', handleFormSubmit);

      // 8) Show the Edit Account Modal
      editAccountModal.show();
    })
    .catch((error) => {
      console.error('Error fetching account data:', error);
    });
}


function populateFormFields(form, data) {
  // Clear out dynamic sections, etc.
  resetDynamicSections(document.getElementById('editAccountModal'));

  // Existing fields...
  form.querySelector('#editAccountId').value = data._id || '';
  form.querySelector('#editAccountOwner').value = data.accountOwner?._id || '';
  form.querySelector('#editAccountNumber').value = data.accountNumber || '';
  form.querySelector('#editAccountValue').value = data.accountValue || '';
  form.querySelector('#editAccountType').value = data.accountType || '';

 
  form.querySelector('#editFederalTaxWithholding').value = data.federalTaxWithholding || '';
  form.querySelector('#editStateTaxWithholding').value = data.stateTaxWithholding || '';
  form.querySelector('#editTaxStatus').value = data.taxStatus || '';
  form.querySelector('#editValueAsOf12_31').value = data.valueAsOf12_31 || '';
  form.querySelector('#editCustodian').value = data.custodian || '';

  // ------------------------------------------------
  // NEW: Asset Allocation Fields
  // ------------------------------------------------
  form.querySelector('#editCash').value = data.cash || '0';
  form.querySelector('#editIncome').value = data.income || '0';
  form.querySelector('#editAnnuities').value = data.annuities || '0';
  form.querySelector('#editGrowth').value = data.growth || '0';
  if (data.asOfDate) {
    // strip time + timezone, take yyyy-mm-dd directly
    form.querySelector('#editAsOfDate').value = data.asOfDate.slice(0,10);
  } else {
    form.querySelector('#editAsOfDate').value = '';
  }
  
}




  function attachDynamicFieldHandlers(modalId) {
    const parentContainer = document.querySelector(modalId);
  
  
    if (!parentContainer) {
        console.error(`Modal with ID ${modalId} not found`);
        return;
    }
  
  
    const addPrimaryButton = parentContainer.querySelector('#add-primary-beneficiary');
    const addContingentButton = parentContainer.querySelector('#add-contingent-beneficiary');
  
  
    if (addPrimaryButton) {
        addPrimaryButton.addEventListener('click', () => addBeneficiaryFields('primary', parentContainer));
    }
    if (addContingentButton) {
        addContingentButton.addEventListener('click', () => addBeneficiaryFields('contingent', parentContainer));
    }
  }

  function handleFormSubmit(event) {
    event.preventDefault();
  
    const form = event.target;
    const modal = bootstrap.Modal.getInstance(form.closest('.modal'));
    const accountId = form.querySelector('#editAccountId').value;
  
    if (!accountId) {
      console.error('Account ID is missing. Unable to submit changes.');
      showAlert('danger', 'Account ID is missing. Please try again.');
      return;
    }
  
    submitUpdatedAccountData(accountId, form, modal);
  }

  function submitUpdatedAccountData(accountId, form, modal) {
    console.log(`[submitUpdatedAccountData] Submitting updated data for accountId: ${accountId}`);
  
    if (!accountId) {
      console.error('[submitUpdatedAccountData] Account ID is missing. Cannot submit changes.');
      showAlert('danger', 'Account ID is missing. Please try again.');
      return;
    }
  
    // 1) Gather all form data
    const formData = new FormData(form);
    const updatedData = Object.fromEntries(formData.entries());
    if (!updatedData.asOfDate) delete updatedData.asOfDate;



  // -------- systematic withdrawals (EDIT modal) ------------
  updatedData.systematicWithdrawals = collectWithdrawals(
    document.getElementById('editAccountModal')
  );
  Object.keys(updatedData).forEach(k => {
    if (k.startsWith('systematicWithdrawals[')) delete updatedData[k];
  });
  //-----------------------------------------------------------

  
    // 2) Convert "joint" owner logic
    if (updatedData.accountOwner === 'joint') {
      if (clientsData.length >= 2) {
        updatedData.accountOwner = [clientsData[0]._id, clientsData[1]._id];
      } else {
        console.warn('[submitUpdatedAccountData] Fewer than 2 clients in household, cannot set to joint.');
        updatedData.accountOwner = [];
      }
    } else {
      if (!updatedData.accountOwner) {
        alert('Please select an Account Owner!');
        return;
      }
      updatedData.accountOwner = [updatedData.accountOwner];
    }
  
    // 3) Handle taxForms if in form
    if (updatedData.editTaxForms) {
      updatedData.taxForms = updatedData.editTaxForms
        .split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0);
      delete updatedData.editTaxForms;
    } else {
      updatedData.taxForms = [];
    }
  
    // 4) Collect Beneficiaries & IRA details
    const editAccountModalElement = document.getElementById('editAccountModal');
    updatedData.beneficiaries = collectBeneficiaries(editAccountModalElement);
    updatedData.iraAccountDetails = collectIraConversions(editAccountModalElement);
  
    // ------------------------------------------------------------
    // ASSET ALLOCATION CHECK: BLANK OK, ELSE MUST SUM 100
    // ------------------------------------------------------------
    const rawCash = updatedData.cash?.trim() || '';
    const rawInc = updatedData.income?.trim() || '';
    const rawAnn = updatedData.annuities?.trim() || '';
    const rawGro = updatedData.growth?.trim() || '';
  
    // Check if all fields are blank
    const allBlank = (!rawCash && !rawInc && !rawAnn && !rawGro);
  
    if (!allBlank) {
      // If not all blank => parse them as numbers (or 0 if blank)
      const cashVal = parseFloat(rawCash || '0');
      const incVal = parseFloat(rawInc || '0');
      const annVal = parseFloat(rawAnn || '0');
      const groVal = parseFloat(rawGro || '0');
  
      // Quick check for non-NaN
      if (
        Number.isNaN(cashVal) ||
        Number.isNaN(incVal) ||
        Number.isNaN(annVal) ||
        Number.isNaN(groVal)
      ) {
        showAlert('danger', 'Please provide valid numeric values for asset allocations or leave them all blank.');
        return;
      }
  
      const totalAllocation = cashVal + incVal + annVal + groVal;
      // Use an epsilon if floating is allowed. Or just do totalAllocation !== 100 if it's integer only
      if (Math.abs(totalAllocation - 100) > 0.000001) {
        showAlert('danger','If any asset allocations are entered, their sum must equal 100%.');
        return; // block
      }
    } else {
      // If all are blank => do nothing => it's allowed
      // But set them to empty or remove them from updatedData if you prefer
      delete updatedData.cash;
      delete updatedData.income;
      delete updatedData.annuities;
      delete updatedData.growth;
    }
  
    console.log('[submitUpdatedAccountData] final updatedData =>', updatedData);
  
    // 5) Send PUT request
    fetch(`/api/accounts/${accountId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedData),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`[submitUpdatedAccountData] HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then((result) => {
        console.log('[submitUpdatedAccountData] Server response =>', result);
        if (result.message && result.message.toLowerCase().includes('success')) {
          modal.hide();
          fetchAccounts(); // Refresh the account table
          showAlert('success', result.message);
        } else {
          showAlert('danger', result.message || 'Failed to update account.');
        }
      })
      .catch((error) => {
        console.error('[submitUpdatedAccountData] Error updating account:', error);
        showAlert('danger', 'Unexpected error while updating account.');
      });
  }
  
  /* ------------------------------------------------------------------
 *  collectWithdrawals(container)
 *  Scans `.withdrawal-entry` rows and returns a clean JS array:
 *    [ { amount: 100, frequency: 'Monthly' }, … ]
 * -----------------------------------------------------------------*/
function collectWithdrawals(container) {
  const out = [];

  container
    .querySelectorAll('.withdrawal-entry')
    .forEach(row => {
      const amountEl = row.querySelector('input[name$="[amount]"]');
      const freqEl   = row.querySelector('select[name$="[frequency]"]');

      const amt  = parseFloat(amountEl?.value ?? '');
      const freq = freqEl?.value ?? '';

      if (!Number.isNaN(amt) && amt >= 0 && freq) {
        out.push({ amount: amt, frequency: freq });
      }
    });

  return out;            // → [] if the user left them blank
}




  /***********************************************************
 * 1) UPDATED collectBeneficiaries WITH A 'CONTAINER' PARAM
 ***********************************************************/
function collectBeneficiaries(container) {
  // Only search within this container
  const primary = [];
  const contingent = [];

  // Get primary beneficiary blocks in the specified container
  container.querySelectorAll('.primary-beneficiary').forEach((beneficiaryBlock) => {
    const firstName = beneficiaryBlock.querySelector('[name="primaryFirstName"]')?.value.trim() || '';
    const lastName = beneficiaryBlock.querySelector('[name="primaryLastName"]')?.value.trim() || '';

    // Only push if user entered both first & last name
    if (firstName && lastName) {
      primary.push({
        _id: beneficiaryBlock.querySelector('[name="primaryId"]')?.value || null,
        firstName,
        lastName,
        relationship: beneficiaryBlock.querySelector('[name="primaryRelationship"]')?.value.trim() || null,
        dateOfBirth: beneficiaryBlock.querySelector('[name="primaryDateOfBirth"]')?.value || null,
        ssn: beneficiaryBlock.querySelector('[name="primarySSN"]')?.value.trim() || null,
        percentageAllocation: parseFloat(
          beneficiaryBlock.querySelector('[name="primaryPercentage"]')?.value
        ) || 0,
      });
    }
  });

  // Get contingent beneficiary blocks in the specified container
  container.querySelectorAll('.contingent-beneficiary').forEach((beneficiaryBlock) => {
    const firstName = beneficiaryBlock.querySelector('[name="contingentFirstName"]')?.value.trim() || '';
    const lastName = beneficiaryBlock.querySelector('[name="contingentLastName"]')?.value.trim() || '';

    // Only push if user entered both first & last name
    if (firstName && lastName) {
      contingent.push({
        _id: beneficiaryBlock.querySelector('[name="contingentId"]')?.value || null,
        firstName,
        lastName,
        relationship: beneficiaryBlock.querySelector('[name="contingentRelationship"]')?.value.trim() || null,
        dateOfBirth: beneficiaryBlock.querySelector('[name="contingentDateOfBirth"]')?.value || null,
        ssn: beneficiaryBlock.querySelector('[name="contingentSSN"]')?.value.trim() || null,
        percentageAllocation: parseFloat(
          beneficiaryBlock.querySelector('[name="contingentPercentage"]')?.value
        ) || 0,
      });
    }
  });

  return { primary, contingent };
}

/***********************************************************
 * 2) UPDATED collectIraConversions WITH A 'CONTAINER' PARAM
 ***********************************************************/
function collectIraConversions(container) {
  const iraDetails = [];

  container.querySelectorAll('.ira-conversion').forEach((conversionBlock) => {
    const yearInput = conversionBlock.querySelector('[name="conversionYear"]');
    const amountInput = conversionBlock.querySelector('[name="conversionAmount"]');

    iraDetails.push({
      year: yearInput ? parseInt(yearInput.value, 10) : null,
      conversionAmount: amountInput ? parseFloat(amountInput.value) : null,
    });
  });

  return iraDetails;
}

  
/**
 * Clears out dynamic sections (primary, contingent, IRA) in the specified modal,
 * removing any existing beneficiary fields or IRA conversions from that modal only.
 * 
 * @param {HTMLElement} modalElement - The container (modal) whose sections you want to clear.
 */
function resetDynamicSections(modalElement) {
  if (!modalElement) return;

  const primarySection = modalElement.querySelector('.primary-beneficiaries-section');
  const contingentSection = modalElement.querySelector('.contingent-beneficiaries-section');
  const iraSection = modalElement.querySelector('.ira-conversions-section');

  if (primarySection) {
    primarySection.innerHTML = '';
  }
  if (contingentSection) {
    contingentSection.innerHTML = '';
  }
  if (iraSection) {
    iraSection.innerHTML = '';
  }
}


  
  

  // Edit Household Form submission - integrate additionalMembers logic here
  editHouseholdForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(editHouseholdForm);
    const data = Object.fromEntries(formData.entries());



    // Convert leadAdvisor to array
    if (data.leadAdvisor) {
      data.leadAdvisor = data.leadAdvisor.split(',').filter(id => id.trim() !== '');
    }


    // 👉 NEW – normalise marginalTaxBracket
    if (data.marginalTaxBracket === '') {
      delete data.marginalTaxBracket;           // treat blank as "unset"
    } else if (data.marginalTaxBracket !== undefined) {
      data.marginalTaxBracket = Number(data.marginalTaxBracket);
    }


    // Gather additional members
    data.additionalMembers = [];
    const memberContainers = editHouseholdModalElement.querySelectorAll('.household-member');
    memberContainers.forEach((container) => {
      const member = {};
      member.firstName = container.querySelector('input[name$="[firstName]"]').value;
      member.lastName = container.querySelector('input[name$="[lastName]"]').value;
      member.dob = container.querySelector('input[name$="[dob]"]').value;
      member.ssn = container.querySelector('input[name$="[ssn]"]').value;
      member.taxFilingStatus = container.querySelector('select[name$="[taxFilingStatus]"]').value;
      member.maritalStatus = container.querySelector('select[name$="[maritalStatus]"]').value;
      member.mobileNumber = container.querySelector('input[name$="[mobileNumber]"]').value;
      member.homePhone = container.querySelector('input[name$="[homePhone]"]').value;
      member.email = container.querySelector('input[name$="[email]"]').value;
      member.homeAddress = container.querySelector('input[name$="[homeAddress]"]').value;

      const idInput = container.querySelector('input[name$="[_id]"]');
      if (idInput) {
        member._id = idInput.value;
      }

      if (member.firstName && member.lastName) {
        data.additionalMembers.push(member);
      }
    });

    fetch(`${window.location.origin}/api/households/${householdData._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(res => res.json())
      .then(result => {
        if (result.success) {
          showAlert('success', 'Household updated successfully.');
          if (editHouseholdModal) editHouseholdModal.hide();
          setTimeout(() => {
            location.reload(); // Refresh page
          }, 1500);
        } else {
          showAlert('danger', result.message || 'Failed to update household.');
        }
      })
      .catch((error) => {
        console.error('Error updating household:', error);
        showAlert('danger', 'An unexpected error occurred.');
      });
  });

  if (editHouseholdButton && editHouseholdModal) {
    editHouseholdButton.addEventListener('click', () => {
      populateModalFields(); // Make sure this sets window.householdData before showing modal
      editHouseholdModal.show();
    });
  }

  const accountsTableBody = document.getElementById('accounts-table-body');
  const prevPageButton = document.getElementById('prev-page');
  const nextPageButton = document.getElementById('next-page');


  // References to pagination elements
  const paginationContainer = document.getElementById('accounts-pagination-ul');
  const paginationInfo      = document.getElementById('accounts-pagination-info');

  let currentPage = 1;
  let totalPages = 1;
  let totalAccounts = 0;
  let currentSearch = '';
  let currentSortField = 'accountOwnerName';
  let currentSortOrder = 'asc';

  let selectAllAcrossPages = false; 
  let selectedAccounts = new Set();
  let isTransitioning = false;

  fetchAccounts();

  const searchInput = document.getElementById('search-accounts');

  // Debounce utility function
  function debounce(fn, delay) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), delay);
    };
  }

  // Debounced search handler
  const handleSearch = debounce(() => {
    currentSearch = searchInput.value.trim();
    currentPage = 1;
    fetchAccounts();
  }, 300);

  if (searchInput) {
    searchInput.addEventListener('input', handleSearch);
  }

/* ───────────────────────────────────────────────────────────
 *  Prepared packets loader
 * ─────────────────────────────────────────────────────────*/
async function fetchPreparedPackets () {
  if (!packetsTbody) return;

  try {
    const res = await fetch(`/api/households/${householdData._id}/packets`, {
      credentials: 'include'
    });
    if (!res.ok) throw new Error('fetch error');
    const { packets } = await res.json();

    packetsTbody.innerHTML = '';
    if (!packets.length) {
      packetsEmpty.classList.remove('d-none');
      return;
    }
    packetsEmpty.classList.add('d-none');

    packets.forEach(p => {
      const tr = document.createElement('tr');
      const range = (p.startDate && p.endDate)
        ? `${new Date(p.startDate).toLocaleDateString()} – ${new Date(p.endDate).toLocaleDateString()}`
        : '—';

      tr.innerHTML = `
        <td class="text-muted placeholder-cell lightning-bolt-cell"><span class="material-symbols-outlined">electric_bolt</span></td>
        <td>${p.surgeName}</td>
        <td>${range}</td>
        <td class="text-end packet-cell">
          <img src="/images/pdf-image.png" class="download-pdf-img small"
               data-url="${p.packetUrl}" alt="Download packet" title="Download packet">
        </td>`;
      packetsTbody.appendChild(tr);
    });
  } catch (err) {
    console.error('[Packets] load error:', err);
  }
}

/* click‑to‑download (delegated) */
packetsTbody?.addEventListener('click', e => {
  const img = e.target.closest('.download-pdf-img');
  if (!img) return;
  const url = img.dataset.url;
  if (!url) return;
  const a = document.createElement('a');
  a.href = url; a.download=''; a.target='_blank'; a.click();
});



  function fetchAccounts() {
    const url = `/api/households/${householdData._id}/accounts?page=${currentPage}&limit=10&sortField=${encodeURIComponent(currentSortField)}&sortOrder=${encodeURIComponent(currentSortOrder)}${currentSearch ? '&search=' + encodeURIComponent(currentSearch) : ''}`;

    fetch(url)
      .then(response => response.json())
      .then(data => {
        renderAccountsTable(data.accounts);
        totalAccounts = data.totalAccounts;
        totalPages = Math.ceil(totalAccounts / 10);
        setupPagination(currentPage, totalPages, totalAccounts);
      })
      .catch(error => {
        console.error('Error fetching accounts:', error);
        showAlert('danger', 'Error fetching accounts.');
      });
  }

  function setupPagination(current, total, totalRecords) {
    currentPage = current;
    totalPages = total;

    if (!paginationContainer) return;
    paginationContainer.innerHTML = '';

    const maxVisiblePages = 5;
    const startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    const prevLi = document.createElement('li');
    prevLi.classList.add('page-item');
    if (currentPage === 1) {
      prevLi.classList.add('disabled');
    }
    const prevBtn = document.createElement('button');
    prevBtn.classList.add('page-link');
    prevBtn.textContent = 'Previous';
    prevBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        fetchAccounts();
      }
    });
    prevLi.appendChild(prevBtn);
    paginationContainer.appendChild(prevLi);

    if (startPage > 1) {
      const ellipsisLi = document.createElement('li');
      ellipsisLi.classList.add('page-item', 'disabled');
      const ellipsisSpan = document.createElement('span');
      ellipsisSpan.classList.add('page-link');
      ellipsisSpan.textContent = '...';
      ellipsisLi.appendChild(ellipsisSpan);
      paginationContainer.appendChild(ellipsisLi);
    }

    for (let i = startPage; i <= endPage; i++) {
      const pageLi = document.createElement('li');
      pageLi.classList.add('page-item');
      if (i === currentPage) {
        pageLi.classList.add('active');
      }
      const pageBtn = document.createElement('button');
      pageBtn.classList.add('page-link');
      pageBtn.textContent = i;
      pageBtn.addEventListener('click', () => {
        currentPage = i;
        fetchAccounts();
      });
      pageLi.appendChild(pageBtn);
      paginationContainer.appendChild(pageLi);
    }

    if (endPage < totalPages) {
      const ellipsisLi = document.createElement('li');
      ellipsisLi.classList.add('page-item', 'disabled');
      const ellipsisSpan = document.createElement('span');
      ellipsisSpan.classList.add('page-link');
      ellipsisSpan.textContent = '...';
      ellipsisLi.appendChild(ellipsisSpan);
      paginationContainer.appendChild(ellipsisLi);
    }

    const nextLi = document.createElement('li');
    nextLi.classList.add('page-item');
    if (currentPage === totalPages) {
      nextLi.classList.add('disabled');
    }
    const nextBtn = document.createElement('button');
    nextBtn.classList.add('page-link');
    nextBtn.textContent = 'Next';
    nextBtn.addEventListener('click', () => {
      if (currentPage < totalPages) {
        currentPage++;
        fetchAccounts();
      }
    });
    nextLi.appendChild(nextBtn);
    paginationContainer.appendChild(nextLi);

    if (paginationInfo) {
      paginationInfo.textContent = `Page ${currentPage} of ${totalPages} | Total Accounts: ${totalRecords}`;
    }
  }

  // function calculateMonthlyDistributionRate(systematicWithdrawAmount, systematicWithdrawFrequency, accountValue) {
  //   // 1) Convert systematicWithdrawAmount to monthlyAmount
  //   let monthlyAmount = 0;
  //   if (!systematicWithdrawAmount || !accountValue || accountValue <= 0) {
  //     return 0;
  //   }
  
  //   switch (systematicWithdrawFrequency) {
  //     case 'Monthly':
  //       monthlyAmount = systematicWithdrawAmount;
  //       break;
  //     case 'Quarterly':
  //       // e.g. if 300 is withdrawn quarterly, monthly is 300/3 = 100
  //       monthlyAmount = systematicWithdrawAmount / 3;
  //       break;
  //     case 'Semi-annual':
  //       // e.g. if 600 is withdrawn semi-annually, monthly is 600/6 = 100
  //       monthlyAmount = systematicWithdrawAmount / 6;
  //       break;
  //     case 'Annually':
  //       // e.g. if 1200 is withdrawn annually, monthly is 1200/12 = 100
  //       monthlyAmount = systematicWithdrawAmount / 12;
  //       break;
  //     default:
  //       // If frequency is blank or unknown, we consider no withdrawal
  //       monthlyAmount = 0;
  //   }
  
  //   // 2) Calculate monthly distribution rate
  //   const rate = (monthlyAmount / accountValue) * 100;
  //   return rate;
  // }
  





  function renderAccountsTable(accounts) {
    const tableAndPaginationContainer = document.querySelector('.table-and-pagination-container');
    const emptyStateContainer = document.querySelector('.empty-state-container');

    accountsTableBody.innerHTML = '';

    if (accounts.length === 0) {
      tableAndPaginationContainer.classList.add('hidden');
      emptyStateContainer.classList.remove('hidden');
      paginationInfo.textContent = '';
      prevPageButton.disabled = true;
      nextPageButton.disabled = true;
      return;
    } else {
      tableAndPaginationContainer.classList.remove('hidden');
      emptyStateContainer.classList.add('hidden');
    }

    accounts.forEach(account => {
      const tr = document.createElement('tr');
      tr.dataset.id = account._id;
    
      // 1) Checkbox column
      const checkboxTd = document.createElement('td');
      checkboxTd.classList.add('inputTh');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.classList.add('household-checkbox');
      checkbox.setAttribute('aria-label', 'Select Account');
      checkbox.dataset.id = account._id;
      checkbox.checked = selectedAccounts.has(account._id);
      checkboxTd.appendChild(checkbox);
    
      // 2) Owner column
      const ownerTd = document.createElement('td');
      ownerTd.classList.add('accountOwnerCell');
      let ownerDisplay = '---';
      if (Array.isArray(account.accountOwner) && account.accountOwner.length > 0) {
        ownerDisplay = account.accountOwner
          .map(o => o.firstName || '---')
          .join(' & ');
      }
      ownerTd.textContent = ownerDisplay;

      //  NEW ► Account number column  ◄ NEW
      const accountNumTd = document.createElement('td');
      accountNumTd.classList.add('accountNumberCell');
      accountNumTd.textContent = maskAccountNumber(account.accountNumber);

    
      // 3) Account type column
      const typeTd = document.createElement('td');
      typeTd.classList.add('typeCell');
      typeTd.textContent = account.accountType || '---';
    
      // 4) Monthly Distribution column (new)
      const monthlyDistTd = document.createElement('td');
      monthlyDistTd.classList.add('monthlyDistCell');
    
      const pct = monthlyRateFromWithdrawals(
        account.systematicWithdrawals,
        account.accountValue
      );
      const dollars = monthlyDollarFromWithdrawals(
        account.systematicWithdrawals,
        account.accountValue
      );
    
      if (pct > 0 && account.accountValue > 0) {
        monthlyDistTd.textContent = `$${dollars} (${pct.toFixed(2)}%)`;
      } else {
        monthlyDistTd.textContent = '---';
      }
    
      // 5) Updated/“As Of” column
      const updatedTd = document.createElement('td');
      updatedTd.classList.add('updatedCell');
      let asOfDisplay = '---';
      if (account.asOfDate) {
        const [y, m, d] = account.asOfDate.slice(0, 10).split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        asOfDisplay = dt.toLocaleDateString();
      } else if (account.updatedAt) {
        asOfDisplay = new Date(account.updatedAt).toLocaleDateString();
      }
      updatedTd.textContent = asOfDisplay;
    
      // 6) Value column
      const valueTd = document.createElement('td');
      valueTd.classList.add('accountValueCell');
      const accountValueNum = typeof account.accountValue === 'number'
        ? account.accountValue
        : 0;
      valueTd.textContent = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
      }).format(accountValueNum);

      const actionsTd = document.createElement('td');
      actionsTd.classList.add('actionsCell', 'position-relative');

      const dropdownContainer = document.createElement('div');
      dropdownContainer.classList.add('dropdown');

      const dropdownToggle = document.createElement('button');
      dropdownToggle.classList.add('btn', 'btn-link', 'p-0', 'three-dots-btn', 'accounts-more-button');
      dropdownToggle.setAttribute('aria-expanded', 'false');
      dropdownToggle.innerHTML = `<i class="fas fa-ellipsis-v"></i>`;

      const dropdownMenu = document.createElement('ul');
      dropdownMenu.classList.add('dropdown-menu');
      dropdownMenu.innerHTML = `
        <li><a class="dropdown-item edit-account" href="#">Edit</a></li>
        <li><a class="dropdown-item view-details" href="#">View Details</a></li>
        <li><a class="dropdown-item js-open-one-time-tx" href="#">One-time Transactions</a></li>
        <li><a class="dropdown-item js-open-account-billing" href="#">Account Billing (AUM)</a></li>
        <li><a class="dropdown-item view-history" href="#">History</a></li>
        <li><a class="dropdown-item text-danger delete-account" href="#">Delete</a></li>
      `;

      function closeAllDropdowns(exceptDropdown = null) {
        document.querySelectorAll('.dropdown-menu.show-more-menu, .dropdown-menu.fade-out').forEach(menu => {
          if (menu !== exceptDropdown) {
            menu.classList.remove('show-more-menu', 'fade-out');
            menu.style.display = 'none';
          }
        });
      }

      

      dropdownToggle.addEventListener('click', (event) => {
        event.stopPropagation();
        const isShown = dropdownMenu.classList.contains('show-more-menu');

        if (isShown) {
          dropdownMenu.classList.add('fade-out');
          dropdownMenu.addEventListener('animationend', () => {
            dropdownMenu.classList.remove('fade-out', 'show-more-menu');
            dropdownMenu.style.display = 'none';
            dropdownToggle.setAttribute('aria-expanded', 'false');
          }, { once: true });
        } else {
          closeAllDropdowns(dropdownMenu);
          dropdownMenu.style.display = 'block';
          dropdownMenu.classList.add('show-more-menu');
          dropdownToggle.setAttribute('aria-expanded', 'true');
        }
      });

      document.addEventListener('click', (event) => {
        if (!dropdownContainer.contains(event.target)) {
          if (dropdownMenu.classList.contains('show-more-menu')) {
            dropdownMenu.classList.add('fade-out');
            dropdownMenu.addEventListener('animationend', () => {
              dropdownMenu.classList.remove('fade-out', 'show-more-menu');
              dropdownMenu.style.display = 'none';
              dropdownToggle.setAttribute('aria-expanded', 'false');
            }, { once: true });
          }
        }
      });

// Build full owner display (First + Last for each, joined with " & ")
const ownerFullDisplay =
  Array.isArray(account.accountOwner) && account.accountOwner.length > 0
    ? account.accountOwner
        .map(o => `${(o.firstName || '').trim()} ${(o.lastName || '').trim()}`.trim())
        .filter(Boolean)
        .join(' & ')
    : '---';

// Extract last 4 digits from the raw account number (digits only)
const last4 = String(account.accountNumber || '').replace(/\D/g, '').slice(-4) || '—';

// Attach data to the “One-time” menu link
const oneTimeLink = dropdownMenu.querySelector('.js-open-one-time-tx');
oneTimeLink.dataset.accountId = account._id;
// Reuse your existing data-account-name field but now with FULL names
oneTimeLink.dataset.accountName = ownerFullDisplay;
oneTimeLink.dataset.accountLast4 = last4;
oneTimeLink.setAttribute(
  'aria-label',
  `Manage one-time transactions for ${ownerFullDisplay}, account ending in ${last4}`
);

const billingLink = dropdownMenu.querySelector('.js-open-account-billing');
billingLink.dataset.accountId = account._id;
billingLink.dataset.accountName = ownerFullDisplay;
billingLink.dataset.accountLast4 = last4;
billingLink.setAttribute(
  'aria-label',
  `Manage account billing for ${ownerFullDisplay}, account ending in ${last4}`
);
billingLink.addEventListener('click', (e) => {
  e.preventDefault();
  // close dropdown like others
  dropdownMenu.classList.remove('show-more-menu', 'fade-out');
  dropdownMenu.style.display = 'none';
  dropdownToggle.setAttribute('aria-expanded', 'false');
});


// Close dropdown on click (unchanged pattern)
oneTimeLink.addEventListener('click', (e) => {
  e.preventDefault();
  dropdownMenu.classList.remove('show-more-menu', 'fade-out');
  dropdownMenu.style.display = 'none';
  dropdownToggle.setAttribute('aria-expanded', 'false');
});


      dropdownMenu.querySelector('.view-details').addEventListener('click', () => {
        dropdownMenu.style.display = 'none';
        dropdownMenu.classList.remove('show-more-menu');
        dropdownToggle.setAttribute('aria-expanded', 'false');
        fetch(`/api/accounts/${account._id}`)
          .then(response => response.json())
          .then(data => {
            const viewAccountModal = new bootstrap.Modal(document.getElementById('viewAccountModal'));
            const modalContent = document.getElementById('view-account-content');
      
            let html = '';
            let ownerNames = '---';
            if (Array.isArray(data.accountOwner) && data.accountOwner.length > 0) {
              ownerNames = data.accountOwner
                .map(o => `${o.firstName || '---'} ${o.lastName || ''}`.trim())
                .join(' & ');
            }
      
            html += `<p><strong>Account Owner:</strong> ${ownerNames}</p>`;
            html += `<p><strong>Account Number:</strong> ${data.accountNumber || '---'}</p>`;
            html += `<p><strong>Account Value:</strong> ${
              data.accountValue !== undefined
                ? '$' + data.accountValue.toLocaleString()
                : '---'
            }</p>`;
            html += `<p><strong>Account Type:</strong> ${data.accountType || '---'}</p>`;
            html += `<p><strong>Tax Status:</strong> ${data.taxStatus || '---'}</p>`;
            html += `<p><strong>Custodian:</strong> ${data.custodianRaw || data.custodian || '---'}</p>`;
            /* ---------------------------------------------------------
               Systematic withdrawals – supports *multiple* entries.
               ---------------------------------------------------------*/
            if (Array.isArray(data.systematicWithdrawals) &&
                data.systematicWithdrawals.length > 0) {
              html += `<h6>Systematic Withdrawals</h6><ul>`;
              data.systematicWithdrawals.forEach(w => {
                if (!w || w.amount === undefined) return;
                const amt = `$${Number(w.amount).toLocaleString()}`;
                const freq = w.frequency || '—';
                html += `<li>${amt} &nbsp;(${freq})</li>`;
              });
              html += `</ul>`;
            } else if (data.systematicWithdrawAmount !== undefined &&
                       data.systematicWithdrawFrequency) {
              /* Fallback for legacy documents */
              html += `<h6>Systematic Withdrawal</h6>`;
              html += `<p>${'$' + Number(data.systematicWithdrawAmount).toLocaleString()} &nbsp;(${data.systematicWithdrawFrequency})</p>`;
            } else {
              html += `<h6>Systematic Withdrawal</h6><p>None</p>`;
            }
            html += `<p><strong>Federal Tax Withholding:</strong> ${
              data.federalTaxWithholding !== undefined
                ? data.federalTaxWithholding + '%'
                : '---'
            }</p>`;
            html += `<p><strong>State Tax Withholding:</strong> ${
              data.stateTaxWithholding !== undefined
                ? data.stateTaxWithholding + '%'
                : '---'
            }</p>`;
            html += `<p><strong>Value As Of 12/31:</strong> ${
              data.valueAsOf12_31 !== undefined
                ? '$' + data.valueAsOf12_31.toLocaleString()
                : '---'
            }</p>`;
      
            // ADD ASSET ALLOCATION FIELDS HERE
            html += `<h6>Asset Allocation</h6>`;
            html += `<p><strong>Cash:</strong> ${
              data.cash !== undefined ? data.cash + '%' : '---'
            }</p>`;
            html += `<p><strong>Income:</strong> ${
              data.income !== undefined ? data.income + '%' : '---'
            }</p>`;
            html += `<p><strong>Annuities:</strong> ${
              data.annuities !== undefined ? data.annuities + '%' : '---'
            }</p>`;
            html += `<p><strong>Growth:</strong> ${
              data.growth !== undefined ? data.growth + '%' : '---'
            }</p>`;
      
            if (data.taxForms && data.taxForms.length > 0) {
              html += `<p><strong>Tax Forms:</strong> ${data.taxForms.join(', ')}</p>`;
            } else {
              html += `<p><strong>Tax Forms:</strong> None</p>`;
            }
      
            if (data.inheritedAccountDetails && Object.keys(data.inheritedAccountDetails).length > 0) {
              html += `<h6>Inherited Account Details</h6>`;
              html += `<p><strong>Deceased Name:</strong> ${
                data.inheritedAccountDetails.deceasedName || '---'
              }</p>`;
              html += `<p><strong>Date of Death:</strong> ${
                data.inheritedAccountDetails.dateOfDeath
                  ? new Date(data.inheritedAccountDetails.dateOfDeath).toLocaleDateString()
                  : '---'
              }</p>`;
              html += `<p><strong>Relationship To Deceased:</strong> ${
                data.inheritedAccountDetails.relationshipToDeceased || '---'
              }</p>`;
            }
      
            if (data.iraAccountDetails && data.iraAccountDetails.length > 0) {
              html += `<h6>IRA Account Details</h6><ul>`;
              data.iraAccountDetails.forEach(detail => {
                html += `<li>Year: ${
                  detail.year || '---'
                }, Conversion Amount: ${
                  detail.conversionAmount !== undefined
                    ? '$' + detail.conversionAmount.toLocaleString()
                    : '---'
                }</li>`;
              });
              html += `</ul>`;
            }
      
            html += `<h6>Beneficiaries</h6>`;
      
            if (data.beneficiaries && data.beneficiaries.primary && data.beneficiaries.primary.length > 0) {
              html += `<strong>Primary:</strong><ul>`;
              data.beneficiaries.primary.forEach(b => {
                const ben = b.beneficiary || {};
                html += `<li>${ben.firstName || '---'} ${ben.lastName || '---'} (Relationship: ${
                  ben.relationship || '---'
                }, Allocation: ${
                  b.percentageAllocation !== undefined ? b.percentageAllocation + '%' : '---'
                })</li>`;
              });
              html += `</ul>`;
            } else {
              html += `<p><strong>Primary Beneficiaries:</strong> None</p>`;
            }
      
            if (data.beneficiaries && data.beneficiaries.contingent && data.beneficiaries.contingent.length > 0) {
              html += `<strong>Contingent:</strong><ul>`;
              data.beneficiaries.contingent.forEach(b => {
                const ben = b.beneficiary || {};
                html += `<li>${ben.firstName || '---'} ${ben.lastName || '---'} (Relationship: ${
                  ben.relationship || '---'
                }, Allocation: ${
                  b.percentageAllocation !== undefined ? b.percentageAllocation + '%' : '---'
                })</li>`;
              });
              html += `</ul>`;
            } else {
              html += `<p><strong>Contingent Beneficiaries:</strong> None</p>`;
            }
      
            html += `<hr><p><strong>Created At:</strong> ${
              data.createdAt ? new Date(data.createdAt).toLocaleString() : '---'
            }</p>`;
            html += `<p><strong>Updated At:</strong> ${
              data.updatedAt ? new Date(data.updatedAt).toLocaleString() : '---'
            }</p>`;
      
            modalContent.innerHTML = html;
            viewAccountModal.show();
          })
          .catch(err => console.error('Error fetching account details:', err));
      });
      
// — View History —
dropdownMenu.querySelector('.view-history').addEventListener('click', () => {
  dropdownMenu.style.display = 'none';
  dropdownMenu.classList.remove('show-more-menu');
  dropdownToggle.setAttribute('aria-expanded', 'false');

  openHistoryModal(account);   // <— call helper below
});


      

      dropdownMenu.querySelector('.edit-account').addEventListener('click', () => {
        dropdownMenu.style.display = 'none';
        dropdownMenu.classList.remove('show-more-menu');
        dropdownToggle.setAttribute('aria-expanded', 'false');

        handleEditAccount(account._id); // Call the modular function
      });

      dropdownMenu.querySelector('.delete-account').addEventListener('click', () => {
        dropdownMenu.style.display = 'none';
        dropdownMenu.classList.remove('show-more-menu');
        dropdownToggle.setAttribute('aria-expanded', 'false');
        const deleteConfirmationModal = new bootstrap.Modal(document.getElementById('deleteConfirmationModal'));
        deleteConfirmationModal.show();

        document.getElementById('confirm-delete').addEventListener('click', () => {
          fetch(`/api/accounts/${account._id}`, {
              method: 'DELETE',
          })
          .then(response => response.json())
          .then(data => {
              showAlert('success', data.message || 'Account deleted successfully.');
              fetchAccounts(); // Refresh account list
          })
          .catch(err => console.error('Error deleting account:', err))
          .finally(() => deleteConfirmationModal.hide());
        });
      });

      dropdownContainer.appendChild(dropdownToggle);
      dropdownContainer.appendChild(dropdownMenu);
      actionsTd.appendChild(dropdownContainer);

      tr.appendChild(checkboxTd);
      tr.appendChild(ownerTd);
      tr.appendChild(accountNumTd);
      tr.appendChild(typeTd);
      tr.appendChild(monthlyDistTd);
      tr.appendChild(updatedTd);
      tr.appendChild(valueTd);
      tr.appendChild(actionsTd);

      accountsTableBody.appendChild(tr);
    });

    updateSelectionContainer();
  }

/**
 * Parse a YYYY-MM-DD or full ISO date string as a local date at midnight.
 */
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.slice(0,10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function buildHistoryHtml(historyArr = []) {
  if (!historyArr.length) {
    return `<p class="text-center text-muted">No history on record.</p>`;
  }

  // pretty‐print raw values
  function formatValue(val) {
    if (Array.isArray(val) && val.every(v => v.amount != null && v.frequency)) {
      return val
        .map(v => `${v.frequency}: $${Number(v.amount).toLocaleString()}`)
        .join('<br>');
    }
    return typeof val === 'number'
      ? `$${val.toLocaleString()}`
      : JSON.stringify(val);
  }

  // friendly field names
  function prettifyField(field) {
    const map = {
      systematicWithdrawals: 'Withdrawals',
      accountValue:          'Account Value',
      // add other mappings if desired
    };
    return map[field] || field;
  }

  return historyArr.map(h => {
    const relevant = h.changes.filter(c =>
      !['accountType','custodian','taxStatus'].includes(c.field)
    );
    if (!relevant.length) return '';

    const asOf = h.asOfDate
      ? parseLocalDate(h.asOfDate)
      : new Date(h.createdAt);
    const when = asOf.toLocaleDateString();
    const updatedOn = new Date(h.changedAt).toLocaleDateString();

    // wrap each label+values in its own container
    const rows = relevant.map(c => {
      const label = prettifyField(c.field);
      const before = formatValue(c.prev === null ? '∅' : c.prev);
      const after  = formatValue(c.next);
      return `
      <div class="history-row row mb-2">
        <div class="col-sm-4 history-label text-end text-end-2 pe-2">
          ${label}
        </div>
        <div class="col-sm-8 history-values">
          <div class="value-before"><small class="text-muted">Before:</small> ${before}</div>
          <div class="value-after"><small class="text-muted">After:</small> ${after}</div>
        </div>
      </div>`;
    }).join('');

    return `
    <div class="card mb-3 shadow-sm history-card">
      <div class="card-header card-header2 bg-white d-flex justify-content-between align-items-center">
        <div class="history-asof">
          <i class="fas fa-calendar-alt me-2 text-secondary"></i>
          <strong>${when}</strong>
        </div>
        <small class="text-muted history-updated-on">Updated on ${updatedOn}</small>
      </div>
      <div class="card-body py-2 history-body">
        ${rows}
      </div>
    </div>`;
  }).join('') || `<p class="text-center text-muted">No visible history changes.</p>`;
}


  


  function addBeneficiaryFields(type, parentContainer = document) {
    const section =
      type === 'primary'
        ? parentContainer.querySelector('.primary-beneficiaries-section')
        : parentContainer.querySelector('.contingent-beneficiaries-section');

    if (!section) {
      console.error(`No section found for type: ${type} in the provided context`);
      return;
    }

    section.style.display = 'block';

    const container = document.createElement('div');
    container.classList.add(`${type}-beneficiary`, 'mb-3');

    const fields = [
      { label: 'First Name', name: `${type}FirstName`, type: 'text', required: true },
      { label: 'Last Name', name: `${type}LastName`, type: 'text', required: true },
      { label: 'Relationship', name: `${type}Relationship`, type: 'text', required: false },
      { label: 'Date of Birth', name: `${type}DateOfBirth`, type: 'date', required: false },
      { label: 'SSN', name: `${type}SSN`, type: 'text', required: false },
      {
        label: 'Percentage Allocation (%)',
        name: `${type}Percentage`,
        type: 'number',
        required: true,
        step: '0.01',
      },
    ];

    fields.forEach((field) => {
      const fieldDiv = document.createElement('div');
      fieldDiv.classList.add('mb-2');

      const label = document.createElement('label');
      label.classList.add('form-label');
      label.textContent = field.label;

      const input = document.createElement('input');
      input.type = field.type;
      input.name = field.name;
      input.classList.add('form-control');
      if (field.required) input.required = true;
      if (field.step) input.step = field.step;

      fieldDiv.appendChild(label);
      fieldDiv.appendChild(input);
      container.appendChild(fieldDiv);
    });

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.classList.add('btn', 'btn-danger', 'mb-3');
    removeButton.textContent = `Remove ${type === 'primary' ? 'Primary' : 'Contingent'} Beneficiary`;
    removeButton.addEventListener('click', () => {
      container.remove();
    });
    container.appendChild(removeButton);

    section.appendChild(container);
  }

  function updatePaginationInfo() {
    if (totalAccounts === 0) {
      paginationInfo.textContent = 'No accounts to display.';
    } else {
      paginationInfo.textContent = `Page ${currentPage} of ${totalPages}, Total Accounts: ${totalAccounts}`;
    }
    prevPageButton.disabled = currentPage === 1 || totalAccounts === 0;
    nextPageButton.disabled = currentPage === totalPages || totalAccounts === 0;
  }

  function showAlert(type, message, options = {}) {
    const alertContainer = document.getElementById('alert-container');
    if (!alertContainer) return;

    const alert = document.createElement('div');
    alert.id = type === 'success' ? 'passwordChangeSuccess' : 'errorAlert';
    alert.className = `alert ${type === 'success' ? 'alert-success' : 'alert-error'}`;
    alert.setAttribute('role', 'alert');

    const iconContainer = document.createElement('div');
    iconContainer.className = type === 'success' ? 'success-icon-container' : 'error-icon-container';
    const icon = document.createElement('i');
    icon.className = type === 'success' ? 'far fa-check-circle' : 'far fa-times-circle';
    iconContainer.appendChild(icon);

    const closeContainer = document.createElement('div');
    closeContainer.className = type === 'success' ? 'success-close-container' : 'error-close-container';
    const closeIcon = document.createElement('span');
    closeIcon.className = 'material-symbols-outlined successCloseIcon';
    closeIcon.innerText = 'close';
    closeContainer.appendChild(closeIcon);

    const textContainer = document.createElement('div');
    textContainer.className = type === 'success' ? 'success-text' : 'error-text';
    const title = document.createElement('h3');
    title.innerText = type === 'success' ? 'Success!' : 'Error!';
    const text = document.createElement('p');
    text.innerText = message;

    textContainer.appendChild(title);
    textContainer.appendChild(text);

    if (options.undo) {
      const undoButton = document.createElement('button');
      undoButton.className = 'alert-undo-button';
      undoButton.innerText = 'Undo';
      undoButton.addEventListener('click', () => {
        options.undoCallback();
        closeAlert(alert);
      });
      textContainer.appendChild(undoButton);
    }

    alert.appendChild(iconContainer);
    alert.appendChild(closeContainer);
    alert.appendChild(textContainer);

    alertContainer.prepend(alert);

    void alert.offsetWidth;
    alert.classList.add('show');

    setTimeout(() => closeAlert(alert), 5000);
    closeIcon.addEventListener('click', () => closeAlert(alert));

    function closeAlert(a) {
      a.classList.add('exit');
      setTimeout(() => {
        if (a && a.parentNode) {
          a.parentNode.removeChild(a);
        }
      }, 500);
    }
  }

  function populateModalFields() {
    // Ensure these IDs match the edit modal field IDs
    document.getElementById('editFirstName2').value = householdData.headOfHousehold.firstName || '';
    document.getElementById('editLastName2').value = householdData.headOfHousehold.lastName || '';
    document.getElementById('editDob2').value = formatDateForInput(householdData.headOfHousehold.dob);
    document.getElementById('editSsn2').value = householdData.headOfHousehold.ssn || '';
    document.getElementById('editTaxFilingStatus2').value = householdData.headOfHousehold.taxFilingStatus || '';
    document.getElementById('editMaritalStatus2').value = householdData.headOfHousehold.maritalStatus || '';
    document.getElementById('editMobileNumber2').value = householdData.headOfHousehold.mobileNumber || '';
    document.getElementById('editHomePhone2').value = householdData.headOfHousehold.homePhone || '';
    document.getElementById('editEmail2').value = householdData.headOfHousehold.email || '';
    document.getElementById('editHomeAddress2').value = householdData.headOfHousehold.homeAddress || '';
   
    // 👉 NEW – Marginal Tax Bracket
    document.getElementById('editMarginalTaxBracket').value =
      householdData.marginalTaxBracket != null
        ? householdData.marginalTaxBracket
        : '';


    

    const membersSection = document.querySelector('#editHouseholdModal .household-members-section');
    membersSection.innerHTML = '';

    const additionalMembers = clientsData.filter(
      (client) => client._id !== householdData.headOfHousehold._id
    );

    additionalMembers.forEach((member, index) => {
      addMemberFields(member, index, 'edit');
    });

    const addMemberButton = document.getElementById('edit-add-household-member');
    addMemberButton.removeEventListener('click', handleAddMemberClick);
    addMemberButton.addEventListener('click', handleAddMemberClick);

    updateMemberIndices();
  }

  function handleAddMemberClick() {
    addMemberFields({}, undefined, 'edit');
    updateMemberIndices();
  }

  function updateMemberIndices() {
    const memberForms = document.querySelectorAll('.household-member');
    memberForms.forEach((form, index) => {
      const header = form.querySelector('h6.formModalHeadersTwo');
      if (header) {
        header.textContent = `Additional Household Member ${index + 1}`;
      }
    });
  }

  function formatDateForInput(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date)) return '';
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function addMemberFields(memberData = {}, index, mode) {
    const modalSelector = mode === 'edit' ? '#editHouseholdModal' : '#addHouseholdModal';
    const membersSection = document.querySelector(`${modalSelector} .household-members-section`);

    const memberIndex = index !== undefined ? index : Date.now();
    const memberContainer = document.createElement('div');
    memberContainer.classList.add('household-member', 'mb-4');
    memberContainer.dataset.memberIndex = memberIndex;

    const header = document.createElement('h6');
    header.classList.add('formModalHeadersTwo');
    header.textContent = 'Additional Household Member';

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.classList.add('btn', 'btn-danger', 'remove-member-btn');
    removeButton.textContent = 'Remove Member';

    removeButton.addEventListener('click', () => {
      memberContainer.remove();
      updateMemberIndices();
    });

    memberContainer.appendChild(header);

    if (memberData._id) {
      const hiddenIdInput = document.createElement('input');
      hiddenIdInput.type = 'hidden';
      hiddenIdInput.name = `additionalMembers[${memberIndex}][_id]`;
      hiddenIdInput.value = memberData._id;
      memberContainer.appendChild(hiddenIdInput);
    }

    const fields = [
      {
        label: 'First Name *',
        type: 'text',
        name: 'firstName',
        required: true,
        placeholder: 'Enter first name',
        value: memberData.firstName || '',
      },
      {
        label: 'Last Name *',
        type: 'text',
        name: 'lastName',
        required: true,
        placeholder: 'Enter last name',
        value: memberData.lastName || '',
      },
      {
        label: 'Date of Birth',
        type: 'date',
        name: 'dob',
        required: false,
        value: formatDateForInput(memberData.dob),
      },
      {
        label: 'Social Security Number (SSN)',
        type: 'text',
        name: 'ssn',
        required: false,
        placeholder: '123-45-6789',
        value: memberData.ssn || '',
      },
      {
        label: 'Mobile Number',
        type: 'tel',
        name: 'mobileNumber',
        required: false,
        placeholder: '123-456-7890',
        value: memberData.mobileNumber || '',
      },
      {
        label: 'Home Phone',
        type: 'tel',
        name: 'homePhone',
        required: false,
        placeholder: '123-456-7890',
        value: memberData.homePhone || '',
      },
      {
        label: 'Email',
        type: 'email',
        name: 'email',
        required: false,
        placeholder: 'example@domain.com',
        value: memberData.email || '',
      },
      {
        label: 'Home Address',
        type: 'text',
        name: 'homeAddress',
        required: false,
        placeholder: 'Enter home address',
        value: memberData.homeAddress || '',
      },
    ];

    fields.forEach((field) => {
      const fieldDiv = document.createElement('div');
      fieldDiv.classList.add('mb-3');

      const label = document.createElement('label');
      label.classList.add('form-label');
      label.setAttribute('for', `member_${field.name}_${memberIndex}`);
      label.textContent = field.label;

      const input = document.createElement('input');
      input.type = field.type;
      input.classList.add('form-control');
      input.id = `member_${field.name}_${memberIndex}`;
      input.name = `additionalMembers[${memberIndex}][${field.name}]`;
      if (field.required) input.required = true;
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.value) input.value = field.value;

      fieldDiv.appendChild(label);
      fieldDiv.appendChild(input);

      memberContainer.appendChild(fieldDiv);
    });

    const taxFilingStatusDiv = document.createElement('div');
    taxFilingStatusDiv.classList.add('mb-3');

    const taxFilingStatusLabel = document.createElement('label');
    taxFilingStatusLabel.classList.add('form-label');
    taxFilingStatusLabel.setAttribute('for', `memberTaxFilingStatus_${memberIndex}`);
    taxFilingStatusLabel.textContent = 'Tax Filing Status';

    const taxFilingStatusSelect = document.createElement('select');
    taxFilingStatusSelect.classList.add('form-select');
    taxFilingStatusSelect.id = `memberTaxFilingStatus_${memberIndex}`;
    taxFilingStatusSelect.name = `additionalMembers[${memberIndex}][taxFilingStatus]`;

    const taxFilingStatusOptions = [
      { value: '', text: 'Select Tax Filing Status' },
      { value: 'Married Filing Jointly', text: 'Married Filing Jointly' },
      { value: 'Married Filing Separately', text: 'Married Filing Separately' },
      { value: 'Single', text: 'Single' },
      { value: 'Head of Household', text: 'Head of Household' },
      { value: 'Qualifying Widower', text: 'Qualifying Widower' },
    ];

    taxFilingStatusOptions.forEach((optionData) => {
      const option = document.createElement('option');
      option.value = optionData.value;
      option.textContent = optionData.text;
      if (memberData.taxFilingStatus === optionData.value) {
        option.selected = true;
      }
      taxFilingStatusSelect.appendChild(option);
    });

    taxFilingStatusDiv.appendChild(taxFilingStatusLabel);
    taxFilingStatusDiv.appendChild(taxFilingStatusSelect);
    memberContainer.appendChild(taxFilingStatusDiv);

    const maritalStatusDiv = document.createElement('div');
    maritalStatusDiv.classList.add('mb-3');

    const maritalStatusLabel = document.createElement('label');
    maritalStatusLabel.classList.add('form-label');
    maritalStatusLabel.setAttribute('for', `memberMaritalStatus_${memberIndex}`);
    maritalStatusLabel.textContent = 'Marital Status';

    const maritalStatusSelect = document.createElement('select');
    maritalStatusSelect.classList.add('form-select');
    maritalStatusSelect.id = `memberMaritalStatus_${memberIndex}`;
    maritalStatusSelect.name = `additionalMembers[${memberIndex}][maritalStatus]`;

    const maritalStatusOptions = [
      { value: '', text: 'Select Marital Status' },
      { value: 'Married', text: 'Married' },
      { value: 'Single', text: 'Single' },
      { value: 'Widowed', text: 'Widowed' },
      { value: 'Divorced', text: 'Divorced' },
    ];

    maritalStatusOptions.forEach((optionData) => {
      const option = document.createElement('option');
      option.value = optionData.value;
      option.textContent = optionData.text;
      if (memberData.maritalStatus === optionData.value) {
        option.selected = true;
      }
      maritalStatusSelect.appendChild(option);
    });

    maritalStatusDiv.appendChild(maritalStatusLabel);
    maritalStatusDiv.appendChild(maritalStatusSelect);
    memberContainer.appendChild(maritalStatusDiv);

    memberContainer.appendChild(removeButton);
    membersSection.appendChild(memberContainer);
  }

  const selectAllCheckbox = document.getElementById('select-all');
  const selectionContainer = document.querySelector('.selection-container');
  const selectionCount = document.getElementById('selection-count');
  const clearSelectionLink = document.getElementById('clear-selection');
  const deleteSelectedButton = document.getElementById('delete-selected');
  const sortIcons = document.querySelectorAll('.sort-icon');

  document.querySelectorAll('.copy-icon').forEach((icon) => {
    const tooltip = document.createElement('span');
    tooltip.classList.add('tooltip-text');
    tooltip.innerText = 'Copy';
    icon.appendChild(tooltip);

    icon.addEventListener('click', () => {
      const fieldValue = icon.getAttribute('data-field');
      navigator.clipboard.writeText(fieldValue).then(
        () => {
          tooltip.innerText = 'Copied!';
          setTimeout(() => {
            tooltip.innerText = 'Copy';
          }, 2000);
        },
        (err) => {
          console.error('Failed to copy: ', err);
        }
      );
    });
  });

  function initializeCopyFunctionality() {
    document.querySelectorAll('.copy-icon').forEach((icon) => {
      if (!icon.dataset.listenerAdded) {
        const tooltip = document.createElement('span');
        tooltip.classList.add('tooltip-text');
        tooltip.innerText = 'Copy';
        icon.appendChild(tooltip);

        icon.addEventListener('click', () => {
          const fieldValue = icon.getAttribute('data-field');
          navigator.clipboard.writeText(fieldValue).then(
            () => {
              tooltip.innerText = 'Copied!';
              setTimeout(() => {
                tooltip.innerText = 'Copy';
              }, 2000);
            },
            (err) => {
              console.error('Failed to copy: ', err);
            }
          );
        });
        icon.dataset.listenerAdded = 'true';
      }
    });
  }

  initializeCopyFunctionality();

  const householdMemberTabs = document.getElementById('householdMemberTabs');
  if (householdMemberTabs) {
    householdMemberTabs.addEventListener('shown.bs.tab', () => {
      initializeCopyFunctionality();
    });
  }

  function showSelectionContainer() {
    if (isTransitioning) return;
    isTransitioning = true;
    selectionContainer.classList.add('visible');
    selectionContainer.setAttribute('aria-hidden', 'false');
    selectionContainer.addEventListener('transitionend', () => {
      isTransitioning = false;
    }, { once: true });
  }

  function hideSelectionContainer() {
    if (isTransitioning) return;
    isTransitioning = true;
    selectionContainer.classList.remove('visible');
    selectionContainer.setAttribute('aria-hidden', 'true');
    selectionContainer.addEventListener('transitionend', () => {
      isTransitioning = false;
    }, { once: true });
  }

  function getCurrentPageSelectedCount() {
    const checkboxes = document.querySelectorAll('#accounts-table-body .household-checkbox');
    let count = 0;
    checkboxes.forEach(cb => {
      if (cb.checked) count++;
    });
    return count;
  }

  function updateSelectionContainer() {
    const currentPageSelectedCount = getCurrentPageSelectedCount();
    if (currentPageSelectedCount > 0) {
      if (!selectionContainer.classList.contains('visible')) {
        showSelectionContainer();
      }
      selectionCount.textContent = `${currentPageSelectedCount} record${currentPageSelectedCount > 1 ? 's' : ''} on this page have been selected.`;
      clearSelectionLink.classList.remove('hidden');
    } else {
      if (selectionContainer.classList.contains('visible')) {
        hideSelectionContainer();
      }
    }
  }
  const deleteConfirmationModalElement = document.getElementById('deleteConfirmationModal');
  const deleteConfirmationModal = deleteConfirmationModalElement ? new bootstrap.Modal(deleteConfirmationModalElement) : null;
  const confirmDeleteButton = document.getElementById('confirm-delete');

  if (selectAllCheckbox && selectionContainer && clearSelectionLink && deleteSelectedButton) {
    document.getElementById('accounts-table-body')?.addEventListener('change', (e) => {
      if (e.target.classList.contains('household-checkbox')) {
        const accountId = e.target.dataset.id;
        if (e.target.checked) {
          selectedAccounts.add(accountId);
        } else {
          selectedAccounts.delete(accountId);
        }
        const allCheckboxes = document.querySelectorAll('#accounts-table-body .household-checkbox');
        const allChecked = Array.from(allCheckboxes).every(cb => cb.checked);
        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = Array.from(allCheckboxes).some(cb => cb.checked) && !allChecked;
        updateSelectionContainer();
      }
    });

    selectAllCheckbox.addEventListener('change', () => {
      const isChecked = selectAllCheckbox.checked;
      const checkboxes = document.querySelectorAll('#accounts-table-body .household-checkbox');
      checkboxes.forEach(cb => cb.checked = isChecked);
      if (isChecked) {
        checkboxes.forEach(cb => selectedAccounts.add(cb.dataset.id));
      } else {
        checkboxes.forEach(cb => selectedAccounts.delete(cb.dataset.id));
      }
      updateSelectionContainer();
    });

    clearSelectionLink.addEventListener('click', (e) => {
      e.preventDefault();
      selectedAccounts.clear();
      const checkboxes = document.querySelectorAll('#accounts-table-body .household-checkbox');
      checkboxes.forEach(cb => cb.checked = false);
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
      updateSelectionContainer();
    });

    deleteSelectedButton.addEventListener('click', () => {
      if (selectedAccounts.size === 0) return;
      if (deleteConfirmationModal) {
        deleteConfirmationModal.show();
      }
    });

    if (confirmDeleteButton) {
      confirmDeleteButton.addEventListener('click', () => {
        if (selectedAccounts.size === 0) return;

        const accountIds = Array.from(selectedAccounts);
        fetch('/api/accounts/bulk-delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountIds })
        })
        .then(response => response.json())
        .then(data => {
          if (data.message) {
            showAlert('success', data.message);
          }
          selectedAccounts.clear();
          fetchAccounts(); // Refresh accounts

          const checkboxes = document.querySelectorAll('#accounts-table-body .household-checkbox');
          checkboxes.forEach(cb => cb.checked = false);
          selectAllCheckbox.checked = false;
          selectAllCheckbox.indeterminate = false;
          updateSelectionContainer();
        })
        .catch(error => {
          console.error('Error deleting accounts:', error);
          showAlert('danger', 'Error deleting accounts.');
        })
        .finally(() => {
          if (deleteConfirmationModal) {
            deleteConfirmationModal.hide();
          }
        });
      });
    }
  }

  sortIcons.forEach(icon => {
    icon.addEventListener('click', () => {
      const field = icon.dataset.field;
      if (!field) return;

      let newOrder;
      if (icon.textContent.trim() === 'arrow_upward') {
        icon.textContent = 'arrow_downward';
        newOrder = 'desc';
      } else {
        icon.textContent = 'arrow_upward';
        newOrder = 'asc';
      }

      currentSortField = field;
      currentSortOrder = newOrder;

      fetchAccounts();
    });
  });



  function openHistoryModal(accountMeta) {
    const modalEl  = document.getElementById('accountHistoryModal');
    const modal    = new bootstrap.Modal(modalEl);
  
    // 1) Header
    const owners = Array.isArray(accountMeta.accountOwner)
      ? accountMeta.accountOwner.map(o => `${o.firstName} ${o.lastName}`).join(' & ')
      : '—';
  
    document.getElementById('history-header').innerHTML = `
      <h5 class="mb-1 householdDetailHeader">Account #${accountMeta.accountNumber || '—'}</h5>
      <p class="mb-1 supportingText"><strong>Owner:</strong> ${owners}</p>
      <p class="mb-1 supportingText"><strong>Type:</strong> ${accountMeta.accountType || '—'}</p>
      ${accountMeta.custodian
        ? `<p class="mb-0 supportingText"><strong>Custodian:</strong> ${accountMeta.custodian}</p>`
        : ''}`;
  
    // 2) Timeline spinner
    const timelineEl = document.getElementById('history-timeline');
    timelineEl.innerHTML = '<div class="text-center py-4"><div class="spinner-border"></div></div>';
  
    // 3) Fetch & render cards
    fetch(`/api/accounts/${accountMeta._id}/history`)
      .then(r => r.json())
      .then(({ history }) => {
        timelineEl.innerHTML = buildHistoryHtml(history);
      })
      .catch(err => {
        console.error('History fetch failed:', err);
        timelineEl.innerHTML = '<p class="text-danger text-center">Failed to load history.</p>';
      });
  
    modal.show();
  }
  


  // ————————————
// Inline edit modal for Marginal Tax Bracket
// ————————————
const margModalEl = document.getElementById('editMarginalModal');
const margModal = new bootstrap.Modal(margModalEl);
const margInput = document.getElementById('modalMarginalTaxBracket');

// 1) When you click any of the summary‐boxes…
document.querySelectorAll('.dataBox.marginal-tax').forEach(box => {
  box.addEventListener('click', () => {
    // populate with current value (or blank)
    const current = window.householdData.marginalTaxBracket;
    margInput.value = current != null ? current : '';
    margModal.show();
  });
});

// 2) Handle the small form inside that modal
document.getElementById('modalMarginalForm').addEventListener('submit', async e => {
  e.preventDefault();
  const raw = parseFloat(margInput.value);
  const body = {};
  if (isNaN(raw)) {
    body.marginalTaxBracket = null;
  } else {
    body.marginalTaxBracket = raw;
  }

  try {
    const res = await fetch(
      `/api/households/${window.householdData._id}`,
      {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(body)
      }
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json.message||res.statusText);

    // 3) Update UI in all three boxes
    window.householdData.marginalTaxBracket = body.marginalTaxBracket;
    document.querySelectorAll('.dataBox.marginal-tax .summary-sub-header')
      .forEach(p => {
        if (body.marginalTaxBracket == null) {
          p.textContent = '--';
        } else {
          p.textContent = `${body.marginalTaxBracket.toFixed(0)}%`;
        }
      });

    showAlert('success','Marginal bracket updated.');
    margModal.hide();
  } catch(err) {
    console.error(err);
    showAlert('danger', err.message || 'Failed to update marginal bracket.');
  }
});




  // Initial data fetch
  fetchAccounts();
  fetchPreparedPackets();

  

});
