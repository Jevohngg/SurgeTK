// public/js/settings.js

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// GLOBAL STATE
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~
let unsavedChangesModal;      
let wantedTab = null;   
let wantedURL = null;  // For intercepting navigation

// These must be global so isAnyFormDirty() can see them
let accountIsFormChanged = false;
let companyInfoIsFormChanged = false;
let bucketsSettingsDirty = false;

/**
 * isAnyFormDirty() => returns true if any form is unsaved
 */
function isAnyFormDirty() {
  return (
    accountIsFormChanged ||
    companyInfoIsFormChanged ||
    bucketsSettingsDirty
  );
}

function toggleNoLogoText(show) {
  const companyInfoSaveButton = document.getElementById('companyinfo-save-button');
  const companyInfoCancelButton = document.getElementById('companyinfo-cancel-button');
  const companyInfoNameInput = document.getElementById('company-info-name');
  const companyInfoWebsiteInput = document.getElementById('company-info-website');
  const companyInfoAddressInput = document.getElementById('company-address');
  const companyInfoPhoneInput = document.getElementById('company-phone');
  const companyLogoInput = document.getElementById('company-logo');
  const companyLogoPreview = document.querySelector('.company-logo-preview');

  const logoPreviewContainer = document.getElementById('companyLogoPreviewContainer');
  const companyInfoForm = document.getElementById('company-info-form');
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
      noLogoText.style.pointerEvents = 'none';
      companyLogoPreview.parentElement.style.position = 'relative';
      companyLogoPreview.parentElement.appendChild(noLogoText);
  }
  noLogoText.style.display = show ? 'block' : 'none';
}

    /**
     * Resets the form to its original state
     */
    function resetCompanyInfoForm() {
      const companyInfoSaveButton = document.getElementById('companyinfo-save-button');
      const companyInfoCancelButton = document.getElementById('companyinfo-cancel-button');
      const companyInfoNameInput = document.getElementById('company-info-name');
      const companyInfoWebsiteInput = document.getElementById('company-info-website');
      const companyInfoAddressInput = document.getElementById('company-address');
      const companyInfoPhoneInput = document.getElementById('company-phone');
      const companyLogoInput = document.getElementById('company-logo');
      const companyLogoPreview = document.querySelector('.company-logo-preview');
  
      const logoPreviewContainer = document.getElementById('companyLogoPreviewContainer');
      companyInfoIsFormChanged = false;
      companyInfoFormData = new FormData();
      companyInfoSaveButton.disabled = true;
      companyInfoCancelButton.disabled = true;
      const colorPickerContainer = document.getElementById('color-picker-container');
      const companyBrandingColorInput = document.getElementById('company-branding-color');

      const companyInfoInitialFormValues = {
        companyName: companyInfoNameInput.value || '',
        website: companyInfoWebsiteInput.value || '',
        address: companyInfoAddressInput.value || '',
        phone: companyInfoPhoneInput.value || '',
        logo: companyLogoPreview.src || '',
        companyBrandingColor: companyBrandingColorInput ? (companyBrandingColorInput.value || '') : ''
    };

      companyInfoNameInput.value = companyInfoInitialFormValues.companyName;
      companyInfoWebsiteInput.value = companyInfoInitialFormValues.website;
      companyInfoAddressInput.value = companyInfoInitialFormValues.address;
      companyInfoPhoneInput.value = companyInfoInitialFormValues.phone;
      companyLogoPreview.src = companyInfoInitialFormValues.logo;

      // "Not yet uploaded" label if no initial logo
      if (companyInfoInitialFormValues.logo) {
          toggleNoLogoText(false);
      } else {
          toggleNoLogoText(true);
      }

      if (companyBrandingColorInput) {
          companyBrandingColorInput.value = companyInfoInitialFormValues.companyBrandingColor;
          if (pickr) {
              pickr.setColor(companyInfoInitialFormValues.companyBrandingColor || '#FFFFFF');
              pickr.getRoot().button.style.backgroundColor =
                  companyInfoInitialFormValues.companyBrandingColor || '#FFFFFF';
          }
      }
  }

