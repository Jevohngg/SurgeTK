document.addEventListener('DOMContentLoaded', function() {
    const inputs = document.querySelectorAll('.verify-digit');
    const verificationCodeInput = document.getElementById('verificationCode');

    // Function to capture the 4-digit code
    const captureCode = () => {
      const code = Array.from(inputs).map(input => input.value).join('');
      verificationCodeInput.value = code; // Update the hidden input with the full code
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

    const resendLink = document.querySelector('.ctrs');

    if (resendLink) {
      resendLink.addEventListener('click', function (e) {
        e.preventDefault(); // Prevent the default link behavior
        this.textContent = 'Resending...'; // Change the text
        this.classList.add('disabled'); // Disable the link to prevent multiple clicks
    
        // Simply reload the page to resend the email
        location.reload();
      });
    }
    





});
