// public/js/adminScript.js

// Add any client-side JavaScript you need for the admin page
// For example, handling dynamic updates, AJAX calls (if you choose to use them), etc.

// Example: Confirm before toggling company ID status
document.addEventListener('DOMContentLoaded', function () {
    const toggleButtons = document.querySelectorAll('.toggle-company-id-btn');
    toggleButtons.forEach((button) => {
      button.addEventListener('click', function (e) {
        const action = button.textContent.trim();
        if (!confirm(`Are you sure you want to ${action} this Company ID?`)) {
          e.preventDefault();
        }
      });
    });
  });
  