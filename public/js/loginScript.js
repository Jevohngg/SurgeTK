document.addEventListener('DOMContentLoaded', function() {
    const loginContainer = document.getElementById('login-container');
    const loginCard = document.getElementById('login-card');
    const headerTitle = document.getElementById('headerTitle');
    const headerSubtitle = document.getElementById('headerSubtitle');
    const loginTab = document.querySelector('a[href="#login"]');
    const signupTab = document.querySelector('a[href="#signup"]');
    const cardContainer = document.getElementById('login-card');
    const transitionDuration = 300;

    // Signup form elements
    const passwordInput = document.getElementById('passwordSignup');
    const confirmPasswordInput = document.getElementById('confirmPasswordSignup');
    const companyIdInput = document.getElementById('companyIdSignup');
    const emailInput = document.getElementById('emailSignup');
    const companyNameInput = document.getElementById('companyName');
    const passwordList = document.getElementById('passwordList');
    const signupForm = document.querySelector('form[action="/signup"]');
    const signupSubmitButton = document.getElementById('signupSubmit');

    // Login form elements
    const loginForm = document.getElementById('login-form');
    const loginCompanyIdInput = document.getElementById('companyId');
    const loginEmailInput = document.getElementById('email');
    const loginPasswordInput = document.getElementById('password');

    // Error elements for signup validation
    const passwordErrorDiv = document.getElementById('passwordError');
    const passwordMatchErrorDiv = document.getElementById('passwordMatchError');
    const companyIdErrorDiv = document.getElementById('companyIdError');

    // Error elements for login validation
    const loginCompanyIdErrorDiv = document.getElementById('loginCompanyIdErrorDiv');
    const loginEmailErrorDiv = document.getElementById('loginEmailErrorDiv');
    const loginPasswordErrorDiv = document.getElementById('loginPasswordErrorDiv');

    const successAlert = document.getElementById('passwordChangeSuccess');
    const closeIcon = document.querySelector('.successCloseIcon');



    // Show the success alert with a fade-in effect
    if (successAlert) {
      setTimeout(function () {
        successAlert.classList.add('show');
      }, 100); // Small delay to trigger the fade-in
  
      // Automatically hide the success message after 6 seconds
      setTimeout(function () {
        successAlert.classList.remove('show');
      }, 6000); // Display time (6 seconds)
  
      // Completely remove the success message after the fade-out (500ms fade duration)
      setTimeout(function () {
        successAlert.style.display = 'none';
      }, 6500); // Wait for the fade-out to complete
    }
  
    // Close the success alert on click
    if (closeIcon && successAlert) {
      closeIcon.addEventListener('click', function () {
        successAlert.classList.add('hidden'); // Add 'hidden' class to trigger fade-out
  
        setTimeout(function () {
          successAlert.style.display = 'none'; // Hide after the fade-out effect
        }, 500); // Matches the duration of the CSS transition (0.5s)
      });
    }
      
        // Function to check element visibility
        const isVisible = (elem) => {
            return !!(elem.offsetWidth || elem.offsetHeight || elem.getClientRects().length) &&
                   window.getComputedStyle(elem).visibility !== 'hidden' &&
                   window.getComputedStyle(elem).display !== 'none';
        };
    
        const setCardHeight = () => {
            const activeTabPane = document.querySelector('.tab-pane.active');
            const isLoginTab = activeTabPane && activeTabPane.id === 'login';
        
            if (isLoginTab) {
                // Do not adjust the height on the login tab
                cardContainer.style.height = 'auto';
                cardContainer.style.maxHeight = '720px'; // Set your desired max height
                return;
            } else {
                // Remove the max-height when on the signup tab
                cardContainer.style.maxHeight = 'none';
            }
        
            // For the signup tab, adjust the height based on visible error elements within the active tab
            let baseHeight = 934; // Base height for signup tab
            let errorElements = activeTabPane.querySelectorAll('.text-danger');
            let visibleErrorCount = 0;
        
            // Count how many error elements are currently visible
            errorElements.forEach((errorElem) => {
                if (isVisible(errorElem)) {
                    visibleErrorCount++;
                }
            });
        
            let extraHeight = visibleErrorCount * 50; // Adjust height based on visible errors
            cardContainer.style.height = `${baseHeight + extraHeight}px`;
        };
        
        
    
    

    // Function to update header content dynamically
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


    // Tab switching
    loginTab.addEventListener('click', () => {
        updateHeaderAndContent(true);
        setCardHeight();
    });
    signupTab.addEventListener('click', () => {
        updateHeaderAndContent(false);
        setCardHeight();
    });


    // Handle the active tab from server
    const activeTabFromServer = document.querySelector('meta[name="active-tab"]').content;
    const isLoginTab = activeTabFromServer === 'login';
    const tabToActivate = activeTabFromServer === 'signup' ? signupTab : loginTab;
    const bootstrapTab = new bootstrap.Tab(tabToActivate);
    bootstrapTab.show();


    // Set card height and update header content
    setCardHeight();
    updateHeaderAndContent(isLoginTab);

    // setCardHeight(isLoginTab);
    // updateHeaderAndContent(isLoginTab);

    // setCardHeight(activeTabFromServer === 'login');
    // updateHeaderAndContent(activeTabFromServer === 'login');

    // Real-time password validation for signup
    const validatePassword = () => {
        const password = passwordInput?.value;
        const confirmPassword = confirmPasswordInput?.value;
        let isValid = true;
    
        // Check if passwordList exists before accessing its children
        if (passwordList) {
            // Validate length
            if (password.length >= 8) {
                if (passwordList.children[0]?.querySelector('i')) {
                    passwordList.children[0].querySelector('i').style.color = 'green';
                    passwordList.children[0].style.color = 'black';
                }
            } else {
                if (passwordList.children[0]?.querySelector('i')) {
                    passwordList.children[0].querySelector('i').style.color = '#D0D5DD';
                    passwordList.children[0].style.color = '#D0D5DD';
                }
                isValid = false;
            }
    
            // Validate special character
            if (/[^A-Za-z0-9]/.test(password)) {
                if (passwordList.children[1]?.querySelector('i')) {
                    passwordList.children[1].querySelector('i').style.color = 'green';
                    passwordList.children[1].style.color = 'black';
                }
            } else {
                if (passwordList.children[1]?.querySelector('i')) {
                    passwordList.children[1].querySelector('i').style.color = '#D0D5DD';
                    passwordList.children[1].style.color = '#D0D5DD';
                }
                isValid = false;
            }
        }
    
        // Check if passwordMatchErrorDiv exists before updating its text
        if (passwordMatchErrorDiv) {
            if (password !== confirmPassword) {
                passwordMatchErrorDiv.textContent = 'Passwords do not match.';
                passwordMatchErrorDiv.style.display = 'block';
                isValid = false;
            } else {
                passwordMatchErrorDiv.style.display = 'none';
            }
        }
    
        setCardHeight(false);
        return isValid;
    };

    // Function to validate login form on submit
    const validateLoginForm = () => {
        let isValid = true;

        // Validate company ID
        if (loginCompanyIdInput.value.trim() === '') {
            if (loginCompanyIdErrorDiv) { // Check if the element exists
                loginCompanyIdErrorDiv.textContent = 'Company ID is required.';
                loginCompanyIdErrorDiv.style.display = 'block';
            }
            isValid = false;
        } else {
            if (loginCompanyIdErrorDiv) {
                loginCompanyIdErrorDiv.style.display = 'none';
            }
        }

        // Validate email
        if (loginEmailInput.value.trim() === '') {
            if (loginEmailErrorDiv) {
                loginEmailErrorDiv.textContent = 'Email is required.';
                loginEmailErrorDiv.style.display = 'block';
            }
            isValid = false;
        } else {
            if (loginEmailErrorDiv) {
                loginEmailErrorDiv.style.display = 'none';
            }
        }

        // Validate password
        if (loginPasswordInput.value.trim() === '') {
            if (loginPasswordErrorDiv) {
                loginPasswordErrorDiv.textContent = 'Password is required.';
                loginPasswordErrorDiv.style.display = 'block';
            }
            isValid = false;
        } else {
            if (loginPasswordErrorDiv) {
                loginPasswordErrorDiv.style.display = 'none';
            }
        }

        setCardHeight(true);
        return isValid;
    };

    // Function to check if all fields are filled for signup
    const allFieldsComplete = () => {
        return (
            companyIdInput.value.trim() !== '' &&
            companyNameInput.value.trim() !== '' &&
            emailInput.value.trim() !== '' &&
            passwordInput.value.trim() !== '' &&
            confirmPasswordInput.value.trim() !== ''
        );
    };

    // Function to enable/disable the "Get Started" button for signup
    const toggleSubmitButton = () => {
        const allFieldsValid = allFieldsComplete() && validatePassword();
        signupSubmitButton.disabled = !allFieldsValid;
    };

    // Real-time form validation for signup
    companyIdInput.addEventListener('input', toggleSubmitButton);
    companyNameInput.addEventListener('input', toggleSubmitButton);
    emailInput.addEventListener('input', toggleSubmitButton);
    passwordInput.addEventListener('input', toggleSubmitButton);
    confirmPasswordInput.addEventListener('input', toggleSubmitButton);

    passwordInput.addEventListener('input', validatePassword);
    confirmPasswordInput.addEventListener('input', validatePassword);

    toggleSubmitButton();
    const verifyEmailForm = document.getElementById('verify-email-form');

    // Function to hide the login card and show the verification form
    const showVerificationForm = () => {
        if (loginCard) {
            loginCard.style.display = 'none';
       
        }
        if (verifyEmailForm) {
            verifyEmailForm.style.display = 'flex';
          
        }
    };

    // Function to check if the verification form is visible
    const isElementVisible = (elem) => {
        return elem && window.getComputedStyle(elem).display !== 'none' && elem.offsetParent !== null;
    };

    // Check if the verify email form exists and is visible in the DOM
    if (isElementVisible(verifyEmailForm)) {
    
        showVerificationForm();
    } else {
   
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

      
    // Function to capture verification code and send it to the backend
    const submitVerificationCode = () => {
        const digitInputs = document.querySelectorAll('.verify-digit');
        let verificationCode = '';

        // Concatenate the values of each input field to form the full code
        digitInputs.forEach(input => {
            verificationCode += input.value;
        });

        // Set the hidden input field with the full code
        const verificationCodeInput = document.getElementById('verificationCode');
        if (verificationCodeInput) {
            verificationCodeInput.value = verificationCode;
        }

     

        // Optionally, trigger form submission or send via AJAX
        // Example: document.querySelector('form[action="/verify-email"]').submit();
    };


    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get('success');

    if (success === '1') {
      const alertBox = document.createElement('div');
      alertBox.className = 'alert alert-success';
      alertBox.textContent = 'Your password has been successfully changed. Please sign in with your new password.';
      document.body.prepend(alertBox);
    }
      
    // Attach the function to the submit button for verification form
    const verifySubmitButton = document.querySelector('#verifySubmit');

    if (verifySubmitButton) {
      verifySubmitButton.addEventListener('click', (e) => {
        submitVerificationCode();  // Capture the code before form submission
      });
    }

    const resendLink = document.querySelector('.ctrs');

    if (resendLink) {
      resendLink.addEventListener('click', function (e) {
        e.preventDefault(); // Prevent the default link behavior
        this.textContent = 'Resending...'; // Change the text
        this.classList.add('disabled'); // Disable the link to prevent multiple clicks

        // Reload the page to resend the verification email
        location.reload();
      });
    }

// ========================
// Alert Functionality
// ========================

/**
 * Displays a custom alert message.
 * @param {string} type - The type of alert ('success' or 'error').
 * @param {string} message - The message to display.
 */
function showAlert(type, message) {
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
    textContainer.className = 'success-text';
    const title = document.createElement('h3');
    title.innerText = type === 'success' ? 'Success!' : 'Error!';
    const text = document.createElement('p');
    text.innerText = message;
    textContainer.appendChild(title);
    textContainer.appendChild(text);

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



    // ------------ AJAX Login Form Handling ------------

    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault(); // Prevent the default form submission
    
            // Collect form data
            const companyId = document.getElementById('companyId').value.trim();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value.trim();
    
            // Prepare the payload
            const payload = { companyId, email, password };
    
            try {
                // Send the login data via fetch
                const response = await fetch('/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest' // To indicate AJAX request
                    },
                    body: JSON.stringify(payload)
                });
    
                // Parse the JSON response
                const result = await response.json();
    
                if (response.ok) {
                    if (result.requires2FA) {
                        // Show the 2FA modal if Bootstrap is loaded
                        const twoFAModalElement = document.getElementById('login-2fa-modal');
                        if (twoFAModalElement && typeof bootstrap !== 'undefined' && typeof bootstrap.Modal === 'function') {
                            const twoFAModal = new bootstrap.Modal(twoFAModalElement, { backdrop: 'static' });
                            twoFAModal.show();
                        } else {
                            console.error("Bootstrap Modal component is not available or the element is missing.");
                        }
                    } else if (result.success && result.redirect) {
                        // Redirect to the dashboard
                        window.location.href = result.redirect;
                    }
                } else {
                    // Handle validation errors
                    if (result.errors) {
                        // Display validation errors
                        console.log('Errors:', result.errors); // Debugging
                        Object.keys(result.errors).forEach(key => {
                            const errorDiv = document.getElementById(`${key}`); // Adjusted to match element IDs
                            if (errorDiv) {
                                errorDiv.textContent = result.errors[key];
                                errorDiv.style.display = 'block';
                            } else {
                                showAlert('danger', result.errors[key]); // Fallback alert if no specific div exists
                            }
                        });
                    } else if (result.message) {
                        // Display general error message
                        showAlert('danger', result.message);
                    }
                }
            } catch (error) {
                console.error('Error during AJAX login:', error);
                showAlert('danger', 'An unexpected error occurred. Please try again.');
            }
        });
    }
    
    

    // ------------ 2FA Modal Handling ------------

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
});
