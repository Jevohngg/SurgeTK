document.addEventListener('DOMContentLoaded', function() {
  // 1) Capture the code from 4-digit inputs (if applicable)
  const inputs = document.querySelectorAll('.verify-digit');
  const verificationCodeInput = document.getElementById('verificationCode');

  const captureCode = () => {
    const code = Array.from(inputs).map(input => input.value).join('');
    if (verificationCodeInput) verificationCodeInput.value = code;
  };

  inputs.forEach((input, index) => {
    input.addEventListener('input', () => {
      if (input.value.length === 1 && index < inputs.length - 1) {
        inputs[index + 1].focus();
      }
      captureCode();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === "Backspace" && input.value === '' && index > 0) {
        inputs[index - 1].focus();
      }
    });
  });

  // 2) Handle "Resend" link if present
  const resendLink = document.querySelector('.ctrs');
  if (resendLink) {
    resendLink.addEventListener('click', function (e) {
      e.preventDefault();
      this.textContent = 'Resending...';
      this.classList.add('disabled');
      location.reload();
    });
  }

  // 3) ADD YOUR LOADING STATE FOR THE "Send Verification Code" BUTTON
  const forgotPasswordForm = document.getElementById('forgot-password-form');
  const sendVerificationBtn = document.getElementById('sendVerificationBtn');

  if (forgotPasswordForm && sendVerificationBtn) {
    forgotPasswordForm.addEventListener('submit', function(e) {
      // (Optional) e.preventDefault() if you do AJAX.  
      // If you want normal form POST -> no preventDefault().

      // Lock the button width & height so it won't shrink when text disappears
      const rect = sendVerificationBtn.getBoundingClientRect();
      sendVerificationBtn.style.width = rect.width + "px";
      sendVerificationBtn.style.height = rect.height + "px";

      // Disable the button so it can't be clicked twice
      sendVerificationBtn.disabled = true;

      // Instantly hide text / show spinner
      sendVerificationBtn.classList.add('loading');

      // If you do want normal form submission, do NOT call e.preventDefault().
      // The form will submit normally and redirect.
    });
  }


  const verifyForm = document.querySelector('form[action="/forgot-password/verify"]');
  const verifySubmitButton = document.querySelector('#verifySubmit');

  if (verifyForm && verifySubmitButton) {
    verifyForm.addEventListener('submit', function(e) {
      console.log('Verification form is submitting to /forgot-password/verify');
      console.log('Email:', document.querySelector('input[name="email"]').value);
      console.log('verificationCodeInput.value:', verificationCodeInput.value);
      // If you want a normal form submission that navigates to another page, 
      // do NOT call e.preventDefault(). Let the form submit naturally.

      // 1) Lock the button’s current width & height
      const rect = verifySubmitButton.getBoundingClientRect();
      verifySubmitButton.style.width = rect.width + "px";
      verifySubmitButton.style.height = rect.height + "px";

      // 2) Disable the button to prevent multiple clicks
      verifySubmitButton.disabled = true;

      // 3) Add the .loading class (instantly hides text, shows spinner)
      verifySubmitButton.classList.add('loading');

      // (Optional) If you do Ajax instead of normal POST, 
      // you'd keep e.preventDefault() and handle the request yourself:
      // e.preventDefault();
      // Then on success/failure, .classList.remove('loading') if needed.
    });
  }


  const resetPasswordForm = document.querySelector('form[action="/reset-password"]');
  const resetPasswordBtn = document.getElementById('resetPasswordBtn');

  if (resetPasswordForm && resetPasswordBtn) {
    resetPasswordForm.addEventListener('submit', function (e) {
      // If you want normal form submission (navigate away),
      // do NOT call e.preventDefault().
      
      // 1) Lock button width & height
      const rect = resetPasswordBtn.getBoundingClientRect();
      resetPasswordBtn.style.width = rect.width + "px";
      resetPasswordBtn.style.height = rect.height + "px";

      // 2) Disable button to prevent repeated clicks
      resetPasswordBtn.disabled = true;

      // 3) Add .loading (instantly hides text, shows spinner)
      resetPasswordBtn.classList.add('loading');
    });
  }


});