// Helper that “discards all changes” across all forms
function discardAllChanges() {
    // 1) Reset the account form
    const accountForm = document.getElementById('account-form');
    if (accountForm) resetAccountForm();
  
    // 2) Reset the company info form
    const companyInfoForm = document.getElementById('company-info-form');
    if (companyInfoForm) resetCompanyInfoForm();
  
    // 3) Reset buckets, if you have a “cancelBucketsChanges()”:
    if (typeof cancelBucketsChanges === 'function') {
      cancelBucketsChanges();
    }
  
    // 4) Set all to false
    accountIsFormChanged = false;
    companyInfoIsFormChanged = false;
    bucketsSettingsDirty = false;
  }


  function resetAccountForm() {
    const accountCancelButton = document.getElementById('account-cancel-button');
    const accountSaveButton = document.getElementById('account-save-button');
    const accountFirstNameInput = document.getElementById('account-first-name');
    const accountLastNameInput = document.getElementById('account-last-name');
    const accountEmailInput = document.getElementById('email-address');
    const accountProfileAvatarInput = document.getElementById('profile-avatar');
    const accountForm = document.getElementById('account-form');
    const accountAvatarPreview = accountForm.querySelector('.profile-avatar-preview');
    accountIsFormChanged = false;
    accountSaveButton.disabled = true;
    accountCancelButton.disabled = true;

    const accountInitialFormValues = {
      firstName: accountFirstNameInput.value || '',
      lastName: accountLastNameInput.value || '',
      email: accountEmailInput.value || '',
      avatar: accountAvatarPreview ? accountAvatarPreview.src : ''
    };
    
    // Reset the FormData
    accountFormData = new FormData();
  
    // Reset text field values to original
    accountFirstNameInput.value = accountInitialFormValues.firstName;
    accountLastNameInput.value = accountInitialFormValues.lastName;
    accountEmailInput.value = accountInitialFormValues.email;
  
    // Revert the displayed avatar to the original
    accountAvatarPreview.src = accountInitialFormValues.avatar;
  
    // Added lines ↓
    // Clear out the file input so the file is truly "forgotten"
    accountProfileAvatarInput.value = '';
  
    // Hide or reset the .uploaded-avatar-preview if you’re showing it
    const uploadedAvatarPreview = accountForm.querySelector('.uploaded-avatar-preview');
    if (uploadedAvatarPreview) {
      uploadedAvatarPreview.src = '';
      uploadedAvatarPreview.classList.add('hidden');
    }
  
  }
  

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// MAIN DOMContentLoaded
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~

