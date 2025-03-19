document.addEventListener('DOMContentLoaded', function() {
  const loginContainer = document.getElementById('login-container');
  const loginCard = document.getElementById('login-card');
  const headerTitle = document.getElementById('headerTitle');
  const headerSubtitle = document.getElementById('headerSubtitle');
  const loginTab = document.querySelector('a[href="#login"]');
  const signupTab = document.querySelector('a[href="#signup"]');
  const cardContainer = document.getElementById('login-card');
  const loginSubmitButton = document.getElementById('login-submit');
  const loginSubmitSpinner = document.getElementById('login-submit-spinner');
  const loginSubmitButtonText = document.getElementById('login-submit-text');

  const transitionDuration = 300;

  // ============================
  // SIGNUP FORM ELEMENTS
  // ============================
  const firstNameInput = document.getElementById('firstName');
  const lastNameInput = document.getElementById('lastName');
  const emailSignupInput = document.getElementById('emailSignup');
  const passwordSignupInput = document.getElementById('passwordSignup');
  const confirmPasswordSignupInput = document.getElementById('confirmPasswordSignup');
  const passwordList = document.getElementById('passwordList');
  const signupForm = document.querySelector('form[action="/signup"]');
  const signupSubmitButton = document.getElementById('signupSubmit');

  const passwordErrorDiv = document.getElementById('passwordError');
  const passwordMatchErrorDiv = document.getElementById('passwordMatchError');

  // ============================
  // LOGIN FORM ELEMENTS
  // ============================
  const loginForm = document.getElementById('login-form');
  const loginEmailInput = document.getElementById('email');
  const loginPasswordInput = document.getElementById('password');
  const loginEmailErrorDiv = document.getElementById('loginEmailErrorDiv');
  const loginPasswordErrorDiv = document.getElementById('loginPasswordErrorDiv');

  // ============================
  // SUCCESS ALERT / CLOSE ICON
  // ============================
  const successAlert = document.getElementById('passwordChangeSuccess');
  const closeIcon = document.querySelector('.successCloseIcon');

  // Show the success alert with a fade-in effect
  if (successAlert) {
    setTimeout(function () {
      successAlert.classList.add('show');
    }, 100); 
    setTimeout(function () {
      successAlert.classList.remove('show');
    }, 6000); 
    setTimeout(function () {
      successAlert.style.display = 'none';
    }, 6500);
  }

  if (closeIcon && successAlert) {
    closeIcon.addEventListener('click', function () {
      successAlert.classList.add('hidden');
      setTimeout(function () {
        successAlert.style.display = 'none';
      }, 500);
    });
  }

  // ============================
  // VISIBILITY & HEIGHT HELPERS
  // ============================
  const isVisible = (elem) => {
    return (
      !!(elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length) &&
      window.getComputedStyle(elem).visibility !== 'hidden' &&
      window.getComputedStyle(elem).display !== 'none'
    );
  };

  const setCardHeight = () => {
    const activeTabPane = document.querySelector('.tab-pane.active');
    const isLoginTab = activeTabPane && activeTabPane.id === 'login';

    if (isLoginTab) {
      // Do not adjust the height on the login tab
      cardContainer.style.height = 'auto';
      cardContainer.style.maxHeight = '770px'; 
      return;
    } else {
      cardContainer.style.maxHeight = 'none';
    }

    // For the signup tab
    let baseHeight = 950; 
    let errorElements = activeTabPane.querySelectorAll('.text-danger');
    let visibleErrorCount = 0;
    errorElements.forEach((errorElem) => {
      if (isVisible(errorElem)) {
        visibleErrorCount++;
      }
    });
    let extraHeight = visibleErrorCount * 50; 
    cardContainer.style.height = `${baseHeight + extraHeight}px`;
  };






  // ============================
  // TAB SWITCHING
  // ============================
  const updateHeaderAndContent = (isLoginTab) => {
    headerTitle.style.opacity = 0;
    headerSubtitle.style.opacity = 0;
    setTimeout(() => {
      if (isLoginTab) {
        headerTitle.textContent = "Sign in to your account";
        headerSubtitle.textContent = "Welcome back!";
      } else {
        headerTitle.textContent = "Create your account";
        headerSubtitle.textContent = "Complete the form below";
      }
      setCardHeight(isLoginTab);
      headerTitle.style.opacity = 1;
      headerSubtitle.style.opacity = 1;
    }, transitionDuration);
  };

  loginTab.addEventListener('click', () => {
    updateHeaderAndContent(true);
    setCardHeight();
  });
  signupTab.addEventListener('click', () => {
    updateHeaderAndContent(false);
    setCardHeight();
  });

  const activeTabFromServer = document.querySelector('meta[name="active-tab"]').content;
  const tabToActivate = activeTabFromServer === 'signup' ? signupTab : loginTab;
  const bootstrapTab = new bootstrap.Tab(tabToActivate);
  bootstrapTab.show();

  const isLoginTab = (activeTabFromServer === 'login');
  setCardHeight();
  updateHeaderAndContent(isLoginTab);

  // ============================
  // REAL-TIME PASSWORD VALIDATION FOR SIGNUP
  // ============================
  const validatePassword = () => {
    const password = passwordSignupInput?.value || "";
    const confirmPassword = confirmPasswordSignupInput?.value || "";
    let isValid = true;

    // Validate length
    if (password.length >= 8) {
      // Turn the bullet point green
      if (passwordList && passwordList.children[0]?.querySelector('i')) {
        passwordList.children[0].querySelector('i').style.color = 'green';
        passwordList.children[0].style.color = 'black';
      }
    } else {
      if (passwordList && passwordList.children[0]?.querySelector('i')) {
        passwordList.children[0].querySelector('i').style.color = '#D0D5DD';
        passwordList.children[0].style.color = '#D0D5DD';
      }
      isValid = false;
    }

    // Validate special character
    if (/[^A-Za-z0-9]/.test(password)) {
      if (passwordList && passwordList.children[1]?.querySelector('i')) {
        passwordList.children[1].querySelector('i').style.color = 'green';
        passwordList.children[1].style.color = 'black';
      }
    } else {
      if (passwordList && passwordList.children[1]?.querySelector('i')) {
        passwordList.children[1].querySelector('i').style.color = '#D0D5DD';
        passwordList.children[1].style.color = '#D0D5DD';
      }
      isValid = false;
    }

    // Match check
    if (password !== confirmPassword) {
      if (passwordMatchErrorDiv) {
        passwordMatchErrorDiv.textContent = 'Passwords do not match.';
        passwordMatchErrorDiv.style.display = 'block';
      }
      isValid = false;
    } else {
      if (passwordMatchErrorDiv) {
        passwordMatchErrorDiv.style.display = 'none';
      }
    }

    setCardHeight(false);
    return isValid;
  };

  // ============================
  // ENABLE/DISABLE "GET STARTED" BUTTON
  // ============================
  const allFieldsComplete = () => {
    return (
      firstNameInput?.value.trim() !== '' &&
      lastNameInput?.value.trim() !== '' &&
      emailSignupInput?.value.trim() !== '' &&
      passwordSignupInput?.value.trim() !== '' &&
      confirmPasswordSignupInput?.value.trim() !== ''
    );
  };

  const toggleSubmitButton = () => {
    const allFieldsValid = allFieldsComplete() && validatePassword();
    if (signupSubmitButton) {
      signupSubmitButton.disabled = !allFieldsValid;
    }
  };

  // If these elements exist, attach listeners
  if (firstNameInput) firstNameInput.addEventListener('input', toggleSubmitButton);
  if (lastNameInput) lastNameInput.addEventListener('input', toggleSubmitButton);
  if (emailSignupInput) emailSignupInput.addEventListener('input', toggleSubmitButton);
  if (passwordSignupInput) {
    passwordSignupInput.addEventListener('input', () => {
      validatePassword();
      toggleSubmitButton();
    });
  }
  if (confirmPasswordSignupInput) {
    confirmPasswordSignupInput.addEventListener('input', () => {
      validatePassword();
      toggleSubmitButton();
    });
  }

  toggleSubmitButton();

  // ============================
  // VERIFY EMAIL FORM LOGIC
  // ============================
  const verifyEmailForm = document.getElementById('verify-email-form');

  const showVerificationForm = () => {
    if (loginCard) {
      loginCard.style.display = 'none';
    }
    if (verifyEmailForm) {
      verifyEmailForm.style.display = 'flex';
    }
  };
  const isElementVisible = (elem) => {
    return elem && window.getComputedStyle(elem).display !== 'none' && elem.offsetParent !== null;
  };

  if (isElementVisible(verifyEmailForm)) {
    showVerificationForm();
  }

  const inputs = document.querySelectorAll('.verify-digit');
  inputs.forEach((input, index) => {
    input.addEventListener('input', () => {
      if (input.value.length === 1 && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === "Backspace" && input.value === '' && index > 0) {
        inputs[index - 1].focus();
      }
    });
  });

  const submitVerificationCode = () => {
    const digitInputs = document.querySelectorAll('.verify-digit');
    let verificationCode = '';
    digitInputs.forEach(input => {
      verificationCode += input.value;
    });
    const verificationCodeInput = document.getElementById('verificationCode');
    if (verificationCodeInput) {
      verificationCodeInput.value = verificationCode;
    }
  };


  const verifySubmitButton = document.querySelector('#verifySubmit');
  if (verifySubmitButton) {
    verifySubmitButton.addEventListener('click', function (e) {
      // ===================================
      // 1) Lock button width & height
      // ===================================
      const rect = verifySubmitButton.getBoundingClientRect();
      verifySubmitButton.style.width = rect.width + "px";
      verifySubmitButton.style.height = rect.height + "px";
  
      // ===================================
      // 2) Disable the button 
      // (so it can't be clicked again)
      // ===================================
      verifySubmitButton.disabled = true;
  
      // ===================================
      // 3) Add the .loading class 
      // (instantly hides text, shows spinner)
      // ===================================
      verifySubmitButton.classList.add('loading');
  
      // ===================================
      // 4) Call submitVerificationCode() 
      // or any other logic you need
      // ===================================
      submitVerificationCode();
  
      // ===================================
      // 5) Optionally, if this is a normal form submission, 
      // remove e.preventDefault() if used or do:
      // verifySubmitButton.form.submit();
      // (That depends on how your app is set up.)
      // ===================================
      verifySubmitButton.form.submit();
    });
  
    
  }

  

  const resendLink = document.querySelector('.ctrs');
  if (resendLink) {
    resendLink.addEventListener('click', function (e) {
      e.preventDefault();
      this.textContent = 'Resending...';
      this.classList.add('disabled');
      location.reload();
    });
  }

  // ============================
  // ALERT HELPER
  // ============================
  function showAlert(type, message) {
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
    const text = document.createElement('p');
    text.innerText = message;
    textContainer.appendChild(title);
    textContainer.appendChild(text);

    alert.appendChild(iconContainer);
    alert.appendChild(closeContainer);
    alert.appendChild(textContainer);
    alertContainer.prepend(alert);

    void alert.offsetWidth;
    alert.classList.add('show');
    setTimeout(() => closeAlert(alert), 5000);
    closeIcon.addEventListener('click', () => closeAlert(alert));
  }
  function closeAlert(alert) {
    alert.classList.add('exit');
    setTimeout(() => {
      if (alert && alert.parentNode) {
        alert.parentNode.removeChild(alert);
      }
    }, 500);
  }

// ============================
// LOGIN FORM SUBMIT
// ============================
if (loginForm) {
  loginForm.addEventListener('submit', function (e) {
    // Remove this if you want normal form POST:
    // e.preventDefault();

    if (loginSubmitButton) {
      // 1) Lock the button's current width & height
      const rect = loginSubmitButton.getBoundingClientRect();
      loginSubmitButton.style.width = rect.width + "px";
      loginSubmitButton.style.height = rect.height + "px";

      // 2) Disable pointer events, but keep the normal color
      loginSubmitButton.disabled = true;

      // 3) Instantly hide text / show spinner
      loginSubmitButton.classList.add('loading');
    }

    // If you're using normal form submission, let the form submit:
    // this.submit();
  });
}

// ============================
// SIGNUP FORM SUBMIT
// ============================
if (signupForm) {
  signupForm.addEventListener('submit', function (e) {
    // Remove this if you want normal form POST:
    // e.preventDefault();

    if (signupSubmitButton) {
      // 1) Lock the button's current width & height
      const rect = signupSubmitButton.getBoundingClientRect();
      signupSubmitButton.style.width = rect.width + "px";
      signupSubmitButton.style.height = rect.height + "px";

      // 2) Disable pointer events, but keep the normal color
      signupSubmitButton.disabled = true;

      // 3) Instantly hide text / show spinner
      signupSubmitButton.classList.add('loading');
    }

    // If you're using normal form submission, let the form submit:
    // this.submit();
  });
}




  // ============================
  // 2FA MODAL HANDLING
  // ============================
  const handle2FAVerification = () => {
    const codeSegments = document.querySelectorAll('.code-segment');
    const submit2FAButton = document.getElementById('submit-login-2FA-button');
    const cancel2FAButton = document.getElementById('cancel-login-2fa-button');

    codeSegments.forEach((segment, index) => {
      segment.addEventListener('input', () => {
        if (segment.value.length === 1 && index < codeSegments.length - 1) {
          codeSegments[index + 1].focus();
        }
      });
      segment.addEventListener('keydown', (e) => {
        if (e.key === "Backspace" && segment.value === '' && index > 0) {
          codeSegments[index - 1].focus();
        }
      });
    });

    submit2FAButton.addEventListener('click', async () => {
      const token = Array.from(codeSegments).map(segment => segment.value).join('');
      if (token.length !== 6) {
        showAlert('danger', 'Please enter the complete 6-digit verification code.');
        return;
      }

      try {
        const response = await fetch('/login/2fa', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: JSON.stringify({ token })
        });

        const result = await response.json();
        if (response.ok) {
          if (result.success && result.redirect) {
            showAlert('success', 'Logged in successfully.');
            window.location.href = result.redirect;
          }
        } else {
          showAlert('danger', result.message);
        }
      } catch (error) {
        console.error('Error during 2FA verification:', error);
        showAlert('danger', 'An unexpected error occurred. Please try again.');
      }
    });
  };

  handle2FAVerification();

  if (window.show2FAModal) {
    const twoFAModal = new bootstrap.Modal(document.getElementById('login-2fa-modal'));
    twoFAModal.show();
  }
});
