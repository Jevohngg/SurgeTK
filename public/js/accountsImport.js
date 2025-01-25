// public/js/accountsImport.js

import ProgressManager from './progressManager.js'; // Reuse your existing progress manager

document.addEventListener('DOMContentLoaded', () => {
  // DOM references for the accounts import
  const updateAccountsButton = document.getElementById('update-accounts'); 
  const importAccountsModalElement = document.getElementById('importAccountsModal');
  const importAccountsModal = importAccountsModalElement ? new bootstrap.Modal(importAccountsModalElement) : null;

  const fileUploadAccountsInput = document.getElementById('fileUploadAccounts');
  const uploadAccountsForm = document.getElementById('upload-accounts-form');
  const accountsUploadProgress = document.getElementById('accounts-upload-progress');
  const removeFileButtonAccounts = document.getElementById('removeFileButtonAccounts');
  const submitUploadButtonAccounts = document.getElementById('submitUploadButtonAccounts');

  let uploadState = 'idle';  // 'idle' | 'uploading' | 'completed'
  let headers = [];   // We'll store the server-returned headers here
  let uploadedData = [];
  let s3Key = '';
  let uploadStartTime = null;

  /**
   * Optional helper to dynamically change the ProgressContainer header text 
   * from "Household Import" to "Account Import"
   */
  function setProgressHeaderToAccount() {
    const header = document.querySelector('#progress-container .progress-header h5');
    if (header) {
      header.textContent = 'Account Import';
    }
  }

  // -------------------------------------------------------------------------
  //  If you have an #alert-container in your layout, we can show dynamic alerts.
  // -------------------------------------------------------------------------
  function showAlert(type, message, options = {}) {
    const alertContainer = document.getElementById('alert-container');
    if (!alertContainer) {
      console.warn('No #alert-container element found in DOM.');
      return; // or fallback to console
    }

    const alert = document.createElement('div');
    alert.id = type === 'success' ? 'passwordChangeSuccess' : 'errorAlert';
    alert.className = `alert ${
      type === 'success' ? 'alert-success' : 'alert-error'
    }`;
    alert.setAttribute('role', 'alert');

    // Icon container
    const iconContainer = document.createElement('div');
    iconContainer.className =
      type === 'success' ? 'success-icon-container' : 'error-icon-container';
    const icon = document.createElement('i');
    icon.className = type === 'success' ? 'far fa-check-circle' : 'far fa-times-circle';
    iconContainer.appendChild(icon);

    // Close button container
    const closeContainer = document.createElement('div');
    closeContainer.className =
      type === 'success' ? 'success-close-container' : 'error-close-container';
    const closeIcon = document.createElement('span');
    closeIcon.className = 'material-symbols-outlined successCloseIcon';
    closeIcon.innerText = 'close';
    closeContainer.appendChild(closeIcon);

    // Text container
    const textContainer = document.createElement('div');
    textContainer.className = 'success-text';
    const title = document.createElement('h3');
    title.innerText = type === 'success' ? 'Success!' : 'Error!';
    const text = document.createElement('p');
    text.innerText = message;

    textContainer.appendChild(title);
    textContainer.appendChild(text);

    // Optional: Undo logic
    function closeAlert(alertEl) {
      alertEl.classList.add('exit');
      setTimeout(() => {
        if (alertEl && alertEl.parentNode) {
          alertEl.parentNode.removeChild(alertEl);
        }
      }, 500);
    }

    if (options.undo) {
      const undoButton = document.createElement('button');
      undoButton.className = 'alert-undo-button';
      undoButton.innerText = 'Undo';
      undoButton.addEventListener('click', () => {
        options.undoCallback?.();
        closeAlert(alert);
      });
      textContainer.appendChild(undoButton);
    }

    // Build the alert
    alert.appendChild(iconContainer);
    alert.appendChild(closeContainer);
    alert.appendChild(textContainer);

    // Put it at top
    alertContainer.prepend(alert);

    // Animate in
    void alert.offsetWidth;
    alert.classList.add('show');

    // Auto-close after 5s
    setTimeout(() => closeAlert(alert), 5000);
    closeIcon.addEventListener('click', () => closeAlert(alert));
  }

  // Socket.io + progress manager
  const socket = io();
  const progressManager = new ProgressManager(socket);

  // Show the modal when user clicks “Import Account Data”
  if (updateAccountsButton && importAccountsModal) {
    updateAccountsButton.addEventListener('click', () => {
      // Dynamically switch the progress container's header to "Account Import"
      setProgressHeaderToAccount();

      if (uploadAccountsForm) uploadAccountsForm.reset();
      resetUploadState();
      submitUploadButtonAccounts.disabled = true; 
      importAccountsModal.show();
    });
  }

  function resetUploadState() {
    setUploadState('idle');
  }

  function setUploadState(state, fileObj = null) {
    uploadState = state;

    const uploadBox = document.querySelector('.upload-box.account-import-box');
    const progressSection = document.querySelector('#accounts-upload-progress');
    const completedSection = document.querySelector('#importAccountsModal .upload-completed');

    if (state === 'idle') {
      uploadBox?.classList.remove('hidden');
      progressSection?.classList.add('hidden');
      completedSection?.classList.add('hidden');
      submitUploadButtonAccounts.disabled = true; 
    } else if (state === 'uploading') {
      uploadBox?.classList.add('hidden');
      progressSection?.classList.remove('hidden');
      completedSection?.classList.add('hidden');
      submitUploadButtonAccounts.disabled = true; 

      if (fileObj) {
        const fileIconAccounts = document.getElementById('fileIconAccounts');
        if (fileIconAccounts) {
          if (fileObj.type === 'text/csv' || fileObj.name.endsWith('.csv')) {
            fileIconAccounts.src = '/images/csv-icon.png';
            fileIconAccounts.alt = 'CSV Icon';
          } else if (
            fileObj.type.includes('excel') ||
            fileObj.name.endsWith('.xlsx')
          ) {
            fileIconAccounts.src = '/images/excel-file-icon.png';
            fileIconAccounts.alt = 'Excel Icon';
          }
        }
      }
      updateProgressBar(0);
    } else if (state === 'completed') {
      progressSection?.classList.add('hidden');
      completedSection?.classList.remove('hidden');

      if (fileObj) {
        const completedFileIconAccounts = document.getElementById('completedFileIconAccounts');
        if (completedFileIconAccounts) {
          if (fileObj.type === 'text/csv' || fileObj.name.endsWith('.csv')) {
            completedFileIconAccounts.src = '/images/csv-icon.png';
            completedFileIconAccounts.alt = 'CSV Icon';
          } else if (
            fileObj.type.includes('excel') ||
            fileObj.name.endsWith('.xlsx')
          ) {
            completedFileIconAccounts.src = '/images/excel-file-icon.png';
            completedFileIconAccounts.alt = 'Excel Icon';
          }
        }
        const completedFileNameAccounts = document.getElementById('completedFileNameAccounts');
        if (completedFileNameAccounts) {
          completedFileNameAccounts.innerHTML = `File "<span class="file-name" title="${fileObj.name}">${fileObj.name}</span>" uploaded successfully.`;
        }
      }
      submitUploadButtonAccounts.disabled = false; 
    }
  }

  function updateProgressBar(percent) {
    const progressBar = document.querySelector('#accounts-upload-progress .progress-bar');
    if (progressBar) {
      progressBar.style.width = `${percent}%`;
      progressBar.setAttribute('aria-valuenow', percent);
      progressBar.textContent = `${percent}%`;
    }
  }

  if (removeFileButtonAccounts) {
    removeFileButtonAccounts.addEventListener('click', () => {
      uploadAccountsForm?.reset();
      resetUploadState();
    });
  }

  if (fileUploadAccountsInput) {
    submitUploadButtonAccounts.disabled = true;
    fileUploadAccountsInput.addEventListener('change', () => {
      const file = fileUploadAccountsInput.files[0];
      if (file && isSpreadsheetFile(file)) {
        initiateUpload(file);
      } else {
        showAlert('danger', 'Only spreadsheet files (CSV, XLSX) are allowed.');
        uploadAccountsForm.reset();
        submitUploadButtonAccounts.disabled = true;
      }
    });

    const uploadBox = document.querySelector('.upload-box.account-import-box');
    if (uploadBox) {
      uploadBox.addEventListener('dragover', (event) => {
        event.preventDefault();
        uploadBox.classList.add('drag-over');
      });
      uploadBox.addEventListener('dragleave', () => {
        uploadBox.classList.remove('drag-over');
      });
      uploadBox.addEventListener('drop', (event) => {
        event.preventDefault();
        uploadBox.classList.remove('drag-over');
        const file = event.dataTransfer.files[0];
        if (file && isSpreadsheetFile(file)) {
          const dt = new DataTransfer();
          dt.items.add(file);
          fileUploadAccountsInput.files = dt.files;
          initiateUpload(file);
        } else {
          showAlert('danger', 'Only CSV or Excel files are allowed.');
          uploadAccountsForm.reset();
          submitUploadButtonAccounts.disabled = true;
        }
      });
    }
  }

  function isSpreadsheetFile(file) {
    const allowedTypes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    return (
      allowedTypes.includes(file.type) ||
      file.name.endsWith('.csv') ||
      file.name.endsWith('.xlsx')
    );
  }

  function initiateUpload(file) {
    setUploadState('uploading', file);
    uploadStartTime = Date.now();

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/accounts/import', true);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        updateProgressBar(percentComplete);
      }
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        const result = JSON.parse(xhr.responseText);
        handleUploadSuccess(result, file);
      } else {
        showAlert('danger', 'Failed to upload accounts file.');
        resetUploadState();
      }
    };
    xhr.onerror = () => {
      showAlert('danger', 'An error occurred during the accounts file upload.');
      resetUploadState();
    };

    const formData = new FormData();
    formData.append('fileUpload', file);
    xhr.send(formData);
  }

  function handleUploadSuccess(result, file) {
    headers = result.headers || [];
    uploadedData = result.uploadedData || [];
    s3Key = result.s3Key || '';

    if (!uploadedData.length) {
      showAlert('danger', 'No rows found in the uploaded file.');
      resetUploadState();
      return;
    }

    const elapsed = Date.now() - uploadStartTime;
    const minTime = 3000;
    const remaining = minTime - elapsed;
    updateProgressBar(100);

    if (remaining > 0) {
      setTimeout(() => setUploadState('completed', file), remaining);
    } else {
      setUploadState('completed', file);
    }
  }

  if (submitUploadButtonAccounts) {
    submitUploadButtonAccounts.addEventListener('click', () => {
      if (uploadState !== 'completed') {
        showAlert('danger', 'Please wait for file upload to complete first.');
        return;
      }
      const mappingModalAccountsElement = document.getElementById('mappingModalAccounts');
      const mappingModalAccounts = new bootstrap.Modal(mappingModalAccountsElement);

      // Populate the dropdowns
      populateMappingDropdownsAccounts(headers);

      mappingModalAccounts.show();
    });
  }



  ////////////////////////////////////////
