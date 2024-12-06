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
      checkbox.checked = selectedAccounts.has(account._id);
      checkboxTd.appendChild(checkbox);
  
      // Account Owner Cell
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
      const lastUpdated = account.updatedAt ? new Date(account.updatedAt).toLocaleDateString() : '---';
      updatedTd.textContent = lastUpdated;
  
      // Account Value Cell
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
      );
      dropdownToggle.setAttribute('aria-expanded', 'false');
      dropdownToggle.innerHTML = `<i class="fas fa-ellipsis-v"></i>`; // 3-dot icon
  
      const dropdownMenu = document.createElement('ul');
      dropdownMenu.classList.add('dropdown-menu');
      dropdownMenu.innerHTML = `
        <li><a class="dropdown-item view-details" href="#">View Details</a></li>
        <li><a class="dropdown-item edit-account" href="#">Edit</a></li>
        <li><a class="dropdown-item text-danger delete-account" href="#">Delete</a></li>
      `;
  
      // Function to close all other dropdowns
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
  
      // Add event listeners for dropdown menu items
      dropdownMenu.querySelector('.view-details').addEventListener('click', () => {
        dropdownMenu.style.display = 'none'; 
        dropdownMenu.classList.remove('show-more-menu');
        dropdownToggle.setAttribute('aria-expanded', 'false');
        fetch(`/api/accounts/${account._id}`)
          .then(response => response.json())
          .then(data => {
            const viewAccountModal = new bootstrap.Modal(document.getElementById('viewAccountModal'));
            const modalContent = document.getElementById('view-account-content');
            modalContent.innerHTML = `
              <p><strong>Account Owner:</strong> ${data.accountOwner.firstName} ${data.accountOwner.lastName}</p>
              <p><strong>Account Number:</strong> ${data.accountNumber}</p>
              <p><strong>Account Value:</strong> $${data.accountValue.toFixed(2)}</p>
              <p><strong>Account Type:</strong> ${data.accountType}</p>
              <p><strong>Custodian:</strong> ${data.custodian}</p>
              <p><strong>Systematic Withdraw Amount:</strong> $${data.systematicWithdrawAmount}</p>
              <p><strong>Systematic Withdraw Frequency:</strong> ${data.systematicWithdrawFrequency}</p>
              <p><strong>Federal Tax Withholding:</strong> ${data.federalTaxWithholding}%</p>
              <p><strong>State Tax Withholding:</strong> ${data.stateTaxWithholding}%</p>
              <p><strong>Tax Status:</strong> ${data.taxStatus}</p>
              <p><strong>Value as of 12/31:</strong> $${data.valueAsOf12_31}</p>
              <p><strong>Beneficiaries:</strong></p>
              <ul>
                <li><strong>Primary:</strong> ${
                  data.beneficiaries.primary.length > 0
                    ? data.beneficiaries.primary
                        .map(b => {
                          const beneficiary = b.beneficiary || {};
                          return `${beneficiary.firstName || '---'} ${beneficiary.lastName || '---'}`;
                        })
                        .join(', ')
                    : '---'
                }</li>
                <li><strong>Contingent:</strong> ${
                  data.beneficiaries.contingent.length > 0
                    ? data.beneficiaries.contingent
                        .map(b => {
                          const beneficiary = b.beneficiary || {};
                          return `${beneficiary.firstName || '---'} ${beneficiary.lastName || '---'}`;
                        })
                        .join(', ')
                    : '---'
                }</li>
              </ul>

              <p><strong>Tax Forms:</strong> ${data.taxForms.length > 0 ? data.taxForms.join(', ') : '---'}</p>
              <p><strong>Inherited Account Details:</strong> ${Object.keys(data.inheritedAccountDetails).length > 0 ? JSON.stringify(data.inheritedAccountDetails) : '---'}</p>
              <p><strong>IRA Account Details:</strong> ${data.iraAccountDetails.length > 0 ? data.iraAccountDetails.map(i => `Year: ${i.year}, Amount: $${i.conversionAmount}`).join('<br>') : '---'}</p>
              <p><strong>Created At:</strong> ${new Date(data.createdAt).toLocaleString()}</p>
              <p><strong>Updated At:</strong> ${new Date(data.updatedAt).toLocaleString()}</p>
            `;
            viewAccountModal.show();
          })
          .catch(err => console.error('Error fetching account details:', err));
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


  

  
  function addBeneficiaryFields(type, parentContainer = document) {
    console.log(`addBeneficiaryFields called for ${type}`); // Debugging

    // Dynamically scope to the parent container (modal or document)
    const section =
        type === 'primary'
            ? parentContainer.querySelector('.primary-beneficiaries-section')
            : parentContainer.querySelector('.contingent-beneficiaries-section');

    if (!section) {
        console.error(`No section found for type: ${type} in the provided context`);
        return;
    }

    // Make the section visible
    section.style.display = 'block'; // Ensure parent section is visible

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

    console.log(`Appending new ${type} beneficiary fields to section`);
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

if (addAccountButton && addAccountForm) {
  addAccountButton.addEventListener('click', () => {
    addAccountForm.reset();
    resetDynamicSections(); // Reset any dynamic fields
    addAccountModal.show();
  });

  addAccountForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(addAccountForm);
    const data = Object.fromEntries(formData.entries());
    data.systematicWithdrawFrequency = data.systematicWithdrawFrequency === 'Select Frequency' ? '' : data.systematicWithdrawFrequency;
  
    // Process beneficiaries and IRA details
    data.beneficiaries = collectBeneficiaries();
    data.iraAccountDetails = collectIraConversions();
  
    fetch(`/api/households/${householdData._id}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch. Status: ${response.status}`);
        }
        return response.json();
      })
      .then((result) => {
        console.log('API Response:', result); // Debugging
        if (result.message && result.message.toLowerCase().includes('successfully')) {
          addAccountModal.hide();
          showAlert('success', result.message);
          fetchAccounts(); // Refresh account table
        } else {
          showAlert('danger', result.message || 'Failed to add account.');
        }
      })
      .catch((error) => {
        console.error('Error adding account:', error); // Debugging
        showAlert('danger', 'Unexpected error while adding account.');
      });
  });
  
  
}

