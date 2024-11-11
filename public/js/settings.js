// public/js/settings.js

document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab-link');
    const tabPanels = document.querySelectorAll('.tab-panel');
    const alertContainer = document.getElementById('alert-container');

    // ========================
    // Tabs Navigation Functionality
    // ========================

    /**
     * Function to activate a specific tab and its corresponding panel.
     * Also stores the active tab in sessionStorage to persist across refreshes.
     * @param {HTMLElement} tab - The tab element to activate.
     */
    function activateTab(tab) {
        const target = tab.getAttribute('data-tab');

        // Remove active class from all tabs
        tabs.forEach(t => t.classList.remove('active'));
        // Add active class to the clicked tab
        tab.classList.add('active');

        // Hide all tab panels
        tabPanels.forEach(panel => panel.classList.remove('active'));
        // Show the target tab panel
        const targetPanel = document.getElementById(target);
        if (targetPanel) {
            targetPanel.classList.add('active');
        }

        // Save the active tab in sessionStorage
        sessionStorage.setItem('activeTab', target);
    }

    // Attach click event listeners to all tabs
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            activateTab(tab);
        });
    });

    // On page load, check if an active tab is stored in sessionStorage
    const savedTab = sessionStorage.getItem('activeTab');
    if (savedTab) {
        const targetTab = document.querySelector(`.tab-link[data-tab='${savedTab}']`);
        if (targetTab) {
            activateTab(targetTab);
        } else {
            // If the savedTab doesn't exist (e.g., removed), activate the first tab
            const firstTab = tabs[0];
            if (firstTab) activateTab(firstTab);
        }
    } else {
        // No saved tab, activate the first tab by default
        const firstTab = tabs[0];
        if (firstTab) activateTab(firstTab);
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
        if (!alertContainer) return; // If alert container doesn't exist, exit

        const alert = document.createElement('div');
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

        // Force reflow to apply the transition on the first display
        void alert.offsetWidth;

        // Add show class after reflow to trigger the transition
        alert.classList.add('show');

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

    // ========================
    // Account Form Functionality
    // ========================
    const accountForm = document.getElementById('account-form');
    if (accountForm) {
        const accountSaveButton = document.getElementById('account-save-button');
        const accountCancelButton = document.getElementById('account-cancel-button');
        const accountCompanyNameInput = document.getElementById('company-name');
        const accountEmailInput = document.getElementById('email-address');
        const accountProfileAvatarInput = document.getElementById('profile-avatar');
        const accountAvatarPreview = accountForm.querySelector('.profile-avatar-preview');

        // Save initial form values
        const accountInitialFormValues = {
            companyName: accountCompanyNameInput.value || '',
            email: accountEmailInput.value || '',
            avatar: accountAvatarPreview.src || ''
        };

        // Create spinner element for save button
        const accountSpinner = document.createElement('div');
        accountSpinner.classList.add('spinner-border', 'spinner-border-sm', 'ms-2');
        accountSpinner.setAttribute('role', 'status');
        accountSpinner.style.display = 'none';
        accountSaveButton.appendChild(accountSpinner);

        let accountFormData = new FormData();
        let accountIsFormChanged = false;

        /**
         * Enables the Save and Cancel buttons when form changes are detected.
         */
        function enableAccountButtons() {
            if (!accountIsFormChanged) {
                accountIsFormChanged = true;
                accountSaveButton.disabled = false;
                accountCancelButton.disabled = false;
            }
        }

        /**
         * Validates if the provided file is an image.
         * @param {File} file - The file to validate.
         * @returns {boolean} - Returns true if the file is an image, else false.
         */
        function isImageFile(file) {
            return file && file.type.startsWith('image/');
        }

        // Track changes to fields
        accountCompanyNameInput.addEventListener('input', () => {
            accountFormData.set('companyName', accountCompanyNameInput.value);
            enableAccountButtons();
        });

        accountEmailInput.addEventListener('input', () => {
            accountFormData.set('email', accountEmailInput.value);
            enableAccountButtons();
        });

        accountProfileAvatarInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                if (isImageFile(file)) {
                    updateAccountAvatarPreview(file);
                    accountFormData.set('avatar', file);
                    enableAccountButtons();
                } else {
                    showAlert('error', 'Only image files (PNG, JPG, JPEG, GIF) are allowed for Profile Avatar.');
                    // Reset the file input
                    accountProfileAvatarInput.value = '';
                }
            }
        });

        /**
         * Updates the avatar preview image with the selected file.
         * @param {File} file - The selected avatar image file.
         */
        function updateAccountAvatarPreview(file) {
            const reader = new FileReader();
            const uploadedAvatarPreview = accountForm.querySelector('.uploaded-avatar-preview');

            reader.onload = (e) => {
                if (uploadedAvatarPreview) {
                    uploadedAvatarPreview.src = e.target.result;
                    uploadedAvatarPreview.classList.remove('hidden'); // Show the overlay if applicable
                }
                accountAvatarPreview.src = e.target.result; // Update the main preview
            };

            reader.readAsDataURL(file);
        }

        /**
         * Handles the submission of the Account form.
         */
        accountSaveButton.addEventListener('click', async (event) => {
            event.preventDefault();

            // Show spinner and disable buttons while saving
            accountSpinner.style.display = 'inline-block';
            accountSaveButton.disabled = true;
            accountCancelButton.disabled = true;

            try {
                const response = await fetch('/settings/update-profile', { // Updated URL
                    method: 'POST',
                    body: accountFormData,
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });

                if (response.ok) {
                    const result = await response.json();
                    updateAccountFormValues(result.user);
                    showAlert('success', result.message || 'Account information updated successfully!');
                    // Update initialFormValues to the new data
                    accountInitialFormValues.companyName = result.user.companyName || '';
                    accountInitialFormValues.email = result.user.email || '';
                    accountInitialFormValues.avatar = result.user.avatar || '';

                    // Reset form state
                    accountIsFormChanged = false;
                    accountSaveButton.disabled = true;
                    accountCancelButton.disabled = true;
                    accountFormData = new FormData(); // Clear formData
                } else {
                    const errorData = await response.json();
                    showAlert('error', errorData.message || 'Failed to update account information.');
                    // Re-enable buttons on error
                    accountSaveButton.disabled = false;
                    accountCancelButton.disabled = false;
                }
            } catch (error) {
                console.error('Error updating account info:', error);
                showAlert('error', 'An error occurred while updating account information.');
                // Re-enable buttons on error
                accountSaveButton.disabled = false;
                accountCancelButton.disabled = false;
            } finally {
                accountSpinner.style.display = 'none';
            }
        });

        /**
         * Handles the cancellation of changes in the Account form.
         */
        accountCancelButton.addEventListener('click', (event) => {
            event.preventDefault();
            resetAccountForm();
        });

        /**
         * Updates the Account form fields with the latest user data.
         * @param {Object} user - The updated user object from the server.
         */
        function updateAccountFormValues(user) {
            accountCompanyNameInput.value = user.companyName || '';
            accountEmailInput.value = user.email || '';
            if (user.avatar) {
                accountAvatarPreview.src = user.avatar;
            } else {
                accountAvatarPreview.src = '';
            }
        }

        /**
         * Resets the Account form to its initial state.
         */
        function resetAccountForm() {
            accountIsFormChanged = false;
            accountSaveButton.disabled = true;
            accountCancelButton.disabled = true;
            accountFormData = new FormData(); // Clear formData

            // Reset form fields to initial values
            accountCompanyNameInput.value = accountInitialFormValues.companyName;
            accountEmailInput.value = accountInitialFormValues.email;
            accountAvatarPreview.src = accountInitialFormValues.avatar;
        }
    }

    // ========================
    // Company Info Form Functionality
    // ========================
    const companyInfoForm = document.getElementById('company-info-form');
    if (companyInfoForm) {
        const companyInfoSaveButton = document.getElementById('companyinfo-save-button');
        const companyInfoCancelButton = document.getElementById('companyinfo-cancel-button');
        const companyInfoNameInput = document.getElementById('company-info-name');
        const companyInfoEmailInput = document.getElementById('company-info-email');
        const companyInfoWebsiteInput = document.getElementById('company-info-website');
        const companyInfoAddressInput = document.getElementById('company-address');
        const companyInfoPhoneInput = document.getElementById('company-phone');
        const companyLogoInput = document.getElementById('company-logo');
        const companyLogoPreview = document.querySelector('.company-logo-preview');

        // Save initial form values
        const companyInfoInitialFormValues = {
            companyName: companyInfoNameInput.value || '',
            email: companyInfoEmailInput.value || '',
            website: companyInfoWebsiteInput.value || '',
            address: companyInfoAddressInput.value || '',
            phone: companyInfoPhoneInput.value || '',
            logo: companyLogoPreview.src || ''
        };

        // Create spinner element for save button
        const companyInfoSpinner = document.createElement('div');
        companyInfoSpinner.classList.add('spinner-border', 'spinner-border-sm', 'ms-2');
        companyInfoSpinner.setAttribute('role', 'status');
        companyInfoSpinner.style.display = 'none';
        companyInfoSaveButton.appendChild(companyInfoSpinner);

        let companyInfoFormData = new FormData();
        let companyInfoIsFormChanged = false;

        /**
         * Enables the Save and Cancel buttons when form changes are detected.
         */
        function enableCompanyInfoButtons() {
            if (!companyInfoIsFormChanged) {
                companyInfoIsFormChanged = true;
                companyInfoSaveButton.disabled = false;
                companyInfoCancelButton.disabled = false;
            }
        }

        /**
         * Validates if the provided file is an image.
         * @param {File} file - The file to validate.
         * @returns {boolean} - Returns true if the file is an image, else false.
         */
        function isImageFile(file) {
            return file && file.type.startsWith('image/');
        }

        // Track changes to fields
        companyInfoNameInput.addEventListener('input', () => {
            companyInfoFormData.set('companyInfoName', companyInfoNameInput.value);
            enableCompanyInfoButtons();
        });

        companyInfoEmailInput.addEventListener('input', () => {
            companyInfoFormData.set('companyInfoEmail', companyInfoEmailInput.value);
            enableCompanyInfoButtons();
        });

        companyInfoWebsiteInput.addEventListener('input', () => {
            companyInfoFormData.set('companyInfoWebsite', companyInfoWebsiteInput.value);
            enableCompanyInfoButtons();
        });

        companyInfoAddressInput.addEventListener('input', () => {
            companyInfoFormData.set('companyAddress', companyInfoAddressInput.value);
            enableCompanyInfoButtons();
        });

        companyInfoPhoneInput.addEventListener('input', () => {
            companyInfoFormData.set('companyPhone', companyInfoPhoneInput.value);
            enableCompanyInfoButtons();
        });

        /**
         * Handles changes to the Company Logo input and updates the preview.
         */
        companyLogoInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                if (isImageFile(file)) {
                    updateCompanyLogoPreview(file);
                    companyInfoFormData.set('company-logo', file);
                    enableCompanyInfoButtons();
                } else {
                    showAlert('error', 'Only image files (PNG, JPG, JPEG, GIF) are allowed for Company Logo.');
                    // Reset the file input
                    companyLogoInput.value = '';
                }
            }
        });

        /**
         * Handles drag-and-drop functionality for Company Logo upload.
         */
        const companyLogoUploadBoxes = companyInfoForm.querySelectorAll('.upload-box');
        companyLogoUploadBoxes.forEach(uploadBox => {
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
                if (file) {
                    if (isImageFile(file)) {
                        companyLogoInput.files = event.dataTransfer.files;
                        updateCompanyLogoPreview(file);
                        companyInfoFormData.set('company-logo', file);
                        enableCompanyInfoButtons();
                    } else {
                        showAlert('error', 'Only image files (PNG, JPG, JPEG, GIF) are allowed for Company Logo.');
                        // Reset the file input
                        companyLogoInput.value = '';
                    }
                }
            });
        });

        /**
         * Updates the Company Logo preview image with the selected file.
         * @param {File} file - The selected company logo image file.
         */
        function updateCompanyLogoPreview(file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                companyLogoPreview.src = e.target.result;
                toggleNoLogoText(false); // Hide "Not yet uploaded" text
            };
            reader.readAsDataURL(file);
        }

        /**
         * Toggles the visibility of the "Not yet uploaded" text.
         * @param {boolean} show - If true, shows the text; otherwise, hides it.
         */
        function toggleNoLogoText(show) {
            let noLogoText = companyInfoForm.querySelector('.no-logo-text');
            if (!noLogoText) {
                noLogoText = document.createElement('span');
                noLogoText.classList.add('no-logo-text');
                noLogoText.innerText = 'Not yet uploaded';
                noLogoText.style.position = 'absolute';
                noLogoText.style.top = '50%';
                noLogoText.style.left = '50%';
                noLogoText.style.transform = 'translate(-50%, -50%)';
                noLogoText.style.color = '#888';
                noLogoText.style.fontSize = '16px';
                noLogoText.style.pointerEvents = 'none'; // Ensure it doesn't block interactions
                companyLogoPreview.parentElement.style.position = 'relative'; // Ensure positioning context
                companyLogoPreview.parentElement.appendChild(noLogoText);
            }
            noLogoText.style.display = show ? 'block' : 'none';
        }

        /**
         * Handles the submission of the Company Info form.
         */
        companyInfoSaveButton.addEventListener('click', async (event) => {
            event.preventDefault();

            // Basic Validation
            const companyInfoName = companyInfoNameInput.value.trim();
            const companyInfoEmail = companyInfoEmailInput.value.trim();
            const companyInfoWebsite = companyInfoWebsiteInput.value.trim();
            const companyAddress = companyInfoAddressInput.value.trim();
            const companyPhone = companyInfoPhoneInput.value.trim();

            let errors = {};
            if (!companyInfoName) errors.companyInfoName = 'Company name is required.';
            if (!companyInfoEmail) {
                errors.companyInfoEmail = 'Email address is required.';
            } else if (!isValidEmail(companyInfoEmail)) {
                errors.companyInfoEmail = 'Please enter a valid email address.';
            }
            if (companyInfoWebsite && !isValidURL(companyInfoWebsite)) {
                errors.companyInfoWebsite = 'Please enter a valid URL.';
            }
            // Address and Phone Number are optional; no validation required

            if (Object.keys(errors).length > 0) {
                // Display Errors
                Object.keys(errors).forEach(key => {
                    showAlert('error', errors[key]);
                });
                return;
            }

            // Show spinner and disable buttons while saving
            companyInfoSpinner.style.display = 'inline-block';
            companyInfoSaveButton.disabled = true;
            companyInfoCancelButton.disabled = true;

            try {
                const response = await fetch('/settings/update-company-info', { // Correct backend route
                    method: 'POST',
                    body: companyInfoFormData,
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });

                if (response.ok) {
                    const result = await response.json();
                    updateCompanyInfoFormValues(result.user);
                    showAlert('success', result.message || 'Company information updated successfully!');

                    // Update initialFormValues to the new data
                    companyInfoInitialFormValues.companyName = result.user.companyName || '';
                    companyInfoInitialFormValues.email = result.user.email || '';
                    companyInfoInitialFormValues.website = result.user.companyWebsite || '';
                    companyInfoInitialFormValues.address = result.user.companyAddress || '';
                    companyInfoInitialFormValues.phone = result.user.phoneNumber || '';
                    companyInfoInitialFormValues.logo = result.user.companyLogo || '';

                    // Reset form state
                    companyInfoIsFormChanged = false;
                    companyInfoSaveButton.disabled = true;
                    companyInfoCancelButton.disabled = true;
                    companyInfoFormData = new FormData(); // Clear formData

                    // Check if logo exists and toggle "Not yet uploaded" text
                    if (result.user.companyLogo) {
                        toggleNoLogoText(false);
                    } else {
                        toggleNoLogoText(true);
                    }
                } else {
                    const errorData = await response.json();
                    showAlert('error', errorData.message || 'Failed to update company information.');
                    // Re-enable buttons on error
                    companyInfoSaveButton.disabled = false;
                    companyInfoCancelButton.disabled = false;
                }
            } catch (error) {
                console.error('Error updating company info:', error);
                showAlert('error', 'An error occurred while updating company information.');
                // Re-enable buttons on error
                companyInfoSaveButton.disabled = false;
                companyInfoCancelButton.disabled = false;
            } finally {
                companyInfoSpinner.style.display = 'none';
            }
        });

        /**
         * Handles the cancellation of changes in the Company Info form.
         */
        companyInfoCancelButton.addEventListener('click', (event) => {
            event.preventDefault();
            resetCompanyInfoForm();
        });

        /**
         * Updates the Company Info form fields with the latest user data.
         * @param {Object} user - The updated user object from the server.
         */
        function updateCompanyInfoFormValues(user) {
            companyInfoNameInput.value = user.companyName || '';
            companyInfoEmailInput.value = user.email || '';
            companyInfoWebsiteInput.value = user.companyWebsite || '';
            companyInfoAddressInput.value = user.companyAddress || '';
            companyInfoPhoneInput.value = user.phoneNumber || '';
            if (user.companyLogo) {
                companyLogoPreview.src = user.companyLogo;
                toggleNoLogoText(false); // Hide "Not yet uploaded" text
            } else {
                companyLogoPreview.src = '';
                toggleNoLogoText(true); // Show "Not yet uploaded" text
            }
        }

        /**
         * Resets the Company Info form to its initial state.
         */
        function resetCompanyInfoForm() {
            companyInfoIsFormChanged = false;
            companyInfoSaveButton.disabled = true;
            companyInfoCancelButton.disabled = true;
            companyInfoFormData = new FormData(); // Clear formData

            // Reset form fields to initial values
            companyInfoNameInput.value = companyInfoInitialFormValues.companyName;
            companyInfoEmailInput.value = companyInfoInitialFormValues.email;
            companyInfoWebsiteInput.value = companyInfoInitialFormValues.website;
            companyInfoAddressInput.value = companyInfoInitialFormValues.address;
            companyInfoPhoneInput.value = companyInfoInitialFormValues.phone;
            companyLogoPreview.src = companyInfoInitialFormValues.logo;

            // Toggle "Not yet uploaded" text based on whether a logo exists
            if (companyInfoInitialFormValues.logo) {
                toggleNoLogoText(false);
            } else {
                toggleNoLogoText(true);
            }
        }
    }

    // ========================
    // Password Form Functionality
    // ========================
    const passwordForm = document.getElementById('password-form');
    if (passwordForm) {
        const passwordSaveButton = passwordForm.querySelector('.btn-primary[type="submit"]');
        const passwordCancelButton = passwordForm.querySelector('.btn-secondary[type="button"]');
        const oldPasswordInput = passwordForm.querySelector('#old-password');
        const newPasswordInput = passwordForm.querySelector('#new-password');
        const confirmNewPasswordInput = passwordForm.querySelector('#confirm-new-password');

        // Disable buttons initially
        passwordSaveButton.disabled = true;
        passwordCancelButton.disabled = true;

        /**
         * Enables the Save and Cancel buttons when all password fields are filled.
         */
        function enablePasswordButtons() {
            if (oldPasswordInput.value && newPasswordInput.value && confirmNewPasswordInput.value) {
                passwordSaveButton.disabled = false;
                passwordCancelButton.disabled = false;
            } else {
                passwordSaveButton.disabled = true;
                passwordCancelButton.disabled = true;
            }
        }

        // Track changes to password fields
        oldPasswordInput.addEventListener('input', enablePasswordButtons);
        newPasswordInput.addEventListener('input', enablePasswordButtons);
        confirmNewPasswordInput.addEventListener('input', enablePasswordButtons);

        /**
         * Handles the submission of the Password form.
         */
        passwordForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const oldPassword = oldPasswordInput.value.trim();
            const newPassword = newPasswordInput.value.trim();
            const confirmNewPassword = confirmNewPasswordInput.value.trim();

            // Basic Validation
            let errors = {};
            if (!oldPassword) errors.oldPassword = 'Old password is required.';
            if (!newPassword) {
                errors.newPassword = 'New password is required.';
            } else if (newPassword.length < 8 || !/[^A-Za-z0-9]/.test(newPassword)) {
                errors.newPassword = 'Password must be at least 8 characters long and contain a special character.';
            }
            if (newPassword !== confirmNewPassword) {
                errors.confirmNewPassword = 'Passwords do not match.';
            }

            if (Object.keys(errors).length > 0) {
                // Display Errors
                Object.keys(errors).forEach(key => {
                    showAlert('error', errors[key]);
                });
                return;
            }

            try {
                const response = await fetch('/settings/change-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: JSON.stringify({
                        oldPassword,
                        newPassword
                    })
                });

                const result = await response.json();
                if (response.ok) {
                    showAlert('success', result.message || 'Password updated successfully!');
                    passwordForm.reset(); // Clear form inputs
                    passwordSaveButton.disabled = true;
                    passwordCancelButton.disabled = true;
                } else {
                    showAlert('error', result.message || 'Failed to update password');
                }
            } catch (error) {
                console.error('Error changing password:', error);
                showAlert('error', 'An error occurred while changing the password.');
            }
        });

        /**
         * Handles the cancellation of changes in the Password form.
         */
        passwordCancelButton.addEventListener('click', (event) => {
            event.preventDefault();
            passwordForm.reset();
            passwordSaveButton.disabled = true;
            passwordCancelButton.disabled = true;
        });
    }

