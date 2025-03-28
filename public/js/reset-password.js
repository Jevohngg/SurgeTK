// public/js/reset-password.js
// Copy and paste this entire file. No further edits needed.

document.addEventListener('DOMContentLoaded', function() {
  /*
   * =========================================
   * 1) FORGOT-PASSWORD FORM (Send Verification)
   * =========================================
   */
  const forgotPasswordForm = document.getElementById('forgot-password-form');
  const sendVerificationBtn = document.getElementById('sendVerificationBtn');

  if (forgotPasswordForm && sendVerificationBtn) {
    forgotPasswordForm.addEventListener('submit', function() {
      // 1. Lock the button width & height so it won’t shrink
      const rect = sendVerificationBtn.getBoundingClientRect();
      sendVerificationBtn.style.width = rect.width + 'px';
      sendVerificationBtn.style.height = rect.height + 'px';

      // 2. Disable the button so it cannot be clicked again
      sendVerificationBtn.disabled = true;

      // 3. Switch to spinner (hide text, show spinner)
      sendVerificationBtn.classList.add('loading');

      // The form will submit normally, so no need to call preventDefault().
    });
  }

  /*
   * =========================================
   * 2) VERIFY CODE FORM (/forgot-password/verify)
   * =========================================
   */
  const verifyForm = document.querySelector('form[action="/forgot-password/verify"]');
  const verifySubmitButton = document.getElementById('verifySubmit');

  // The 4-digit inputs
  const codeInputs = document.querySelectorAll('.verify-digit');
  // The hidden input where we store the combined code
  const verificationCodeInput = document.getElementById('verificationCode');

  // Combine digits into hidden input
  const captureCode = () => {
    const code = Array.from(codeInputs).map((input) => input.value).join('');
    if (verificationCodeInput) {
      verificationCodeInput.value = code;
    }
  };

  // Auto-focus the first field
  const firstInput = document.getElementById('digit1');
  if (firstInput) {
    firstInput.focus();

    // Allow pasting a 4-digit code into the first field
    firstInput.addEventListener('paste', (e) => {
      e.preventDefault(); // Keep ourselves in control of how the paste is handled
      const pasteData = e.clipboardData.getData('text').trim();

      // If exactly 4 characters are pasted, distribute them
      if (pasteData.length === codeInputs.length) {
        codeInputs.forEach((input, index) => {
          input.value = pasteData[index] || '';
        });
        // IMPORTANT: Manually update hidden input
        captureCode();
      }
    });
  }

  // Move focus on typing / capture code
  codeInputs.forEach((input, index) => {
    input.addEventListener('input', () => {
      // If user typed 1 character, go to the next field (if any)
      if (input.value.length === 1 && index < codeInputs.length - 1) {
        codeInputs[index + 1].focus();
      }
      // Update hidden input
      captureCode();
    });

    // If backspace on an empty field, go back
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && input.value === '' && index > 0) {
        codeInputs[index - 1].focus();
      }
    });
  });

  // Add loading state when the user clicks “Verify”
  if (verifyForm && verifySubmitButton) {
    verifyForm.addEventListener('submit', function() {
      // 1. Lock button size
      const rect = verifySubmitButton.getBoundingClientRect();
      verifySubmitButton.style.width = rect.width + 'px';
      verifySubmitButton.style.height = rect.height + 'px';

      // 2. Disable the button so it cannot be clicked again
      verifySubmitButton.disabled = true;

      // 3. Instantly hide text & show spinner
      verifySubmitButton.classList.add('loading');

      // Let the form submit normally (no preventDefault()).
    });
  }

  /*
   * =========================================
   * 3) RESEND LINK
   * =========================================
   */
  const resendLink = document.querySelector('.ctrs');
  if (resendLink) {
    resendLink.addEventListener('click', function(e) {
      e.preventDefault();
      this.textContent = 'Resending...';
      this.classList.add('disabled');
      // Simple approach: just reload or do an AJAX call to your server
      location.reload();
    });
  }

  /*
   * =========================================
   * 4) RESET-PASSWORD FORM (/reset-password)
   * =========================================
   */
  const resetPasswordForm = document.querySelector('form[action="/reset-password"]');
  const resetPasswordBtn = document.getElementById('resetPasswordBtn');

  if (resetPasswordForm && resetPasswordBtn) {
    resetPasswordForm.addEventListener('submit', function() {
      // 1. Lock the button’s width & height
      const rect = resetPasswordBtn.getBoundingClientRect();
      resetPasswordBtn.style.width = rect.width + 'px';
      resetPasswordBtn.style.height = rect.height + 'px';

      // 2. Disable the button so it can’t be clicked twice
      resetPasswordBtn.disabled = true;

      // 3. Show spinner (hide text)
      resetPasswordBtn.classList.add('loading');
      // Let normal form submission proceed.
    });
  }
});
