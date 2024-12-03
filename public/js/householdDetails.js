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

    /**
     * Closes and removes an alert from the DOM.
     * @param {HTMLElement} alert - The alert element to close.
     */
    function closeAlert(alert) {
      alert.classList.add('exit');
      setTimeout(() => {
        if (alert && alert.parentNode) {
          alert.parentNode.removeChild(alert);
        }
      }, 500);
    }

    // If undo option is provided, add undo button
    if (options.undo) {
      const undoButton = document.createElement('button');
      undoButton.className = 'alert-undo-button';
      undoButton.innerText = 'Undo';
      undoButton.addEventListener('click', () => {
        options.undoCallback();
        // Close the alert after undo is clicked
        closeAlert(alert);
      });
      textContainer.appendChild(undoButton);
    }

    // Append elements to the alert
    alert.appendChild(iconContainer);
    alert.appendChild(closeContainer);
    alert.appendChild(textContainer);

    // Prepend alert to the container
    alertContainer.prepend(alert);

    // Trigger fade-in transition
    void alert.offsetWidth;
    alert.classList.add('show');

    // Auto-close alert after 5 seconds
    setTimeout(() => closeAlert(alert), 5000);
    closeIcon.addEventListener('click', () => closeAlert(alert));
  }

  function populateModalFields() {
    // Populate head of household fields
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

    // Clear existing additional members
    const membersSection = document.querySelector('.household-members-section');
    membersSection.innerHTML = '';

    // Add existing additional members
    const additionalMembers = clientsData.filter(
      (client) => client._id !== householdData.headOfHousehold._id
    );
    additionalMembers.forEach((member, index) => {
      addMemberFields(member, index);
    });

    // Re-add event listener for the "Add Household Member" button
    const addMemberButton = document.getElementById('add-household-member');
    addMemberButton.addEventListener('click', () => {
      addMemberFields();
      updateMemberIndices();
    });

    // Initial update of member indices
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
    const memberIndex = index !== undefined ? index : Date.now(); // Unique identifier
    const memberContainer = document.createElement('div');
    memberContainer.classList.add('household-member', 'mb-4');
    memberContainer.dataset.memberIndex = memberIndex;

    // Create header
    const header = document.createElement('h6');
    header.classList.add('formModalHeadersTwo');
    header.textContent = 'Additional Household Member';

    // Create remove button
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.classList.add('btn', 'btn-danger', 'remove-member-btn');
    removeButton.textContent = 'Remove Member';

    // Add event listener for remove button
    removeButton.addEventListener('click', () => {
      memberContainer.remove();
      updateMemberIndices();
    });

    // Append header and remove button to memberContainer
    memberContainer.appendChild(header);

    // If memberData._id exists, create a hidden input
    if (memberData._id) {
      const hiddenIdInput = document.createElement('input');
      hiddenIdInput.type = 'hidden';
      hiddenIdInput.name = `additionalMembers[${memberIndex}][_id]`;
      hiddenIdInput.value = memberData._id;
      memberContainer.appendChild(hiddenIdInput);
    }

    // Create fields dynamically
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

    // Tax Filing Status Field
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

    // Marital Status Field
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

    // Append the remove button to memberContainer
    memberContainer.appendChild(removeButton);

    // Append the memberContainer to the membersSection
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

    // Collect head of household data directly from input elements
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

    // Process additional members
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

      // Get the member's ID if it exists (for existing members)
      const idInput = container.querySelector('input[name$="[_id]"]');
      if (idInput) {
        member._id = idInput.value;
      }

      // Only add the member if they have at least a first and last name
      if (member.firstName && member.lastName) {
        data.additionalMembers.push(member);
      }
    });

    // Send AJAX request to update the household
    fetch(`${window.location.origin}/api/households/${householdData._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
      .then((response) => response.json())
      .then((result) => {
        if (result.success) {
          // Close modal
          addHouseholdModal.hide();
          // Show success alert
          showAlert('success', 'Household updated successfully.');

          // Optionally refresh the page or update the DOM with new data
          setTimeout(() => {
            location.reload();
          }, 3000); // Delay of 3 seconds (adjust as needed)
        } else {
          // Handle errors
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
      // Reset dynamic sections
      resetDynamicSections();
      addAccountModal.show();
    });

    // Handle form submission
    addAccountForm.addEventListener('submit', (event) => {
      event.preventDefault(); // Prevents the default form submission

      const formData = new FormData(addAccountForm);
      const data = Object.fromEntries(formData.entries());

      // Handle empty strings for optional enum fields
      if (data.systematicWithdrawFrequency === '') {
        delete data.systematicWithdrawFrequency;
      }
      if (data.systematicWithdrawAmount === '') {
        delete data.systematicWithdrawAmount;
      }

      // Handle beneficiaries
      data.beneficiaries = {
        primary: [],
        contingent: [],
      };

      // Collect primary beneficiaries
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

      // Collect contingent beneficiaries
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

      // Handle IRA Account Details (Roth Conversions)
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

      // Convert numeric fields
      data.accountValue = parseFloat(data.accountValue);
      data.systematicWithdrawAmount = parseFloat(data.systematicWithdrawAmount) || null;
      data.federalTaxWithholding = parseFloat(data.federalTaxWithholding) || null;
      data.stateTaxWithholding = parseFloat(data.stateTaxWithholding) || null;
      data.valueAsOf12_31 = parseFloat(data.valueAsOf12_31) || null;

      // Handle Tax Forms (if any)
      data.taxForms = data.taxForms ? data.taxForms.split(',') : [];

      fetch(`/api/households/${householdData._id}/accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })
        .then((res) => {
          // Capture the status and response body
          return res.json().then((body) => ({
            status: res.status,
            body,
          }));
        })
        .then(({ status, body }) => {
          if (status === 201) {
            addAccountModal.hide();
            showAlert('success', 'Account added successfully.');

            // Refresh the accounts table
            currentPage = 1; // Reset to first page if needed
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

  // Dynamic field display based on Account Type
  const accountTypeSelect = document.getElementById('accountType');
  if (accountTypeSelect) {
    accountTypeSelect.addEventListener('change', handleAccountTypeChange);

    function handleAccountTypeChange() {
      const selectedType = accountTypeSelect.value;

      const inheritedDetailsSection = document.getElementById('inherited-details-section');
      const iraDetailsSection = document.getElementById('ira-details-section');

      // Show Inherited Account Details if account type is 'Inherited IRA'
      inheritedDetailsSection.style.display = selectedType === 'Inherited IRA' ? 'block' : 'none';

      // Show IRA Account Details if account type is 'IRA' or 'Roth IRA'
      iraDetailsSection.style.display =
        selectedType === 'IRA' || selectedType === 'Roth IRA' ? 'block' : 'none';

      // Handle other conditional fields based on account type
    }

    // Initialize the account type change handler
    handleAccountTypeChange();
  }

  // Add Beneficiary Functions
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

    // Fields for Beneficiary
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

    // Remove Beneficiary Button
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

  // Add IRA Conversion Function
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

    // Fields for IRA Conversion
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

    // Remove Conversion Button
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

  // Function to reset dynamic sections when the modal is opened
  function resetDynamicSections() {
    // Clear beneficiaries
    if (primaryBeneficiariesSection) primaryBeneficiariesSection.innerHTML = '';
    if (contingentBeneficiariesSection) contingentBeneficiariesSection.innerHTML = '';
    // Hide conditional sections
    const inheritedDetailsSection = document.getElementById('inherited-details-section');
    const iraDetailsSection = document.getElementById('ira-details-section');
    if (inheritedDetailsSection) inheritedDetailsSection.style.display = 'none';
    if (iraDetailsSection) iraDetailsSection.style.display = 'none';
    // Clear IRA conversions
    if (iraConversionsSection) iraConversionsSection.innerHTML = '';
  }

  // Account Table, Pagination, and Expandable Rows
  const accountsTableBody = document.querySelector('#accounts-table tbody');
  const accountsTable = document.getElementById('accounts-table');
  const noAccountsMessage = document.getElementById('no-accounts-message');
  const prevPageButton = document.getElementById('prev-page');
  const nextPageButton = document.getElementById('next-page');
  const paginationInfo = document.getElementById('pagination-info');

  // Ensure that these elements exist
  if (
    accountsTableBody &&
    accountsTable &&
    prevPageButton &&
    nextPageButton &&
    paginationInfo &&
    noAccountsMessage
  ) {
    let currentPage = 1;
    const pageSize = 10; // Display 10 records per page
    let totalPages = 1;

    // Fetch accounts when the page loads
    fetchAccounts();

    function fetchAccounts() {
      fetch(`/api/households/${householdData._id}/accounts?page=${currentPage}&limit=${pageSize}`)
        .then((response) => response.json())
        .then((data) => {
          renderAccountsTable(data.accounts);
          totalPages = Math.ceil(data.totalAccounts / pageSize);
          updatePaginationInfo(data.totalAccounts);
        })
        .catch((error) => {
          console.error('Error fetching accounts:', error);
          showAlert('danger', 'Error fetching accounts.');
        });
    }

    function renderAccountsTable(accounts) {
      accountsTableBody.innerHTML = ''; // Clear existing rows
    
      if (accounts.length === 0) {
        // Hide the table and show the "No accounts available" message
        accountsTable.style.display = 'none';
        noAccountsMessage.style.display = 'block';
        paginationInfo.textContent = 'No accounts to display.';
        prevPageButton.disabled = true;
        nextPageButton.disabled = true;
        return;
      } else {
        accountsTable.style.display = 'table';
        noAccountsMessage.style.display = 'none';
      }
    
      accounts.forEach((account) => {
        const tr = document.createElement('tr');
        tr.dataset.accountId = account._id;
    
        // Account Owner
        const ownerTd = document.createElement('td');
        ownerTd.classList.add('account-owner-cell');
        ownerTd.textContent = `${account.accountOwner.firstName} ${account.accountOwner.lastName}`;
        tr.appendChild(ownerTd);
    
        // Account Number
        const numberTd = document.createElement('td');
        numberTd.classList.add('account-number-cell');
        numberTd.textContent = account.accountNumber;
        tr.appendChild(numberTd);
    
        // Total Account Balance
        const balanceTd = document.createElement('td');
        balanceTd.classList.add('account-value-cell');
        balanceTd.textContent = account.accountValue.toLocaleString('en-US', {
          style: 'currency',
          currency: 'USD',
        });
        tr.appendChild(balanceTd);
    
        // Expand Icon
        const expandTd = document.createElement('td');
        expandTd.classList.add('text-end');
    
        const expandButton = document.createElement('button');
        expandButton.classList.add('btn', 'btn-link', 'expand-row');
        expandButton.innerHTML = '<i class="fas fa-chevron-down"></i>';
        expandButton.addEventListener('click', () => toggleDetails(tr, account));
        expandTd.appendChild(expandButton);
        tr.appendChild(expandTd);
    
        accountsTableBody.appendChild(tr);
    
        // Hidden Row for Details
        const detailsTr = document.createElement('tr');
        detailsTr.classList.add('account-details');
        detailsTr.style.display = 'none';
    
        const detailsTd = document.createElement('td');
        detailsTd.colSpan = 4;
        detailsTd.innerHTML = getAccountDetailsHtml(account);
    
        detailsTr.appendChild(detailsTd);
        accountsTableBody.appendChild(detailsTr);
      });
    }

    function toggleDetails(row, account) {
      const nextRow = row.nextElementSibling;
      if (nextRow && nextRow.classList.contains('account-details')) {
        if (nextRow.style.display === 'none') {
          nextRow.style.display = 'table-row';
          row.querySelector('.expand-row i').classList.remove('fa-chevron-down');
          row.querySelector('.expand-row i').classList.add('fa-chevron-up');
        } else {
          nextRow.style.display = 'none';
          row.querySelector('.expand-row i').classList.remove('fa-chevron-up');
          row.querySelector('.expand-row i').classList.add('fa-chevron-down');
        }
      }
    }

    function getAccountDetailsHtml(account) {
      // Build HTML string for account details
      let html = '<div class="account-details-container">';

      html += `<p><strong>Account Owner:</strong> ${account.accountOwner.firstName} ${account.accountOwner.lastName}</p>`;
      html += `<p><strong>Account Value:</strong> ${account.accountValue.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
      })}</p>`;
      html += `<p><strong>Account Type:</strong> ${account.accountType}</p>`;
      html += `<p><strong>Systematic Withdraw Amount:</strong> ${
        account.systematicWithdrawAmount || '---'
      }</p>`;
      html += `<p><strong>Systematic Withdraw Frequency:</strong> ${
        account.systematicWithdrawFrequency || '---'
      }</p>`;
      html += `<p><strong>Federal Tax Withholding:</strong> ${
        account.federalTaxWithholding || '---'
      }</p>`;
      html += `<p><strong>State Tax Withholding:</strong> ${
        account.stateTaxWithholding || '---'
      }</p>`;
      html += `<p><strong>Tax Status:</strong> ${account.taxStatus}</p>`;
      html += `<p><strong>12/31 Value:</strong> ${account.valueAsOf12_31 || '---'}</p>`;
      html += `<p><strong>Custodian:</strong> ${account.custodian}</p>`;

      // Beneficiaries
      if (account.beneficiaries && account.beneficiaries.primary.length > 0) {
        html += '<h6>Primary Beneficiaries</h6><ul>';
        account.beneficiaries.primary.forEach((pb) => {
          html += `<li>${pb.beneficiary.firstName} ${pb.beneficiary.lastName} - ${pb.percentageAllocation}%</li>`;
        });
        html += '</ul>';
      }

      if (account.beneficiaries && account.beneficiaries.contingent.length > 0) {
        html += '<h6>Contingent Beneficiaries</h6><ul>';
        account.beneficiaries.contingent.forEach((cb) => {
          html += `<li>${cb.beneficiary.firstName} ${cb.beneficiary.lastName} - ${cb.percentageAllocation}%</li>`;
        });
        html += '</ul>';
      }

      // Tax Forms
      if (account.taxForms && account.taxForms.length > 0) {
        html += `<p><strong>Tax Forms:</strong> ${account.taxForms.join(', ')}</p>`;
      }

      // Inherited Account Details
      if (account.inheritedAccountDetails && account.inheritedAccountDetails.deceasedName) {
        html += '<h6>Inherited Account Details</h6>';
        html += `<p><strong>Deceased Name:</strong> ${account.inheritedAccountDetails.deceasedName}</p>`;
        html += `<p><strong>Date of Death:</strong> ${formatDateForDisplay(
          account.inheritedAccountDetails.dateOfDeath
        )}</p>`;
        html += `<p><strong>Relationship to Deceased:</strong> ${account.inheritedAccountDetails.relationshipToDeceased}</p>`;
      }

      // IRA Account Details
      if (account.iraAccountDetails && account.iraAccountDetails.length > 0) {
        html += '<h6>IRA Account Details</h6>';
        html += '<table class="table table-bordered">';
        html += '<thead><tr><th>Year</th><th>Conversion Amount</th></tr></thead>';
        html += '<tbody>';
        account.iraAccountDetails.forEach((iraDetail) => {
          html += `<tr><td>${iraDetail.year}</td><td>${iraDetail.conversionAmount}</td></tr>`;
        });
        html += '</tbody></table>';
      }

      html += '</div>';
      return html;
    }

    function updatePaginationInfo(totalAccounts) {
      if (totalAccounts === 0) {
        paginationInfo.textContent = 'No accounts to display.';
      } else {
        paginationInfo.textContent = `Page ${currentPage} of ${totalPages}, Total Accounts: ${totalAccounts}`;
      }
      prevPageButton.disabled = currentPage === 1 || totalAccounts === 0;
      nextPageButton.disabled = currentPage === totalPages || totalAccounts === 0;
    }

    // Pagination Event Listeners
    prevPageButton.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        fetchAccounts();
      }
    });

    nextPageButton.addEventListener('click', () => {
      if (currentPage < totalPages) {
        currentPage++;
        fetchAccounts();
      }
    });
  } else {
    console.error('Required elements for accounts table are missing in the DOM.');
  }