document.addEventListener('DOMContentLoaded', () => {
  const alertContainer = document.getElementById('alert-container');


  const tabs = document.querySelectorAll('.tab-link');
  const tabPanels = document.querySelectorAll('.tab-panel');

  // 1) Parse the sub-route from the path, e.g. /settings/company-info => "company-info"
  const pathParts = window.location.pathname.split('/'); 
  // pathParts might be ["", "settings", "company-info"]
  let subtab = pathParts[2] || 'account'; 
  // default to "account" if none

  // 2) Activate the tab that has data-route = subtab
  const defaultTab = document.querySelector(`.tab-link[data-route="${subtab}"]`);
  if (defaultTab) {
    activateTab(defaultTab);
  } else {
    // fallback: if no matching button, activate 'account' or the first
    activateTab(tabs[0]);
  }

  // 3) Hook up a popstate handler so if user clicks "Back" or "Forward," we navigate tabs:
  window.addEventListener('popstate', (ev) => {
    const pathParts = window.location.pathname.split('/');
    const subtab = pathParts[2] || 'account';
    const matchingTab = document.querySelector(`.tab-link[data-route="${subtab}"]`);
    if (matchingTab) activateTab(matchingTab);
  });
  
    // Initialize the unsavedChangesModal
    const unsavedChangesModalElement = document.getElementById('unsavedChangesModal');
    unsavedChangesModal = new bootstrap.Modal(unsavedChangesModalElement, {
      backdrop: 'static', // prevent closing by clicking outside
      keyboard: false
    });
  
    const discardChangesBtn = document.getElementById('discard-changes-btn');
    const stayHereBtn = document.getElementById('stay-here-btn');

    const allLinks = document.querySelectorAll('a[href^="/"]');

    allLinks.forEach(link => {
      link.addEventListener('click', (event) => {
        // 1) If forms are dirty, show your unsaved-changes modal
        if (isAnyFormDirty()) {
          event.preventDefault();
          wantedURL = link.getAttribute('href');
          unsavedChangesModal.show();
          return; // Stop here so we don't navigate yet
        }
    
        // 2) If we're already on /settings and the new link is also /settings#someTab...
        const currentPath = window.location.pathname; // e.g. "/settings"
        const linkUrl = new URL(link.href);          // e.g. "http://localhost:3000/settings#company-info"
    
        if (
          currentPath === '/settings' && 
          linkUrl.pathname === '/settings' &&
          linkUrl.hash  // i.e. "#company-info"
        ) {
          event.preventDefault();          // Stop normal browser navigation
          location.hash = linkUrl.hash;    // Set our window hash

        }
    
        // Else do nothing special => normal navigation
      });
    });
    
  
discardChangesBtn.addEventListener('click', () => {
    // 1) Discard all changes so forms are back to pristine
    discardAllChanges();
  
    // 2) If it was a tab-click, do that
    if (wantedTab) {
      const routeSegment = wantedTab.getAttribute('data-route'); 
      const newPath = `/settings/${routeSegment}`; 
      history.pushState({}, '', newPath);
      activateTab(wantedTab);
      wantedTab = null;
    }
  
    // 3) If it was a link-click, do that
    if (wantedURL) {
      window.location = wantedURL;  // <-- actually go to the link
      wantedURL = null;
    }
  
    // 4) Hide the modal
    unsavedChangesModal.hide();
  });
  
  
    // If user clicks "Cancel" => do nothing special
    stayHereBtn.addEventListener('click', () => {
      wantedTab = null; // clear reference
      // The modal is hidden automatically by Bootstrap
    });
  
    // function activateTab(tab) {
    //   // [YOUR EXISTING activateTab CODE...]
    //   // (unchanged)
    // }
  
    // Overwrite your tab click so that it checks for dirty forms first
    tabs.forEach(tab => {
      tab.addEventListener('click', (event) => {
        event.preventDefault();
    
        // 1) Check for unsaved changes if needed
        if (isAnyFormDirty()) {

          wantedTab = tab;
          unsavedChangesModal.show();
          
          return;
        }
    
        // 2) Build the new path => "/settings/company-info" or whatever
        const routeSegment = tab.getAttribute('data-route'); // e.g. "company-info"
        const newPath = `/settings/${routeSegment}`;
    
        // 3) Update the URL *without* reloading:
        history.pushState({}, '', newPath);
    
        // 4) Actually activate the tab content (hide old, show new)
        activateTab(tab);
      });
    });
    

    // ========================
    // Tabs Navigation Functionality
    // ========================

    /**
     * Activates a specific tab and its corresponding panel.
     * Updates ARIA attributes for accessibility and stores the active tab in sessionStorage.
     * @param {HTMLElement} tab - The tab element to activate.
     */
    function activateTab(tab) {
        const target = tab.getAttribute('data-tab');

        // Deactivate all tabs and update ARIA attributes
        tabs.forEach(t => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
        });
        // Activate the clicked tab
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');

        // Hide all tab panels and update ARIA attributes
        tabPanels.forEach(panel => {
            panel.classList.remove('active');
            panel.setAttribute('aria-hidden', 'true');
        });
        // Show the target panel if it exists
        const targetPanel = document.getElementById(target);
        if (targetPanel) {
            targetPanel.classList.add('active');
            targetPanel.setAttribute('aria-hidden', 'false');
        } else {
            console.warn(`No panel found for tab: ${target}`);
            // Optional: Display an alert in alertContainer if needed
            // if (alertContainer) alertContainer.textContent = `Error: Tab "${target}" not found.`;
        }

        // Save the active tab in sessionStorage
        sessionStorage.setItem('activeTab', target);
    }

    window.addEventListener('beforeunload', (e) => {
        if (isAnyFormDirty()) {
          // The standard approach: Show default browser prompt
          e.preventDefault();
          e.returnValue = ''; 
        }
      });
      

    // Attach click event listeners to all tabs
    // tabs.forEach(tab => {
    //     tab.addEventListener('click', () => {
    //         activateTab(tab);
    //     });
    // });

  

// In DOMContentLoaded
const hash = window.location.hash ? window.location.hash.substring(1) : null;
// sessionStorage fallback
const savedTab = sessionStorage.getItem('activeTab');
const activeTab = hash || savedTab;

if (activeTab) {
  const targetTab = document.querySelector(`.tab-link[data-tab='${activeTab}']`);
  if (targetTab) {
    activateTab(targetTab); 
  } else {
    // Fallback to the first tab
    const firstTab = tabs[0];
    if (firstTab) activateTab(firstTab);
  }
} else {
  // No hash or saved tab => default to first tab
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

// const colorPickerContainer = document.getElementById('color-picker-container');
// const brandingColorInput = document.getElementById('company-branding-color');

// if (colorPickerContainer && brandingColorInput) {
//   const pickr = Pickr.create({
//     el: colorPickerContainer,
//     theme: 'classic', // Must match your CSS theme
//     default: brandingColorInput.value || '#FFFFFF',
//     swatches: [
//       '#F44336','#E91E63','#9C27B0','#673AB7',
//       '#3F51B5','#2196F3','#03A9F4','#00BCD4',
//       '#009688','#4CAF50','#8BC34A','#CDDC39',
//       '#FFEB3B','#FFC107','#FF9800','#FF5722',
//       '#795548','#607D8B','#000000','#FFFFFF'
//     ],
//     components: {
//       preview: true,
//       opacity: false,
//       hue: true,
//       interaction: {
//         hex: true,
//         input: true,
//         clear: true,
//         save: false
//       }
//     }
//   });

//   // 1) On init, make sure the pickr button matches your input’s initial color
//   pickr.on('init', instance => {
//     const initialHex = brandingColorInput.value || '#FFFFFF';
//     pickr.setColor(initialHex);
//     pickr.getRoot().button.style.backgroundColor = initialHex;
//   });

//   // 2) On color change, update the hidden input AND the pickr button background
//   pickr.on('change', (color) => {
//     const hexColor = color.toHEXA().toString(); // e.g. "#123ABC"
//     brandingColorInput.value = hexColor;

//     // Make the color fill the pickr's own button
//     pickr.getRoot().button.style.backgroundColor = hexColor;

//     // Update your FormData & enable Save/Cancel
//     companyInfoFormData.set('companyBrandingColor', hexColor);
//     enableCompanyInfoButtons(); // already defined in your code
//   });
// }



// ========================
// Account Form Functionality
// ========================
const accountForm = document.getElementById('account-form');
if (accountForm) {
  const accountSaveButton = document.getElementById('account-save-button');
  const accountCancelButton = document.getElementById('account-cancel-button');
  
  // Replace the single name input with two:
  const accountFirstNameInput = document.getElementById('account-first-name');
  const accountLastNameInput = document.getElementById('account-last-name');
  
  const accountEmailInput = document.getElementById('email-address');
  const accountProfileAvatarInput = document.getElementById('profile-avatar');
  const accountAvatarPreview = accountForm.querySelector('.profile-avatar-preview');

  // Store the initial form values (for Cancel functionality)
  const accountInitialFormValues = {
    firstName: accountFirstNameInput.value || '',
    lastName: accountLastNameInput.value || '',
    email: accountEmailInput.value || '',
    avatar: accountAvatarPreview ? accountAvatarPreview.src : ''
  };

  const accountSpinner = document.createElement('div');
  accountSpinner.classList.add('spinner-border', 'spinner-border-sm', 'ms-2');
  accountSpinner.setAttribute('role', 'status');
  accountSpinner.style.display = 'none';
  accountSaveButton.appendChild(accountSpinner);

  let accountFormData = new FormData();
//   let accountIsFormChanged = false;

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
   */
  function isImageFile(file) {
    return file && file.type.startsWith('image/');
  }

  // Track changes to FIRST name
  accountFirstNameInput.addEventListener('input', () => {
    accountFormData.set('firstName', accountFirstNameInput.value);
    enableAccountButtons();
  });

  // Track changes to LAST name
  accountLastNameInput.addEventListener('input', () => {
    accountFormData.set('lastName', accountLastNameInput.value);
    enableAccountButtons();
  });

  // Track changes to email
  accountEmailInput.addEventListener('input', () => {
    accountFormData.set('email', accountEmailInput.value);
    enableAccountButtons();
  });

  // Track changes to avatar
  accountProfileAvatarInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      if (isImageFile(file)) {
        updateAccountAvatarPreview(file);
        accountFormData.set('avatar', file);
        enableAccountButtons();
      } else {
        showAlert('error', 'Only image files are allowed for Profile Avatar.');
        accountProfileAvatarInput.value = '';
      }
    }
  });

  function updateAccountAvatarPreview(file) {
    const reader = new FileReader();
    const uploadedAvatarPreview = accountForm.querySelector('.uploaded-avatar-preview');

    reader.onload = (e) => {
      if (uploadedAvatarPreview) {
        uploadedAvatarPreview.src = e.target.result;
        uploadedAvatarPreview.classList.remove('hidden');
      }
      accountAvatarPreview.src = e.target.result;
    };

    reader.readAsDataURL(file);
  }

  // Handle SAVE
  accountSaveButton.addEventListener('click', async (event) => {
    event.preventDefault();
    accountSpinner.style.display = 'inline-block';
    accountSaveButton.disabled = true;
    accountCancelButton.disabled = true;

    try {
      const response = await fetch('/settings/update-profile', {
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
        setTimeout(() => {
            window.location.reload();
          }, 1500);
        

        // Update initial form values
        accountInitialFormValues.firstName = result.user.firstName || '';
        accountInitialFormValues.lastName = result.user.lastName || '';
        accountInitialFormValues.email = result.user.email || '';
        accountInitialFormValues.avatar = result.user.avatar || '';

        // Reset form
        accountIsFormChanged = false;
        accountSaveButton.disabled = true;
        accountCancelButton.disabled = true;
        accountFormData = new FormData();
      } else {
        const errorData = await response.json();
        showAlert('error', errorData.message || 'Failed to update account information.');
        accountSaveButton.disabled = false;
        accountCancelButton.disabled = false;
      }
    } catch (error) {
      console.error('Error updating account info:', error);
      showAlert('error', 'An error occurred while updating account information.');
      accountSaveButton.disabled = false;
      accountCancelButton.disabled = false;
    } finally {
      accountSpinner.style.display = 'none';
    }
  });

  // Handle CANCEL
  accountCancelButton.addEventListener('click', (event) => {
    event.preventDefault();
    resetAccountForm();
  });

  function updateAccountFormValues(user) {
    accountFirstNameInput.value = user.firstName || '';
    accountLastNameInput.value = user.lastName || '';
    accountEmailInput.value = user.email || '';
    accountAvatarPreview.src = user.avatar || '';
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
    const companyInfoWebsiteInput = document.getElementById('company-info-website');
    const companyInfoAddressInput = document.getElementById('company-address');
    const companyInfoPhoneInput = document.getElementById('company-phone');
    const companyLogoInput = document.getElementById('company-logo');
    const companyLogoPreview = document.querySelector('.company-logo-preview');

    const logoPreviewContainer = document.getElementById('companyLogoPreviewContainer');


if (logoPreviewContainer && companyLogoPreview) {
  // If the src includes "placeholder-logo.png" or is empty, hide the container:
  if (
    !companyLogoPreview.src ||
    companyLogoPreview.src.includes('placeholder-logo.png')
  ) {
    logoPreviewContainer.style.display = 'none';
  } else {
    // If there's a real logo, show it
    logoPreviewContainer.style.display = 'block';
  }
}


    // Branding color elements
    const colorPickerContainer = document.getElementById('color-picker-container');
    const companyBrandingColorInput = document.getElementById('company-branding-color');

    // Create spinner element for the Save button
    const companyInfoSpinner = document.createElement('div');
    companyInfoSpinner.classList.add('spinner-border', 'spinner-border-sm', 'ms-2');
    companyInfoSpinner.setAttribute('role', 'status');
    companyInfoSpinner.style.display = 'none';
    companyInfoSaveButton.appendChild(companyInfoSpinner);



    // =====================
    // Original form values
    // =====================
    const companyInfoInitialFormValues = {
        companyName: companyInfoNameInput.value || '',
        website: companyInfoWebsiteInput.value || '',
        address: companyInfoAddressInput.value || '',
        phone: companyInfoPhoneInput.value || '',
        logo: companyLogoPreview.src || '',
        companyBrandingColor: companyBrandingColorInput ? (companyBrandingColorInput.value || '') : ''
    };

    function toAbsoluteUrl(possiblyRelativeUrl) {
        // If it's empty or null, just return an empty string
        if (!possiblyRelativeUrl) return '';
      
        // Create an <a> element so the browser resolves the .href
        const a = document.createElement('a');
        a.href = possiblyRelativeUrl;
        // Now a.href is the absolute version
        return a.href;
      }

      // Instead of referencing user, just read the preview src:
let initLogo = companyLogoPreview.src;

// If that src is empty or placeholder, unify it:
if (!initLogo || initLogo.includes('placeholder-logo.png')) {
  initLogo = '/images/placeholder-logo.png';
}

companyInfoInitialFormValues.logo = toAbsoluteUrl(initLogo);


      

   


  

    // =====================
    // Form Data + State
    // =====================
    let companyInfoFormData = new FormData();
    // let companyInfoIsFormChanged = false;

    // =====================
    // Helper Functions
    // =====================

    /**
     * Enables the Save and Cancel buttons once there's any unsaved change.
     * This was part of the old functionality to immediately enable them as soon
     * as a field changes (like a new logo).
     */
    function enableCompanyInfoButtons() {
        if (!companyInfoIsFormChanged) {
            companyInfoIsFormChanged = true;
            companyInfoSaveButton.disabled = false;
            companyInfoCancelButton.disabled = false;
        }
    }

/**
 * Checks if current fields differ from the original form values.
 * If all revert to their initial state, disable the Save/Cancel buttons.
 * 
 * @param {boolean} debug - If true, logs detailed info about which fields changed.
 */
function checkCompanyInfoChanged(debug = false) {
  // 1) Grab the initial object & the current values
  const init = companyInfoInitialFormValues;
  let currentName    = companyInfoNameInput.value.trim();
  let currentWebsite = companyInfoWebsiteInput.value.trim();
  let currentAddress = companyInfoAddressInput.value.trim();
  let currentPhone   = companyInfoPhoneInput.value.trim();

  // Convert what the <img> actually shows to absolute
  let currentLogo = toAbsoluteUrl(companyLogoPreview.src);
  let initLogo    = init.logo;  

  // For color input (branding color)
  let initColor    = (init.companyBrandingColor || '').toLowerCase();
  let currentColor = (companyBrandingColorInput.value || '').toLowerCase();

  // 2) If both logos are placeholders, unify them so they compare equal
  const isPlaceholderCurrent = currentLogo.includes('placeholder-logo.png');
  const isPlaceholderInit    = initLogo.includes('placeholder-logo.png');

  if (isPlaceholderCurrent && isPlaceholderInit) {
    currentLogo = 'PLACEHOLDER';
    initLogo    = 'PLACEHOLDER';
  }

  // 3) Build a list of which fields have changed
  let changedFields = [];

  if (currentName !== init.companyName) {
    changedFields.push({
      field: 'companyName',
      from: init.companyName,
      to: currentName
    });
  }
  if (currentWebsite !== init.website) {
    changedFields.push({
      field: 'website',
      from: init.website,
      to: currentWebsite
    });
  }
  if (currentAddress !== init.address) {
    changedFields.push({
      field: 'address',
      from: init.address,
      to: currentAddress
    });
  }
  if (currentPhone !== init.phone) {
    changedFields.push({
      field: 'phone',
      from: init.phone,
      to: currentPhone
    });
  }
  if (currentLogo !== initLogo) {
    changedFields.push({
      field: 'logo',
      from: initLogo,
      to: currentLogo
    });
  }
  if (currentColor !== initColor) {
    changedFields.push({
      field: 'color',
      from: initColor,
      to: currentColor
    });
  }

  // 4) If any fields changed => mark form as dirty, enable Save/Cancel
  if (changedFields.length > 0) {
    companyInfoIsFormChanged = true;
    companyInfoSaveButton.disabled = false;
    companyInfoCancelButton.disabled = false;

    if (debug) {
      console.warn("Company Info => Fields changed:", changedFields);
    }

  } else {
    // No fields differ => not dirty
    companyInfoIsFormChanged = false;
    companyInfoSaveButton.disabled = true;
    companyInfoCancelButton.disabled = true;
  }
}

      

    /**
     * Checks if a file is an image.
     */
    function isImageFile(file) {
        return file && file.type.startsWith('image/');
    }

    // =====================
    // Event Listeners
    // =====================

    // Track changes on textual fields
    companyInfoNameInput.addEventListener('input', () => {
        companyInfoFormData.set('companyInfoName', companyInfoNameInput.value);
        enableCompanyInfoButtons();
        checkCompanyInfoChanged();
    });

    companyInfoWebsiteInput.addEventListener('input', () => {
        companyInfoFormData.set('companyInfoWebsite', companyInfoWebsiteInput.value);
        enableCompanyInfoButtons();
        checkCompanyInfoChanged();
    });

    companyInfoAddressInput.addEventListener('input', () => {
        companyInfoFormData.set('companyAddress', companyInfoAddressInput.value);
        enableCompanyInfoButtons();
        checkCompanyInfoChanged();
    });

    companyInfoPhoneInput.addEventListener('input', () => {
        companyInfoFormData.set('companyPhone', companyInfoPhoneInput.value);
        enableCompanyInfoButtons();
        checkCompanyInfoChanged();
    });

    // Manually typing in the color input (hidden input) => also track changes
    if (companyBrandingColorInput) {
        companyBrandingColorInput.addEventListener('input', () => {
            companyInfoFormData.set('companyBrandingColor', companyBrandingColorInput.value);
            enableCompanyInfoButtons();
            checkCompanyInfoChanged();
        });
    }

    companyLogoInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file && isImageFile(file)) {
            companyInfoFormData.set('company-logo', file);
            enableCompanyInfoButtons();
            updateCompanyLogoPreview(file, () => {
                checkCompanyInfoChanged();
            });
        } else if (file) {
            showAlert('error', 'Only image files (PNG, JPG, JPEG, GIF) are allowed.');
            companyLogoInput.value = '';
        }
    });

    // Drag & drop for logo
    const logoUploadBoxes = companyInfoForm.querySelectorAll('.upload-box');
    logoUploadBoxes.forEach(uploadBox => {
        uploadBox.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadBox.classList.add('drag-over');
        });
        uploadBox.addEventListener('dragleave', () => {
            uploadBox.classList.remove('drag-over');
        });
        uploadBox.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadBox.classList.remove('drag-over');

            const file = e.dataTransfer.files[0];
            if (file && isImageFile(file)) {
                companyLogoInput.files = e.dataTransfer.files;
                updateCompanyLogoPreview(file, () => {
                    companyInfoFormData.set('company-logo', file);
                    enableCompanyInfoButtons();
                    checkCompanyInfoChanged();
                  });
            } else if (file) {
                showAlert('error', 'Only image files are allowed for Company Logo.');
                companyLogoInput.value = '';
            }
        });
    });

    // =====================
    // Helper: Update Logo Preview
    // =====================
    function updateCompanyLogoPreview(file, callback) {
        const reader = new FileReader();
        const uploadedLogoPreview = document.getElementById('companyLogoPreview');
        const logoPreviewContainer = document.getElementById('companyLogoPreviewContainer');
      
        reader.onload = (e) => {
          if (uploadedLogoPreview) {
            uploadedLogoPreview.src = e.target.result;
          }
          if (logoPreviewContainer) {
            logoPreviewContainer.style.display = 'block';
          }
          if (typeof callback === 'function') {
            callback(); // <-- This fires AFTER the src has changed
          }
        };
        reader.readAsDataURL(file);
      }
      

    // Toggle “Not yet uploaded” label


    // =====================
    // SAVE (Submit) Handler
    // =====================
    companyInfoSaveButton.addEventListener('click', async (event) => {
        event.preventDefault();

        // Basic validation (just website as example)
        const companyWebsite = companyInfoWebsiteInput.value.trim();
        let errors = {};
        if (companyWebsite && !isValidURL(companyWebsite)) {
            errors.companyInfoWebsite = 'Please enter a valid URL.';
        }
        if (Object.keys(errors).length > 0) {
            Object.values(errors).forEach(msg => showAlert('error', msg));
            return;
        }

        // Show spinner and disable buttons
        companyInfoSpinner.style.display = 'inline-block';
        companyInfoSaveButton.disabled = true;
        companyInfoCancelButton.disabled = true;

        try {
            const response = await fetch('/settings/update-company-info', {
                method: 'POST',
                body: companyInfoFormData,
                headers: { 'X-Requested-With': 'XMLHttpRequest' }
            });

            if (response.ok) {
                const result = await response.json();
                updateCompanyInfoFormValues(result.firm);
                showAlert('success', result.message || 'Company information updated successfully!');
                setTimeout(() => {
                    window.location.reload();
                  }, 1500);
                

                // Update initial form values so that reverting disables the buttons
                companyInfoInitialFormValues.companyName = result.firm.companyName || '';
                companyInfoInitialFormValues.website = result.firm.companyWebsite || '';
                companyInfoInitialFormValues.address = result.firm.companyAddress || '';
                companyInfoInitialFormValues.phone = result.firm.phoneNumber || '';
                companyInfoInitialFormValues.logo = result.firm.companyLogo || '';
                companyInfoInitialFormValues.companyBrandingColor = result.firm.companyBrandingColor || '';

                // Reset state
                companyInfoIsFormChanged = false;
                companyInfoFormData = new FormData();
                companyInfoSaveButton.disabled = true;
                companyInfoCancelButton.disabled = true;

                // Toggle "Not yet uploaded" if no logo
                if (result.user && result.user.companyLogo) {
                    toggleNoLogoText(false);
                } else {
                    toggleNoLogoText(true);
                }

            } else {
                const errorData = await response.json();
                showAlert('error', errorData.message || 'Failed to update company information.');
                companyInfoSaveButton.disabled = false;
                companyInfoCancelButton.disabled = false;
            }
        } catch (error) {
            console.error('Error updating company info:', error);
            showAlert('error', 'An error occurred while updating company information.');
            companyInfoSaveButton.disabled = false;
            companyInfoCancelButton.disabled = false;
        } finally {
            companyInfoSpinner.style.display = 'none';
            toggleNoLogoText(false);
        }
    });

    // =====================
    // CANCEL Handler
    // =====================
    companyInfoCancelButton.addEventListener('click', (event) => {
        event.preventDefault();
        resetCompanyInfoForm();
    });

    /**
     * Updates the DOM fields with new data from the server
     */
    function updateCompanyInfoFormValues(firm) {
        companyInfoNameInput.value = firm.companyName || '';
        companyInfoWebsiteInput.value = firm.companyWebsite || '';
        companyInfoAddressInput.value = firm.companyAddress || '';
        companyInfoPhoneInput.value = firm.phoneNumber || '';

        if (firm.companyLogo) {
            companyLogoPreview.src = firm.companyLogo;
            toggleNoLogoText(false);
        } else {
            companyLogoPreview.src = '';
            toggleNoLogoText(true);
        }

        if (companyBrandingColorInput) {
            companyBrandingColorInput.value = firm.companyBrandingColor || '';
            if (pickr) {
                pickr.setColor(firm.companyBrandingColor || '#FFFFFF');
                pickr.getRoot().button.style.backgroundColor = firm.companyBrandingColor || '#FFFFFF';
            }
        }
    }



    // ======================
    // PICKR Initialization
    // ======================
    let pickr = null;
    if (colorPickerContainer && companyBrandingColorInput) {
        console.log('[DEBUG] companyBrandingColorInput (on load) =>', companyBrandingColorInput.value);
        pickr = Pickr.create({
            el: colorPickerContainer,
            theme: 'classic',
            default: companyBrandingColorInput.value || '#282e38',
            swatches: [
                '#F44336','#E91E63','#9C27B0','#673AB7',
                '#3F51B5','#2196F3','#03A9F4','#00BCD4',
                '#009688','#4CAF50','#8BC34A','#CDDC39',
                '#FFEB3B','#FFC107','#FF9800','#FF5722',
                '#795548','#607D8B','#000000','#FFFFFF'
            ],
            components: {
                preview: true,
                opacity: false,
                hue: true,
                interaction: {
                    hex: true,
                    input: true,
                    clear: true,
                    save: false
                }
            }
        });

        pickr.on('init', () => {
            const initHex = companyBrandingColorInput.value || '#FFFFFF';
            console.log('[DEBUG] Pickr on init: Setting color =>', initHex);
            pickr.setColor(initHex);
            pickr.getRoot().button.style.backgroundColor = initHex;
        });

        pickr.on('change', (color) => {
            const hexColor = color.toHEXA().toString();
            console.log('[DEBUG] Pickr on change => new color:', hexColor);

            companyBrandingColorInput.value = hexColor;
            pickr.getRoot().button.style.backgroundColor = hexColor;

            companyInfoFormData.set('companyBrandingColor', hexColor);
            enableCompanyInfoButtons();  // Immediately enable on color change
            checkCompanyInfoChanged();   // Also re-check for revert
        });
        if (window.IS_ADMIN_ACCESS === false) {
            pickr.disable(); 
          }
    }
}





