document.addEventListener('DOMContentLoaded', () => {
  console.log('onboardingProgress:', window.onboardingProgress);

  // Function to check if all tasks in a step are complete
  function checkStepCompletion(stepContainer) {
    const stepNumber = stepContainer.querySelector('.step-number');
    const isComplete = stepContainer.getAttribute('data-step-complete') === 'true';

    if (isComplete) {
      stepNumber.innerHTML = '<span class="material-symbols-outlined">check</span>';
    } else {
      const stepNum = stepContainer.classList.contains('step-1') ? 1 :
                     stepContainer.classList.contains('step-2') ? 2 : 3;
      stepNumber.textContent = stepNum;
    }
  }

  // Function to update all step containers
  function updateStepNumbers() {
    const stepContainers = document.querySelectorAll('.step-container');
    stepContainers.forEach(container => {
      const stepClass = container.className.match(/step-\d/)[0];
      let isComplete = false;

      if (stepClass === 'step-1') {
        isComplete = !!(
          window.onboardingProgress.uploadLogo &&
          window.onboardingProgress.selectBrandColor &&
          window.onboardingProgress.inviteTeam
        );
        console.log('Step 1 complete:', isComplete, window.onboardingProgress);
      } else if (stepClass === 'step-2') {
        // UPDATED: new Step 2 logic (Create Households, Create Accounts, Assign Advisors)
        isComplete = !!(
          window.onboardingProgress.createHouseholds &&
          window.onboardingProgress.createAccounts &&
          window.onboardingProgress.assignAdvisors
        );
        console.log('Step 2 complete:', isComplete, window.onboardingProgress);
      } else if (stepClass === 'step-3') {
        // UPDATED: Ready when Step 1 AND Step 2 are fully complete
        isComplete = !!(
          window.onboardingProgress.uploadLogo &&
          window.onboardingProgress.selectBrandColor &&
          window.onboardingProgress.inviteTeam &&
          window.onboardingProgress.createHouseholds &&
          window.onboardingProgress.createAccounts &&
          window.onboardingProgress.assignAdvisors
        );
        console.log('Step 3 complete:', isComplete, window.onboardingProgress);
      }

      // Update the data attribute and UI
      container.setAttribute('data-step-complete', isComplete.toString());
      checkStepCompletion(container);
    });
  }

  // Expose onboardingProgress to the window object (assumed to be passed from the backend)
  window.onboardingProgress = window.onboardingProgress || {};

  // Initial update on page load
  updateStepNumbers();

  // Optional: Add real-time updates if tasks are completed via AJAX (if applicable)
  // You would need to fetch or listen for updates to onboardingProgress here
});
