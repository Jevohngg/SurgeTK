// public/js/householdDetails.js

document.addEventListener('DOMContentLoaded', () => {
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

  const editHouseholdButton = document.getElementById('editHouseholdButton');
  const addHouseholdModalElement = document.getElementById('addHouseholdModal');
  const addHouseholdModal = addHouseholdModalElement
    ? new bootstrap.Modal(addHouseholdModalElement)
    : null;
  const addHouseholdForm = document.getElementById('add-household-form');

  if (editHouseholdButton && addHouseholdModal && addHouseholdForm) {
    editHouseholdButton.addEventListener('click', () => {
      populateModalFields();
      addHouseholdModal.show();
    });

    // Handle form submission
    addHouseholdForm.addEventListener('submit', handleFormSubmit);
  }

  const accountsTableBody = document.getElementById('accounts-table-body');
  const prevPageButton = document.getElementById('prev-page');
  const nextPageButton = document.getElementById('next-page');
  const paginationInfo = document.getElementById('pagination-info');




  // References to pagination elements
  const paginationContainer = document.querySelector('.pagination-container nav ul.pagination');


  let currentPage = 1;
  let totalPages = 1;
  let totalAccounts = 0;
  let currentSearch = '';
  let currentSortField = 'accountOwnerName';
  let currentSortOrder = 'asc';

  let selectAllAcrossPages = false; // If needed
  let selectedAccounts = new Set();
  let isTransitioning = false;

  fetchAccounts();

  function fetchAccounts() {
    fetch(`/api/households/${householdData._id}/accounts?page=${currentPage}&limit=10`)
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

   // Setup Pagination - adapted from households logic
   function setupPagination(current, total, totalRecords) {
    currentPage = current;
    totalPages = total;

    if (!paginationContainer) return;
    paginationContainer.innerHTML = '';

    // Max number of visible pages in pagination
    const maxVisiblePages = 5;
    const startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    // Previous Button
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

    // Ellipsis before the start (if necessary)
    if (startPage > 1) {
      const ellipsisLi = document.createElement('li');
      ellipsisLi.classList.add('page-item', 'disabled');
      const ellipsisSpan = document.createElement('span');
      ellipsisSpan.classList.add('page-link');
      ellipsisSpan.textContent = '...';
      ellipsisLi.appendChild(ellipsisSpan);
      paginationContainer.appendChild(ellipsisLi);
    }

    // Page Numbers
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

    // Ellipsis after the end (if necessary)
    if (endPage < totalPages) {
      const ellipsisLi = document.createElement('li');
      ellipsisLi.classList.add('page-item', 'disabled');
      const ellipsisSpan = document.createElement('span');
      ellipsisSpan.classList.add('page-link');
      ellipsisSpan.textContent = '...';
      ellipsisLi.appendChild(ellipsisSpan);
      paginationContainer.appendChild(ellipsisLi);
    }

    // Next Button
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

    // Pagination Info
    if (paginationInfo) {
      paginationInfo.textContent = `Page ${currentPage} of ${totalPages} | Total Accounts: ${totalRecords}`;
    }
  }

  function renderAccountsTable(accounts) {
    accountsTableBody.innerHTML = '';
    if (accounts.length === 0) {
      paginationInfo.textContent = 'No accounts to display.';
      prevPageButton.disabled = true;
      nextPageButton.disabled = true;
      return;
    }
  
    accounts.forEach(account => {
      const tr = document.createElement('tr');
      tr.dataset.id = account._id;
  
      // Checkbox cell
      const checkboxTd = document.createElement('td');
      checkboxTd.classList.add('inputTh');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.classList.add('household-checkbox');
      checkbox.setAttribute('aria-label', 'Select Account');
      checkbox.dataset.id = account._id;
  
      // If selectAllAcrossPages (optional), set checked accordingly
      checkbox.checked = selectedAccounts.has(account._id);
  
      checkboxTd.appendChild(checkbox);
  
      // Account Owner Cell (first name only)
      const ownerTd = document.createElement('td');
      ownerTd.classList.add('accountOwnerCell');
      const owner = account.accountOwner || {};
      const ownerFirstName = owner.firstName || '---';
      ownerTd.textContent = ownerFirstName;
  
      // Account Type Cell
      const typeTd = document.createElement('td');
      typeTd.classList.add('typeCell');
      typeTd.textContent = account.accountType || '---';
  
      // Monthly Distribution Cell
      const monthlyDistTd = document.createElement('td');
      monthlyDistTd.classList.add('monthlyDistCell');
      if (account.systematicWithdrawAmount && account.systematicWithdrawFrequency) {
        monthlyDistTd.textContent = `${account.systematicWithdrawAmount} (${account.systematicWithdrawFrequency})`;
      } else {
        monthlyDistTd.textContent = '---';
      }
  
      // Last Updated Cell
      const updatedTd = document.createElement('td');
      updatedTd.classList.add('updatedCell');
      // Assuming account.updatedAt is available; otherwise show '---'
      // If updatedAt is an ISO date string, we could format it as well.
      const lastUpdated = account.updatedAt ? new Date(account.updatedAt).toLocaleDateString() : '---';
      updatedTd.textContent = lastUpdated;
  
      // Account Value Cell - format as currency
      const valueTd = document.createElement('td');
      valueTd.classList.add('accountValueCell');
      const accountValue = typeof account.accountValue === 'number' ? account.accountValue : 0;
      valueTd.textContent = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
      }).format(accountValue);

 // Actions Cell (3-dot menu)
const actionsTd = document.createElement('td');
actionsTd.classList.add('actionsCell', 'position-relative');

const dropdownContainer = document.createElement('div');
dropdownContainer.classList.add('dropdown');

const dropdownToggle = document.createElement('button');
dropdownToggle.classList.add(
  'btn',
  'btn-link',
  'p-0',
  'three-dots-btn',
  'accounts-more-button'
  // Removed 'dropdown-toggle' class to prevent Bootstrap's automatic handling
);
// Removed 'data-bs-toggle="dropdown"' attribute
dropdownToggle.setAttribute('aria-expanded', 'false');
dropdownToggle.innerHTML = `<i class="fas fa-ellipsis-v"></i>`; // 3-dot icon

const dropdownMenu = document.createElement('ul');
dropdownMenu.classList.add('dropdown-menu');
dropdownMenu.innerHTML = `
  <li><a class="dropdown-item" href="#">View Details</a></li>
  <li><a class="dropdown-item" href="#">Edit</a></li>
  <li><a class="dropdown-item text-danger" href="#">Delete</a></li>
`;

dropdownContainer.appendChild(dropdownToggle);
dropdownContainer.appendChild(dropdownMenu);
actionsTd.appendChild(dropdownContainer);

// Function to close all other dropdowns (similar to notifications)
function closeAllDropdowns(exceptDropdown = null) {
  document.querySelectorAll('.dropdown-menu.show-more-menu, .dropdown-menu.fade-out').forEach(menu => {
    if (menu !== exceptDropdown) {
      menu.classList.remove('show-more-menu');
      menu.classList.remove('fade-out');
      menu.style.display = 'none';
    }
  });
}

// Event listener for the 3-dot toggle button
dropdownToggle.addEventListener('click', (event) => {
  event.stopPropagation(); // Prevent the click from bubbling up to document

  const isShown = dropdownMenu.classList.contains('show-more-menu');

  if (isShown) {
    // Initiate fade-out animation
    dropdownMenu.classList.add('fade-out');

    // Listen for the end of the animation to hide the dropdown
    dropdownMenu.addEventListener('animationend', () => {
      dropdownMenu.classList.remove('fade-out');
      dropdownMenu.classList.remove('show-more-menu');
      dropdownMenu.style.display = 'none';
      dropdownToggle.setAttribute('aria-expanded', 'false');
    }, { once: true });
  } else {
    // Close other open dropdowns
    closeAllDropdowns(dropdownMenu);

    // Show the dropdown
    dropdownMenu.classList.remove('fade-out');
    dropdownMenu.style.display = 'block';
    dropdownMenu.classList.add('show-more-menu');
    dropdownToggle.setAttribute('aria-expanded', 'true');
  }
});

// Close the dropdown when clicking outside
document.addEventListener('click', (event) => {
  if (!dropdownContainer.contains(event.target)) {
    if (dropdownMenu.classList.contains('show-more-menu')) {
      // Initiate fade-out animation
      dropdownMenu.classList.add('fade-out');

      // Listen for the end of the animation to hide the dropdown
      dropdownMenu.addEventListener('animationend', () => {
        dropdownMenu.classList.remove('fade-out');
        dropdownMenu.classList.remove('show-more-menu');
        dropdownMenu.style.display = 'none';
        dropdownToggle.setAttribute('aria-expanded', 'false');
      }, { once: true });
    }
  }
});




      tr.appendChild(checkboxTd);
      tr.appendChild(ownerTd);
      tr.appendChild(typeTd);
      tr.appendChild(monthlyDistTd);
      tr.appendChild(updatedTd);
      tr.appendChild(valueTd);
      tr.appendChild(actionsTd);
  
      accountsTableBody.appendChild(tr);
    });
  
    // Update selection container if needed
    updateSelectionContainer();
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

  /**
   * Alert Function
   * Displays alert messages to the user.
   * @param {string} type - Type of alert ('success' or 'danger').
   * @param {string} message - The alert message.
   * @param {Object} options - Additional options (e.g., undo).
   */
  function showAlert(type, message, options = {}) {
    const alertContainer = document.getElementById('alert-container');
    if (!alertContainer) return; // Exit if alert container doesn't exist

    const alert = document.createElement('div');
    alert.id = type === 'success' ? 'passwordChangeSuccess' : 'errorAlert';
    alert.className = `alert ${type === 'success' ? 'alert-success' : 'alert-error'}`;
    alert.setAttribute('role', 'alert');

    // Icon container
    const iconContainer = document.createElement('div');
    iconContainer.className = type === 'success' ? 'success-icon-container' : 'error-icon-container';
    const icon = document.createElement('i');
    icon.className = type === 'success' ? 'far fa-check-circle' : 'far fa-times-circle';
    iconContainer.appendChild(icon);

    // Close button container
    const closeContainer = document.createElement('div');
    closeContainer.className = type === 'success' ? 'success-close-container' : 'error-close-container';
    const closeIcon = document.createElement('span');
    closeIcon.className = 'material-symbols-outlined successCloseIcon';
    closeIcon.innerText = 'close';
    closeContainer.appendChild(closeIcon);

    // Text container
    const textContainer = document.createElement('div');
    textContainer.className = type === 'success' ? 'success-text' : 'error-text';
    const title = document.createElement('h3');
    title.innerText = type === 'success' ? 'Success!' : 'Error!';
    const text = document.createElement('p');
    text.innerText = message;

    textContainer.appendChild(title);
    textContainer.appendChild(text);

    // Undo option if provided
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
    document.getElementById('firstName').value = householdData.headOfHousehold.firstName || '';
    document.getElementById('lastName').value = householdData.headOfHousehold.lastName || '';
    document.getElementById('dob').value = formatDateForInput(householdData.headOfHousehold.dob);
    document.getElementById('ssn').value = householdData.headOfHousehold.ssn || '';
    document.getElementById('taxFilingStatus').value = householdData.headOfHousehold.taxFilingStatus || '';
    document.getElementById('maritalStatus').value = householdData.headOfHousehold.maritalStatus || '';
    document.getElementById('mobileNumber').value = householdData.headOfHousehold.mobileNumber || '';
    document.getElementById('homePhone').value = householdData.headOfHousehold.homePhone || '';
    document.getElementById('email').value = householdData.headOfHousehold.email || '';
    document.getElementById('homeAddress').value = householdData.headOfHousehold.homeAddress || '';

    const membersSection = document.querySelector('.household-members-section');
    membersSection.innerHTML = '';

    const additionalMembers = clientsData.filter(
      (client) => client._id !== householdData.headOfHousehold._id
    );
    additionalMembers.forEach((member, index) => {
      addMemberFields(member, index);
    });

    const addMemberButton = document.getElementById('add-household-member');
    addMemberButton.addEventListener('click', () => {
      addMemberFields();
      updateMemberIndices();
    });

    updateMemberIndices();
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

  function addMemberFields(memberData = {}, index) {
    const membersSection = document.querySelector('.household-members-section');
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

  function updateMemberIndices() {
    const memberForms = document.querySelectorAll('.household-member');
    memberForms.forEach((form, index) => {
      const header = form.querySelector('h6.formModalHeadersTwo');
      if (header) {
        header.textContent = `Additional Household Member ${index + 1}`;
      }
    });
  }

  function handleFormSubmit(event) {
    event.preventDefault();

    const data = {};

    data.firstName = document.getElementById('firstName').value;
    data.lastName = document.getElementById('lastName').value;
    data.dob = document.getElementById('dob').value;
    data.ssn = document.getElementById('ssn').value;
    data.taxFilingStatus = document.getElementById('taxFilingStatus').value;
    data.maritalStatus = document.getElementById('maritalStatus').value;
    data.mobileNumber = document.getElementById('mobileNumber').value;
    data.homePhone = document.getElementById('homePhone').value;
    data.email = document.getElementById('email').value;
    data.homeAddress = document.getElementById('homeAddress').value;

    data.additionalMembers = [];
    const memberContainers = document.querySelectorAll('.household-member');
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
      .then((response) => response.json())
      .then((result) => {
        if (result.success) {
          addHouseholdModal.hide();
          showAlert('success', 'Household updated successfully.');
          setTimeout(() => {
            location.reload();
          }, 3000);
        } else {
          showAlert('danger', result.message || 'An error occurred while updating the household.');
        }
      })
      .catch((error) => {
        console.error('Error:', error);
        showAlert('danger', 'An unexpected error occurred.');
      });
  }

  // Add Account Modal
  const addAccountButton = document.getElementById('add-account-button');
  const addAccountModalElement = document.getElementById('addAccountModal');
  const addAccountModal = addAccountModalElement ? new bootstrap.Modal(addAccountModalElement) : null;
  const addAccountForm = document.getElementById('add-account-form');

  if (addAccountButton && addAccountModal && addAccountForm) {
    addAccountButton.addEventListener('click', () => {
      addAccountForm.reset();
      resetDynamicSections();
      addAccountModal.show();
    });

    addAccountForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(addAccountForm);
      const data = Object.fromEntries(formData.entries());

      if (data.systematicWithdrawFrequency === '') {
        delete data.systematicWithdrawFrequency;
      }
      if (data.systematicWithdrawAmount === '') {
        delete data.systematicWithdrawAmount;
      }

      data.beneficiaries = {
        primary: [],
        contingent: [],
      };

      document.querySelectorAll('.primary-beneficiary').forEach((container) => {
        const beneficiary = {
          firstName: container.querySelector('input[name="primaryFirstName"]').value,
          lastName: container.querySelector('input[name="primaryLastName"]').value,
          relationship: container.querySelector('input[name="primaryRelationship"]').value,
          dateOfBirth: container.querySelector('input[name="primaryDateOfBirth"]').value,
          ssn: container.querySelector('input[name="primarySSN"]').value,
          percentageAllocation: parseFloat(
            container.querySelector('input[name="primaryPercentage"]').value
          ),
        };
        data.beneficiaries.primary.push(beneficiary);
      });

      document.querySelectorAll('.contingent-beneficiary').forEach((container) => {
        const beneficiary = {
          firstName: container.querySelector('input[name="contingentFirstName"]').value,
          lastName: container.querySelector('input[name="contingentLastName"]').value,
          relationship: container.querySelector('input[name="contingentRelationship"]').value,
          dateOfBirth: container.querySelector('input[name="contingentDateOfBirth"]').value,
          ssn: container.querySelector('input[name="contingentSSN"]').value,
          percentageAllocation: parseFloat(
            container.querySelector('input[name="contingentPercentage"]').value
          ),
        };
        data.beneficiaries.contingent.push(beneficiary);
      });

      data.iraAccountDetails = [];
      document.querySelectorAll('.ira-conversion').forEach((container) => {
        const conversion = {
          year: parseInt(container.querySelector('input[name="conversionYear"]').value),
          conversionAmount: parseFloat(
            container.querySelector('input[name="conversionAmount"]').value
          ),
        };
        data.iraAccountDetails.push(conversion);
      });

      data.accountValue = parseFloat(data.accountValue);
      data.systematicWithdrawAmount = parseFloat(data.systematicWithdrawAmount) || null;
      data.federalTaxWithholding = parseFloat(data.federalTaxWithholding) || null;
      data.stateTaxWithholding = parseFloat(data.stateTaxWithholding) || null;
      data.valueAsOf12_31 = parseFloat(data.valueAsOf12_31) || null;
      data.taxForms = data.taxForms ? data.taxForms.split(',') : [];

      fetch(`/api/households/${householdData._id}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
        .then((res) => res.json().then((body) => ({ status: res.status, body })))
        .then(({ status, body }) => {
          if (status === 201) {
            addAccountModal.hide();
            showAlert('success', 'Account added successfully.');
            currentPage = 1;
            fetchAccounts();
          } else {
            const errorMessage = body.message || 'An error occurred while adding the account.';
            showAlert('danger', errorMessage);
          }
        })
        .catch((error) => {
          console.error('Error:', error);
          showAlert('danger', 'An unexpected error occurred.');
        });
    });
  }

  const accountTypeSelect = document.getElementById('accountType');
  if (accountTypeSelect) {
    accountTypeSelect.addEventListener('change', handleAccountTypeChange);
    function handleAccountTypeChange() {
      const selectedType = accountTypeSelect.value;
      const inheritedDetailsSection = document.getElementById('inherited-details-section');
      const iraDetailsSection = document.getElementById('ira-details-section');
      inheritedDetailsSection.style.display = selectedType === 'Inherited IRA' ? 'block' : 'none';
      iraDetailsSection.style.display =
        selectedType === 'IRA' || selectedType === 'Roth IRA' ? 'block' : 'none';
    }
    handleAccountTypeChange();
  }

  const addPrimaryBeneficiaryButton = document.getElementById('add-primary-beneficiary');
  const primaryBeneficiariesSection = document.querySelector('.primary-beneficiaries-section');
  if (addPrimaryBeneficiaryButton && primaryBeneficiariesSection) {
    addPrimaryBeneficiaryButton.addEventListener('click', () => {
      addBeneficiaryFields('primary');
    });
  }

  const addContingentBeneficiaryButton = document.getElementById('add-contingent-beneficiary');
  const contingentBeneficiariesSection = document.querySelector('.contingent-beneficiaries-section');
  if (addContingentBeneficiaryButton && contingentBeneficiariesSection) {
    addContingentBeneficiaryButton.addEventListener('click', () => {
      addBeneficiaryFields('contingent');
    });
  }

  function addBeneficiaryFields(type) {
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
    removeButton.textContent = 'Remove Beneficiary';
    removeButton.addEventListener('click', () => {
      container.remove();
    });
    container.appendChild(removeButton);

    if (type === 'primary' && primaryBeneficiariesSection) {
      primaryBeneficiariesSection.appendChild(container);
    } else if (type === 'contingent' && contingentBeneficiariesSection) {
      contingentBeneficiariesSection.appendChild(container);
    }
  }

  const addIraConversionButton = document.getElementById('add-ira-conversion');
  const iraConversionsSection = document.querySelector('.ira-conversions-section');
  if (addIraConversionButton && iraConversionsSection) {
    addIraConversionButton.addEventListener('click', () => {
      addIraConversionFields();
    });
  }

  function addIraConversionFields() {
    const container = document.createElement('div');
    container.classList.add('ira-conversion', 'mb-3');

    const fields = [
      { label: 'Year', name: 'conversionYear', type: 'number', required: true },
      {
        label: 'Conversion Amount',
        name: 'conversionAmount',
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
    removeButton.textContent = 'Remove Conversion';
    removeButton.addEventListener('click', () => {
      container.remove();
    });
    container.appendChild(removeButton);

    iraConversionsSection.appendChild(container);
  }

  function resetDynamicSections() {
    const primaryBeneficiariesSection = document.querySelector('.primary-beneficiaries-section');
    const contingentBeneficiariesSection = document.querySelector('.contingent-beneficiaries-section');
    if (primaryBeneficiariesSection) primaryBeneficiariesSection.innerHTML = '';
    if (contingentBeneficiariesSection) contingentBeneficiariesSection.innerHTML = '';

    const inheritedDetailsSection = document.getElementById('inherited-details-section');
    const iraDetailsSection = document.getElementById('ira-details-section');
    if (inheritedDetailsSection) inheritedDetailsSection.style.display = 'none';
    if (iraDetailsSection) iraDetailsSection.style.display = 'none';

    const iraConversionsSection = document.querySelector('.ira-conversions-section');
    if (iraConversionsSection) iraConversionsSection.innerHTML = '';
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

    // Instead of using confirm(), show the deleteConfirmationModal
    deleteSelectedButton.addEventListener('click', () => {
      if (selectedAccounts.size === 0) return;
      // Show the modal instead of confirm()
      if (deleteConfirmationModal) {
        deleteConfirmationModal.show();
      }
    });

    // Handle the confirm deletion action when user clicks the "Delete" button in the modal
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
      // Currently just toggling arrow direction
      if (field) {
        if (icon.textContent.trim() === 'arrow_upward') {
          icon.textContent = 'arrow_downward';
        } else {
          icon.textContent = 'arrow_upward';
        }
      }
      // TODO: Implement actual sorting logic if backend supports it
    });
  });

});
