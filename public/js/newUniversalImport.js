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
 *
 * [BUCKETS ADDED]
 *   6 -> Step7 (Buckets Info)
 *   7 -> Step8 (Buckets Upload)
 *   8 -> Step9 (Buckets Mapping)
 *
 * [GUARDRAILS ADDED]
 *   9 -> Step10 (Guardrails Info)
 *   10 -> Step11 (Guardrails Upload)
 *   11 -> Step12 (Guardrails Mapping)
 *
 * [BENEFICIARIES ADDED]
 *   12 -> Step13 (Beneficiary Upload)
 *   13 -> Step14 (Beneficiary Mapping)
 *
 * [BILLING ADDED]
 *   14 -> Step15 (Billing Upload)
 *   15 -> Step16 (Billing Mapping)
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
  //   6 => Step7 (Buckets Info)
  //   7 => Step8 (Buckets Upload)
  //   8 => Step9 (Buckets Mapping)
  //   9 => Step10 (Guardrails Info)
  //   10 => Step11 (Guardrails Upload)
  //   11 => Step12 (Guardrails Mapping)
  //   12 => Step13 (Beneficiary Upload)
  //   13 => Step14 (Beneficiary Mapping)
  //   14 => Step15 (Billing Upload)
  //   15 => Step16 (Billing Mapping)

  let currentStepIndex = 0;
  let selectedImportType = null;

  // CONTACT references
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

  // General Account references
  const toggleAccountAdditionalFieldsBtn = document.getElementById('toggle-account-additional-fields');
  const accountAdditionalFieldsCollapse = document.getElementById('account-additional-fields-collapse');
  const accountDropzone = document.getElementById('account-file-dropzone');
  const accountFileInput = document.getElementById('account-file-input');
  const accountUploadBox = document.querySelector('.account-upload-box');
  const accountUploadProgressContainer = document.getElementById('account-upload-progress');
  const accountUploadProgressBar = document.getElementById('account-progress-bar');
  const accountUploadCompletedContainer = document.getElementById('account-upload-completed');
  const accountRemoveFileButton = document.getElementById('removeAccountFileButton');

  // [BUCKETS] step8 references
  const bucketsDropzone = document.getElementById('buckets-file-dropzone');
  const bucketsFileInput = document.getElementById('buckets-file-input');
  const bucketsUploadBox = document.querySelector('.buckets-upload-box');
  const bucketsUploadProgressContainer = document.getElementById('buckets-upload-progress');
  const bucketsUploadProgressBar = document.getElementById('buckets-progress-bar');
  const bucketsUploadCompletedContainer = document.getElementById('buckets-upload-completed');
  const removeBucketsFileButton = document.getElementById('removeBucketsFileButton');

  // [GUARDRAILS] step11 references
  const guardrailsDropzone = document.getElementById('guardrails-file-dropzone');
  const guardrailsFileInput = document.getElementById('guardrails-file-input');
  const guardrailsUploadBox = document.querySelector('.guardrails-upload-box');
  const guardrailsUploadProgressContainer = document.getElementById('guardrails-upload-progress');
  const guardrailsUploadProgressBar = document.getElementById('guardrails-progress-bar');
  const guardrailsUploadCompletedContainer = document.getElementById('guardrails-upload-completed');
  const removeGuardrailsFileButton = document.getElementById('removeGuardrailsFileButton');

  // [BENEFICIARIES] step13 references
  const beneficiaryDropzone = document.getElementById('beneficiary-file-dropzone');
  const beneficiaryFileInput = document.getElementById('beneficiary-file-input');
  const beneficiaryUploadBox = document.querySelector('.beneficiary-upload-box');
  const beneficiaryUploadProgressContainer = document.getElementById('beneficiary-upload-progress');
  const beneficiaryUploadProgressBar = document.getElementById('beneficiary-progress-bar');
  const beneficiaryUploadCompletedContainer = document.getElementById('beneficiary-upload-completed');
  const removeBeneficiaryFileButton = document.getElementById('removeBeneficiaryFileButton');

  // [BILLING] step15 references
  let billingTempFilePath = '';
  let billingHeaders = '';
  const billingDropzone = document.getElementById('billing-file-dropzone');
  const billingFileInput = document.getElementById('billing-file-input');
  const billingUploadBox = document.querySelector('.billing-upload-box');
  const billingUploadProgressContainer = document.getElementById('billing-upload-progress');
  const billingUploadProgressBar = document.getElementById('billing-progress-bar');
  const billingUploadCompletedContainer = document.getElementById('billing-upload-completed');
  const removeBillingFileButton = document.getElementById('removeBillingFileButton');

  // Current file paths / headers
  let contactTempFilePath = '';
  let contactHeaders = [];
  let nameMode = 'single'; // single vs split name approach

  let accountTempFilePath = '';
  let accountHeaders = [];

  // [BUCKETS]
  let bucketsTempFilePath = '';
  let bucketsHeaders = [];

  // [GUARDRAILS]
  let guardrailsTempFilePath = '';
  let guardrailsHeaders = [];

  // [BENEFICIARIES]
  let beneficiaryTempFilePath = '';
  let beneficiaryHeaders = [];

  // ~~~~~~~~~~~~~~
  // Initialize Steps
  // ~~~~~~~~~~~~~~
  steps.forEach((step, idx) => {
    step.classList.toggle('hidden', idx !== 0);
  });
  nextBtn.disabled = true;
  resetUploadStates();
  updateFooterButtons();

  // Step1: user picks "contact" or "account"
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

  // CONTACT: drag-n-drop
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

  // ACCOUNT: drag-n-drop
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

  // [BUCKETS] step8
  if (bucketsDropzone) {
    initBucketsDragAndDrop();
  }
  if (bucketsFileInput) {
    bucketsFileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) {
        handleBucketsFileUpload(e.target.files[0]);
      }
    });
  }
  if (removeBucketsFileButton) {
    removeBucketsFileButton.addEventListener('click', () => {
      resetBucketsUploadUI();
      if (bucketsFileInput) bucketsFileInput.value = '';
      bucketsTempFilePath = '';
      updateFooterButtons();
    });
  }

  // [GUARDRAILS] step11
  if (guardrailsDropzone) {
    initGuardrailsDragAndDrop();
  }
  if (guardrailsFileInput) {
    guardrailsFileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) {
        handleGuardrailsFileUpload(e.target.files[0]);
      }
    });
  }
  if (removeGuardrailsFileButton) {
    removeGuardrailsFileButton.addEventListener('click', () => {
      resetGuardrailsUploadUI();
      if (guardrailsFileInput) guardrailsFileInput.value = '';
      guardrailsTempFilePath = '';
      updateFooterButtons();
    });
  }

  // [BENEFICIARIES] step13
  if (beneficiaryDropzone) {
    initBeneficiaryDragAndDrop();
  }
  if (beneficiaryFileInput) {
    beneficiaryFileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) {
        handleBeneficiaryFileUpload(e.target.files[0]);
      }
    });
  }
  if (removeBeneficiaryFileButton) {
    removeBeneficiaryFileButton.addEventListener('click', () => {
      resetBeneficiaryUploadUI();
      if (beneficiaryFileInput) beneficiaryFileInput.value = '';
      beneficiaryTempFilePath = '';
      updateFooterButtons();
    });
  }

  // [BILLING] step15
  if (billingDropzone) {
    initBillingDragAndDrop();
  }
  if (billingFileInput) {
    billingFileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) {
        handleBillingFileUpload(e.target.files[0]);
      }
    });
  }
  if (removeBillingFileButton) {
    removeBillingFileButton.addEventListener('click', () => {
      resetBillingUploadUI();
      if (billingFileInput) billingFileInput.value = '';
      billingTempFilePath = '';
      updateFooterButtons();
    });
  }

  // Additional fields collapses for Contact
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

  // Additional fields for Account
  if (toggleAccountAdditionalFieldsBtn && accountAdditionalFieldsCollapse) {
    accountAdditionalFieldsCollapse.addEventListener('shown.bs.collapse', () => {
      toggleAccountAdditionalFieldsBtn.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    accountAdditionalFieldsCollapse.addEventListener('hidden.bs.collapse', () => {
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

  // handleNext
  function handleNext() {
    /*
      0 => Step1 (Pick contact/account)
      1 => Step2 (Contact upload)
      2 => Step3 (Contact mapping)
      3 => Step4 (Account options)
      4 => Step5 (Account upload)
      5 => Step6 (Account mapping)
      6 => Step7 (Buckets Info)
      7 => Step8 (Buckets Upload)
      8 => Step9 (Buckets Mapping)
      9 => Step10 (Guardrails Info)
      10 => Step11 (Guardrails Upload)
      11 => Step12 (Guardrails Mapping)
      12 => Step13 (Beneficiary Upload)
      13 => Step14 (Beneficiary Mapping)
      14 => Step15 (Billing Upload)
      15 => Step16 (Billing Mapping)
    */

    if (currentStepIndex === 0) {
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
      if (!contactTempFilePath) {
        showAlert('danger','Please upload a contact file first.');
        return;
      }
      slideToStep(1, 2);
      populateContactMappingSelects();
    }
    else if (currentStepIndex === 2) {
      performContactImport();
    }
    else if (currentStepIndex === 3) {
      const chosen = document.querySelector('.data-option.account-option.selected');
      if (!chosen) {
        showAlert('danger','Please pick an account import type.');
        return;
      }
      const acctType = chosen.dataset.accountType;

      if (acctType === 'general') {
        slideToStep(3, 4);
      } else if (acctType === 'buckets') {
        slideToStep(3, 6);
      } else if (acctType === 'guardrails') {
        slideToStep(3, 9);
      } else if (acctType === 'beneficiaries') {
        slideToStep(3, 12);
      } else if (acctType === 'billing') {
        // Billing Info => step 14
        slideToStep(3, 14);
      } else {
        showAlert('danger', 'This feature is coming soon.');
      }
    }
    else if (currentStepIndex === 4) {
      if (!accountTempFilePath) {
        showAlert('danger','Please upload an account file first.');
        return;
      }
      slideToStep(4, 5);
      populateAccountMappingSelects();
    }
    else if (currentStepIndex === 5) {
      performAccountImport();
    }
    else if (currentStepIndex === 6) {
      slideToStep(6, 7);
    }
    else if (currentStepIndex === 7) {
      if (!bucketsTempFilePath) {
        showAlert('danger','Please upload a Buckets file first.');
        return;
      }
      slideToStep(7, 8);
      populateBucketsMappingSelects();
    }
    else if (currentStepIndex === 8) {
      performBucketsImport();
    }
    else if (currentStepIndex === 9) {
      slideToStep(9, 10);
    }
    else if (currentStepIndex === 10) {
      if (!guardrailsTempFilePath) {
        showAlert('danger','Please upload a Guardrails file first.');
        return;
      }
      slideToStep(10, 11);
      populateGuardrailsMappingSelects();
    }
    else if (currentStepIndex === 11) {
      performGuardrailsImport();
    }
    else if (currentStepIndex === 12) {
      if (!beneficiaryTempFilePath) {
        showAlert('danger','Please upload a beneficiary file first.');
        return;
      }
      slideToStep(12, 13);
      populateBeneficiaryMappingSelects();
    }
    else if (currentStepIndex === 13) {
      performBeneficiaryImport();
    }
    // [BILLING] Steps 14 -> 15 -> import
    else if (currentStepIndex === 14) {
      // Billing Upload -> next is Billing Mapping
      if (!billingTempFilePath) {
        showAlert('danger','Please upload a billing file first.');
        return;
      }
      slideToStep(14, 15);
      populateBillingMappingSelects();
    }
    else if (currentStepIndex === 15) {
      // Perform Billing import
      performBillingImport();
    }
  }

  // handlePrev
  function handlePrev() {
    if (currentStepIndex === 1) {
      slideToStep(1, 0);
    }
    else if (currentStepIndex === 2) {
      slideToStep(2, 1);
    }
    else if (currentStepIndex === 3) {
      slideToStep(3, 0);
    }
    else if (currentStepIndex === 4) {
      slideToStep(4, 3);
    }
    else if (currentStepIndex === 5) {
      slideToStep(5, 4);
    }
    else if (currentStepIndex === 6) {
      slideToStep(6, 3);
    }
    else if (currentStepIndex === 7) {
      slideToStep(7, 6);
    }
    else if (currentStepIndex === 8) {
      slideToStep(8, 7);
    }
    else if (currentStepIndex === 9) {
      slideToStep(9, 3);
    }
    else if (currentStepIndex === 10) {
      slideToStep(10, 9);
    }
    else if (currentStepIndex === 11) {
      slideToStep(11, 10);
    }
    else if (currentStepIndex === 12) {
      slideToStep(12, 3);
    }
    else if (currentStepIndex === 13) {
      slideToStep(13, 12);
    }
    else if (currentStepIndex === 14) {
      // Billing Upload -> back to step 3
      slideToStep(14, 3);
    }
    else if (currentStepIndex === 15) {
      // Billing Mapping -> back to step 14
      slideToStep(15, 14);
    }
  }

  // CONTACT Drag & Drop init
  function initContactDragAndDrop() {
    const preventDefaults = e => {
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

  // General Account Drag & Drop init
  function initAccountDragAndDrop() {
    const preventDefaults = e => {
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

  // [BUCKETS] init
  function initBucketsDragAndDrop() {
    const preventDefaults = e => {
      e.preventDefault();
      e.stopPropagation();
    };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => {
      bucketsDropzone.addEventListener(evt, preventDefaults, false);
    });
    ['dragenter','dragover'].forEach(evt => {
      bucketsDropzone.addEventListener(evt, () => {
        bucketsDropzone.classList.add('drag-over');
      }, false);
    });
    ['dragleave','drop'].forEach(evt => {
      bucketsDropzone.addEventListener(evt, () => {
        bucketsDropzone.classList.remove('drag-over');
      }, false);
    });
    bucketsDropzone.addEventListener('drop', e => {
      if (e.dataTransfer.files.length > 0) {
        handleBucketsFileUpload(e.dataTransfer.files[0]);
      }
    });
  }

  // [GUARDRAILS] init
  function initGuardrailsDragAndDrop() {
    const preventDefaults = e => {
      e.preventDefault();
      e.stopPropagation();
    };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => {
      guardrailsDropzone.addEventListener(evt, preventDefaults, false);
    });
    ['dragenter','dragover'].forEach(evt => {
      guardrailsDropzone.addEventListener(evt, () => {
        guardrailsDropzone.classList.add('drag-over');
      }, false);
    });
    ['dragleave','drop'].forEach(evt => {
      guardrailsDropzone.addEventListener(evt, () => {
        guardrailsDropzone.classList.remove('drag-over');
      }, false);
    });
    guardrailsDropzone.addEventListener('drop', e => {
      if (e.dataTransfer.files.length > 0) {
        handleGuardrailsFileUpload(e.dataTransfer.files[0]);
      }
    });
  }

  // [BENEFICIARIES] init
  function initBeneficiaryDragAndDrop() {
    const preventDefaults = e => {
      e.preventDefault();
      e.stopPropagation();
    };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => {
      beneficiaryDropzone.addEventListener(evt, preventDefaults, false);
    });
    ['dragenter','dragover'].forEach(evt => {
      beneficiaryDropzone.addEventListener(evt, () => {
        beneficiaryDropzone.classList.add('drag-over');
      }, false);
    });
    ['dragleave','drop'].forEach(evt => {
      beneficiaryDropzone.addEventListener(evt, () => {
        beneficiaryDropzone.classList.remove('drag-over');
      }, false);
    });
    beneficiaryDropzone.addEventListener('drop', e => {
      if (e.dataTransfer.files.length > 0) {
        handleBeneficiaryFileUpload(e.dataTransfer.files[0]);
      }
    });
  }

  // [BILLING] init
  function initBillingDragAndDrop() {
    const preventDefaults = e => {
      e.preventDefault();
      e.stopPropagation();
    };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => {
      billingDropzone.addEventListener(evt, preventDefaults, false);
    });
    ['dragenter','dragover'].forEach(evt => {
      billingDropzone.addEventListener(evt, () => {
        billingDropzone.classList.add('drag-over');
      }, false);
    });
    ['dragleave','drop'].forEach(evt => {
      billingDropzone.addEventListener(evt, () => {
        billingDropzone.classList.remove('drag-over');
      }, false);
    });
    billingDropzone.addEventListener('drop', e => {
      if (e.dataTransfer.files.length > 0) {
        handleBillingFileUpload(e.dataTransfer.files[0]);
      }
    });
  }

  // CONTACT File Upload
  function handleContactFileUpload(file) {
    if (!file) return;
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
    xhr.onload = () => {
      if (xhr.status === 200) {
        const resp = JSON.parse(xhr.responseText);
        contactHeaders = resp.headers || [];
        contactTempFilePath = resp.tempFile || '';
        contactUploadProgressContainer.classList.add('hidden');
        contactUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else {
        showAlert('danger', 'Error uploading contact file');
      }
    };
    xhr.onerror = () => {
      showAlert('danger', 'Upload request failed');
    };
    xhr.send(formData);
  }

  // Account File Upload (General Info)
  function handleAccountFileUpload(file) {
    if (!file) return;
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
    xhr.onload = () => {
      if (xhr.status === 200) {
        const resp = JSON.parse(xhr.responseText);
        accountHeaders = resp.headers || [];
        accountTempFilePath = resp.tempFile || '';
        accountUploadProgressContainer.classList.add('hidden');
        accountUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else {
        showAlert('danger', 'Error uploading account file');
      }
    };
    xhr.onerror = () => {
      showAlert('danger', 'Upload request failed');
    };
    xhr.send(formData);
  }

  // [BUCKETS]
  function handleBucketsFileUpload(file) {
    if (!file) return;
    bucketsUploadBox.classList.add('hidden');
    bucketsUploadProgressContainer.classList.remove('hidden');
    bucketsUploadCompletedContainer.classList.add('hidden');
    nextBtn.disabled = true;

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/new-import/account/file'); 
    xhr.upload.onprogress = function(e) {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        bucketsUploadProgressBar.style.width = percent + '%';
        bucketsUploadProgressBar.textContent = percent + '%';
      }
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        const resp = JSON.parse(xhr.responseText);
        bucketsHeaders = resp.headers || [];
        bucketsTempFilePath = resp.tempFile || '';
        bucketsUploadProgressContainer.classList.add('hidden');
        bucketsUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else {
        showAlert('danger','Error uploading Buckets file');
      }
    };
    xhr.onerror = () => {
      showAlert('danger','Upload request failed');
    };
    xhr.send(formData);
  }

  // [GUARDRAILS]
  function handleGuardrailsFileUpload(file) {
    if (!file) return;
    guardrailsUploadBox.classList.add('hidden');
    guardrailsUploadProgressContainer.classList.remove('hidden');
    guardrailsUploadCompletedContainer.classList.add('hidden');
    nextBtn.disabled = true;

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/new-import/account/file');
    xhr.upload.onprogress = function(e) {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        guardrailsUploadProgressBar.style.width = percent + '%';
        guardrailsUploadProgressBar.textContent = percent + '%';
      }
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        const resp = JSON.parse(xhr.responseText);
        guardrailsHeaders = resp.headers || [];
        guardrailsTempFilePath = resp.tempFile || '';
        guardrailsUploadProgressContainer.classList.add('hidden');
        guardrailsUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else {
        showAlert('danger','Error uploading Guardrails file');
      }
    };
    xhr.onerror = () => {
      showAlert('danger','Upload request failed');
    };
    xhr.send(formData);
  }

  // [BENEFICIARIES]
  function handleBeneficiaryFileUpload(file) {
    if (!file) return;
    beneficiaryUploadBox.classList.add('hidden');
    beneficiaryUploadProgressContainer.classList.remove('hidden');
    beneficiaryUploadCompletedContainer.classList.add('hidden');
    nextBtn.disabled = true;

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/new-import/account/file'); 
    xhr.upload.onprogress = function(e) {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        beneficiaryUploadProgressBar.style.width = percent + '%';
        beneficiaryUploadProgressBar.textContent = percent + '%';
      }
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        const resp = JSON.parse(xhr.responseText);
        beneficiaryHeaders = resp.headers || [];
        beneficiaryTempFilePath = resp.tempFile || '';
        beneficiaryUploadProgressContainer.classList.add('hidden');
        beneficiaryUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else {
        showAlert('danger', 'Error uploading beneficiary file');
      }
    };
    xhr.onerror = () => {
      showAlert('danger', 'Upload request failed');
    };
    xhr.send(formData);
  }

  // [BILLING]
  function handleBillingFileUpload(file) {
    if (!file) return;
    billingUploadBox.classList.add('hidden');
    billingUploadProgressContainer.classList.remove('hidden');
    billingUploadCompletedContainer.classList.add('hidden');
    nextBtn.disabled = true;

    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/new-import/account/file');
    xhr.upload.onprogress = function(e) {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        billingUploadProgressBar.style.width = percent + '%';
        billingUploadProgressBar.textContent = percent + '%';
      }
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        const resp = JSON.parse(xhr.responseText);
        billingHeaders = resp.headers || [];
        billingTempFilePath = resp.tempFile || '';
        billingUploadProgressContainer.classList.add('hidden');
        billingUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else {
        showAlert('danger','Error uploading billing file');
      }
    };
    xhr.onerror = () => {
      showAlert('danger','Upload request failed');
    };
    xhr.send(formData);
  }

  // populateContactMappingSelects
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

  // populateAccountMappingSelects (General Info)
  function populateAccountMappingSelects() {
    if (!accountHeaders.length) return;
    const container = document.getElementById('account-mapping-fields-container');
    if (!container) return;

    const selects = container.querySelectorAll('select');
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

  // [BUCKETS] step9
  function populateBucketsMappingSelects() {
    if (!bucketsHeaders.length) return;
    const container = document.getElementById('buckets-mapping-fields-container');
    if (!container) return;

    const selects = container.querySelectorAll('select');
    selects.forEach(sel => {
      sel.innerHTML = '<option value="">-- Select Column --</option>';
      bucketsHeaders.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        sel.appendChild(opt);
      });
    });
    synchronizeBucketsColumns();
    selects.forEach(sel => {
      sel.addEventListener('change', () => {
        synchronizeBucketsColumns();
        updateFooterButtons();
      });
    });
  }

  // [GUARDRAILS] step12
  function populateGuardrailsMappingSelects() {
    if (!guardrailsHeaders.length) return;
    const container = document.getElementById('guardrails-mapping-fields-container');
    if (!container) return;

    const selects = container.querySelectorAll('select');
    selects.forEach(sel => {
      sel.innerHTML = '<option value="">-- Select Column --</option>';
      guardrailsHeaders.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        sel.appendChild(opt);
      });
    });
    synchronizeGuardrailsColumns();
    selects.forEach(sel => {
      sel.addEventListener('change', () => {
        synchronizeGuardrailsColumns();
        updateFooterButtons();
      });
    });
  }

  // [BENEFICIARIES] step14
  function populateBeneficiaryMappingSelects() {
    if (!beneficiaryHeaders.length) return;
    const container = document.getElementById('beneficiary-mapping-fields-container');
    if (!container) return;

    const selects = container.querySelectorAll('select');
    selects.forEach(sel => {
      sel.innerHTML = '<option value="">-- Select Column --</option>';
      beneficiaryHeaders.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        sel.appendChild(opt);
      });
    });
    synchronizeBeneficiaryColumns();
    selects.forEach(sel => {
      sel.addEventListener('change', () => {
        synchronizeBeneficiaryColumns();
        updateFooterButtons();
      });
    });
  }

  // [BILLING] step16
  function populateBillingMappingSelects() {
    if (!billingHeaders.length) return;
    const container = document.getElementById('billing-mapping-fields-container');
    if (!container) return;

    const selects = container.querySelectorAll('select');
    selects.forEach(sel => {
      sel.innerHTML = '<option value="">-- Select Column --</option>';
      billingHeaders.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        sel.appendChild(opt);
      });
    });
    synchronizeBillingColumns();
    selects.forEach(sel => {
      sel.addEventListener('change', () => {
        synchronizeBillingColumns();
        updateFooterButtons();
      });
    });
  }

  // synchronizeContactColumns
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

  // synchronizeAccountColumns (General Info)
  function synchronizeAccountColumns() {
    const container = document.getElementById('account-mapping-fields-container');
    if (!container) return;

    const selects = container.querySelectorAll('select');
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

  // [BUCKETS]
  function synchronizeBucketsColumns() {
    const container = document.getElementById('buckets-mapping-fields-container');
    if (!container) return;
    const selects = container.querySelectorAll('select');
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

  // [GUARDRAILS]
  function synchronizeGuardrailsColumns() {
    const container = document.getElementById('guardrails-mapping-fields-container');
    if (!container) return;
    const selects = container.querySelectorAll('select');
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

  // [BENEFICIARIES]
  function synchronizeBeneficiaryColumns() {
    const container = document.getElementById('beneficiary-mapping-fields-container');
    if (!container) return;
    const selects = container.querySelectorAll('select');
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

  // [BILLING]
  function synchronizeBillingColumns() {
    const container = document.getElementById('billing-mapping-fields-container');
    if (!container) return;
    const selects = container.querySelectorAll('select');
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

  // performContactImport
  function performContactImport() {
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
      // Real-time socket updates
    })
    .catch(err => {
      console.error(err);
      showAlert('danger','Error initiating the contact import.');
    });
  }

  // performAccountImport (General Info)
  function performAccountImport() {
    const container = document.getElementById('account-mapping-fields-container');
    if (!container) return;

    const requiredSelects = container.querySelectorAll('select[data-required="true"]');
    for (let sel of requiredSelects) {
      if (!sel.value) {
        showAlert('danger','Please fill all required fields before importing.');
        return;
      }
    }

    const mapping = {};
    const allocationFields = ['cash','income','annuities','growth'];
    const allSelects = container.querySelectorAll('select');

    // Single-column fields
    allSelects.forEach(sel => {
      if (allocationFields.includes(sel.name)) return;
      if (sel.value) mapping[sel.name] = accountHeaders.indexOf(sel.value);
    });

    // Multi-column allocations
    allocationFields.forEach(field => {
      const fieldContainer = container.querySelector(`#${field}-allocation-container`);
      mapping[field] = [];
      if (fieldContainer) {
        const selects = fieldContainer.querySelectorAll('select.form-select');
        selects.forEach(sel => {
          if (sel.value) {
            const colIndex = accountHeaders.indexOf(sel.value);
            if (colIndex >= 0) {
              mapping[field].push(colIndex);
            }
          }
        });
      }
    });

    const bodyData = {
      mapping,
      tempFile: accountTempFilePath
    };

    const importModalInstance = bootstrap.Modal.getInstance(importModal);
    if (importModalInstance) importModalInstance.hide();

    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      progressContainer.classList.remove('hidden');
    }
    const progressHeader = progressContainer.querySelector('.progress-header h5.progress-title');
    if (progressHeader) {
      progressHeader.textContent = 'Account Import';
    }

    fetch('/api/new-import/account/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    })
    .then(r => r.json())
    .then(resp => {
      // Real-time socket updates
    })
    .catch(err => {
      console.error(err);
      showAlert('danger','Error initiating the account import.');
    });
  }

  // [BUCKETS]
  function performBucketsImport() {
    const container = document.getElementById('buckets-mapping-fields-container');
    if (!container) return;

    const requiredSelects = container.querySelectorAll('select[data-required="true"]');
    for (let sel of requiredSelects) {
      if (!sel.value) {
        showAlert('danger','Please fill all required fields before importing.');
        return;
      }
    }

    const mapping = {};
    const allocationFields = ['cash','income','annuities','growth'];
    const allSelects = container.querySelectorAll('select');

    // Single-column fields
    allSelects.forEach(sel => {
      if (allocationFields.includes(sel.name)) return;
      if (sel.value) {
        mapping[sel.name] = bucketsHeaders.indexOf(sel.value);
      }
    });

    // Multi-column allocations
    allocationFields.forEach(field => {
      const fieldContainer = container.querySelector(`#${field}-allocation-container`);
      mapping[field] = [];
      if (fieldContainer) {
        const selects = fieldContainer.querySelectorAll('select.form-select');
        selects.forEach(s => {
          if (s.value) {
            const colIndex = bucketsHeaders.indexOf(s.value);
            if (colIndex >= 0) mapping[field].push(colIndex);
          }
        });
      }
    });

    const bodyData = {
      mapping,
      tempFile: bucketsTempFilePath
    };

    const importModalInstance = bootstrap.Modal.getInstance(importModal);
    if (importModalInstance) importModalInstance.hide();

    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      progressContainer.classList.remove('hidden');
    }
    const progressHeader = progressContainer.querySelector('.progress-header h5.progress-title');
    if (progressHeader) {
      progressHeader.textContent = 'Buckets Import';
    }

    fetch('/api/new-import/account/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    })
    .then(r => r.json())
    .then(resp => {
      // Real-time socket updates
    })
    .catch(err => {
      console.error(err);
      showAlert('danger','Error initiating the Buckets import.');
    });
  }

  // [GUARDRAILS]
  function performGuardrailsImport() {
    const container = document.getElementById('guardrails-mapping-fields-container');
    if (!container) return;

    const requiredSelects = container.querySelectorAll('select[data-required="true"]');
    for (let sel of requiredSelects) {
      if (!sel.value) {
        showAlert('danger','Please fill all required fields before importing.');
        return;
      }
    }

    const mapping = {};
    const allSelects = container.querySelectorAll('select');
    allSelects.forEach(sel => {
      if (sel.value) {
        mapping[sel.name] = guardrailsHeaders.indexOf(sel.value);
      }
    });

    const bodyData = {
      mapping,
      tempFile: guardrailsTempFilePath
    };

    const importModalInstance = bootstrap.Modal.getInstance(importModal);
    if (importModalInstance) importModalInstance.hide();

    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      progressContainer.classList.remove('hidden');
    }
    const progressHeader = progressContainer.querySelector('.progress-header h5.progress-title');
    if (progressHeader) {
      progressHeader.textContent = 'Guardrails Import';
    }

    fetch('/api/new-import/account/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    })
    .then(r => r.json())
    .then(resp => {
      // Real-time socket updates
    })
    .catch(err => {
      console.error(err);
      showAlert('danger','Error initiating the Guardrails import.');
    });
  }

  // [BENEFICIARIES]
  function performBeneficiaryImport() {
    const container = document.getElementById('beneficiary-mapping-fields-container');
    if (!container) return;

    const requiredSelect = container.querySelector('select[name="accountNumber"][data-required="true"]');
    if (!requiredSelect || !requiredSelect.value) {
      showAlert('danger','Please map the required Account Number field before importing.');
      return;
    }

    const mapping = {};
    const allSelects = container.querySelectorAll('select');
    allSelects.forEach(sel => {
      if (sel.value) {
        mapping[sel.name] = beneficiaryHeaders.indexOf(sel.value);
      }
    });

    const bodyData = {
      mapping,
      tempFile: beneficiaryTempFilePath,
      importType: 'beneficiaries'
    };

    const importModalInstance = bootstrap.Modal.getInstance(importModal);
    if (importModalInstance) importModalInstance.hide();

    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      progressContainer.classList.remove('hidden');
    }
    const progressHeader = progressContainer.querySelector('.progress-header h5.progress-title');
    if (progressHeader) {
      progressHeader.textContent = 'Beneficiary Import';
    }

    fetch('/api/new-import/account/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    })
    .then(r => r.json())
    .then(resp => {
      // Real-time socket updates
    })
    .catch(err => {
      console.error(err);
      showAlert('danger','Error initiating the Beneficiary import.');
    });
  }

  // [BILLING] - new import
  function performBillingImport() {
    const container = document.getElementById('billing-mapping-fields-container');
    if (!container) return;

    // Required: accountNumber, quarterlyBilledAmount
    const requiredAccountNumber = container.querySelector('select[name="accountNumber"][data-required="true"]');
    const requiredQBilled = container.querySelector('select[name="quarterlyBilledAmount"][data-required="true"]');

    if (!requiredAccountNumber || !requiredAccountNumber.value || !requiredQBilled || !requiredQBilled.value) {
      showAlert('danger','Please fill all required fields (Account Number, Quarterly Billed $).');
      return;
    }

    const mapping = {};
    const allSelects = container.querySelectorAll('select');
    allSelects.forEach(sel => {
      if (sel.value) {
        mapping[sel.name] = billingHeaders.indexOf(sel.value);
      }
    });

    const bodyData = {
      mapping,
      tempFile: billingTempFilePath,
      importType: 'billing'
    };

    const importModalInstance = bootstrap.Modal.getInstance(importModal);
    if (importModalInstance) importModalInstance.hide();

    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      progressContainer.classList.remove('hidden');
    }
    const progressHeader = progressContainer.querySelector('.progress-header h5.progress-title');
    if (progressHeader) {
      progressHeader.textContent = 'Billing Import';
    }

    fetch('/api/new-import/account/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    })
    .then(r => r.json())
    .then(resp => {
      // Real-time socket updates
    })
    .catch(err => {
      console.error(err);
      showAlert('danger','Error initiating the Billing import.');
    });
  }

  // slideToStep
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

  // resetModalState
  function resetModalState() {
    currentStepIndex = 0;
    selectedImportType = null;

    // Reset contact
    contactTempFilePath = '';
    contactHeaders = [];
    nameMode = 'single';
    resetContactUploadUI();

    // Reset general accounts
    accountTempFilePath = '';
    accountHeaders = [];
    resetAccountUploadUI();

    // [BUCKETS]
    bucketsTempFilePath = '';
    bucketsHeaders = [];
    resetBucketsUploadUI();

    // [GUARDRAILS]
    guardrailsTempFilePath = '';
    guardrailsHeaders = [];
    resetGuardrailsUploadUI();

    // [BENEFICIARIES]
    beneficiaryTempFilePath = '';
    beneficiaryHeaders = [];
    resetBeneficiaryUploadUI();

    // [BILLING]
    billingTempFilePath = '';
    billingHeaders = '';
    resetBillingUploadUI();

    steps.forEach((step, idx) => {
      step.classList.toggle('hidden', idx !== 0);
      step.classList.remove('slide-out-left','slide-out-right','slide-in-left','slide-in-right');
    });

    const dataOptionEls = container.querySelectorAll('.data-option');
    dataOptionEls.forEach(o => o.classList.remove('selected'));

    if (contactFileInput) contactFileInput.value = '';
    if (accountFileInput) accountFileInput.value = '';
    if (bucketsFileInput) bucketsFileInput.value = '';
    if (guardrailsFileInput) guardrailsFileInput.value = '';
    if (beneficiaryFileInput) beneficiaryFileInput.value = '';
    if (billingFileInput) billingFileInput.value = '';

    // Collapse any open sections
    if (additionalFieldsCollapse) {
      const collapseEl = bootstrap.Collapse.getInstance(additionalFieldsCollapse);
      if (collapseEl && additionalFieldsCollapse.classList.contains('show')) {
        collapseEl.hide();
      }
    }
    if (accountAdditionalFieldsCollapse) {
      const collapseAcc = bootstrap.Collapse.getInstance(accountAdditionalFieldsCollapse);
      if (collapseAcc && accountAdditionalFieldsCollapse.classList.contains('show')) {
        collapseAcc.hide();
      }
    }

    updateFooterButtons();
  }

  // resetUploadStates
  function resetUploadStates() {
    resetContactUploadUI();
    resetAccountUploadUI();
    resetBucketsUploadUI();
    resetGuardrailsUploadUI();
    resetBeneficiaryUploadUI();
    resetBillingUploadUI();
  }

  // resetContactUploadUI
  function resetContactUploadUI() {
    if (contactUploadBox) contactUploadBox.classList.remove('hidden');
    if (contactUploadProgressContainer) contactUploadProgressContainer.classList.add('hidden');
    if (contactUploadCompletedContainer) contactUploadCompletedContainer.classList.add('hidden');
    if (contactUploadProgressBar) {
      contactUploadProgressBar.style.width = '0%';
      contactUploadProgressBar.textContent = '0%';
    }
  }

  // resetAccountUploadUI
  function resetAccountUploadUI() {
    if (accountUploadBox) accountUploadBox.classList.remove('hidden');
    if (accountUploadProgressContainer) accountUploadProgressContainer.classList.add('hidden');
    if (accountUploadCompletedContainer) accountUploadCompletedContainer.classList.add('hidden');
    if (accountUploadProgressBar) {
      accountUploadProgressBar.style.width = '0%';
      accountUploadProgressBar.textContent = '0%';
    }
  }

  // [BUCKETS] reset
  function resetBucketsUploadUI() {
    if (bucketsUploadBox) bucketsUploadBox.classList.remove('hidden');
    if (bucketsUploadProgressContainer) bucketsUploadProgressContainer.classList.add('hidden');
    if (bucketsUploadCompletedContainer) bucketsUploadCompletedContainer.classList.add('hidden');
    if (bucketsUploadProgressBar) {
      bucketsUploadProgressBar.style.width = '0%';
      bucketsUploadProgressBar.textContent = '0%';
    }
  }

  // [GUARDRAILS] reset
  function resetGuardrailsUploadUI() {
    if (guardrailsUploadBox) guardrailsUploadBox.classList.remove('hidden');
    if (guardrailsUploadProgressContainer) guardrailsUploadProgressContainer.classList.add('hidden');
    if (guardrailsUploadCompletedContainer) guardrailsUploadCompletedContainer.classList.add('hidden');
    if (guardrailsUploadProgressBar) {
      guardrailsUploadProgressBar.style.width = '0%';
      guardrailsUploadProgressBar.textContent = '0%';
    }
  }

  // [BENEFICIARIES] reset
  function resetBeneficiaryUploadUI() {
    if (beneficiaryUploadBox) beneficiaryUploadBox.classList.remove('hidden');
    if (beneficiaryUploadProgressContainer) beneficiaryUploadProgressContainer.classList.add('hidden');
    if (beneficiaryUploadCompletedContainer) beneficiaryUploadCompletedContainer.classList.add('hidden');
    if (beneficiaryUploadProgressBar) {
      beneficiaryUploadProgressBar.style.width = '0%';
      beneficiaryUploadProgressBar.textContent = '0%';
    }
  }

  // [BILLING] reset
  function resetBillingUploadUI() {
    if (billingUploadBox) billingUploadBox.classList.remove('hidden');
    if (billingUploadProgressContainer) billingUploadProgressContainer.classList.add('hidden');
    if (billingUploadCompletedContainer) billingUploadCompletedContainer.classList.add('hidden');
    if (billingUploadProgressBar) {
      billingUploadProgressBar.style.width = '0%';
      billingUploadProgressBar.textContent = '0%';
    }
  }

  // updateFooterButtons
  function updateFooterButtons() {
    /*
      0 => Step1 (Pick)
      1 => Step2 (Contact Upload)
      2 => Step3 (Contact Mapping)
      3 => Step4 (Account Options)
      4 => Step5 (Account Upload)
      5 => Step6 (Account Mapping)
      6 => Step7 (Buckets Info)
      7 => Step8 (Buckets Upload)
      8 => Step9 (Buckets Mapping)
      9 => Step10 (Guardrails Info)
      10 => Step11 (Guardrails Upload)
      11 => Step12 (Guardrails Mapping)
      12 => Step13 (Beneficiary Upload)
      13 => Step14 (Beneficiary Mapping)
      14 => Step15 (Billing Upload)
      15 => Step16 (Billing Mapping)
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
      // Account options
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      const chosenAccountOption = document.querySelector('.data-option.account-option.selected');
      nextBtn.disabled = !chosenAccountOption;
    }
    else if (currentStepIndex === 4) {
      // General account upload
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !accountTempFilePath;
    }
    else if (currentStepIndex === 5) {
      // General account mapping
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Import';
      nextBtn.disabled = false; // Additional validation logic can go here
    }
    else if (currentStepIndex === 6) {
      // Buckets Info
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = false;
    }
    else if (currentStepIndex === 7) {
      // Buckets Upload
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !bucketsTempFilePath;
    }
    else if (currentStepIndex === 8) {
      // Buckets Mapping
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Import';
      const bucketsMappingContainer = document.getElementById('buckets-mapping-fields-container');
      if (!bucketsMappingContainer) {
        nextBtn.disabled = true;
        return;
      }
      const requiredSelects = bucketsMappingContainer.querySelectorAll('select[data-required="true"]');
      let allBucketsRequired = true;
      requiredSelects.forEach(sel => {
        if (!sel.value) {
          allBucketsRequired = false;
        }
      });
      nextBtn.disabled = !allBucketsRequired;
    }
    else if (currentStepIndex === 9) {
      // Guardrails Info
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = false;
    }
    else if (currentStepIndex === 10) {
      // Guardrails Upload
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !guardrailsTempFilePath;
    }
    else if (currentStepIndex === 11) {
      // Guardrails Mapping
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Import';
      const guardrailsMappingContainer = document.getElementById('guardrails-mapping-fields-container');
      if (!guardrailsMappingContainer) {
        nextBtn.disabled = true;
        return;
      }
      const requiredSelects = guardrailsMappingContainer.querySelectorAll('select[data-required="true"]');
      let allGuardrailsRequired = true;
      requiredSelects.forEach(sel => {
        if (!sel.value) {
          allGuardrailsRequired = false;
        }
      });
      nextBtn.disabled = !allGuardrailsRequired;
    }
    else if (currentStepIndex === 12) {
      // Beneficiary Upload
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !beneficiaryTempFilePath;
    }
    else if (currentStepIndex === 13) {
      // Beneficiary Mapping
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Import';
      const beneficiaryMappingContainer = document.getElementById('beneficiary-mapping-fields-container');
      if (!beneficiaryMappingContainer) {
        nextBtn.disabled = true;
        return;
      }
      const requiredSelect = beneficiaryMappingContainer.querySelector('select[name="accountNumber"][data-required="true"]');
      nextBtn.disabled = !(requiredSelect && requiredSelect.value);
    }
    // [BILLING]
    else if (currentStepIndex === 14) {
      // Billing Upload
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !billingTempFilePath;
    }
    else if (currentStepIndex === 15) {
      // Billing Mapping
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Import';
      const billingMappingContainer = document.getElementById('billing-mapping-fields-container');
      if (!billingMappingContainer) {
        nextBtn.disabled = true;
        return;
      }
      const reqAccNum = billingMappingContainer.querySelector('select[name="accountNumber"][data-required="true"]');
      const reqQBill = billingMappingContainer.querySelector('select[name="quarterlyBilledAmount"][data-required="true"]');
      nextBtn.disabled = !(reqAccNum && reqAccNum.value && reqQBill && reqQBill.value);
    }
  }
});
