document.addEventListener('DOMContentLoaded', function() {

    // 1) If you haven’t already, define these functions near the top (or in a global utilities file).
//    Also ensure you have "const alertContainer = document.getElementById('alert-container');" 
//    so the code can find the container.

const alertContainer = document.getElementById('alert-container');

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

  alert.appendChild(iconContainer);
  alert.appendChild(closeContainer);
  alert.appendChild(textContainer);

  alertContainer.prepend(alert);

  // Trigger a reflow so the 'show' transition applies
  void alert.offsetWidth;

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




    const reasonCheckboxes = document.querySelectorAll('.cancel-reason');

    // 2) For each checkbox, listen for changes and toggle "selected" on the parent label
    reasonCheckboxes.forEach(chk => {
      chk.addEventListener('change', () => {
        // The parent label is .reason-option
        const label = chk.closest('.reason-option');
        if (!label) return;
        
        if (chk.checked) {
          label.classList.add('selected');
        } else {
          label.classList.remove('selected');
        }
      });
    });

    // Grab the Cancel Subscription button that triggers the modal
    const cancelButton  = document.getElementById('explicit-cancel-button');
    const cancelModalEl = document.getElementById('cancelSubscriptionModal');
    const cancelModal   = new bootstrap.Modal(cancelModalEl, {
      backdrop: 'static',
      keyboard: false
    });
  
    // Step body containers
    const step1Body = document.getElementById('cancel-wizard-step-1');
    const step2Body = document.getElementById('cancel-wizard-step-2');
    const step3Body = document.getElementById('cancel-wizard-step-3');
    const step4Body = document.getElementById('cancel-wizard-step-4');
    const step5Body = document.getElementById('cancel-wizard-step-5');
    const step6Body = document.getElementById('cancel-wizard-step-6');
  
    // Step footer containers
    const footerStep1 = document.querySelector('.footer-step1');
    const footerStep2 = document.querySelector('.footer-step2');
    const footerStep3 = document.querySelector('.footer-step3');
    const footerStep4 = document.querySelector('.footer-step4');
    const footerStep5 = document.querySelector('.footer-step5');
    const footerStep6 = document.querySelector('.footer-step6');
  
    // Buttons in the footer for each step
    const step1ContinueBtn   = document.getElementById('cancel-step1-continue');
    const step1KeepPlanBtn   = document.getElementById('cancel-step1-keepPlan');
  
    const step2BackBtn       = document.getElementById('cancel-step2-back');
    const step2NextBtn       = document.getElementById('cancel-step2-next');
  
    const step3BackBtn       = document.getElementById('cancel-step3-back');
    const step3ScheduleBtn   = document.getElementById('cancel-step3-schedule');
    const step3CancelAnyway  = document.getElementById('cancel-step3-cancelAnyway');
  
    const step4BackBtn       = document.getElementById('cancel-step4-back');
    const step4NextBtn       = document.getElementById('cancel-step4-next');
  
    const step5BackBtn       = document.getElementById('cancel-step5-back');
    const step5NextBtn       = document.getElementById('cancel-step5-next');
  
    const step6BackBtn       = document.getElementById('cancel-step6-back');
    const finalCancelCheckbox= document.getElementById('final-cancel-checkbox');
    const confirmCancelBtn   = document.getElementById('cancel-confirm-cancel');
  
    // Current wizard step
    let currentStep = 1;
  
    // Data store for user feedback
    let selectedReasons   = [];
    let scheduledMeeting  = false;
    let pricingFeedback   = '';
    let freeformFeedback  = '';
  
    // Final date display in Step 6
    const finalCancelDateEl = document.getElementById('final-cancel-end-date');
    function updateFinalCancelDateUI(dateString) {
      if (finalCancelDateEl) {
        finalCancelDateEl.textContent = dateString || 'the end of your billing period';
      }
    }
    // If you have a nextBillDate, you can do: updateFinalCancelDateUI("MM/DD/YYYY") on load.
  
    // OPEN the modal on "Cancel Subscription" click
    if (cancelButton) {
        cancelButton.addEventListener('click', async () => {
          try {
            // 1) Fetch current billing info from server
            const res = await fetch('/settings/billing');
            const data = await res.json();
      
            // 2) If we got a valid nextBillDate, update the final-cancel-end-date
            if (res.ok && data.nextBillDate) {
              // Convert date string into a localized format, e.g. mm/dd/yyyy
              const dateObj = new Date(data.nextBillDate);
              const dateString = dateObj.toLocaleDateString(); 
              updateFinalCancelDateUI(dateString);
            }
          } catch (error) {
            console.error('Error fetching billing info:', error);
          }
          
          // 3) Finally, show Step 1 of the wizard + open the modal
          showStep(1);
          cancelModal.show();
        });
      }
      
  
    // Step 1
    step1ContinueBtn?.addEventListener('click', () => showStep(2));
    step1KeepPlanBtn?.addEventListener('click', () => cancelModal.hide());
  
    // Step 2
    step2BackBtn?.addEventListener('click', () => showStep(1));
    step2NextBtn?.addEventListener('click', () => {
      const reasonCheckboxes = document.querySelectorAll('.cancel-reason');
      selectedReasons = Array.from(reasonCheckboxes)
        .filter(chk => chk.checked)
        .map(chk => chk.value);
  
      showStep(3);
    });
  
    // Step 3
    step3BackBtn?.addEventListener('click', () => showStep(2));
    step3ScheduleBtn?.addEventListener('click', () => {
      scheduledMeeting = true;
      showAlert('success','Opening scheduling link...');
      showStep(4);
    });
    step3CancelAnyway?.addEventListener('click', () => {
      scheduledMeeting = false;
      showStep(4);
    });
  
    // Step 4
    step4BackBtn?.addEventListener('click', () => showStep(3));
    step4NextBtn?.addEventListener('click', () => {
      const pricingRadios = document.querySelectorAll('.pricing-feedback');
      const checkedRadio = Array.from(pricingRadios).find(r => r.checked);
      pricingFeedback = checkedRadio ? checkedRadio.value : '';
      showStep(5);
    });
  
    // Step 5
    step5BackBtn?.addEventListener('click', () => showStep(4));
    step5NextBtn?.addEventListener('click', () => {
      const freeformTextArea = document.getElementById('cancelFreeformFeedback');
      freeformFeedback = freeformTextArea.value.trim();
      showStep(6);
    });
  
    // Step 6
    step6BackBtn?.addEventListener('click', () => showStep(5));
    finalCancelCheckbox?.addEventListener('change', () => {
      confirmCancelBtn.disabled = !finalCancelCheckbox.checked;
    });
  
    confirmCancelBtn?.addEventListener('click', async () => {
      if (!finalCancelCheckbox.checked) return;
      // Prepare data
      const bodyData = {
        feedback: {
          reasons: selectedReasons,
          scheduledMeeting,
          pricingFeedback,
          freeformFeedback
        }
      };
      try {
        const res = await fetch('/settings/billing/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyData)
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.message || 'Failed to cancel subscription.');
  
        showAlert('error', result.message || 'Your subscription is pending cancellation.');
        cancelModal.hide();
        window.location.reload();
  
      } catch (err) {
        console.error('Error finalizing cancellation:', err);
        showAlert('Error', err.message || 'An error occurred while canceling your subscription.');
      }
    });
  
  
    /**
     * showStep - Shows the appropriate "step" in the body + the correct footer group
     */
    function showStep(stepNumber) {
      currentStep = stepNumber;
  
      // 1) Hide all step bodies
      [step1Body, step2Body, step3Body, step4Body, step5Body, step6Body].forEach(div => {
        div.style.display = 'none';
      });
      // 2) Hide all footers
      [footerStep1, footerStep2, footerStep3, footerStep4, footerStep5, footerStep6].forEach(div => {
        div.style.display = 'none';
      });
  
      // 3) Show only the step we want
      switch (stepNumber) {
        case 1:
          step1Body.style.display = 'flex';
          footerStep1.style.display = 'flex';
          break;
        case 2:
          step2Body.style.display = 'flex';
          footerStep2.style.display = 'flex';
          break;
        case 3:
          step3Body.style.display = 'flex';
          footerStep3.style.display = 'flex';
          break;
        case 4:
          step4Body.style.display = 'flex';
          footerStep4.style.display = 'flex';
          break;
        case 5:
          step5Body.style.display = 'flex';
          footerStep5.style.display = 'flex';
          break;
        case 6:
          step6Body.style.display = 'flex';
          footerStep6.style.display = 'flex';
          break;
      }
    }
  
  });
  