/***************************************
 * newUniversalImport.js
 *
 * Unified import flow for BOTH Contact and Account.
 * Shows file-upload progress for each.
 * Steps:
 *   0 -> Step1 (Pick Contact or Account)
 *   1 -> Step2 (Contact Upload)
 *   2 -> Step3 (Contact Mapping)
 *   3 -> Step4 (Account Options)
 *   4 -> Step5 (Account Upload)
 *   5 -> Step6 (Account Mapping)
 **************************************/

const socket = io();
const pm = new ProgressManager(socket); // For real-time updates

function showAlert(type, message, options = {}) {
  // Same existing showAlert code, unchanged
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
  textContainer.className = 'success-text';
  const title = document.createElement('h3');
  title.innerText = type === 'success' ? 'Success!' : 'Error!';
  const textP = document.createElement('p');
  textP.innerText = message;

  textContainer.appendChild(title);
  textContainer.appendChild(textP);

  function closeAlert(alertElement) {
    alertElement.classList.add('exit');
    setTimeout(() => {
      if (alertElement && alertElement.parentNode) {
        alertElement.parentNode.removeChild(alertElement);
      }
    }, 500);
  }

  if (options.undo) {
    const undoButton = document.createElement('button');
    undoButton.className = 'alert-undo-button';
    undoButton.innerText = 'Undo';
    undoButton.addEventListener('click', () => {
      if (typeof options.undoCallback === 'function') {
        options.undoCallback();
      }
      closeAlert(alert);
    });
    textContainer.appendChild(undoButton);
  }

  alert.appendChild(iconContainer);
  alert.appendChild(closeContainer);
  alert.appendChild(textContainer);

  alertContainer.prepend(alert);

  // Animate in
  void alert.offsetWidth;
  alert.classList.add('show');

  // Auto-close after 5s
  setTimeout(() => closeAlert(alert), 5000);
  closeIcon.addEventListener('click', () => closeAlert(alert));
}