// ========================
// Security Tab Functionality
// ========================
// Security Tab Functionality
const securityTab = document.getElementById('security');
if (securityTab) {
    const enable2FAButton = document.getElementById('enable-2fa-button');
    const disable2FAButton = document.getElementById('disable2FA-button'); // Corrected ID
    const twoFAModalElement = document.getElementById('twofa-modal');
    const verify2FAButton = document.getElementById('verify2FA-button');
    const cancel2FAButton = document.getElementById('cancel2fa-button');
    const qrCodeImage = document.getElementById('qr-code');
    const codeSegments = document.querySelectorAll('.code-segment'); // Updated to handle segmented input
    const modalTitle = document.getElementById('twofaModalLabel');
    const modalSubtitle = document.getElementById('twofaModalSubtitle');
    const signinLogsBody = document.getElementById('signin-logs-body');

    // Initialize Bootstrap Modal
    const twoFAModal = new bootstrap.Modal(twoFAModalElement, {
        keyboard: false
    });

    /**
     * Resets the modal fields to default state after closing.
     */
    function reset2FAModal() {
        codeSegments.forEach(segment => segment.value = ''); // Clear segmented inputs
        qrCodeImage.src = '';
        verify2FAButton.innerText = 'Verify and Enable';
        verify2FAButton.setAttribute('data-action', 'enable'); // Reset to enable action
        modalTitle.innerText = 'Set up two-factor authentication';
        modalSubtitle.innerText = '2FA is a fantastic way to improve your account security. Use an authenticator app on your mobile device to scan this QR code and enter the verification code below.';
        qrCodeImage.style.display = 'block'; // Ensure QR code is shown by default
    }

    // Listen for Bootstrap's modal hidden event to reset the modal
    twoFAModalElement.addEventListener('hidden.bs.modal', reset2FAModal);

    // Event listeners for opening the modal
    if (enable2FAButton) {
        enable2FAButton.addEventListener('click', async () => {
            try {
                const response = await fetch('/settings/2fa/setup');
                const data = await response.json();
                if (!data.enabled) {
                    qrCodeImage.src = data.qrCode;
                    verify2FAButton.setAttribute('data-action', 'enable'); // Set action to enable
                    modalTitle.innerText = 'Set up two-factor authentication';
                    modalSubtitle.innerText = '2FA is a fantastic way to improve your account security. Use an authenticator app on your mobile device to scan this QR code and enter the verification code below.';
                    qrCodeImage.style.display = 'block'; // Show QR code for enabling
                    twoFAModal.show();
                }
            } catch (error) {
                console.error('Error fetching 2FA setup:', error);
                showAlert('error', 'Failed to load 2FA setup.');
            }
        });
    }

    if (disable2FAButton) {
        disable2FAButton.addEventListener('click', () => {
            qrCodeImage.src = '';
            verify2FAButton.innerText = 'Disable 2FA';
            verify2FAButton.setAttribute('data-action', 'disable'); // Set action to disable
            modalTitle.innerText = 'Disable two-factor authentication';
            modalSubtitle.innerText = 'To disable 2FA, please open your authenticator app and enter the code below';
            qrCodeImage.style.display = 'none'; // Hide QR code for disabling
            twoFAModal.show();
        });
    }

    // Handle segmented code input focus and verification
    codeSegments.forEach((segment, index) => {
        segment.addEventListener('input', (e) => {
            if (e.target.value.length === 1 && index < codeSegments.length - 1) {
                codeSegments[index + 1].focus();
            }
        });
        segment.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
                codeSegments[index - 1].focus();
            }
        });
    });

    verify2FAButton.addEventListener('click', async () => {
        const token = Array.from(codeSegments).map(segment => segment.value).join('');
        if (token.length !== 6) {
            showAlert('error', 'Please enter the complete 6-digit verification code.');
            return;
        }

        const action = verify2FAButton.getAttribute('data-action');
        const endpoint = action === 'enable' ? '/settings/2fa/enable' : '/settings/2fa/disable';

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify({ token })
            });

            const result = await response.json();
            if (response.ok) {
                showAlert('success', result.message || (action === 'enable' ? '2FA has been enabled successfully!' : '2FA has been disabled successfully!'));
                twoFAModal.hide();
                reset2FAModal();

                // Update the 2FA section text
                const pElement = securityTab.querySelector('#twofa-status-text');
                if (pElement) {
                    pElement.innerText = action === 'enable' ? '2FA is currently enabled on your account.' : '2FA is currently disabled on your account.';
                }

                // Toggle button visibility based on action
                if (action === 'enable') {
                    if (disable2FAButton) disable2FAButton.style.display = 'inline-block';
                    if (enable2FAButton) enable2FAButton.style.display = 'none';
                } else {
                    if (disable2FAButton) disable2FAButton.style.display = 'none';
                    if (enable2FAButton) enable2FAButton.style.display = 'inline-block';
                }

                // Update the data attribute to reflect the new state
                const securitySection = securityTab.querySelector('.section[data-2fa-enabled]');
                if (securitySection) {
                    securitySection.setAttribute('data-2fa-enabled', action === 'enable' ? 'true' : 'false');
                }
            } else {
                showAlert('error', result.message || 'Failed to process 2FA request.');
            }
        } catch (error) {
            console.error('Error during 2FA operation:', error);
            showAlert('error', 'Failed to process 2FA request.');
        }
    });

    // Fetch and display sign-in logs
    async function loadSignInLogs() {
        try {
            const response = await fetch('/settings/signin-logs');
            const data = await response.json();
            console.log('Fetched sign-in logs:', data.logs); // Debug output
    
            // Clear existing logs in case of re-rendering
            signinLogsBody.innerHTML = '';
            
            data.logs.forEach(log => {
                const tr = document.createElement('tr');
    
                const tdTimestamp = document.createElement('td');
                tdTimestamp.innerText = new Date(log.timestamp).toLocaleString();
                tr.appendChild(tdTimestamp);
    
                const tdLocation = document.createElement('td');
                tdLocation.innerText = log.location || 'Unknown';
                tr.appendChild(tdLocation);
    
                const tdDevice = document.createElement('td');
                tdDevice.innerText = log.device || 'Unknown';
                tr.appendChild(tdDevice);
    
                signinLogsBody.appendChild(tr);
            });
        } catch (error) {
            console.error('Error fetching sign-in logs:', error);
            showAlert('error', 'Failed to load sign-in logs.');
        }
    }
    

    loadSignInLogs();
}




    // ========================
    // Utility Functions
    // ========================

    /**
     * Validates if the provided email is in a correct format.
     * @param {string} email - The email address to validate.
     * @returns {boolean} - Returns true if valid, else false.
     */
    function isValidEmail(email) {
        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailPattern.test(email);
    }

    /**
     * Validates if the provided URL is in a correct format.
     * @param {string} url - The URL to validate.
     * @returns {boolean} - Returns true if valid, else false.
     */
    function isValidURL(url) {
        try {
            new URL(url);
            return true;
        } catch (e) {
            return false;
        }
    }
});
