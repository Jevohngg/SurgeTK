/*************************************************
 * newAccountImport.js
 *
 * Manages the front-end flow for Account import.
 * Very similar to newUniversalImport.js, but dedicated
 * to the Account steps and partials.
 *************************************************/
document.addEventListener('DOMContentLoaded', () => {
    const importModal = document.getElementById('universal-import-modal');
    if (!importModal) return; // Not on a page with the import modal
  
    // Cache step elements
    const stepAccount2 = importModal.querySelector('.import-step-account-2');
    const stepAccount3 = importModal.querySelector('.import-step-account-3');
    const stepAccount4 = importModal.querySelector('.import-step-account-4');
  
    // If these steps don't exist on the page, exit
    if (!stepAccount2 || !stepAccount3 || !stepAccount4) return;
  
    // Buttons
    const prevBtn = importModal.querySelector('#prevStepBtn');
    const nextBtn = importModal.querySelector('#nextStepBtn');
    const cancelBtn = importModal.querySelector('#cancelImportBtn');
  
    // Step 2: .account-option cards
    const accountOptionCards = stepAccount2.querySelectorAll('.account-option');
    let selectedAccountOption = null;
  
    // Step 3: Upload references
    const fileDropzone = stepAccount3.querySelector('#account-file-dropzone');
    const fileInput = stepAccount3.querySelector('#account-file-input');
    const uploadBox = stepAccount3.querySelector('.account-upload-box');
    const uploadProgressContainer = stepAccount3.querySelector('#account-upload-progress');
    const uploadProgressBar = stepAccount3.querySelector('#account-progress-bar');
    const uploadCompletedContainer = stepAccount3.querySelector('#account-upload-completed');
    const removeFileButton = stepAccount3.querySelector('#removeAccountFileButton');
  
    // Step 4: Mapping references
    const mappingFieldsContainer = stepAccount4.querySelector('#account-mapping-fields-container');
    const additionalFieldsCollapse = stepAccount4.querySelector('#account-additional-fields-collapse');
    const toggleAdditionalFieldsBtn = stepAccount4.querySelector('#toggle-account-additional-fields');
  
    // State
    let currentAccountStepIndex = 2; // We'll say: Step1=1, Step2=2, Step3=3, Step4=4
    let tempAccountFilePath = '';
    let accountHeaders = [];
  
    // Listen for user picking an account option
    accountOptionCards.forEach(card => {
      card.addEventListener('click', () => {
        accountOptionCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedAccountOption = card.dataset.accountType;
        updateFooterButtons();
      });
    });
  
    // File upload logic
    function preventDefaults(e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (fileDropzone) {
      ['dragenter','dragover','dragleave','drop'].forEach(evtName => {
        fileDropzone.addEventListener(evtName, preventDefaults, false);
      });
      fileDropzone.addEventListener('dragover', () => fileDropzone.classList.add('drag-over'));
      fileDropzone.addEventListener('dragleave', () => fileDropzone.classList.remove('drag-over'));
      fileDropzone.addEventListener('drop', (e) => {
        fileDropzone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
          handleFileUpload(e.dataTransfer.files[0]);
        }
      });
    }
    if (fileInput) {
      fileInput.addEventListener('change', e => {
        if (e.target.files.length > 0) {
          handleFileUpload(e.target.files[0]);
        }
      });
    }
    removeFileButton?.addEventListener('click', () => {
      resetUploadState();
      if (fileInput) fileInput.value = '';
      tempAccountFilePath = '';
      updateFooterButtons();
    });
  
    // Additional fields collapse
    additionalFieldsCollapse?.addEventListener('shown.bs.collapse', () => {
      toggleAdditionalFieldsBtn.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    additionalFieldsCollapse?.addEventListener('hidden.bs.collapse', () => {
      const modalBody = importModal.querySelector('.modal-body');
      if (modalBody) {
        modalBody.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  
    // Cancel => reset
    cancelBtn.addEventListener('click', () => {
      resetAccountModalState();
    });
  
    // Next / Prev
    prevBtn.addEventListener('click', () => {
      switch(currentAccountStepIndex) {
        case 2: // if user is on step2 (account-options), go back to step1
          slideToAccountStep(2, 0); // We'll revert to universal's step 1
          break;
        case 3: // if user is on step3 (upload)
          slideToAccountStep(3,2);
          break;
        case 4: // if user is on step4 (mapping)
          slideToAccountStep(4,3);
          break;
        default:
          break;
      }
    });
    nextBtn.addEventListener('click', () => {
      switch(currentAccountStepIndex) {
        case 2:
          if (!selectedAccountOption) {
            showAlert('danger','Please select an account import option first.');
            return;
          }
          if (selectedAccountOption === 'general') {
            slideToAccountStep(2,3);
          } else {
            showAlert('danger','This feature is coming soon.');
          }
          break;
        case 3:
          if (!tempAccountFilePath) {
            showAlert('danger','Please upload a file first.');
            return;
          }
          slideToAccountStep(3,4);
          populateMappingSelects();
          break;
        case 4:
          // Perform the import
          performMappingImport();
          break;
        default:
          break;
      }
    });
  
    // -- Helper Functions --
    function handleFileUpload(file) {
      if (!file) return;
      uploadBox.classList.add('hidden');
      uploadProgressContainer.classList.remove('hidden');
      uploadCompletedContainer.classList.add('hidden');
      nextBtn.disabled = true;
  
      const formData = new FormData();
      formData.append('file', file);
  
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/new-import/account/file');
      xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          uploadProgressBar.style.width = percent + '%';
          uploadProgressBar.textContent = percent + '%';
        }
      };
      xhr.onload = function() {
        if (xhr.status === 200) {
          const resp = JSON.parse(xhr.responseText);
          accountHeaders = resp.headers || [];
          tempAccountFilePath = resp.tempFile || '';
          uploadProgressContainer.classList.add('hidden');
          uploadCompletedContainer.classList.remove('hidden');
          updateFooterButtons();
        } else {
          showAlert('danger','Error uploading account file.');
        }
      };
      xhr.onerror = function() {
        showAlert('danger','Upload request failed.');
      };
      xhr.send(formData);
    }
  
    function resetUploadState() {
      uploadBox.classList.remove('hidden');
      uploadProgressContainer.classList.add('hidden');
      uploadCompletedContainer.classList.add('hidden');
      uploadProgressBar.style.width = '0%';
      uploadProgressBar.textContent = '0%';
    }
  
    function resetAccountModalState() {
      selectedAccountOption = null;
      tempAccountFilePath = '';
      accountHeaders = [];
      currentAccountStepIndex = 2; // so we come back to step2 next time
      resetUploadState();
      if (fileInput) fileInput.value = '';
    }
  
    function populateMappingSelects() {
      if (!accountHeaders.length) return;
      const selects = mappingFieldsContainer.querySelectorAll('select');
      selects.forEach(sel => {
        sel.innerHTML = '<option value="">-- Select Column --</option>';
        accountHeaders.forEach(h => {
          const opt = document.createElement('option');
          opt.value = h;
          opt.textContent = h;
          sel.appendChild(opt);
        });
      });
      // De-duplicate logic
      synchronizeSelectedColumns();
      selects.forEach(sel => {
        sel.addEventListener('change', () => {
          synchronizeSelectedColumns();
          updateFooterButtons();
        });
      });
    }
  
    function synchronizeSelectedColumns() {
      const selects = Array.from(mappingFieldsContainer.querySelectorAll('select'));
      const selectedValues = selects.map(s => s.value).filter(v => v !== '');
      selects.forEach(sel => {
        const currentValue = sel.value;
        Array.from(sel.options).forEach(opt => {
          if (opt.value === '') {
            opt.disabled = false;
          } else if (opt.value === currentValue) {
            opt.disabled = false;
          } else {
            opt.disabled = selectedValues.includes(opt.value);
          }
        });
      });
    }
  
    function performMappingImport() {
      // Check required selects
      const requiredSelects = mappingFieldsContainer.querySelectorAll('select[data-required="true"]');
      for (let sel of requiredSelects) {
        if (!sel.value) {
          showAlert('danger','Please fill all required fields before importing.');
          return;
        }
      }
  
      // Build mapping object
      const mapping = {};
      mappingFieldsContainer.querySelectorAll('select').forEach(sel => {
        if (sel.value) mapping[sel.name] = accountHeaders.indexOf(sel.value);
      });
  
      // Hide modal
      const importModalInstance = bootstrap.Modal.getInstance(importModal);
      if (importModalInstance) {
        importModalInstance.hide();
      }
  
      // Show progress container
      const progressContainer = document.getElementById('progress-container');
      if (progressContainer) {
        progressContainer.classList.remove('hidden');
      }
  
      const bodyData = {
        mapping,
        tempFile: tempAccountFilePath
      };
  
      fetch('/api/new-import/account/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      })
        .then(r => r.json())
        .then(resp => {
          // Real-time progress is via Socket.io. No immediate action here.
        })
        .catch(err => {
          console.error(err);
          showAlert('danger','Error initiating account import.');
        });
    }
  
    // Step transitions
    function slideToAccountStep(oldIndex, newIndex) {
      // The universal import steps are 0 & 1 for contacts, so we handle
      // going “back to step1” by referencing `.import-step-1`, etc.
      const container = document.getElementById('import-flow-container');
      if (!container) return;
  
      // Example approach: we hide all .import-step elements, then unhide the target
      const allSteps = container.querySelectorAll('.import-step, .import-step-account-2, .import-step-account-3, .import-step-account-4');
      allSteps.forEach(s => s.classList.add('hidden'));
  
      if (newIndex === 0) {
        // Return to Step 1 universal
        const step1 = container.querySelector('.import-step-1');
        step1.classList.remove('hidden');
        currentAccountStepIndex = 0;
      }
      else if (newIndex === 2) {
        stepAccount2.classList.remove('hidden');
        currentAccountStepIndex = 2;
      }
      else if (newIndex === 3) {
        stepAccount3.classList.remove('hidden');
        currentAccountStepIndex = 3;
      }
      else if (newIndex === 4) {
        stepAccount4.classList.remove('hidden');
        currentAccountStepIndex = 4;
      }
  
      updateFooterButtons();
    }
  
    function updateFooterButtons() {
      // We can adjust prevBtn/nextBtn states depending on current step
      switch(currentAccountStepIndex) {
        case 2:
          prevBtn.classList.remove('hidden');
          nextBtn.textContent = 'Next';
          nextBtn.disabled = !selectedAccountOption; // must pick an option
          break;
        case 3:
          prevBtn.classList.remove('hidden');
          nextBtn.textContent = 'Next';
          nextBtn.disabled = !tempAccountFilePath;
          break;
        case 4:
          prevBtn.classList.remove('hidden');
          nextBtn.textContent = 'Import';
          // Check required fields
          const requiredSelects = mappingFieldsContainer.querySelectorAll('select[data-required="true"]');
          let allRequiredFilled = true;
          requiredSelects.forEach(sel => {
            if (!sel.value) allRequiredFilled = false;
          });
          nextBtn.disabled = !allRequiredFilled;
          break;
        default:
          // Step0 or Step1 are universal steps. We'll handle them in newUniversalImport.js
          break;
      }
    }
  });
  