function isAnyFormDirty() {
  // Evaluate your global flags
  const dirty = accountIsFormChanged || companyInfoIsFormChanged || bucketsSettingsDirty;
  

  // Add some debug logging:
  if (dirty) {
      console.warn("⚠️ isAnyFormDirty() = TRUE. Breakdown:", {
          accountIsFormChanged,
          companyInfoIsFormChanged,
          bucketsSettingsDirty
      });
  } else {
      console.log("isAnyFormDirty() = false");
  }

      // DEBUG FIELD DETAILS
      if (companyInfoIsFormChanged) {
        checkCompanyInfoChanged(true); // 👈 show which fields changed
      }
      if (accountIsFormChanged) {
        checkAccountFormChanged?.(true); // if you add this for account too
      }

  return dirty;
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
                setTimeout(() => {
                    window.location.reload();
                  }, 1500);
                

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


// ========================
// Buckets Value Add Settings
// ========================

const bucketsTabPanel = document.getElementById('value-adds');
if (bucketsTabPanel) {
  // References
  const bucketsEnabledCheckbox = document.getElementById('buckets-enabled');
  const bucketsTitleInput = document.getElementById('buckets-title');
  const bucketsDisclaimerTextarea = document.getElementById('buckets-disclaimer');

  const valueAddsSaveButton = document.getElementById('valueadds-save-button');
  const valueAddsCancelButton = document.getElementById('valueadds-cancel-button');

  // New references for expand/collapse
  const bucketsExpandBtn = document.getElementById('bucketsExpandBtn');
  const bucketsSettingsPanel = document.getElementById('bucketsSettingsPanel');

  // Track initial state
  let initialBucketsSettings = {
    bucketsEnabled: true,
    bucketsTitle: 'Buckets Strategy',
    bucketsDisclaimer: 'Default disclaimer text...'
  };
  let bucketsSettingsDirty = false;

  // Expand/Collapse logic
  bucketsExpandBtn.addEventListener('click', () => {
    if (bucketsSettingsPanel.style.display === 'none') {
      bucketsSettingsPanel.style.display = 'block';
      bucketsExpandBtn.innerHTML = '<i class="material-symbols-outlined">arrow_drop_up</i> Hide Settings';
    } else {
      bucketsSettingsPanel.style.display = 'none';
      bucketsExpandBtn.innerHTML = '<i class="material-symbols-outlined">arrow_drop_down</i> Show Settings';
    }
  });

  function checkBucketsDirty() {
    const currentEnabled = bucketsEnabledCheckbox.checked;
    const currentTitle = bucketsTitleInput.value;
    const currentDisclaimer = bucketsDisclaimerTextarea.value;

    bucketsSettingsDirty =
      currentEnabled !== initialBucketsSettings.bucketsEnabled ||
      currentTitle !== initialBucketsSettings.bucketsTitle ||
      currentDisclaimer !== initialBucketsSettings.bucketsDisclaimer;

    updateBucketsButtons();
  }

  function updateBucketsButtons() {
    if (bucketsSettingsDirty) {
      valueAddsSaveButton.disabled = false;
      valueAddsCancelButton.disabled = false;
    } else {
      valueAddsSaveButton.disabled = true;
      valueAddsCancelButton.disabled = true;
    }
  }

  async function loadBucketsSettings() {
    try {
      const response = await fetch('/settings/value-adds', {
        method: 'GET',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!response.ok) {
        throw new Error('Failed to fetch Buckets settings');
      }
      const data = await response.json();
      bucketsEnabledCheckbox.checked = data.bucketsEnabled;
      bucketsTitleInput.value = data.bucketsTitle;
      bucketsDisclaimerTextarea.value = data.bucketsDisclaimer;

      initialBucketsSettings = {
        bucketsEnabled: data.bucketsEnabled,
        bucketsTitle: data.bucketsTitle,
        bucketsDisclaimer: data.bucketsDisclaimer
      };
      bucketsSettingsDirty = false;
      updateBucketsButtons();
    } catch (err) {
      console.error(err);
      showAlert('error', 'Could not load Buckets settings');
    }
  }

  async function saveBucketsSettings() {
    const payload = {
      bucketsEnabled: bucketsEnabledCheckbox.checked,
      bucketsTitle: bucketsTitleInput.value,
      bucketsDisclaimer: bucketsDisclaimerTextarea.value
    };

    try {
      const response = await fetch('/settings/value-adds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update Buckets settings');
      }
      const result = await response.json();
      showAlert('success', result.message || 'Buckets settings updated!');

      initialBucketsSettings = {
        bucketsEnabled: result.bucketsEnabled,
        bucketsTitle: result.bucketsTitle,
        bucketsDisclaimer: result.bucketsDisclaimer
      };
      bucketsSettingsDirty = false;
      updateBucketsButtons();
    } catch (err) {
      console.error(err);
      showAlert('error', err.message);
    }
  }

  function cancelBucketsChanges() {
    bucketsEnabledCheckbox.checked = initialBucketsSettings.bucketsEnabled;
    bucketsTitleInput.value = initialBucketsSettings.bucketsTitle;
    bucketsDisclaimerTextarea.value = initialBucketsSettings.bucketsDisclaimer;
    bucketsSettingsDirty = false;
    updateBucketsButtons();
  }

  bucketsEnabledCheckbox.addEventListener('change', checkBucketsDirty);
  bucketsTitleInput.addEventListener('input', checkBucketsDirty);
  bucketsDisclaimerTextarea.addEventListener('input', checkBucketsDirty);

  valueAddsSaveButton.addEventListener('click', (e) => {
    e.preventDefault();
    saveBucketsSettings();
  });

  valueAddsCancelButton.addEventListener('click', (e) => {
    e.preventDefault();
    cancelBucketsChanges();
  });

  // Init
  loadBucketsSettings();
}



// function discardAllChanges() {
//     // If the Account Form exists, call its reset function
//     const accountForm = document.getElementById('account-form');
//     if (accountForm) {
//       // This is your existing "resetAccountForm" function name
//       resetAccountForm(); 
//     }
  
//     // If the Company Info Form exists
//     const companyInfoForm = document.getElementById('company-info-form');
//     if (companyInfoForm) {
//       // This is your existing function
//       resetCompanyInfoForm(); 
//     }
  
//     // If you have a Buckets form, “cancelBucketsChanges()” or something similar
//     if (typeof cancelBucketsChanges === 'function') {
//       cancelBucketsChanges();
//     }
  
//     // Finally, set all "dirty" variables to false
//     accountIsFormChanged = false;
//     companyInfoIsFormChanged = false;
//     bucketsSettingsDirty = false;
//   }
  


// If the #account-form exists, call your resetAccountForm() so it’s not dirty

if (accountForm) {
  resetAccountForm();  // sets accountIsFormChanged = false
}

// If the #company-info-form exists, reset it too

if (companyInfoForm) {
  resetCompanyInfoForm(); // sets companyInfoIsFormChanged = false
}

// Buckets => if you have a function “cancelBucketsChanges()”, call it:
if (typeof cancelBucketsChanges === 'function') {
  cancelBucketsChanges();
  bucketsSettingsDirty = false;
}



});