document.addEventListener('DOMContentLoaded', () => {
  const importModal = document.getElementById('universal-import-modal');
  if (!importModal) return;

  const container = document.getElementById('import-flow-container');
  const steps = container.querySelectorAll('.import-step');

  // Footer buttons
  const prevBtn = importModal.querySelector('#prevStepBtn');
  const nextBtn = importModal.querySelector('#nextStepBtn');
  const cancelBtn = importModal.querySelector('#cancelImportBtn');

  // Step Indices:
  //   0 => Step1 (Pick Contact or Account)
  //   1 => Step2 (Contact Upload)
  //   2 => Step3 (Contact Mapping)
  //   3 => Step4 (Account Options)
  //   4 => Step5 (Account Upload)
  //   5 => Step6 (Account Mapping)

  let currentStepIndex = 0;
  let selectedImportType = null;

  // ~~~~~~~~~~~~~~~~~~~~
  // CONTACT references
  // ~~~~~~~~~~~~~~~~~~~~
  const contactDropzone = document.getElementById('contact-file-dropzone');
  const contactFileInput = document.getElementById('contact-file-input');
  const contactUploadBox = document.querySelector('.contact-upload-box');
  const contactUploadProgressContainer = document.getElementById('contact-upload-progress');
  const contactUploadProgressBar = document.getElementById('contact-progress-bar');
  const contactUploadCompletedContainer = document.getElementById('contact-upload-completed');
  const contactRemoveFileButton = document.getElementById('removeFileButton');
  const contactMappingFieldsContainer = document.getElementById('mapping-fields-container');
  const useSplitCheckbox = document.getElementById('useSplitCheckbox');
  const singleNameField = document.getElementById('single-name-field');
  const splitNameFields = document.getElementById('split-name-fields');
  const toggleAdditionalFieldsBtn = document.getElementById('toggle-additional-fields');
  const additionalFieldsCollapse = document.getElementById('additional-fields-collapse');

// ~~~ Account collapsible references ~~~
const toggleAccountAdditionalFieldsBtn = document.getElementById('toggle-account-additional-fields');
const accountAdditionalFieldsCollapse = document.getElementById('account-additional-fields-collapse');

if (toggleAccountAdditionalFieldsBtn && accountAdditionalFieldsCollapse) {
  accountAdditionalFieldsCollapse.addEventListener('shown.bs.collapse', () => {
    // Smoothly scroll the button (or the entire .modal-body) into view
    toggleAccountAdditionalFieldsBtn.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  accountAdditionalFieldsCollapse.addEventListener('hidden.bs.collapse', () => {
    const modalBody = importModal.querySelector('.modal-body');
    if (modalBody) {
      modalBody.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
}

  let contactTempFilePath = '';
  let contactHeaders = [];
  let nameMode = 'single'; // single vs split name approach

  // ~~~~~~~~~~~~~~~~~~~~
  // ACCOUNT references
  // ~~~~~~~~~~~~~~~~~~~~
  // For step5 (Account Upload)
  const accountDropzone = document.getElementById('account-file-dropzone');
  const accountFileInput = document.getElementById('account-file-input');
  const accountUploadBox = document.querySelector('.account-upload-box');
  const accountUploadProgressContainer = document.getElementById('account-upload-progress');
  const accountUploadProgressBar = document.getElementById('account-progress-bar');
  const accountUploadCompletedContainer = document.getElementById('account-upload-completed');
  const accountRemoveFileButton = document.getElementById('removeAccountFileButton');

  let accountTempFilePath = '';
  let accountHeaders = [];

  // ~~~~~~~~~~~~~~~~~~~~
  // Initialize steps
  // ~~~~~~~~~~~~~~~~~~~~
  steps.forEach((step, idx) => {
    step.classList.toggle('hidden', idx !== 0);
  });
  nextBtn.disabled = true;
  resetUploadStates();
  updateFooterButtons();

  // ~~~~~~~~~~~~~~~~~~~~
  // Step1: user picks "contact" or "account"
  // ~~~~~~~~~~~~~~~~~~~~
  const dataOptions = container.querySelectorAll('.data-option');
  dataOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      dataOptions.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedImportType = opt.dataset.type;
      updateFooterButtons();
    });
  });

  // Cancel -> close and reset
  cancelBtn.addEventListener('click', () => {
    resetModalState();
    const modalInstance = bootstrap.Modal.getInstance(importModal);
    if (modalInstance) modalInstance.hide();
  });
  importModal.addEventListener('hidden.bs.modal', () => {
    resetModalState();
  });

  // Prev / Next
  prevBtn.addEventListener('click', handlePrev);
  nextBtn.addEventListener('click', handleNext);

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // DRAG-N-DROP + FILE PICKER for CONTACT
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  if (contactDropzone) {
    initContactDragAndDrop();
  }
  if (contactFileInput) {
    contactFileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) {
        handleContactFileUpload(e.target.files[0]);
      }
    });
  }
  if (contactRemoveFileButton) {
    contactRemoveFileButton.addEventListener('click', () => {
      resetContactUploadUI();
      contactFileInput.value = '';
      contactTempFilePath = '';
      updateFooterButtons();
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // DRAG-N-DROP + FILE PICKER for ACCOUNT
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  if (accountDropzone) {
    initAccountDragAndDrop();
  }
  if (accountFileInput) {
    accountFileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) {
        handleAccountFileUpload(e.target.files[0]);
      }
    });
  }
  if (accountRemoveFileButton) {
    accountRemoveFileButton.addEventListener('click', () => {
      resetAccountUploadUI();
      if (accountFileInput) accountFileInput.value = '';
      accountTempFilePath = '';
      updateFooterButtons();
    });
  }

  // Additional fields collapse for Contact
  if (toggleAdditionalFieldsBtn && additionalFieldsCollapse) {
    additionalFieldsCollapse.addEventListener('shown.bs.collapse', () => {
      toggleAdditionalFieldsBtn.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    additionalFieldsCollapse.addEventListener('hidden.bs.collapse', () => {
      const modalBody = importModal.querySelector('.modal-body');
      if (modalBody) {
        modalBody.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  // Split name checkbox
  if (useSplitCheckbox) {
    useSplitCheckbox.addEventListener('change', () => {
      if (useSplitCheckbox.checked) {
        nameMode = 'split';
        singleNameField.classList.add('hidden');
        splitNameFields.classList.remove('hidden');
      } else {
        nameMode = 'single';
        singleNameField.classList.remove('hidden');
        splitNameFields.classList.add('hidden');
      }
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~
  // handleNext
  // ~~~~~~~~~~~~~~~~~~~~
  function handleNext() {
    /*
      0 => Step1 (Pick contact/account)
      1 => Step2 (Contact upload)
      2 => Step3 (Contact mapping)
      3 => Step4 (Account options)
      4 => Step5 (Account upload)
      5 => Step6 (Account mapping)
    */
    if (currentStepIndex === 0) {
      // Step1 -> contact(1) or account(3)
      if (!selectedImportType) {
        showAlert('danger', 'Please select a data type');
        return;
      }
      if (selectedImportType === 'contact') {
        slideToStep(0, 1);
      } else {
        slideToStep(0, 3);
      }
    }
    else if (currentStepIndex === 1) {
      // Contact upload -> contact mapping
      if (!contactTempFilePath) {
        showAlert('danger','Please upload a contact file first.');
        return;
      }
      slideToStep(1, 2);
      populateContactMappingSelects();
    }
    else if (currentStepIndex === 2) {
      // Perform contact import
      performContactImport();
    }
    else if (currentStepIndex === 3) {
      // Account options -> account upload
      // Check which option
      const chosen = document.querySelector('.data-option.account-option.selected');
      if (!chosen) {
        showAlert('danger','Please pick an account import type.');
        return;
      }
      const acctType = chosen.dataset.accountType;
      if (acctType === 'general') {
        slideToStep(3, 4);
      } else {
        showAlert('danger', 'This feature is coming soon.');
      }
    }
    else if (currentStepIndex === 4) {
      // Account upload -> account mapping
      if (!accountTempFilePath) {
        showAlert('danger','Please upload an account file first.');
        return;
      }
      slideToStep(4, 5);
      populateAccountMappingSelects();
    }
    else if (currentStepIndex === 5) {
      // Perform account import
      performAccountImport();
    }
  }

  // ~~~~~~~~~~~~~~~~~~~~
  // handlePrev
  // ~~~~~~~~~~~~~~~~~~~~
  function handlePrev() {
    if (currentStepIndex === 1) {
      // Contact upload -> step1
      slideToStep(1, 0);
    }
    else if (currentStepIndex === 2) {
      // Contact mapping -> step2
      slideToStep(2, 1);
    }
    else if (currentStepIndex === 3) {
      // Account options -> step1
      slideToStep(3, 0);
    }
    else if (currentStepIndex === 4) {
      // Account upload -> step3 (account options)
      slideToStep(4, 3);
    }
    else if (currentStepIndex === 5) {
      // Account mapping -> step4 (upload)
      slideToStep(5, 4);
    }
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~
  // CONTACT Drag & Drop init
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~
  function initContactDragAndDrop() {
    const preventDefaults = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => {
      contactDropzone.addEventListener(evt, preventDefaults, false);
    });
    ['dragenter','dragover'].forEach(evt => {
      contactDropzone.addEventListener(evt, () => {
        contactDropzone.classList.add('drag-over');
      }, false);
    });
    ['dragleave','drop'].forEach(evt => {
      contactDropzone.addEventListener(evt, () => {
        contactDropzone.classList.remove('drag-over');
      }, false);
    });
    contactDropzone.addEventListener('drop', e => {
      if (e.dataTransfer.files.length > 0) {
        handleContactFileUpload(e.dataTransfer.files[0]);
      }
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~
  // ACCOUNT Drag & Drop init
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~
  function initAccountDragAndDrop() {
    const preventDefaults = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => {
      accountDropzone.addEventListener(evt, preventDefaults, false);
    });
    ['dragenter','dragover'].forEach(evt => {
      accountDropzone.addEventListener(evt, () => {
        accountDropzone.classList.add('drag-over');
      }, false);
    });
    ['dragleave','drop'].forEach(evt => {
      accountDropzone.addEventListener(evt, () => {
        accountDropzone.classList.remove('drag-over');
      }, false);
    });
    accountDropzone.addEventListener('drop', e => {
      if (e.dataTransfer.files.length > 0) {
        handleAccountFileUpload(e.dataTransfer.files[0]);
      }
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~
  // handleContactFileUpload
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~
  function handleContactFileUpload(file) {
    if (!file) return;
    // Hide initial box, show progress
    contactUploadBox.classList.add('hidden');
    contactUploadProgressContainer.classList.remove('hidden');
    contactUploadCompletedContainer.classList.add('hidden');
    nextBtn.disabled = true;

    const formData = new FormData();
    formData.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/new-import/contact/file');
    xhr.upload.onprogress = function(e) {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        contactUploadProgressBar.style.width = percent + '%';
        contactUploadProgressBar.textContent = percent + '%';
      }
    };
    xhr.onload = function() {
      if (xhr.status === 200) {
        const resp = JSON.parse(xhr.responseText);
        contactHeaders = resp.headers || [];
        contactTempFilePath = resp.tempFile || '';
        contactUploadProgressContainer.classList.add('hidden');
        contactUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else {
        showAlert('danger','Error uploading contact file');
      }
    };
    xhr.onerror = function() {
      showAlert('danger','Upload request failed');
    };
    xhr.send(formData);
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~
  // handleAccountFileUpload
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~
  function handleAccountFileUpload(file) {
    if (!file) return;
    // Hide initial box, show progress
    accountUploadBox.classList.add('hidden');
    accountUploadProgressContainer.classList.remove('hidden');
    accountUploadCompletedContainer.classList.add('hidden');
    nextBtn.disabled = true;

    const formData = new FormData();
    formData.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/new-import/account/file');
    xhr.upload.onprogress = function(e) {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        accountUploadProgressBar.style.width = percent + '%';
        accountUploadProgressBar.textContent = percent + '%';
      }
    };
    xhr.onload = function() {
      if (xhr.status === 200) {
        const resp = JSON.parse(xhr.responseText);
        accountHeaders = resp.headers || [];
        accountTempFilePath = resp.tempFile || '';
        accountUploadProgressContainer.classList.add('hidden');
        accountUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else {
        showAlert('danger','Error uploading account file');
      }
    };
    xhr.onerror = function() {
      showAlert('danger','Upload request failed');
    };
    xhr.send(formData);
  }

  // ~~~~~~~~~~~~~~~~~~~~
  // populateContactMappingSelects
  // ~~~~~~~~~~~~~~~~~~~~
  function populateContactMappingSelects() {
    if (!contactHeaders.length) return;
    const selects = contactMappingFieldsContainer.querySelectorAll('select');
    selects.forEach(sel => {
      sel.innerHTML = '<option value="">-- Select Column --</option>';
      contactHeaders.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        sel.appendChild(opt);
      });
    });
    synchronizeContactColumns();
    selects.forEach(sel => {
      sel.addEventListener('change', () => {
        synchronizeContactColumns();
        updateFooterButtons();
      });
    });
  }

// ~~~~~~~~~~~~~~~~~~~~
// populateAccountMappingSelects
// ~~~~~~~~~~~~~~~~~~~~
function populateAccountMappingSelects() {
    if (!accountHeaders.length) return;
    const accountMappingContainer = document.getElementById('account-mapping-fields-container');
    if (!accountMappingContainer) return;
  
    const selects = accountMappingContainer.querySelectorAll('select');
    selects.forEach(sel => {
      sel.innerHTML = '<option value="">-- Select Column --</option>';
      accountHeaders.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        sel.appendChild(opt);
      });
    });
    synchronizeAccountColumns();
    selects.forEach(sel => {
      sel.addEventListener('change', () => {
        synchronizeAccountColumns();
        updateFooterButtons();
      });
    });
  }
  

  // ~~~~~~~~~~~~~~~~~~~~
  // synchronizeContactColumns
  // ~~~~~~~~~~~~~~~~~~~~
  function synchronizeContactColumns() {
    const selects = contactMappingFieldsContainer.querySelectorAll('select');
    const selectedValues = Array.from(selects).map(s => s.value).filter(v => v);
    selects.forEach(sel => {
      const curr = sel.value;
      Array.from(sel.options).forEach(opt => {
        if (!opt.value) {
          opt.disabled = false;
        } else if (opt.value === curr) {
          opt.disabled = false;
        } else {
          opt.disabled = selectedValues.includes(opt.value);
        }
      });
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~
  // synchronizeAccountColumns
  // ~~~~~~~~~~~~~~~~~~~~
  function synchronizeAccountColumns() {
    const accountMappingContainer = document.getElementById('account-mapping-fields-container');
    if (!accountMappingContainer) return;
    const selects = accountMappingContainer.querySelectorAll('select');
    const selectedValues = Array.from(selects).map(s => s.value).filter(v => v);
    selects.forEach(sel => {
      const curr = sel.value;
      Array.from(sel.options).forEach(opt => {
        if (!opt.value) {
          opt.disabled = false;
        } else if (opt.value === curr) {
          opt.disabled = false;
        } else {
          opt.disabled = selectedValues.includes(opt.value);
        }
      });
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~
  // performContactImport
  // ~~~~~~~~~~~~~~~~~~~~
  function performContactImport() {
    // Validate required fields
    const requiredSelects = contactMappingFieldsContainer.querySelectorAll('select[data-required="true"]');
    for (let sel of requiredSelects) {
      if (!sel.closest('.hidden') && !sel.value) {
        showAlert('danger','Please fill all required fields before importing.');
        return;
      }
    }

    const mapping = {};
    contactMappingFieldsContainer.querySelectorAll('select').forEach(sel => {
      if (sel.value) mapping[sel.name] = contactHeaders.indexOf(sel.value);
    });

    const bodyData = {
      mapping,
      tempFile: contactTempFilePath,
      nameMode
    };

    const importModalInstance = bootstrap.Modal.getInstance(importModal);
    if (importModalInstance) importModalInstance.hide();

    // Show progress container
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      progressContainer.classList.remove('hidden');
    }

    const progressHeader = progressContainer.querySelector('.progress-header h5.progress-title');
    if (progressHeader) {
      progressHeader.textContent = 'Contact Import';
    }


    fetch('/api/new-import/contact/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    })
    .then(r => r.json())
    .then(resp => {
      // Real-time progress from socket
    })
    .catch(err => {
      console.error(err);
      showAlert('danger','Error initiating the contact import.');
    });
  }

// ~~~~~~~~~~~~~~~~~~~~
// performAccountImport (revised for multi-column allocations)
// ~~~~~~~~~~~~~~~~~~~~
function performAccountImport() {
    // Validate required fields
    const accountMappingContainer = document.getElementById('account-mapping-fields-container');
    if (!accountMappingContainer) return;
  
    const requiredSelects = accountMappingContainer.querySelectorAll('select[data-required="true"]');
    for (let sel of requiredSelects) {
      if (!sel.value) {
        showAlert('danger','Please fill all required fields before importing.');
        return;
      }
    }
  
    // Initialize an object to hold final mappings for the backend
    const mapping = {};
  
    // 1) Gather standard single-column fields
    //    (like clientId, accountNumber, etc.),
    //    but SKIP the asset-allocation fields:
    const allocationFields = ['cash','income','annuities','growth'];
  
    // Query all SELECTs in the container
    const allSelects = accountMappingContainer.querySelectorAll('select');
  
    allSelects.forEach(sel => {
      // If this select belongs to an allocation field, skip here;
      // We'll handle those in step 2 below.
      if (allocationFields.includes(sel.name)) {
        return;
      }
      if (sel.value) {
        mapping[sel.name] = accountHeaders.indexOf(sel.value);
      }
    });
  
    // 2) Gather multi-column allocations for 'cash', 'income', etc.
    allocationFields.forEach(field => {
      const container = document.getElementById(`${field}-allocation-container`);
      // Start with an empty array for each field
      mapping[field] = [];
  
      if (container) {
        // Grab ALL <select> elements for this field
        const selects = container.querySelectorAll('select.form-select');
        selects.forEach(sel => {
          // Each select might have a chosen column
          if (sel.value) {
            const colIndex = accountHeaders.indexOf(sel.value);
            if (colIndex >= 0) {
              mapping[field].push(colIndex);
            }
          }
        });
      }
    });
  
    // Build request body
    const bodyData = {
      mapping,
      tempFile: accountTempFilePath
    };
  
    // Hide the modal
    const importModalInstance = bootstrap.Modal.getInstance(importModal);
    if (importModalInstance) importModalInstance.hide();
  
    // Show progress container
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      progressContainer.classList.remove('hidden');
    }
  
    // Update progress title
    const progressHeader = progressContainer.querySelector('.progress-header h5.progress-title');
    if (progressHeader) {
      progressHeader.textContent = 'Account Import';
    }
  
    // POST to your backend
    fetch('/api/new-import/account/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    })
    .then(r => r.json())
    .then(resp => {
      // Real-time progress from socket, etc.
    })
    .catch(err => {
      console.error(err);
      showAlert('danger','Error initiating the account import.');
    });
  }
  
  

  // ~~~~~~~~~~~~~~~~~~~~
  // slideToStep
  // ~~~~~~~~~~~~~~~~~~~~
  function slideToStep(oldIndex, newIndex) {
    const oldStep = steps[oldIndex];
    const newStep = steps[newIndex];
    const forward = newIndex > oldIndex;

    oldStep.classList.add(forward ? 'slide-out-left' : 'slide-out-right');
    newStep.classList.remove('hidden');
    newStep.classList.add(forward ? 'slide-in-right' : 'slide-in-left');

    setTimeout(() => {
      oldStep.classList.add('hidden');
      oldStep.classList.remove('slide-out-left','slide-out-right');
      newStep.classList.remove('slide-in-right','slide-in-left');
      currentStepIndex = newIndex;
      updateFooterButtons();
    }, 300);
  }

  // ~~~~~~~~~~~~~~~~~~~~
  // resetModalState
  // ~~~~~~~~~~~~~~~~~~~~
  function resetModalState() {
    currentStepIndex = 0;
    selectedImportType = null;

    // Reset contact state
    contactTempFilePath = '';
    contactHeaders = [];
    nameMode = 'single';

    // Reset account state
    accountTempFilePath = '';
    accountHeaders = [];

    steps.forEach((step, idx) => {
      step.classList.toggle('hidden', idx !== 0);
      step.classList.remove('slide-out-left','slide-out-right','slide-in-left','slide-in-right');
    });

    const dataOptionEls = container.querySelectorAll('.data-option');
    dataOptionEls.forEach(o => o.classList.remove('selected'));

    resetUploadStates();

    if (contactFileInput) contactFileInput.value = '';
    if (accountFileInput) accountFileInput.value = '';

    if (additionalFieldsCollapse) {
      const collapseEl = bootstrap.Collapse.getInstance(additionalFieldsCollapse);
      if (collapseEl && additionalFieldsCollapse.classList.contains('show')) {
        collapseEl.hide();
      }
    }

    updateFooterButtons();
  }

  // ~~~~~~~~~~~~~~~~~~~~
  // resetUploadStates
  // ~~~~~~~~~~~~~~~~~~~~
  function resetUploadStates() {
    // Contact
    resetContactUploadUI();
    // Account
    resetAccountUploadUI();
  }

  // ~~~~~~~~~~~~~~~~~~~~
  // resetContactUploadUI
  // ~~~~~~~~~~~~~~~~~~~~
  function resetContactUploadUI() {
    if (contactUploadBox) contactUploadBox.classList.remove('hidden');
    if (contactUploadProgressContainer) contactUploadProgressContainer.classList.add('hidden');
    if (contactUploadCompletedContainer) contactUploadCompletedContainer.classList.add('hidden');
    if (contactUploadProgressBar) {
      contactUploadProgressBar.style.width = '0%';
      contactUploadProgressBar.textContent = '0%';
    }
  }

  // ~~~~~~~~~~~~~~~~~~~~
  // resetAccountUploadUI
  // ~~~~~~~~~~~~~~~~~~~~
  function resetAccountUploadUI() {
    if (accountUploadBox) accountUploadBox.classList.remove('hidden');
    if (accountUploadProgressContainer) accountUploadProgressContainer.classList.add('hidden');
    if (accountUploadCompletedContainer) accountUploadCompletedContainer.classList.add('hidden');
    if (accountUploadProgressBar) {
      accountUploadProgressBar.style.width = '0%';
      accountUploadProgressBar.textContent = '0%';
    }
  }

  // ~~~~~~~~~~~~~~~~~~~~
  // updateFooterButtons
  // ~~~~~~~~~~~~~~~~~~~~
  function updateFooterButtons() {
    /*
      Step Indices:
        0 => Step1: Pick
        1 => Step2: Contact Upload
        2 => Step3: Contact Mapping
        3 => Step4: Account Options
        4 => Step5: Account Upload
        5 => Step6: Account Mapping
    */
    if (currentStepIndex === 0) {
      prevBtn.classList.add('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !selectedImportType;
    }
    else if (currentStepIndex === 1) {
      // Contact upload
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !contactTempFilePath;
    }
    else if (currentStepIndex === 2) {
      // Contact mapping
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Import';
      const requiredSelects = contactMappingFieldsContainer.querySelectorAll('select[data-required="true"]');
      let allContactRequired = true;
      requiredSelects.forEach(sel => {
        if (sel.closest('.hidden')) return;
        if (!sel.value) allContactRequired = false;
      });
      nextBtn.disabled = !allContactRequired;
    }
    else if (currentStepIndex === 3) {
      // Account Options
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      const chosenAccountOption = document.querySelector('.data-option.account-option.selected');
      nextBtn.disabled = !chosenAccountOption;
    }
    else if (currentStepIndex === 4) {
      // Account upload
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !accountTempFilePath;
    }
    else if (currentStepIndex === 5) {
      // Account mapping
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Import';
      // Optionally check required fields
      // e.g. let allAccountReq = ...
      nextBtn.disabled = false;
    }
  }
});
