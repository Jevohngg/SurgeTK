/***************************************
 * newUniversalImport.js
 *
 * Unified import flow for BOTH Contact and Account.
 * Shows file-upload progress for each.
 **************************************/

const socket = io();
const pm = new ProgressManager(socket); // For real-time updates

// ---------------------------------------------------------------------------
// Canonical wizard indices  — keep in sync with the Pug includes
// NOTE: Billing now has an Info step; Insurance flow added; Liability/Asset shifted.
// ---------------------------------------------------------------------------
const STEP = {
  // Pick data‑type
  PICK: 0,

  // Contact
  CONTACT_INFO:           1,
  CONTACT_UPLOAD:         2,
  CONTACT_MAPPING:        3,

  // Account – General
  ACCOUNT_OPTIONS:        4,
  ACCOUNT_GENERAL_INFO:   5,
  ACCOUNT_UPLOAD:         6,
  ACCOUNT_MAPPING:        7,

  // Buckets
  BUCKETS_INFO:           8,
  BUCKETS_UPLOAD:         9,
  BUCKETS_MAPPING:        10,

  // Guardrails
  GUARDRAILS_INFO:        11,
  GUARDRAILS_UPLOAD:      12,
  GUARDRAILS_MAPPING:     13,

  // Beneficiary
  BENEFICIARY_INFO:       14,
  BENEFICIARY_UPLOAD:     15,
  BENEFICIARY_MAPPING:    16,

  // Billing (INFO → UPLOAD → MAPPING)
  BILLING_INFO:           17,
  BILLING_UPLOAD:         18,
  BILLING_MAPPING:        19,

  // Liability
  LIABILITY_INFO:         20,
  LIABILITY_UPLOAD:       21,
  LIABILITY_MAPPING:      22,

  // Insurance (INFO → UPLOAD → MAPPING)
  INSURANCE_INFO:         23,
  INSURANCE_UPLOAD:       24,
  INSURANCE_MAPPING:      25,

  // Asset
  ASSET_INFO:             26,
  ASSET_UPLOAD:           27,
  ASSET_MAPPING:          28
};

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

  let eligibility = {
    canImportClients : true,
    canImportAccounts: true,
    hasAnyAccounts   : true
  };

  const importModal = document.getElementById('universal-import-modal');
  if (!importModal) return;

  const container = document.getElementById('import-flow-container');
  const steps = container.querySelectorAll('.import-step');

  // Footer buttons
  const prevBtn = importModal.querySelector('#prevStepBtn');
  const nextBtn = importModal.querySelector('#nextStepBtn');
  const cancelBtn = importModal.querySelector('#cancelImportBtn');

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

  // [BENEFICIARIES] step14 references
  const beneficiaryDropzone = document.getElementById('beneficiary-file-dropzone');
  const beneficiaryFileInput = document.getElementById('beneficiary-file-input');
  const beneficiaryUploadBox = document.querySelector('.beneficiary-upload-box');
  const beneficiaryUploadProgressContainer = document.getElementById('beneficiary-upload-progress');
  const beneficiaryUploadProgressBar = document.getElementById('beneficiary-progress-bar');
  const beneficiaryUploadCompletedContainer = document.getElementById('beneficiary-upload-completed');
  const removeBeneficiaryFileButton = document.getElementById('removeBeneficiaryFileButton');

  // Buckets & Guardrails date pickers
  const bucketsAsOfInput    = document.getElementById('bucketsAsOfDate');
  const guardrailsAsOfInput = document.getElementById('guardrailsAsOfDate');

  // ───────────────────────────
  // BILLING references & state (new: Type/Period controls)
  // ───────────────────────────
  let billingTempFilePath = '';
  let billingHeaders = [];
  let billingS3Key = '';
  const billingDropzone = document.getElementById('billing-file-dropzone');
  const billingFileInput = document.getElementById('billing-file-input');
  const billingUploadBox = document.querySelector('.billing-upload-box');
  const billingUploadProgressContainer = document.getElementById('billing-upload-progress');
  const billingUploadProgressBar = document.getElementById('billing-progress-bar');
  const billingUploadCompletedContainer = document.getElementById('billing-upload-completed');
  const removeBillingFileButton = document.getElementById('removeBillingFileButton');
  const billingTypeSelect = document.getElementById('billingTypeSelect');
  const billingPeriodSelect = document.getElementById('billingPeriodSelect');
  const billingYearSelect = document.getElementById('billingYearSelect');
  const billingQuarterSelect = document.getElementById('billingQuarterSelect');
  const billingMonthSelect = document.getElementById('billingMonthSelect');
  const billingQuarterContainer = document.getElementById('quarterContainer');
  const billingMonthContainer = document.getElementById('monthContainer');

  // ───────────────────────────
  // LIABILITY upload references
  // ───────────────────────────
  let liabilityTempFilePath = '';
  let liabilityHeaders      = [];
  let liabilityS3Key        = '';
  const liabilityDropzone                = document.getElementById('liability-file-dropzone');
  const liabilityFileInput               = document.getElementById('liability-file-input');
  const liabilityUploadBox               = document.querySelector('.liability-upload-box');
  const liabilityUploadProgressContainer = document.getElementById('liability-upload-progress');
  const liabilityProgressBar             = document.getElementById('liability-progress-bar');
  const liabilityUploadCompletedContainer= document.getElementById('liability-upload-completed');
  const removeLiabilityFileButton        = document.getElementById('removeLiabilityFileButton');

  // ───────────────────────────
  // INSURANCE upload references (new flow)
  // ───────────────────────────
  let insuranceTempFilePath = '';
  let insuranceHeaders = [];
  let insuranceS3Key = '';
  const insuranceDropzone = document.getElementById('insurance-file-dropzone');
  const insuranceFileInput = document.getElementById('insurance-file-input');
  const insuranceUploadBox = document.querySelector('.insurance-upload-box');
  const insuranceUploadProgressContainer = document.getElementById('insurance-upload-progress');
  const insuranceProgressBar = document.getElementById('insurance-progress-bar');
  const insuranceUploadCompletedContainer = document.getElementById('insurance-upload-completed');
  const removeInsuranceFileButton = document.getElementById('removeInsuranceFileButton');

  // ───────────────────────────
  // ASSET upload references
  // ───────────────────────────
  let assetTempFilePath = '';
  let assetHeaders      = [];
  let assetS3Key        = '';
  const assetDropzone                = document.getElementById('asset-file-dropzone');
  const assetFileInput               = document.getElementById('asset-file-input');
  const assetUploadBox               = document.querySelector('.asset-upload-box');
  const assetUploadProgressContainer = document.getElementById('asset-upload-progress');
  const assetProgressBar             = document.getElementById('asset-progress-bar');
  const assetUploadCompletedContainer= document.getElementById('asset-upload-completed');
  const removeAssetFileButton        = document.getElementById('removeAssetFileButton');

  // Current file paths / headers
  let contactTempFilePath = '';
  let contactHeaders = [];
  let nameMode = 'single'; // single vs split name approach
  let contactS3Key = '';

  let accountTempFilePath = '';
  let accountHeaders = [];
  let accountS3Key = '';

  // [BUCKETS]
  let bucketsTempFilePath = '';
  let bucketsHeaders = [];
  let bucketsS3Key = '';

  // [GUARDRAILS]
  let guardrailsTempFilePath = '';
  let guardrailsHeaders = [];
  let guardrailsS3Key = '';

  // [BENEFICIARIES]
  let beneficiaryTempFilePath = '';
  let beneficiaryHeaders = [];
  let beneficiaryS3Key = '';

  // ~~~~~~~~~~~~~~
  // Initialize Steps
  // ~~~~~~~~~~~~~~
  steps.forEach((step, idx) => {
    step.classList.toggle('hidden', idx !== STEP.PICK);
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

  // Hidden -> reset state
  importModal.addEventListener('hidden.bs.modal', () => {
    resetModalState();
  });


  // Build canonical period key from the visible controls
function buildBillingPeriodKey() {
  const meta = getBillingMeta(); // { billingType, period: { granularity, year, month?, quarter? } }
  const g = (meta.period.granularity || '').toLowerCase();
  const y = String(meta.period.year || '').trim();
  if (!y) return '';
  if (g === 'quarter') {
    const q = String(meta.period.quarter || '').trim();
    return (q ? `${y}-Q${q}` : '');
  }
  if (g === 'month') {
    const m = String(meta.period.month || '').trim();
    return (m ? `${y}-${m.toString().padStart(2,'0')}` : '');
  }
  if (g === 'year') {
    return y;
  }
  return '';
}


  // Shown -> fetch eligibility exactly once
  importModal.addEventListener('shown.bs.modal', loadEligibilityOnce, { once: true });

  /** Load import-eligibility flags from server */
  async function loadEligibilityOnce() {
    try {
      const resp = await fetch('/api/import/eligibility');
      if (!resp.ok) throw new Error('Network response not OK');
      eligibility = await resp.json();
      applyEligibility();
    } catch (e) {
      console.error('Eligibility fetch error', e);
      showAlert(
        'danger',
        'Could not verify import eligibility. Everything left enabled by default.'
      );
    }
  }

  function applyEligibility() {
    /* ---------- 1st screen ---------- */
    const clientOpt   = container.querySelector('.data-option[data-type="contact"]');
    const accountOpt  = container.querySelector('.data-option[data-type="account"]');
    const helpClient  = document.getElementById('contact-disabled-help');
    const helpAccount = document.getElementById('account-disabled-help');

    toggleOption(clientOpt , !eligibility.canImportClients ,
      helpClient , 'Client import disabled because your firm is connected to Redtail CRM. ' +
                   'Manage clients in Redtail or disconnect it first.');

    toggleOption(accountOpt, !eligibility.canImportAccounts,
      helpAccount, 'No households/clients exist yet, so account import is unavailable.');

    /* ---------- account‑options screen ---------- */
    const needAccount = !eligibility.hasAnyAccounts;
    const disableIfNeeded = (selector, reason) => {
      document.querySelectorAll(selector).forEach(el => {
        toggleOption(el, needAccount,
          document.getElementById('account-options-disabled-help'),
          reason);
      });
    };
    disableIfNeeded('.data-option.account-option[data-account-type="buckets"]',
      'No accounts found.  Start with a General Account import.');
    disableIfNeeded('.data-option.account-option[data-account-type="guardrails"]',
      'No accounts found.  Start with a General Account import.');
    disableIfNeeded('.data-option.account-option[data-account-type="beneficiaries"]',
      'No accounts found.  Start with a General Account import.');
    disableIfNeeded('.data-option.account-option[data-account-type="billing"]',
      'No accounts found.  Start with a General Account import.');
    // (Insurance can remain enabled; depends on your business rules)
  }

  /** Toggle disabled card + helper text */
  function toggleOption(card, shouldDisable, helpEl, helpMessage) {
    if (!card || !helpEl) return;
    if (shouldDisable) {
      card.classList.add('disabled-option');
      helpEl.textContent = helpMessage;
      helpEl.classList.remove('hidden');
    } else {
      card.classList.remove('disabled-option');
      helpEl.classList.add('hidden');
    }
  }

  // Prev / Next
  prevBtn.addEventListener('click', handlePrev);
  nextBtn.addEventListener('click', handleNext);

  // CONTACT: drag-n-drop
  if (contactDropzone) initContactDragAndDrop();
  if (contactFileInput) {
    contactFileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleContactFileUpload(e.target.files[0]);
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
  if (accountDropzone) initAccountDragAndDrop();
  if (accountFileInput) {
    accountFileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleAccountFileUpload(e.target.files[0]);
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

  // [BUCKETS]
  if (bucketsDropzone) initBucketsDragAndDrop();
  if (bucketsFileInput) {
    bucketsFileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleBucketsFileUpload(e.target.files[0]);
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

  // [GUARDRAILS]
  if (guardrailsDropzone) initGuardrailsDragAndDrop();
  if (guardrailsFileInput) {
    guardrailsFileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleGuardrailsFileUpload(e.target.files[0]);
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

  // [BENEFICIARIES]
  if (beneficiaryDropzone) initBeneficiaryDragAndDrop();
  if (beneficiaryFileInput) {
    beneficiaryFileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleBeneficiaryFileUpload(e.target.files[0]);
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

  // [BILLING] (Upload)
  if (billingDropzone) initBillingDragAndDrop();
  if (billingFileInput) {
    billingFileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleBillingFileUpload(e.target.files[0]);
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

  // Wire Billing Type/Period controls for gating + visibility
  [billingTypeSelect, billingPeriodSelect, billingYearSelect, billingQuarterSelect, billingMonthSelect]
    .filter(Boolean)
    .forEach(sel => sel.addEventListener('change', () => {
      updateBillingPeriodVisibility();
      updateFooterButtons();
      // If user changes type while on mapping, update anchor label
      if (currentStepIndex === STEP.BILLING_MAPPING) updateBillingAnchorLabel();
    }));

  // [LIABILITY]
  if (liabilityDropzone) initLiabilityDragAndDrop();
  if (liabilityFileInput) {
    liabilityFileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleLiabilityFileUpload(e.target.files[0]);
    });
  }
  if (removeLiabilityFileButton) {
    removeLiabilityFileButton.addEventListener('click', () => {
      resetLiabilityUploadUI();
      liabilityFileInput.value = '';
      liabilityTempFilePath = '';
      updateFooterButtons();
    });
  }

  // [INSURANCE]
  if (insuranceDropzone) initInsuranceDragAndDrop();
  if (insuranceFileInput) {
    insuranceFileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) handleInsuranceFileUpload(e.target.files[0]);
    });
  }
  if (removeInsuranceFileButton) {
    removeInsuranceFileButton.addEventListener('click', () => {
      resetInsuranceUploadUI();
      if (insuranceFileInput) insuranceFileInput.value = '';
      insuranceTempFilePath = '';
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
      if (modalBody) modalBody.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Additional fields for Account
  if (toggleAccountAdditionalFieldsBtn && accountAdditionalFieldsCollapse) {
    accountAdditionalFieldsCollapse.addEventListener('shown.bs.collapse', () => {
      toggleAccountAdditionalFieldsBtn.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    accountAdditionalFieldsCollapse.addEventListener('hidden.bs.collapse', () => {
      const modalBody = importModal.querySelector('.modal-body');
      if (modalBody) modalBody.scrollTo({ top: 0, behavior: 'smooth' });
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

  // ────────────────────────────────────────────────────────────
  // NEXT: flow orchestration
  // ────────────────────────────────────────────────────────────
  function handleNext() {
    if (currentStepIndex === STEP.PICK) {
      if (!selectedImportType) { showAlert('danger', 'Please select a data type'); return; }
      if (selectedImportType === 'contact') slideToStep(STEP.PICK, STEP.CONTACT_INFO);
      else slideToStep(STEP.PICK, STEP.ACCOUNT_OPTIONS);
    }

    // ----------------------  CONTACT  ----------------------
    else if (currentStepIndex === STEP.CONTACT_INFO) {
      slideToStep(STEP.CONTACT_INFO, STEP.CONTACT_UPLOAD);
    }
    else if (currentStepIndex === STEP.CONTACT_UPLOAD) {
      if (!contactTempFilePath) { showAlert('danger', 'Please upload a contact file first.'); return; }
      slideToStep(STEP.CONTACT_UPLOAD, STEP.CONTACT_MAPPING);
      populateContactMappingSelects();
    }
    else if (currentStepIndex === STEP.CONTACT_MAPPING) {
      performContactImport();
    }

    // ----------------------  ACCOUNT OPTIONS  ----------------------
    else if (currentStepIndex === STEP.ACCOUNT_OPTIONS) {
      const chosen = document.querySelector('.data-option.account-option.selected');
      if (!chosen) { showAlert('danger','Please pick an account import type.'); return; }

      switch (chosen.dataset.accountType) {
        case 'general':       slideToStep(STEP.ACCOUNT_OPTIONS, STEP.ACCOUNT_GENERAL_INFO); break;
        case 'buckets':       slideToStep(STEP.ACCOUNT_OPTIONS, STEP.BUCKETS_INFO);         break;
        case 'guardrails':    slideToStep(STEP.ACCOUNT_OPTIONS, STEP.GUARDRAILS_INFO);      break;
        case 'beneficiaries': slideToStep(STEP.ACCOUNT_OPTIONS, STEP.BENEFICIARY_INFO);     break;
        case 'billing':       slideToStep(STEP.ACCOUNT_OPTIONS, STEP.BILLING_INFO);         break; // updated
        case 'liability':     slideToStep(STEP.ACCOUNT_OPTIONS, STEP.LIABILITY_INFO);       break;
        case 'insurance':     slideToStep(STEP.ACCOUNT_OPTIONS, STEP.INSURANCE_INFO);       break; // new
        case 'asset':         slideToStep(STEP.ACCOUNT_OPTIONS, STEP.ASSET_INFO);           break;
        default:              showAlert('danger','This feature is coming soon.');
      }
    }

    // ----------------------  GENERAL ACCOUNT  ----------------------
    else if (currentStepIndex === STEP.ACCOUNT_GENERAL_INFO) {
      slideToStep(STEP.ACCOUNT_GENERAL_INFO, STEP.ACCOUNT_UPLOAD);
    }
    else if (currentStepIndex === STEP.ACCOUNT_UPLOAD) {
      if (!accountTempFilePath) { showAlert('danger','Please upload an account file first.'); return; }
      slideToStep(STEP.ACCOUNT_UPLOAD, STEP.ACCOUNT_MAPPING);
      populateAccountMappingSelects();
    }
    else if (currentStepIndex === STEP.ACCOUNT_MAPPING) {
      performAccountImport();
    }

    // ----------------------  BUCKETS  ----------------------
    else if (currentStepIndex === STEP.BUCKETS_INFO) {
      slideToStep(STEP.BUCKETS_INFO, STEP.BUCKETS_UPLOAD);
    }
    else if (currentStepIndex === STEP.BUCKETS_UPLOAD) {
      if (!bucketsTempFilePath) { showAlert('danger','Please upload a Buckets file first.'); return; }
      slideToStep(STEP.BUCKETS_UPLOAD, STEP.BUCKETS_MAPPING);
      populateBucketsMappingSelects();
    }
    else if (currentStepIndex === STEP.BUCKETS_MAPPING) {
      performBucketsImport();
    }

    // ----------------------  GUARDRAILS  ----------------------
    else if (currentStepIndex === STEP.GUARDRAILS_INFO) {
      slideToStep(STEP.GUARDRAILS_INFO, STEP.GUARDRAILS_UPLOAD);
    }
    else if (currentStepIndex === STEP.GUARDRAILS_UPLOAD) {
      if (!guardrailsTempFilePath) { showAlert('danger','Please upload a Guardrails file first.'); return; }
      slideToStep(STEP.GUARDRAILS_UPLOAD, STEP.GUARDRAILS_MAPPING);
      populateGuardrailsMappingSelects();
    }
    else if (currentStepIndex === STEP.GUARDRAILS_MAPPING) {
      performGuardrailsImport();
    }

    // ----------------------  BENEFICIARIES  ----------------------
    else if (currentStepIndex === STEP.BENEFICIARY_INFO) {
      slideToStep(STEP.BENEFICIARY_INFO, STEP.BENEFICIARY_UPLOAD);
    }
    else if (currentStepIndex === STEP.BENEFICIARY_UPLOAD) {
      if (!beneficiaryTempFilePath) { showAlert('danger','Please upload a beneficiary file first.'); return; }
      slideToStep(STEP.BENEFICIARY_UPLOAD, STEP.BENEFICIARY_MAPPING);
      populateBeneficiaryMappingSelects();
    }
    else if (currentStepIndex === STEP.BENEFICIARY_MAPPING) {
      performBeneficiaryImport();
    }

    // ----------------------  BILLING  ----------------------
    else if (currentStepIndex === STEP.BILLING_INFO) {
      slideToStep(STEP.BILLING_INFO, STEP.BILLING_UPLOAD);
    }
    else if (currentStepIndex === STEP.BILLING_UPLOAD) {
      if (!isBillingUploadReady()) {
        showAlert('danger','Select Billing Type and complete the Billing Period, then upload a file.');
        return;
      }
      slideToStep(STEP.BILLING_UPLOAD, STEP.BILLING_MAPPING);
      populateBillingMappingSelects();
      updateBillingAnchorLabel();
    }
    else if (currentStepIndex === STEP.BILLING_MAPPING) {
      performBillingImport();
    }

    // ----------------------  LIABILITY  ----------------------
    else if (currentStepIndex === STEP.LIABILITY_INFO) {
      slideToStep(STEP.LIABILITY_INFO, STEP.LIABILITY_UPLOAD);
    }
    else if (currentStepIndex === STEP.LIABILITY_UPLOAD) {
      if (!liabilityTempFilePath) { showAlert('danger','Please upload a Liability file first.'); return; }
      slideToStep(STEP.LIABILITY_UPLOAD, STEP.LIABILITY_MAPPING);
      populateLiabilityMappingSelects();
    }
    else if (currentStepIndex === STEP.LIABILITY_MAPPING) {
      performLiabilityImport();
    }

    // ----------------------  INSURANCE  ----------------------
    else if (currentStepIndex === STEP.INSURANCE_INFO) {
      slideToStep(STEP.INSURANCE_INFO, STEP.INSURANCE_UPLOAD);
    }
    else if (currentStepIndex === STEP.INSURANCE_UPLOAD) {
      if (!insuranceTempFilePath) { showAlert('danger','Please upload an Insurance file first.'); return; }
      slideToStep(STEP.INSURANCE_UPLOAD, STEP.INSURANCE_MAPPING);
      populateInsuranceMappingSelects();
    }
    else if (currentStepIndex === STEP.INSURANCE_MAPPING) {
      performInsuranceImport();
    }

    // ----------------------  ASSET  ----------------------
    else if (currentStepIndex === STEP.ASSET_INFO) {
      slideToStep(STEP.ASSET_INFO, STEP.ASSET_UPLOAD);
    }
    else if (currentStepIndex === STEP.ASSET_UPLOAD) {
      if (!assetTempFilePath) { showAlert('danger','Please upload an Asset file first.'); return; }
      slideToStep(STEP.ASSET_UPLOAD, STEP.ASSET_MAPPING);
      populateAssetMappingSelects();
    }
    else if (currentStepIndex === STEP.ASSET_MAPPING) {
      performAssetImport();
    }
  }

  // ────────────────────────────────────────────────────────────
  // PREV: flow orchestration
  // ────────────────────────────────────────────────────────────
  function handlePrev() {
    // Contact flow
    if (currentStepIndex === STEP.CONTACT_INFO) {
      slideToStep(STEP.CONTACT_INFO, STEP.PICK);
    }
    else if (currentStepIndex === STEP.CONTACT_UPLOAD) {
      slideToStep(STEP.CONTACT_UPLOAD, STEP.CONTACT_INFO);
    }
    else if (currentStepIndex === STEP.CONTACT_MAPPING) {
      slideToStep(STEP.CONTACT_MAPPING, STEP.CONTACT_UPLOAD);
    }

    // Account flow (general branch)
    else if (currentStepIndex === STEP.ACCOUNT_OPTIONS) {
      slideToStep(STEP.ACCOUNT_OPTIONS, STEP.PICK);
    }
    else if (currentStepIndex === STEP.ACCOUNT_GENERAL_INFO) {
      slideToStep(STEP.ACCOUNT_GENERAL_INFO, STEP.ACCOUNT_OPTIONS);
    }
    else if (currentStepIndex === STEP.ACCOUNT_UPLOAD) {
      slideToStep(STEP.ACCOUNT_UPLOAD, STEP.ACCOUNT_GENERAL_INFO);
    }
    else if (currentStepIndex === STEP.ACCOUNT_MAPPING) {
      slideToStep(STEP.ACCOUNT_MAPPING, STEP.ACCOUNT_UPLOAD);
    }

    // Buckets
    else if (currentStepIndex === STEP.BUCKETS_INFO) {
      slideToStep(STEP.BUCKETS_INFO, STEP.ACCOUNT_OPTIONS);
    }
    else if (currentStepIndex === STEP.BUCKETS_UPLOAD) {
      slideToStep(STEP.BUCKETS_UPLOAD, STEP.BUCKETS_INFO);
    }
    else if (currentStepIndex === STEP.BUCKETS_MAPPING) {
      slideToStep(STEP.BUCKETS_MAPPING, STEP.BUCKETS_UPLOAD);
    }

    // Guardrails
    else if (currentStepIndex === STEP.GUARDRAILS_INFO) {
      slideToStep(STEP.GUARDRAILS_INFO, STEP.ACCOUNT_OPTIONS);
    }
    else if (currentStepIndex === STEP.GUARDRAILS_UPLOAD) {
      slideToStep(STEP.GUARDRAILS_UPLOAD, STEP.GUARDRAILS_INFO);
    }
    else if (currentStepIndex === STEP.GUARDRAILS_MAPPING) {
      slideToStep(STEP.GUARDRAILS_MAPPING, STEP.GUARDRAILS_UPLOAD);
    }

    // Beneficiaries
    else if (currentStepIndex === STEP.BENEFICIARY_INFO) {
      slideToStep(STEP.BENEFICIARY_INFO, STEP.ACCOUNT_OPTIONS);
    }
    else if (currentStepIndex === STEP.BENEFICIARY_UPLOAD) {
      slideToStep(STEP.BENEFICIARY_UPLOAD, STEP.BENEFICIARY_INFO);
    }
    else if (currentStepIndex === STEP.BENEFICIARY_MAPPING) {
      slideToStep(STEP.BENEFICIARY_MAPPING, STEP.BENEFICIARY_UPLOAD);
    }

    // Billing
    else if (currentStepIndex === STEP.BILLING_INFO) {
      slideToStep(STEP.BILLING_INFO, STEP.ACCOUNT_OPTIONS);
    }
    else if (currentStepIndex === STEP.BILLING_UPLOAD) {
      slideToStep(STEP.BILLING_UPLOAD, STEP.BILLING_INFO);
    }
    else if (currentStepIndex === STEP.BILLING_MAPPING) {
      slideToStep(STEP.BILLING_MAPPING, STEP.BILLING_UPLOAD);
    }

    // Liability
    else if (currentStepIndex === STEP.LIABILITY_INFO) {
      slideToStep(STEP.LIABILITY_INFO, STEP.ACCOUNT_OPTIONS);
    }
    else if (currentStepIndex === STEP.LIABILITY_UPLOAD) {
      slideToStep(STEP.LIABILITY_UPLOAD, STEP.LIABILITY_INFO);
    }
    else if (currentStepIndex === STEP.LIABILITY_MAPPING) {
      slideToStep(STEP.LIABILITY_MAPPING, STEP.LIABILITY_UPLOAD);
    }

    // Insurance
    else if (currentStepIndex === STEP.INSURANCE_INFO) {
      slideToStep(STEP.INSURANCE_INFO, STEP.ACCOUNT_OPTIONS);
    }
    else if (currentStepIndex === STEP.INSURANCE_UPLOAD) {
      slideToStep(STEP.INSURANCE_UPLOAD, STEP.INSURANCE_INFO);
    }
    else if (currentStepIndex === STEP.INSURANCE_MAPPING) {
      slideToStep(STEP.INSURANCE_MAPPING, STEP.INSURANCE_UPLOAD);
    }

    // Asset
    else if (currentStepIndex === STEP.ASSET_INFO) {
      slideToStep(STEP.ASSET_INFO, STEP.ACCOUNT_OPTIONS);
    }
    else if (currentStepIndex === STEP.ASSET_UPLOAD) {
      slideToStep(STEP.ASSET_UPLOAD, STEP.ASSET_INFO);
    }
    else if (currentStepIndex === STEP.ASSET_MAPPING) {
      slideToStep(STEP.ASSET_MAPPING, STEP.ASSET_UPLOAD);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // CONTACT Drag & Drop init
  // ─────────────────────────────────────────────────────────────
  function initContactDragAndDrop() {
    const preventDefaults = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => {
      contactDropzone.addEventListener(evt, preventDefaults, false);
    });
    ['dragenter','dragover'].forEach(evt => {
      contactDropzone.addEventListener(evt, () => contactDropzone.classList.add('drag-over'), false);
    });
    ['dragleave','drop'].forEach(evt => {
      contactDropzone.addEventListener(evt, () => contactDropzone.classList.remove('drag-over'), false);
    });
    contactDropzone.addEventListener('drop', e => {
      if (e.dataTransfer.files.length > 0) handleContactFileUpload(e.dataTransfer.files[0]);
    });
  }

  // General Account Drag & Drop init
  function initAccountDragAndDrop() {
    const preventDefaults = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => {
      accountDropzone.addEventListener(evt, preventDefaults, false);
    });
    ['dragenter','dragover'].forEach(evt => {
      accountDropzone.addEventListener(evt, () => accountDropzone.classList.add('drag-over'), false);
    });
    ['dragleave','drop'].forEach(evt => {
      accountDropzone.addEventListener(evt, () => accountDropzone.classList.remove('drag-over'), false);
    });
    accountDropzone.addEventListener('drop', e => {
      if (e.dataTransfer.files.length > 0) handleAccountFileUpload(e.dataTransfer.files[0]);
    });
  }

  // [BUCKETS] init
  function initBucketsDragAndDrop() {
    const preventDefaults = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => {
      bucketsDropzone.addEventListener(evt, preventDefaults, false);
    });
    ['dragenter','dragover'].forEach(evt => {
      bucketsDropzone.addEventListener(evt, () => bucketsDropzone.classList.add('drag-over'), false);
    });
    ['dragleave','drop'].forEach(evt => {
      bucketsDropzone.addEventListener(evt, () => bucketsDropzone.classList.remove('drag-over'), false);
    });
    bucketsDropzone.addEventListener('drop', e => {
      if (e.dataTransfer.files.length > 0) handleBucketsFileUpload(e.dataTransfer.files[0]);
    });
  }

  // [GUARDRAILS] init
  function initGuardrailsDragAndDrop() {
    const preventDefaults = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => {
      guardrailsDropzone.addEventListener(evt, preventDefaults, false);
    });
    ['dragenter','dragover'].forEach(evt => {
      guardrailsDropzone.addEventListener(evt, () => guardrailsDropzone.classList.add('drag-over'), false);
    });
    ['dragleave','drop'].forEach(evt => {
      guardrailsDropzone.addEventListener(evt, () => guardrailsDropzone.classList.remove('drag-over'), false);
    });
    guardrailsDropzone.addEventListener('drop', e => {
      if (e.dataTransfer.files.length > 0) handleGuardrailsFileUpload(e.dataTransfer.files[0]);
    });
  }

  // [BENEFICIARIES] init
  function initBeneficiaryDragAndDrop() {
    const preventDefaults = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => {
      beneficiaryDropzone.addEventListener(evt, preventDefaults, false);
    });
    ['dragenter','dragover'].forEach(evt => {
      beneficiaryDropzone.addEventListener(evt, () => beneficiaryDropzone.classList.add('drag-over'), false);
    });
    ['dragleave','drop'].forEach(evt => {
      beneficiaryDropzone.addEventListener(evt, () => beneficiaryDropzone.classList.remove('drag-over'), false);
    });
    beneficiaryDropzone.addEventListener('drop', e => {
      if (e.dataTransfer.files.length > 0) handleBeneficiaryFileUpload(e.dataTransfer.files[0]);
    });
  }

  // [BILLING] init
  function initBillingDragAndDrop() {
    const preventDefaults = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach(evt => {
      billingDropzone.addEventListener(evt, preventDefaults, false);
    });
    ['dragenter','dragover'].forEach(evt => {
      billingDropzone.addEventListener(evt, () => billingDropzone.classList.add('drag-over'), false);
    });
    ['dragleave','drop'].forEach(evt => {
      billingDropzone.addEventListener(evt, () => billingDropzone.classList.remove('drag-over'), false);
    });
    billingDropzone.addEventListener('drop', e => {
      if (e.dataTransfer.files.length > 0) handleBillingFileUpload(e.dataTransfer.files[0]);
    });
  }

  // [LIABILITY] init
  function initLiabilityDragAndDrop() {
    const prevent = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach(evt =>
      liabilityDropzone.addEventListener(evt, prevent));
    ['dragenter','dragover'].forEach(evt =>
      liabilityDropzone.addEventListener(evt, () => liabilityDropzone.classList.add('drag-over')));
    ['dragleave','drop'].forEach(evt =>
      liabilityDropzone.addEventListener(evt, () => liabilityDropzone.classList.remove('drag-over')));
    liabilityDropzone.addEventListener('drop', e => {
      if (e.dataTransfer.files.length) handleLiabilityFileUpload(e.dataTransfer.files[0]);
    });
  }

  // [INSURANCE] init
  function initInsuranceDragAndDrop() {
    const prevent = e => { e.preventDefault(); e.stopPropagation(); };
    ['dragenter','dragover','dragleave','drop'].forEach(evt =>
      insuranceDropzone.addEventListener(evt, prevent));
    ['dragenter','dragover'].forEach(evt =>
      insuranceDropzone.addEventListener(evt, () => insuranceDropzone.classList.add('drag-over')));
    ['dragleave','drop'].forEach(evt =>
      insuranceDropzone.addEventListener(evt, () => insuranceDropzone.classList.remove('drag-over')));
    insuranceDropzone.addEventListener('drop', e => {
      if (e.dataTransfer.files.length) handleInsuranceFileUpload(e.dataTransfer.files[0]);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Liability upload
  // ─────────────────────────────────────────────────────────────
  function handleLiabilityFileUpload(file) {
    if (!file) return;
    liabilityUploadBox.classList.add('hidden');
    liabilityUploadProgressContainer.classList.remove('hidden');
    nextBtn.disabled = true;

    const fd = new FormData();
    fd.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/new-import/account/file');
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        liabilityProgressBar.style.width = pct + '%';
        liabilityProgressBar.textContent = pct + '%';
      }
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        const resp = JSON.parse(xhr.responseText);
        liabilityHeaders      = resp.headers || [];
        liabilityTempFilePath = resp.tempFile || '';
        liabilityS3Key        = resp.s3Key   || '';
        liabilityUploadProgressContainer.classList.add('hidden');
        liabilityUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else showAlert('danger','Error uploading Liability file');
    };
    xhr.onerror = () => showAlert('danger','Upload failed');
    xhr.send(fd);
  }

  function populateLiabilityMappingSelects() {
    if (!liabilityHeaders.length) return;
    const cont = document.getElementById('liability-mapping-fields-container');
    if (!cont) return;
    const selects = cont.querySelectorAll('select');
    selects.forEach(sel => {
      sel.innerHTML = '<option value="">-- Select Column --</option>';
      liabilityHeaders.forEach(h => {
        const o = document.createElement('option'); o.value = h; o.textContent = h;
        sel.appendChild(o);
      });
    });
    synchronizeLiabilityColumns();
    selects.forEach(sel => sel.addEventListener('change', () => {
      synchronizeLiabilityColumns(); updateFooterButtons();
    }));
  }

  function synchronizeLiabilityColumns() {
    const cont = document.getElementById('liability-mapping-fields-container');
    if (!cont) return;
    const selects = cont.querySelectorAll('select');
    const chosen  = Array.from(selects).map(s => s.value).filter(v => v);
    selects.forEach(sel => {
      const curr = sel.value;
      Array.from(sel.options).forEach(opt => {
        if (!opt.value)          opt.disabled = false;
        else if (opt.value === curr) opt.disabled = false;
        else                     opt.disabled = chosen.includes(opt.value);
      });
    });
  }

  function performLiabilityImport() {
    const cont = document.getElementById('liability-mapping-fields-container');
    if (!cont) return;
    const req = cont.querySelector('select[name="accountLoanNumber"][data-required="true"]');
    if (!req || !req.value) { showAlert('danger','Please map Account/Loan Number'); return; }

    const mapping = {};
    cont.querySelectorAll('select').forEach(sel => {
      if (sel.value) mapping[sel.name] = liabilityHeaders.indexOf(sel.value);
    });

    const bodyData = {
      mapping,
      tempFile   : liabilityTempFilePath,
      s3Key      : liabilityS3Key,
      importType : 'liability'
    };

    bootstrap.Modal.getInstance(importModal)?.hide();
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      progressContainer.classList.remove('hidden');
      const hdr = progressContainer.querySelector('.progress-header h5.progress-title');
      if (hdr) hdr.textContent = 'Liability Import';
    }

    fetch('/api/new-import/account/process', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(bodyData)
    }).catch(err => { console.error(err); showAlert('danger','Error initiating Liability import'); });
  }

  // ─────────────────────────────────────────────────────────────
  // Asset helpers
  // ─────────────────────────────────────────────────────────────
  function handleAssetFileUpload(file) {
    if (!file) return;
    assetUploadBox.classList.add('hidden');
    assetUploadProgressContainer.classList.remove('hidden');
    nextBtn.disabled = true;

    const fd = new FormData(); fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/new-import/account/file');
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        assetProgressBar.style.width = pct + '%';
        assetProgressBar.textContent = pct + '%';
      }
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        const resp = JSON.parse(xhr.responseText);
        assetHeaders      = resp.headers || [];
        assetTempFilePath = resp.tempFile || '';
        assetS3Key        = resp.s3Key   || '';
        assetUploadProgressContainer.classList.add('hidden');
        assetUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else showAlert('danger','Error uploading Asset file');
    };
    xhr.onerror = () => showAlert('danger','Upload failed');
    xhr.send(fd);
  }

  function populateAssetMappingSelects() {
    if (!assetHeaders.length) return;
    const cont = document.getElementById('asset-mapping-fields-container');
    if (!cont) return;
    const selects = cont.querySelectorAll('select');
    selects.forEach(sel => {
      sel.innerHTML = '<option value="">-- Select Column --</option>';
      assetHeaders.forEach(h => {
        const o = document.createElement('option'); o.value = h; o.textContent = h;
        sel.appendChild(o);
      });
    });
    synchronizeAssetColumns();
    selects.forEach(sel => sel.addEventListener('change', () => {
      synchronizeAssetColumns(); updateFooterButtons();
    }));
  }

  function synchronizeAssetColumns() {
    const cont = document.getElementById('asset-mapping-fields-container');
    if (!cont) return;
    const selects = cont.querySelectorAll('select');
    const chosen  = Array.from(selects).map(s => s.value).filter(v => v);
    selects.forEach(sel => {
      const curr = sel.value;
      Array.from(sel.options).forEach(opt => {
        if (!opt.value) opt.disabled = false;
        else if (opt.value === curr) opt.disabled = false;
        else opt.disabled = chosen.includes(opt.value);
      });
    });
  }

  function performAssetImport() {
    const cont = document.getElementById('asset-mapping-fields-container');
    if (!cont) return;
    const req = cont.querySelector('select[name="assetNumber"][data-required="true"]');
    if (!req || !req.value) { showAlert('danger','Please map Asset Number'); return; }

    const mapping = {};
    cont.querySelectorAll('select').forEach(sel => {
      if (sel.value) mapping[sel.name] = assetHeaders.indexOf(sel.value);
    });

    const bodyData = {
      mapping,
      tempFile   : assetTempFilePath,
      s3Key      : assetS3Key,
      importType : 'asset'
    };

    bootstrap.Modal.getInstance(importModal)?.hide();
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      progressContainer.classList.remove('hidden');
      const hdr = progressContainer.querySelector('.progress-header h5.progress-title');
      if (hdr) hdr.textContent = 'Asset Import';
    }

    fetch('/api/new-import/account/process', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(bodyData)
    }).catch(err => { console.error(err); showAlert('danger','Error initiating Asset import'); });
  }

  // ─────────────────────────────────────────────────────────────
  // CONTACT upload
  // ─────────────────────────────────────────────────────────────
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
        contactS3Key = resp.s3Key || '';
        contactUploadProgressContainer.classList.add('hidden');
        contactUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else {
        showAlert('danger', 'Error uploading contact file');
      }
    };
    xhr.onerror = () => showAlert('danger', 'Upload request failed');
    xhr.send(formData);
  }

  // ─────────────────────────────────────────────────────────────
  // Account (general) upload
  // ─────────────────────────────────────────────────────────────
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
        accountS3Key = resp.s3Key || '';
        accountUploadProgressContainer.classList.add('hidden');
        accountUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else {
        showAlert('danger', 'Error uploading account file');
      }
    };
    xhr.onerror = () => showAlert('danger', 'Upload request failed');
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
        bucketsS3Key = resp.s3Key || '';
        bucketsUploadProgressContainer.classList.add('hidden');
        bucketsUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else {
        showAlert('danger','Error uploading Buckets file');
      }
    };
    xhr.onerror = () => showAlert('danger','Upload request failed');
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
        guardrailsS3Key = resp.s3Key || '';
        guardrailsUploadProgressContainer.classList.add('hidden');
        guardrailsUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else {
        showAlert('danger','Error uploading Guardrails file');
      }
    };
    xhr.onerror = () => showAlert('danger','Upload request failed');
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
        beneficiaryS3Key = resp.s3Key || '';
        beneficiaryUploadProgressContainer.classList.add('hidden');
        beneficiaryUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else {
        showAlert('danger', 'Error uploading beneficiary file');
      }
    };
    xhr.onerror = () => showAlert('danger', 'Upload request failed');
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
        billingS3Key = resp.s3Key || '';
        billingUploadProgressContainer.classList.add('hidden');
        billingUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else {
        showAlert('danger','Error uploading billing file');
      }
    };
    xhr.onerror = () => showAlert('danger','Upload request failed');
    xhr.send(formData);
  }

  // [INSURANCE]
  function handleInsuranceFileUpload(file) {
    if (!file) return;
    insuranceUploadBox.classList.add('hidden');
    insuranceUploadProgressContainer.classList.remove('hidden');
    insuranceUploadCompletedContainer.classList.add('hidden');
    nextBtn.disabled = true;

    const fd = new FormData();
    fd.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/new-import/account/file');
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        insuranceProgressBar.style.width = pct + '%';
        insuranceProgressBar.textContent = pct + '%';
      }
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        const resp = JSON.parse(xhr.responseText);
        insuranceHeaders      = resp.headers || [];
        insuranceTempFilePath = resp.tempFile || '';
        insuranceS3Key        = resp.s3Key   || '';
        insuranceUploadProgressContainer.classList.add('hidden');
        insuranceUploadCompletedContainer.classList.remove('hidden');
        updateFooterButtons();
      } else showAlert('danger','Error uploading Insurance file');
    };
    xhr.onerror = () => showAlert('danger','Upload failed');
    xhr.send(fd);
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

  // populateAccountMappingSelects (General)
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

  // [BUCKETS]
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

  // [GUARDRAILS]
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

  // [BENEFICIARIES]
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

  // [BILLING] populate mapping (only 2 fields)
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

  // [INSURANCE] populate mapping
  function populateInsuranceMappingSelects() {
    if (!insuranceHeaders.length) return;
    const cont = document.getElementById('insurance-mapping-fields-container');
    if (!cont) return;

    const selects = cont.querySelectorAll('select');
    selects.forEach(sel => {
      sel.innerHTML = '<option value="">-- Select Column --</option>';
      insuranceHeaders.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        sel.appendChild(opt);
      });
    });
    synchronizeInsuranceColumns();
    selects.forEach(sel => sel.addEventListener('change', () => {
      synchronizeInsuranceColumns(); updateFooterButtons();
    }));
  }

  // synchronizeContactColumns
  function synchronizeContactColumns() {
    const selects = contactMappingFieldsContainer.querySelectorAll('select');
    const selectedValues = Array.from(selects).map(s => s.value).filter(v => v);
    selects.forEach(sel => {
      const curr = sel.value;
      Array.from(sel.options).forEach(opt => {
        if (!opt.value)      opt.disabled = false;
        else if (opt.value === curr) opt.disabled = false;
        else                 opt.disabled = selectedValues.includes(opt.value);
      });
    });
  }

  // synchronizeAccountColumns (General)
  function synchronizeAccountColumns() {
    const container = document.getElementById('account-mapping-fields-container');
    if (!container) return;
    const selects = container.querySelectorAll('select');
    const selectedValues = Array.from(selects).map(s => s.value).filter(v => v);
    selects.forEach(sel => {
      const curr = sel.value;
      Array.from(sel.options).forEach(opt => {
        if (!opt.value)      opt.disabled = false;
        else if (opt.value === curr) opt.disabled = false;
        else                 opt.disabled = selectedValues.includes(opt.value);
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
        if (!opt.value)      opt.disabled = false;
        else if (opt.value === curr) opt.disabled = false;
        else                 opt.disabled = selectedValues.includes(opt.value);
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
        if (!opt.value)      opt.disabled = false;
        else if (opt.value === curr) opt.disabled = false;
        else                 opt.disabled = selectedValues.includes(opt.value);
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
        if (!opt.value)      opt.disabled = false;
        else if (opt.value === curr) opt.disabled = false;
        else                 opt.disabled = selectedValues.includes(opt.value);
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
        if (!opt.value)      opt.disabled = false;
        else if (opt.value === curr) opt.disabled = false;
        else                 opt.disabled = selectedValues.includes(opt.value);
      });
    });
  }

  // [INSURANCE]
  function synchronizeInsuranceColumns() {
    const cont = document.getElementById('insurance-mapping-fields-container');
    if (!cont) return;
    const selects = cont.querySelectorAll('select');
    const chosen  = Array.from(selects).map(s => s.value).filter(v => v);
    selects.forEach(sel => {
      const curr = sel.value;
      Array.from(sel.options).forEach(opt => {
        if (!opt.value)          opt.disabled = false;
        else if (opt.value === curr) opt.disabled = false;
        else                     opt.disabled = chosen.includes(opt.value);
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
      s3Key: contactS3Key,
      nameMode
    };

    const importModalInstance = bootstrap.Modal.getInstance(importModal);
    if (importModalInstance) importModalInstance.hide();

    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) progressContainer.classList.remove('hidden');
    const progressHeader = progressContainer.querySelector('.progress-header h5.progress-title');
    if (progressHeader) progressHeader.textContent = 'Contact Import';

    fetch('/api/new-import/contact/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    }).catch(err => {
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
      if (!sel.value) { showAlert('danger','Please fill all required fields before importing.'); return; }
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
            if (colIndex >= 0) mapping[field].push(colIndex);
          }
        });
      }
    })
    const asOfDateInput = document.getElementById('asOfDateInput');
    const asOfDate = asOfDateInput ? asOfDateInput.value : '';

    const bodyData = {
      mapping,
      tempFile: accountTempFilePath,
      s3Key: accountS3Key,
      asOfDate
    };

    const importModalInstance = bootstrap.Modal.getInstance(importModal);
    if (importModalInstance) importModalInstance.hide();

    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) progressContainer.classList.remove('hidden');
    const progressHeader = progressContainer.querySelector('.progress-header h5.progress-title');
    if (progressHeader) progressHeader.textContent = 'Account Import';

    fetch('/api/new-import/account/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    }).catch(err => {
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
      if (!sel.value) { showAlert('danger','Please fill all required fields before importing.'); return; }
    }

    const mapping = {};
    const allocationFields = ['cash','income','annuities','growth'];
    const allSelects = container.querySelectorAll('select');

    allSelects.forEach(sel => {
      if (allocationFields.includes(sel.name)) return;
      if (sel.value) mapping[sel.name] = bucketsHeaders.indexOf(sel.value);
    });

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

    const asOfDate = bucketsAsOfInput ? bucketsAsOfInput.value : '';

    const bodyData = {
      mapping,
      tempFile: bucketsTempFilePath,
      s3Key: bucketsS3Key,
      asOfDate
    };

    bootstrap.Modal.getInstance(importModal)?.hide();
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) progressContainer.classList.remove('hidden');
    const progressHeader = progressContainer.querySelector('.progress-header h5.progress-title');
    if (progressHeader) progressHeader.textContent = 'Buckets Import';

    fetch('/api/new-import/account/process', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    }).catch(err => {
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
      if (!sel.value) { showAlert('danger','Please fill all required fields before importing.'); return; }
    }

    const mapping = {};
    const allSelects = container.querySelectorAll('select');
    allSelects.forEach(sel => {
      if (sel.value) mapping[sel.name] = guardrailsHeaders.indexOf(sel.value);
    });

    const asOfDate = guardrailsAsOfInput ? guardrailsAsOfInput.value : '';

    const bodyData = {
      mapping,
      tempFile: guardrailsTempFilePath,
      s3Key: guardrailsS3Key,
      asOfDate
    };

    bootstrap.Modal.getInstance(importModal)?.hide();
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) progressContainer.classList.remove('hidden');
    const progressHeader = progressContainer.querySelector('.progress-header h5.progress-title');
    if (progressHeader) progressHeader.textContent = 'Guardrails Import';

    fetch('/api/new-import/account/process', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    }).catch(err => {
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
      if (sel.value) mapping[sel.name] = beneficiaryHeaders.indexOf(sel.value);
    });

    const bodyData = {
      mapping,
      tempFile: beneficiaryTempFilePath,
      s3Key: beneficiaryS3Key,
      importType: 'beneficiaries'
    };

    bootstrap.Modal.getInstance(importModal)?.hide();
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) progressContainer.classList.remove('hidden');
    const progressHeader = progressContainer.querySelector('.progress-header h5.progress-title');
    if (progressHeader) progressHeader.textContent = 'Beneficiary Import';

    fetch('/api/new-import/account/process', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    }).catch(err => {
      console.error(err);
      showAlert('danger','Error initiating the Beneficiary import.');
    });
  }

  // [BILLING] - new import (anchor + amount only, plus meta)
  function performBillingImport() {
    const container = document.getElementById('billing-mapping-fields-container');
    if (!container) return;
  
    const anchorSel = document.getElementById('billing-anchor-select');
    const amountSel = document.getElementById('billing-amount-select');
  
    if (!anchorSel || !anchorSel.value || !amountSel || !amountSel.value) {
      showAlert('danger','Please map both the Anchor ID and Amount columns.');
      return;
    }
  
    // Canonical key based on Billing Type
    const typeRaw = billingTypeSelect ? billingTypeSelect.value : '';
    const billingType = (typeRaw === 'Household') ? 'household' : 'account';
    const anchorKey   = (billingType === 'household') ? 'householdId' : 'accountNumber';
  
    const mapping = {};
    mapping[anchorKey] = billingHeaders.indexOf(anchorSel.value);
    mapping.amount     = billingHeaders.indexOf(amountSel.value);
  
    // >>> NEW: send canonical period string the server expects
    const billingPeriod = buildBillingPeriodKey();
  
    const bodyData = {
      mapping,
      tempFile    : billingTempFilePath,
      s3Key       : billingS3Key,
      importType  : 'billing',
      billingType,                 // 'household' | 'account'
      billingPeriod,               // 'YYYY-Q#' | 'YYYY-MM' | 'YYYY'
      billingMeta : getBillingMeta() // keep sending for completeness/analytics
    };
  
    bootstrap.Modal.getInstance(importModal)?.hide();
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) progressContainer.classList.remove('hidden');
    const progressHeader = progressContainer.querySelector('.progress-header h5.progress-title');
    if (progressHeader) progressHeader.textContent = 'Billing Import';
  
    fetch('/api/new-import/account/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    }).catch(err => {
      console.error(err);
      showAlert('danger','Error initiating the Billing import.');
    });
  }
  

  // [INSURANCE] - import (Policy Number required)
  function performInsuranceImport() {
    const cont = document.getElementById('insurance-mapping-fields-container');
    if (!cont) return;
    const req = cont.querySelector('select[name="policyNumber"][data-required="true"]');
    if (!req || !req.value) { showAlert('danger','Please map Policy Number (required).'); return; }

    const mapping = {};
    cont.querySelectorAll('select').forEach(sel => {
      if (sel.value) mapping[sel.name] = insuranceHeaders.indexOf(sel.value);
    });

    const bodyData = {
      mapping,
      tempFile   : insuranceTempFilePath,
      s3Key      : insuranceS3Key,
      importType : 'insurance'
    };

    bootstrap.Modal.getInstance(importModal)?.hide();
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      progressContainer.classList.remove('hidden');
      const hdr = progressContainer.querySelector('.progress-header h5.progress-title');
      if (hdr) hdr.textContent = 'Insurance Import';
    }

    fetch('/api/new-import/account/process', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(bodyData)
    }).catch(err => { console.error(err); showAlert('danger','Error initiating Insurance import'); });
  }

  // ─────────────────────────────────────────────────────────────
  // slideToStep (animations preserved)
  // ─────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────
  // Reset helpers
  // ─────────────────────────────────────────────────────────────
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
    billingHeaders = [];
    resetBillingUploadUI();
    if (billingTypeSelect) billingTypeSelect.value = '';
    if (billingPeriodSelect) billingPeriodSelect.value = '';
    if (billingYearSelect) billingYearSelect.value = '';
    if (billingQuarterSelect) billingQuarterSelect.value = '';
    if (billingMonthSelect) billingMonthSelect.value = '';
    updateBillingPeriodVisibility();

    // [LIABILITY]
    liabilityTempFilePath = '';
    liabilityHeaders = [];
    resetLiabilityUploadUI();

    // [INSURANCE]
    insuranceTempFilePath = '';
    insuranceHeaders = [];
    resetInsuranceUploadUI();
    if (insuranceFileInput) insuranceFileInput.value = '';

    // [ASSET]
    assetTempFilePath = '';
    assetHeaders = [];
    resetAssetUploadUI();

    steps.forEach((step, idx) => {
      step.classList.toggle('hidden', idx !== STEP.PICK);
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
      if (collapseEl && additionalFieldsCollapse.classList.contains('show')) collapseEl.hide();
    }
    if (accountAdditionalFieldsCollapse) {
      const collapseAcc = bootstrap.Collapse.getInstance(accountAdditionalFieldsCollapse);
      if (collapseAcc && accountAdditionalFieldsCollapse.classList.contains('show')) collapseAcc.hide();
    }

    updateFooterButtons();
  }

  function resetUploadStates() {
    resetContactUploadUI();
    resetAccountUploadUI();
    resetBucketsUploadUI();
    resetGuardrailsUploadUI();
    resetBeneficiaryUploadUI();
    resetBillingUploadUI();
    resetLiabilityUploadUI();
    resetInsuranceUploadUI();
    resetAssetUploadUI();
  }

  function resetContactUploadUI() {
    if (contactUploadBox) contactUploadBox.classList.remove('hidden');
    if (contactUploadProgressContainer) contactUploadProgressContainer.classList.add('hidden');
    if (contactUploadCompletedContainer) contactUploadCompletedContainer.classList.add('hidden');
    if (contactUploadProgressBar) {
      contactUploadProgressBar.style.width = '0%';
      contactUploadProgressBar.textContent = '0%';
    }
  }

  function resetAccountUploadUI() {
    if (accountUploadBox) accountUploadBox.classList.remove('hidden');
    if (accountUploadProgressContainer) accountUploadProgressContainer.classList.add('hidden');
    if (accountUploadCompletedContainer) accountUploadCompletedContainer.classList.add('hidden');
    if (accountUploadProgressBar) {
      accountUploadProgressBar.style.width = '0%';
      accountUploadProgressBar.textContent = '0%';
    }
  }

  function resetBucketsUploadUI() {
    if (bucketsUploadBox) bucketsUploadBox.classList.remove('hidden');
    if (bucketsUploadProgressContainer) bucketsUploadProgressContainer.classList.add('hidden');
    if (bucketsUploadCompletedContainer) bucketsUploadCompletedContainer.classList.add('hidden');
    if (bucketsUploadProgressBar) {
      bucketsUploadProgressBar.style.width = '0%';
      bucketsUploadProgressBar.textContent = '0%';
    }
  }

  function resetGuardrailsUploadUI() {
    if (guardrailsUploadBox) guardrailsUploadBox.classList.remove('hidden');
    if (guardrailsUploadProgressContainer) guardrailsUploadProgressContainer.classList.add('hidden');
    if (guardrailsUploadCompletedContainer) guardrailsUploadCompletedContainer.classList.add('hidden');
    if (guardrailsUploadProgressBar) {
      guardrailsUploadProgressBar.style.width = '0%';
      guardrailsUploadProgressBar.textContent = '0%';
    }
  }

  function resetBeneficiaryUploadUI() {
    if (beneficiaryUploadBox) beneficiaryUploadBox.classList.remove('hidden');
    if (beneficiaryUploadProgressContainer) beneficiaryUploadProgressContainer.classList.add('hidden');
    if (beneficiaryUploadCompletedContainer) beneficiaryUploadCompletedContainer.classList.add('hidden');
    if (beneficiaryUploadProgressBar) {
      beneficiaryUploadProgressBar.style.width = '0%';
      beneficiaryUploadProgressBar.textContent = '0%';
    }
  }

  function resetBillingUploadUI() {
    if (billingUploadBox) billingUploadBox.classList.remove('hidden');
    if (billingUploadProgressContainer) billingUploadProgressContainer.classList.add('hidden');
    if (billingUploadCompletedContainer) billingUploadCompletedContainer.classList.add('hidden');
    if (billingUploadProgressBar) {
      billingUploadProgressBar.style.width = '0%';
      billingUploadProgressBar.textContent = '0%';
    }
  }

  function resetLiabilityUploadUI() {
    if (liabilityUploadBox) liabilityUploadBox.classList.remove('hidden');
    if (liabilityUploadProgressContainer) liabilityUploadProgressContainer.classList.add('hidden');
    if (liabilityUploadCompletedContainer) liabilityUploadCompletedContainer.classList.add('hidden');
    if (liabilityProgressBar) {
      liabilityProgressBar.style.width = '0%';
      liabilityProgressBar.textContent = '0%';
    }
  }

  function resetInsuranceUploadUI() {
    if (insuranceUploadBox) insuranceUploadBox.classList.remove('hidden');
    if (insuranceUploadProgressContainer) insuranceUploadProgressContainer.classList.add('hidden');
    if (insuranceUploadCompletedContainer) insuranceUploadCompletedContainer.classList.add('hidden');
    if (insuranceProgressBar) {
      insuranceProgressBar.style.width = '0%';
      insuranceProgressBar.textContent = '0%';
    }
  }

  function resetAssetUploadUI() {
    if (assetUploadBox) assetUploadBox.classList.remove('hidden');
    if (assetUploadProgressContainer) assetUploadProgressContainer.classList.add('hidden');
    if (assetUploadCompletedContainer) assetUploadCompletedContainer.classList.add('hidden');
    if (assetProgressBar) {
      assetProgressBar.style.width = '0%';
      assetProgressBar.textContent = '0%';
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Billing helpers (validation + label + meta)
  // ─────────────────────────────────────────────────────────────
  function updateBillingPeriodVisibility() {
    if (!billingPeriodSelect) return;
    const g = billingPeriodSelect.value; // '', 'Month', 'Quarter', 'Year'
    if (billingQuarterContainer) billingQuarterContainer.classList.toggle('hidden', g !== 'Quarter');
    if (billingMonthContainer) billingMonthContainer.classList.toggle('hidden', g !== 'Month');
    // Clear hidden controls to avoid stale gating
    if (g !== 'Quarter' && billingQuarterSelect) billingQuarterSelect.value = '';
    if (g !== 'Month'   && billingMonthSelect)   billingMonthSelect.value   = '';
  }

  function isBillingUploadReady() {
    // Need: Type, valid period selection, file uploaded
    const hasFile = !!billingTempFilePath;
    const typeOk = billingTypeSelect && !!billingTypeSelect.value;

    let periodOk = false;
    if (billingPeriodSelect && billingPeriodSelect.value) {
      const g = billingPeriodSelect.value;
      const y = billingYearSelect ? billingYearSelect.value : '';
      if (g === 'Year')     periodOk = !!y;
      else if (g === 'Month')   periodOk = !!(y && billingMonthSelect && billingMonthSelect.value);
      else if (g === 'Quarter') periodOk = !!(y && billingQuarterSelect && billingQuarterSelect.value);
      else periodOk = false;
    }
    return !!(hasFile && typeOk && periodOk);
  }

  function getBillingMeta() {
    const billingType = billingTypeSelect ? billingTypeSelect.value : '';
    const g = billingPeriodSelect ? billingPeriodSelect.value : '';
    const year = billingYearSelect ? billingYearSelect.value : '';
    const month = (g === 'Month'   && billingMonthSelect)   ? billingMonthSelect.value   : '';
    const quarter = (g === 'Quarter' && billingQuarterSelect) ? billingQuarterSelect.value : '';
    return {
      billingType,
      period: {
        granularity: g ? g.toLowerCase() : '',
        year, month, quarter
      }
    };
  }

  function updateBillingAnchorLabel() {
    const labelEl = document.getElementById('billing-anchor-label');
    if (!labelEl) return;
    const type = billingTypeSelect ? billingTypeSelect.value : '';
    labelEl.textContent = (type === 'Household') ? 'Household ID' : 'Account Number';
  }

  // ─────────────────────────────────────────────────────────────
  // Footer buttons (gating)
  // ─────────────────────────────────────────────────────────────
  function updateFooterButtons() {
    if (currentStepIndex === STEP.PICK) {
      prevBtn.classList.add('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !selectedImportType;
    }
    else if (currentStepIndex === STEP.CONTACT_INFO) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = false;
    }
    else if (currentStepIndex === STEP.CONTACT_UPLOAD) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !contactTempFilePath;
    }
    else if (currentStepIndex === STEP.CONTACT_MAPPING) {
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
    else if (currentStepIndex === STEP.ACCOUNT_OPTIONS) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      const chosenAccountOption = document.querySelector('.data-option.account-option.selected');
      nextBtn.disabled = !chosenAccountOption;
    }
    else if (
      currentStepIndex === STEP.ACCOUNT_GENERAL_INFO ||
      currentStepIndex === STEP.BUCKETS_INFO         ||
      currentStepIndex === STEP.GUARDRAILS_INFO      ||
      currentStepIndex === STEP.BENEFICIARY_INFO     ||
      currentStepIndex === STEP.LIABILITY_INFO       ||
      currentStepIndex === STEP.INSURANCE_INFO       || // new
      currentStepIndex === STEP.ASSET_INFO
    ) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = false;
    }
    else if (currentStepIndex === STEP.ACCOUNT_UPLOAD) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !accountTempFilePath;
    }
    else if (currentStepIndex === STEP.ACCOUNT_MAPPING) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Import';
      nextBtn.disabled = false; // keep pattern
    }
    else if (currentStepIndex === STEP.BUCKETS_UPLOAD) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !bucketsTempFilePath;
    }
    else if (currentStepIndex === STEP.BUCKETS_MAPPING) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Import';
      const container = document.getElementById('buckets-mapping-fields-container');
      if (!container) { nextBtn.disabled = true; return; }
      const requiredSelects = container.querySelectorAll('select[data-required="true"]');
      let allReq = true;
      requiredSelects.forEach(sel => { if (!sel.value) allReq = false; });
      nextBtn.disabled = !allReq;
    }
    else if (currentStepIndex === STEP.GUARDRAILS_UPLOAD) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !guardrailsTempFilePath;
    }
    else if (currentStepIndex === STEP.GUARDRAILS_MAPPING) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Import';
      const container = document.getElementById('guardrails-mapping-fields-container');
      if (!container) { nextBtn.disabled = true; return; }
      const requiredSelects = container.querySelectorAll('select[data-required="true"]');
      let allReq = true;
      requiredSelects.forEach(sel => { if (!sel.value) allReq = false; });
      nextBtn.disabled = !allReq;
    }
    else if (currentStepIndex === STEP.BENEFICIARY_UPLOAD) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !beneficiaryTempFilePath;
    }
    else if (currentStepIndex === STEP.BENEFICIARY_MAPPING) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Import';
      const container = document.getElementById('beneficiary-mapping-fields-container');
      if (!container) { nextBtn.disabled = true; return; }
      const requiredSelect = container.querySelector('select[name="accountNumber"][data-required="true"]');
      nextBtn.disabled = !(requiredSelect && requiredSelect.value);
    }
    else if (currentStepIndex === STEP.BILLING_INFO) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = false;
    }
    else if (currentStepIndex === STEP.BILLING_UPLOAD) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !isBillingUploadReady();
    }
    else if (currentStepIndex === STEP.BILLING_MAPPING) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Import';
      const anchorSel = document.getElementById('billing-anchor-select');
      const amountSel = document.getElementById('billing-amount-select');
      nextBtn.disabled = !(anchorSel && anchorSel.value && amountSel && amountSel.value);
    }
    else if (currentStepIndex === STEP.LIABILITY_UPLOAD) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !liabilityTempFilePath;
    }
    else if (currentStepIndex === STEP.LIABILITY_MAPPING) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Import';
      const cont = document.getElementById('liability-mapping-fields-container');
      const req  = cont?.querySelector('select[name="accountLoanNumber"][data-required="true"]');
      nextBtn.disabled = !(req && req.value);
    }
    else if (currentStepIndex === STEP.INSURANCE_UPLOAD) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !insuranceTempFilePath;
    }
    else if (currentStepIndex === STEP.INSURANCE_MAPPING) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Import';
      const cont = document.getElementById('insurance-mapping-fields-container');
      const req  = cont?.querySelector('select[name="policyNumber"][data-required="true"]');
      nextBtn.disabled = !(req && req.value);
    }
    else if (currentStepIndex === STEP.ASSET_UPLOAD) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Next';
      nextBtn.disabled = !assetTempFilePath;
    }
    else if (currentStepIndex === STEP.ASSET_MAPPING) {
      prevBtn.classList.remove('hidden');
      nextBtn.textContent = 'Import';
      const cont = document.getElementById('asset-mapping-fields-container');
      const req  = cont?.querySelector('select[name="assetNumber"][data-required="true"]');
      nextBtn.disabled = !(req && req.value);
    }
  }
});