function submitUpdatedAccountData(accountId, form, modal) {
  console.log(`Submitting updated data for accountId: ${accountId}`);
  if (!accountId) {
    console.error('Account ID is missing. Unable to submit changes.');
    showAlert('danger', 'Account ID is missing. Please try again.');
    return;
  }

  // Collect form data
  const formData = new FormData(form);
  const updatedData = Object.fromEntries(formData.entries());

  // Sanitize taxForms
  if (updatedData.editTaxForms) {
    updatedData.taxForms = updatedData.editTaxForms
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0); // Remove empty strings
    delete updatedData.editTaxForms; // Remove unnecessary key
  } else {
    updatedData.taxForms = [];
  }

  // Include beneficiaries and IRA details
  updatedData.beneficiaries = collectBeneficiaries();
  updatedData.iraAccountDetails = collectIraConversions();

  console.log('Updated Data to be submitted:', updatedData); // Debugging

  // Send PUT request
  fetch(`/api/accounts/${accountId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updatedData),
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then((result) => {
      console.log('Server response:', result);
      if (result.message && result.message.toLowerCase().includes('success')) {
        modal.hide(); // Close the modal
        fetchAccounts(); // Refresh account table
        showAlert('success', result.message);
      } else {
        showAlert('danger', result.message || 'Failed to update account.');
      }
    })
    .catch((error) => {
      console.error('Error updating account:', error);
      showAlert('danger', 'Unexpected error while updating account.');
    });
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




function handleEditAccount(accountId) {
  console.log('handleEditAccount called with accountId:', accountId); // Debugging

  fetch(`/api/accounts/${accountId}`)
      .then((response) => response.json())
      .then((data) => {
          console.log('Data received from API:', data); // Debugging

          const editAccountModalElement = document.getElementById('editAccountModal');
          const editAccountModal = new bootstrap.Modal(editAccountModalElement);
          const editAccountForm = document.getElementById('edit-account-form');

          if (!editAccountModalElement || !editAccountForm) {
              console.error('Edit Account Modal or Form not found in DOM'); // Debugging
              return;
          }

          // Reset dynamic fields
          resetDynamicSections();

          // Populate the form with account data
          populateFormFields(editAccountForm, data);

          // Set the accountId in the hidden input
          const accountIdField = editAccountForm.querySelector('#editAccountId');
          if (accountIdField) {
              accountIdField.value = accountId;
          }

            // Populate Primary Beneficiaries
            if (data.beneficiaries?.primary?.length > 0) {
              data.beneficiaries.primary.forEach(({ beneficiary, percentageAllocation }) => {
                  if (beneficiary) {
                      addBeneficiaryFields('primary', editAccountModalElement);
                      const lastPrimary = editAccountModalElement.querySelector(
                          '.primary-beneficiaries-section .primary-beneficiary:last-child'
                      );
                      populateBeneficiaryFields(lastPrimary, { ...beneficiary, percentageAllocation }, 'primary');
                  } else {
                      console.warn(`Missing beneficiary details for primary entry:`, { beneficiary, percentageAllocation });
                  }
              });
            } else {
              console.warn('No primary beneficiaries found.');
            }

            // Populate Contingent Beneficiaries
            if (data.beneficiaries?.contingent?.length > 0) {
              data.beneficiaries.contingent.forEach(({ beneficiary, percentageAllocation }) => {
                  if (beneficiary) {
                      addBeneficiaryFields('contingent', editAccountModalElement);
                      const lastContingent = editAccountModalElement.querySelector(
                          '.contingent-beneficiaries-section .contingent-beneficiary:last-child'
                      );
                      populateBeneficiaryFields(lastContingent, { ...beneficiary, percentageAllocation }, 'contingent');
                  } else {
                      console.warn(`Missing beneficiary details for contingent entry:`, { beneficiary, percentageAllocation });
                  }
              });
            } else {
              console.warn('No contingent beneficiaries found.');
            }


          // Attach event listeners for Add Beneficiary buttons
          attachDynamicFieldHandlers('#editAccountModal');

          // Ensure only one event listener is attached
          editAccountForm.removeEventListener('submit', handleFormSubmit);
          editAccountForm.addEventListener('submit', handleFormSubmit);

          editAccountModal.show();
      })
      .catch((error) => {
          console.error('Error fetching account data:', error); // Debugging
      });
}



function handleFormSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const modal = bootstrap.Modal.getInstance(form.closest('.modal')); // Get the modal instance
  const accountId = form.querySelector('#editAccountId').value;

  if (!accountId) {
    console.error('Account ID is missing. Unable to submit changes.');
    showAlert('danger', 'Account ID is missing. Please try again.');
    return;
  }

  submitUpdatedAccountData(accountId, form, modal);
}



function populateBeneficiaryFields(container, beneficiary, type) {
  if (!container) return;
  container.querySelector(`[name="${type}FirstName"]`).value = beneficiary.firstName || '';
  container.querySelector(`[name="${type}LastName"]`).value = beneficiary.lastName || '';
  container.querySelector(`[name="${type}Relationship"]`).value = beneficiary.relationship || '';
  container.querySelector(`[name="${type}DateOfBirth"]`).value = beneficiary.dateOfBirth || '';
  container.querySelector(`[name="${type}SSN"]`).value = beneficiary.ssn || '';
  container.querySelector(`[name="${type}Percentage"]`).value = beneficiary.percentageAllocation || '';
}



function resetDynamicSections() {
  document.querySelector('.primary-beneficiaries-section').innerHTML = '';
  document.querySelector('.contingent-beneficiaries-section').innerHTML = '';
  document.querySelector('.ira-conversions-section').innerHTML = '';
}

function populateFormFields(form, data) {
  resetDynamicSections(); // Clear existing fields

  // Populate static fields
  form.querySelector('#editAccountId').value = data._id || '';
  form.querySelector('#editAccountOwner').value = data.accountOwner?._id || '';
  form.querySelector('#editAccountNumber').value = data.accountNumber || '';
  form.querySelector('#editAccountValue').value = data.accountValue || '';
  form.querySelector('#editAccountType').value = data.accountType || '';
  form.querySelector('#editSystematicWithdrawAmount').value = data.systematicWithdrawAmount || '';
  form.querySelector('#editSystematicWithdrawFrequency').value = data.systematicWithdrawFrequency || '';
  form.querySelector('#editFederalTaxWithholding').value = data.federalTaxWithholding || '';
  form.querySelector('#editStateTaxWithholding').value = data.stateTaxWithholding || '';
  form.querySelector('#editTaxStatus').value = data.taxStatus || '';
  form.querySelector('#editValueAsOf12_31').value = data.valueAsOf12_31 || '';
  form.querySelector('#editCustodian').value = data.custodian || '';

  // Populate dynamic fields: Primary Beneficiaries
  if (data.beneficiaries?.primary?.length > 0) {
    data.beneficiaries.primary.forEach((beneficiary) => {
      addBeneficiaryFields('primary');
      const lastPrimary = document.querySelector(
        '.primary-beneficiaries-section .primary-beneficiary:last-child'
      );
      populateBeneficiaryFields(lastPrimary, beneficiary, 'primary');
    });
  }

  // Populate dynamic fields: Contingent Beneficiaries
  if (data.beneficiaries?.contingent?.length > 0) {
    data.beneficiaries.contingent.forEach((beneficiary) => {
      addBeneficiaryFields('contingent');
      const lastContingent = document.querySelector(
        '.contingent-beneficiaries-section .contingent-beneficiary:last-child'
      );
      populateBeneficiaryFields(lastContingent, beneficiary, 'contingent');
    });
  }
}



function collectBeneficiaries() {
  const primary = [];
  const contingent = [];

  document.querySelectorAll('.primary-beneficiary').forEach((container) => {
    const firstName = container.querySelector('[name="primaryFirstName"]').value.trim();
    const lastName = container.querySelector('[name="primaryLastName"]').value.trim();

    // Only include valid beneficiaries
    if (firstName && lastName) {
      primary.push({
        _id: container.querySelector('[name="primaryId"]')?.value || null,
        firstName,
        lastName,
        relationship: container.querySelector('[name="primaryRelationship"]').value.trim() || null,
        dateOfBirth: container.querySelector('[name="primaryDateOfBirth"]').value || null,
        ssn: container.querySelector('[name="primarySSN"]').value.trim() || null,
        percentageAllocation: parseFloat(container.querySelector('[name="primaryPercentage"]').value) || 0,
      });
    }
  });

  document.querySelectorAll('.contingent-beneficiary').forEach((container) => {
    const firstName = container.querySelector('[name="contingentFirstName"]').value.trim();
    const lastName = container.querySelector('[name="contingentLastName"]').value.trim();

    // Only include valid beneficiaries
    if (firstName && lastName) {
      contingent.push({
        _id: container.querySelector('[name="contingentId"]')?.value || null,
        firstName,
        lastName,
        relationship: container.querySelector('[name="contingentRelationship"]').value.trim() || null,
        dateOfBirth: container.querySelector('[name="contingentDateOfBirth"]').value || null,
        ssn: container.querySelector('[name="contingentSSN"]').value.trim() || null,
        percentageAllocation: parseFloat(container.querySelector('[name="contingentPercentage"]').value) || 0,
      });
    }
  });

  return { primary, contingent };
}





function collectIraConversions() {
  const iraDetails = [];
  document.querySelectorAll('.ira-conversion').forEach((container) => {
    iraDetails.push({
      year: parseInt(container.querySelector('[name="conversionYear"]').value, 10),
      conversionAmount: parseFloat(container.querySelector('[name="conversionAmount"]').value),
    });
  });
  return iraDetails;
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

  

  const addIraConversionButton = document.getElementById('add-ira-conversion');
  const iraConversionsSection = document.querySelector('.ira-conversions-section');
  if (addIraConversionButton && iraConversionsSection) {
    addIraConversionButton.addEventListener('click', () => {
      addIraConversionFields();
    });
  }

  function addIraConversionFields(sectionSelector, conversion = {}) {
    const section = document.querySelector(sectionSelector);
  
    if (!section) return;
  
    const container = document.createElement('div');
    container.classList.add('ira-conversion', 'mb-3');
  
    const fields = [
      { label: 'Year', name: 'conversionYear', type: 'number', value: conversion.year || '', required: true },
      {
        label: 'Conversion Amount',
        name: 'conversionAmount',
        type: 'number',
        value: conversion.conversionAmount || '',
        step: '0.01',
        required: true,
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
      input.value = field.value;
      if (field.step) input.step = field.step;
      if (field.required) input.required = true;
  
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
  
    section.appendChild(container);
  }

  function resetDynamicSections() {
    const primarySection = document.querySelector('.primary-beneficiaries-section');
    const contingentSection = document.querySelector('.contingent-beneficiaries-section');
    const iraSection = document.querySelector('.ira-conversions-section');
  
    // Clear existing fields
    if (primarySection) primarySection.innerHTML = '';
    if (contingentSection) contingentSection.innerHTML = '';
    if (iraSection) iraSection.innerHTML = '';
  
    // Remove required attributes from dynamic fields (if hidden)
    document.querySelectorAll('[name="primaryFirstName"], [name="primaryLastName"], [name="primaryPercentage"]').forEach(field => field.removeAttribute('required'));
    document.querySelectorAll('[name="contingentFirstName"], [name="contingentLastName"], [name="contingentPercentage"]').forEach(field => field.removeAttribute('required'));
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