// Copy functionality for client fields
document.querySelectorAll('.copy-icon').forEach((icon) => {
  // Create tooltip element
  const tooltip = document.createElement('span');
  tooltip.classList.add('tooltip-text');
  tooltip.innerText = 'Copy';
  icon.appendChild(tooltip);

  icon.addEventListener('click', () => {
    const fieldValue = icon.getAttribute('data-field');
    // Copy to clipboard
    navigator.clipboard.writeText(fieldValue).then(
      () => {
        // Change tooltip text to "Copied!"
        tooltip.innerText = 'Copied!';
        // Revert back to "Copy" after a short delay
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


// Function to initialize copy functionality
function initializeCopyFunctionality() {
  document.querySelectorAll('.copy-icon').forEach((icon) => {
    // Avoid adding multiple event listeners
    if (!icon.dataset.listenerAdded) {
      // Create tooltip element
      const tooltip = document.createElement('span');
      tooltip.classList.add('tooltip-text');
      tooltip.innerText = 'Copy';
      icon.appendChild(tooltip);

      icon.addEventListener('click', () => {
        const fieldValue = icon.getAttribute('data-field');
        // Copy to clipboard
        navigator.clipboard.writeText(fieldValue).then(
          () => {
            // Change tooltip text to "Copied!"
            tooltip.innerText = 'Copied!';
            // Revert back to "Copy" after a short delay
            setTimeout(() => {
              tooltip.innerText = 'Copy';
            }, 2000);
          },
          (err) => {
            console.error('Failed to copy: ', err);
          }
        );
      });

      // Mark that the listener has been added
      icon.dataset.listenerAdded = 'true';
    }
  });
}

// Initialize copy functionality on page load
initializeCopyFunctionality();

// Re-initialize copy functionality when a tab is shown
const householdMemberTabs = document.getElementById('householdMemberTabs');
if (householdMemberTabs) {
  householdMemberTabs.addEventListener('shown.bs.tab', () => {
    initializeCopyFunctionality();
  });
}







});
