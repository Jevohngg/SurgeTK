// public/js/onboardingTransitions.js
// Make sure this file is served as a static asset in your Express app.

document.addEventListener('DOMContentLoaded', () => {


  const copyButton = document.getElementById('copyEmailButton');
  const emailTemplate = document.getElementById('emailTemplate');
  const copyTextSpan = copyButton?.querySelector('.copy-text');

  if (copyButton && emailTemplate && copyTextSpan) {
    copyButton.addEventListener('click', () => {
      navigator.clipboard.writeText(emailTemplate.value)
        .then(() => {
          const originalText = copyTextSpan.textContent;
          copyTextSpan.textContent = 'Copied!';

          // Optionally remove icon for cleaner look
          const icon = copyButton.querySelector('i');
          if (icon) icon.style.display = 'none';

          setTimeout(() => {
            copyTextSpan.textContent = originalText;
            if (icon) icon.style.display = 'inline';
          }, 2000);
        })
        .catch(err => {
          console.error('Failed to copy text: ', err);
        });
    });
  }


  const selects = document.querySelectorAll('select.form-select');

  selects.forEach(select => {
    select.addEventListener('change', () => {
      select.classList.toggle('has-placeholder', select.selectedIndex === 0);
    });

    // Initial check
    select.classList.toggle('has-placeholder', select.selectedIndex === 0);
  });
  
  // ========== 1) Grab major elements for initial fade transitions ==========
  const onboardingHeader      = document.getElementById('onboardingHeader');
  const initialOptions        = document.getElementById('initialOptions');
  const btnShowFirmForm       = document.getElementById('btnShowFirmForm');
  const createFirmFormParent  = document.getElementById('createFirmFormContainer');

  // The adaptive "Back" button at top
  const btnBackToOptions      = document.getElementById('btnBackToOptions');

  // ========== 2) Multi-Step elements for the new form flow ==========
  const stepOne       = document.getElementById('stepOne');
  const stepTwo       = document.getElementById('stepTwo');
  const goToStepTwo   = document.getElementById('goToStepTwo');
  const backToStepOne = document.getElementById('backToStepOne');

  // Form submission spinner
  const multiStepForm     = document.getElementById('multiStepForm');
  const createFirmBtn     = document.getElementById('createFirmSubmitBtn');
  // Company Name input for "Next" button validation
  const companyNameInput  = document.getElementById('companyNameInput');
  const companyEmailInput      = document.getElementById('companyEmailInput');
  const phoneNumberInput       = document.getElementById('phoneNumberInput');
  const companyWebsiteInput    = document.getElementById('companyWebsiteInput');
  const companyAddressInput    = document.getElementById('companyAddressInput');


  if (multiStepForm) {
    multiStepForm.addEventListener('keydown', (event) => {
      // If user presses Enter in *any* field (except textarea), prevent form submission
      if (event.key === 'Enter' && event.target.tagName.toLowerCase() !== 'textarea') {
        event.preventDefault();
      }
    });
  }

  document.querySelector('.help-icon').addEventListener('click', () => {
    document.getElementById('emailHelpLightbox').style.display = 'flex';
  });
  
  document.querySelector('.close-lightbox').addEventListener('click', () => {
    document.getElementById('emailHelpLightbox').style.display = 'none';
  });
  
  document.querySelector('.lightbox-backdrop').addEventListener('click', () => {
    document.getElementById('emailHelpLightbox').style.display = 'none';
  });
  


  const stepTwoHeader = document.querySelector('#stepTwo .onboard-form-header-text h2');

// Whenever user types in the Company Name field:
companyNameInput.addEventListener('input', () => {
  const nameVal = companyNameInput.value.trim();
  // Update the Step Two header text
  stepTwoHeader.textContent = `${nameVal} Additional Details`;
});




// Grab ALL the placeholders that should contain the firm name
const firmNamePlaceholders = document.querySelectorAll('.firmNamePlaceholder');

// =========================
// Existing fade logic, etc.
// =========================

// 1) Listen for input in the companyName field
if (companyNameInput) {
  companyNameInput.addEventListener('input', () => {
    const nameVal = companyNameInput.value.trim();
    
    // (A) Update the Step Two main header's text
    if (stepTwoHeader) {
      stepTwoHeader.textContent = nameVal
        ? `${nameVal} Additional Details`
        : 'Your Firm Additional Details';
    }

    // (B) Update every .firmNamePlaceholder span
    firmNamePlaceholders.forEach((span) => {
      span.textContent = nameVal || 'Your Firm';
    });
  });
}

  // ========== 3) Fade helper functions ==========
  function fadeOutElements(...elements) {
    elements.forEach(el => {
      el.classList.add('fade-exit', 'fade-exit-active');
    });
    setTimeout(() => {
      elements.forEach(el => {
        el.style.display = 'none';
        el.classList.remove('fade-exit', 'fade-exit-active');
      });
    }, 300);
  }

  function fadeInElement(el, displayType = 'flex') {
    el.style.display = displayType;
    el.classList.add('fade-enter');
    requestAnimationFrame(() => {
      el.classList.add('fade-enter-active');
    });
  }

  function fadeOutElement(el) {
    el.classList.remove('fade-enter', 'fade-enter-active');
    el.classList.add('fade-exit', 'fade-exit-active');
    setTimeout(() => {
      el.style.display = 'none';
      el.classList.remove('fade-exit', 'fade-exit-active');
    }, 300);
  }

  // ========== 4) Show the "Set Up Firm" form (hide header + initial options) ==========
  if (btnShowFirmForm) {
    btnShowFirmForm.addEventListener('click', () => {
      fadeOutElements(onboardingHeader, initialOptions);
      setTimeout(() => {
        fadeInElement(createFirmFormParent, 'flex');
      }, 300);
    });
  }

  // ========== 5) ADAPTIVE BACK BUTTON (top-level) ==========
  // If user is on Step Two, go back to Step One. If on Step One, go back to initial options.
  if (btnBackToOptions) {
    btnBackToOptions.addEventListener('click', () => {
      if (stepTwo.style.display !== 'none') {
        // Currently on Step Two -> go back to Step One
        fadeOutElement(stepTwo);
        setTimeout(() => {
          fadeInElement(stepOne, 'flex');
        }, 300);
      } else {
        // On Step One -> go back to initial options
        fadeOutElement(createFirmFormParent);
        setTimeout(() => {
          fadeInElement(onboardingHeader, 'flex');
          fadeInElement(initialOptions, 'flex');
        }, 300);
      }
    });
  }

  // ========== 6) Step One -> Step Two (via "Next" button) ==========
  if (goToStepTwo) {
    goToStepTwo.addEventListener('click', () => {
      fadeOutElement(stepOne);
      setTimeout(() => {
        fadeInElement(stepTwo, 'flex');
      }, 300);
    });
  }

  // ========== 7) Step Two -> Step One (Back button in Step Two) ==========
  if (backToStepOne) {
    backToStepOne.addEventListener('click', () => {
      fadeOutElement(stepTwo);
      setTimeout(() => {
        fadeInElement(stepOne, 'flex');
      }, 300);
    });
  }

  // ========== 8) On final form submission, show spinner & disable button ==========
  if (multiStepForm && createFirmBtn) {
    multiStepForm.addEventListener('submit', function (e) {
      // 1) Lock the button’s current width & height
      const rect = createFirmBtn.getBoundingClientRect();
      createFirmBtn.style.width = rect.width + "px";
      createFirmBtn.style.height = rect.height + "px";
  
      // 2) Disable the button so it can’t be clicked again
      createFirmBtn.disabled = true;
  
      // 3) Instantly hide text & show spinner (via .loading)
      createFirmBtn.classList.add('loading');
  
      // The form will submit normally (assuming no e.preventDefault())
      // and the user will see the spinner until the page navigates.
    });
  }
  

  // ========== 9) Enable/Disable Next Button Based on Company Name ==========
  if (companyNameInput && goToStepTwo) {
    // Initialize the "Next" button disabled state on page load
    updateNextButtonState();

    companyNameInput.addEventListener('input', () => {
      updateNextButtonState();
    });

    function updateNextButtonState() {
      const trimmedName = companyNameInput.value.trim();
      goToStepTwo.disabled = (trimmedName.length === 0);
    }
  }

 // ========== 10) Trim only trailing spaces before submission ==========
 const fieldsToTrim = [
  'companyNameInput',
  'companyEmailInput',
  'phoneNumberInput',
  'companyWebsiteInput',
  'companyAddressInput'
];

fieldsToTrim.forEach(fieldId => {
  const field = document.getElementById(fieldId);
  if (field) {
    // Add a 'submit' event listener to trim trailing spaces only before submission
    field.form.addEventListener('submit', () => {
      field.value = field.value.replace(/\s+$/, '');  // Trim only trailing spaces
    });
  }
});

  // ========== 10) Custodian Multi-Select Logic ==========
  const custodianCheckBoxes     = document.querySelectorAll('.custodianCheckbox');
  const custodianDisplayInput   = document.getElementById('custodianDisplayInput');
  const custodianHiddenInput    = document.getElementById('custodianHiddenInput');
  const otherCheckbox           = document.getElementById('custodianOtherCheckbox');
  const otherCustodianInput     = document.getElementById('otherCustodianInput');

  // Listen for changes on each custodian checkbox
  if (custodianCheckBoxes && custodianDisplayInput && custodianHiddenInput) {
    custodianCheckBoxes.forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        handleCustodianSelection();
      });
    });
  }

  // "Other" checkbox logic
  if (otherCheckbox && otherCustodianInput) {
    otherCheckbox.addEventListener('change', () => {
      otherCustodianInput.style.display = otherCheckbox.checked ? 'block' : 'none';
      if (!otherCheckbox.checked) {
        otherCustodianInput.value = '';
      }
      handleCustodianSelection();
    });
    otherCustodianInput.addEventListener('input', () => {
      handleCustodianSelection();
    });
  }

  function handleCustodianSelection() {
    // 1) Gather all checked values (except 'Other')
    const selectedCustodians = [];
    custodianCheckBoxes.forEach(box => {
      if (box.checked && box.value !== 'Other') {
        selectedCustodians.push(box.value);
      }
    });

    // 2) If "Other" is checked, add user-typed text
    if (otherCheckbox && otherCheckbox.checked) {
      const otherText = otherCustodianInput.value.trim();
      if (otherText) {
        selectedCustodians.push(otherText);
      }
    }

    // 3) Build comma-separated string
    const finalString = selectedCustodians.join(', ');

    // 4) Show in the user-facing text input (read-only)
    custodianDisplayInput.value = finalString;

    // 5) Populate hidden input for form submission
    custodianHiddenInput.value = finalString;
  }





});