// 2) Toggle for Single vs. Split name mapping (Accounts)
////////////////////////////////////////
const useAccountFullName = document.getElementById('useAccountFullName');
const useAccountSplitNames = document.getElementById('useAccountSplitNames');
const accountFullNameContainer = document.querySelector('.accountFullNameContainer');
const accountSplitNamesContainer = document.querySelector('.accountSplitNamesContainer');

function updateAccountNameMode() {
  if (useAccountFullName && useAccountFullName.checked) {
    // Single "Full Name"
    accountFullNameContainer.style.display = 'flex';
    accountSplitNamesContainer.style.display = 'none';
  } else {
    // Split F/M/L
    accountFullNameContainer.style.display = 'none';
    accountSplitNamesContainer.style.display = 'flex';
  }
}

if (useAccountFullName) {
  useAccountFullName.addEventListener('change', updateAccountNameMode);
}
if (useAccountSplitNames) {
  useAccountSplitNames.addEventListener('change', updateAccountNameMode);
}

// Init on page load
updateAccountNameMode();







  function populateMappingDropdownsAccounts(headersArray) {
    const form = document.getElementById('mapping-form-accounts');
    if (!form) return;

    const selects = form.querySelectorAll('select');

    // Step 1: Fill each <select> with headers + 'None'
    selects.forEach((sel) => {
      sel.innerHTML = `<option value=''>-- Select Column --</option><option value='None'>None</option>`;
      headersArray.forEach((header) => {
        const option = document.createElement('option');
        option.value = header;
        option.textContent = header;
        sel.appendChild(option);
      });
    });

    // Step 2: On each select "change", disable used columns in other selects
    selects.forEach((sel) => {
      sel.addEventListener('change', () => {
        updateDropdownOptions(selects);
      });
    });

    // Step 3: initial update
    updateDropdownOptions(selects);
  }

  function updateDropdownOptions(selects) {
    const chosenValues = Array.from(selects)
      .map((sel) => sel.value)
      .filter((val) => val && val !== 'None');

    selects.forEach((sel) => {
      const currentValue = sel.value;
      const options = sel.querySelectorAll('option');
      options.forEach((opt) => {
        if (opt.value === 'None' || opt.value === '') {
          opt.disabled = false;
          return;
        }
        if (chosenValues.includes(opt.value) && opt.value !== currentValue) {
          opt.disabled = true;
        } else {
          opt.disabled = false;
        }
      });
    });
  }

  // On mapping form submit
  const mappingFormAccounts = document.getElementById('mapping-form-accounts');
  if (mappingFormAccounts) {
    mappingFormAccounts.addEventListener('submit', async (e) => {
      e.preventDefault();

      const formData = new FormData(mappingFormAccounts);
      const mapping = {};
      formData.forEach((val, key) => {
        // "None" means ignore that field
        if (val && val !== 'None') {
          mapping[key] = val;
        }
      });

      // If user left Account Number blank or "None", show alert & stop
      if (!mapping['mapping[Account Number]']) {
        showAlert(
          'danger',
          '“Account Number” is required and cannot be empty or "None".'
        );
        return;
      }

      // Hide the modal(s)
      const modalInstance = bootstrap.Modal.getInstance(mappingFormAccounts.closest('.modal'));
      const mappingModalInstance = bootstrap.Modal.getInstance(importAccountsModalElement.closest('.modal'));
      if (modalInstance) modalInstance.hide();
      if (mappingModalInstance) mappingModalInstance.hide();
      
      importAccountsWithMapping(mapping, uploadedData, s3Key);
    });
  }

  async function importAccountsWithMapping(mapping, uploadedData, s3Key) {
    try {
      // pass headers to server as well
      const resp = await fetch('/api/accounts/import/mapped', {
        method: 'POST',
        skipGlobalLoader: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headers,
          mapping,
          uploadedData,
          s3Key
        }),
      });
      if (!resp.ok) {
        const result = await resp.json();
        throw new Error(result.message || 'Failed to import accounts.');
      }
      showAlert('success', 'Account import initiated. Check the progress bar for updates.');
    } catch (err) {
      console.error(err);
      showAlert('danger', err.message);
    }
  }
});
