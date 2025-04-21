// public/js/billingLimited.js

document.addEventListener('DOMContentLoaded', () => {
    /******************************************
     * 0) GLOBAL VARIABLES / STATE
     ******************************************/
    let stripe, elements, cardElement;
    let userHasCardOnFile = false;
  
    // We can read .env-like constants if you’re inserting them server-side:
    const MONTHLY_PRO_COST_PER_SEAT = parseFloat(window.PRO_COST_PER_SEAT || '95');
    const RAW_ANNUAL_PRO_COST_PER_SEAT = 1140; // or 1026, depends on your actual setup
  
    // Current known subscription details from loadBillingInfo()
    let userCurrentTier = 'free';
    let userCurrentSeats = 1;
    let userCurrentInterval = 'monthly'; // or 'annual'
  
    // Tracks the wizard's state
    let selectedPlan = 'free';
    let billingInterval = 'monthly';
    let seatCount = 1;
  
    // So we can jump back to subscription wizard after editing card
    let cameFromSubscriptionWizard = false;
  
  
    /******************************************
     * 1) ENHANCED ALERT FUNCTION (from billing.js)
     ******************************************/
    function showAlert(type, message, options = {}) {
      // If you have an #alert-container on your limited page, use it.
      const alertContainer = document.getElementById('alert-container');
      if (!alertContainer) {
        // fallback if container not found
        alert(message);
        return;
      }
  
      const alert = document.createElement('div');
      alert.className = `alert ${type === 'success' ? 'alert-success' : 'alert-error'}`;
      alert.setAttribute('role', 'alert');
  
      // Icon container
      const iconContainer = document.createElement('div');
      iconContainer.className = type === 'success' ? 'success-icon-container' : 'error-icon-container';
      const icon = document.createElement('i');
      icon.className = type === 'success' ? 'far fa-check-circle' : 'far fa-times-circle';
      iconContainer.appendChild(icon);
  
      // Close button
      const closeContainer = document.createElement('div');
      closeContainer.className = 'success-close-container';
      const closeIcon = document.createElement('span');
      closeIcon.className = 'material-symbols-outlined successCloseIcon';
      closeIcon.innerText = 'close';
      closeContainer.appendChild(closeIcon);
  
      // Text
      const textContainer = document.createElement('div');
      textContainer.className = 'success-text';
      const title = document.createElement('h3');
      title.innerText = (type === 'success') ? 'Success!' : 'Error!';
      const text = document.createElement('p');
      text.innerText = message;
      textContainer.appendChild(title);
      textContainer.appendChild(text);
  
      // Optional "Undo" button
      if (options.undo) {
        const undoButton = document.createElement('button');
        undoButton.className = 'alert-undo-button';
        undoButton.innerText = 'Undo';
        undoButton.addEventListener('click', () => {
          if (typeof options.undoCallback === 'function') {
            options.undoCallback();
          }
          closeAlert(alert);
        });
        textContainer.appendChild(undoButton);
      }
  
      // Combine
      alert.appendChild(iconContainer);
      alert.appendChild(closeContainer);
      alert.appendChild(textContainer);
      alertContainer.prepend(alert);
  
      // Animate in
      void alert.offsetWidth;
      alert.classList.add('show');
  
      // Auto-close
      setTimeout(() => closeAlert(alert), 5000);
  
      // Close logic
      function closeAlert(el) {
        el.classList.add('exit');
        setTimeout(() => {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 500);
      }
  
      closeIcon.addEventListener('click', () => closeAlert(alert));
    }
  
  
    /******************************************
     * 2) INIT STRIPE ELEMENTS (from billing.js)
     ******************************************/
    function initStripeElements() {
      if (!window.STRIPE_PUBLIC_KEY) {
        console.warn('STRIPE_PUBLIC_KEY not set. Stripe elements will not be initialized.');
        return;
      }
      stripe = Stripe(window.STRIPE_PUBLIC_KEY);
      elements = stripe.elements();
  
      cardElement = elements.create('card', {
        style: {
          base: { fontSize: '16px', color: '#32325d' },
        },
      });
      const cardContainer = document.getElementById('card-element');
      if (cardContainer) {
        cardElement.mount('#card-element');
      } else {
        console.warn("No #card-element found on the page");
      }
    }
    initStripeElements();
  
  
    /******************************************
     * 3) LOAD BILLING INFO
     ******************************************/
    async function loadBillingInfo() {
      try {
        const res = await fetch('/settings/billing', {
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to load billing info.');
  
        // Fill the "Current Plan" row
        const planTextEl        = document.getElementById('current-plan-text');
        const seatsEl           = document.getElementById('current-seats-purchased');
        const frequencyEl       = document.getElementById('current-billing-frequency');
        const nextBillEl        = document.getElementById('current-next-bill');
        const brandEl           = document.getElementById('payment-method-brand');
        const last4El           = document.getElementById('payment-method-last4');
        const cancellationAlert = document.getElementById('cancellation-banner'); // if you have it
  
        userCurrentTier     = data.subscriptionTier || 'free';
        userCurrentSeats    = data.seatsPurchased || 1;
        userCurrentInterval = (data.billingInterval && data.billingInterval.toLowerCase() === 'annual') ? 'annual' : 'monthly';
  
        if (planTextEl) planTextEl.textContent = userCurrentTier;
        if (seatsEl) seatsEl.textContent = userCurrentSeats;
        if (frequencyEl) frequencyEl.textContent = data.billingInterval || 'N/A';
        if (nextBillEl) {
          nextBillEl.textContent = data.nextBillDate
            ? new Date(data.nextBillDate).toLocaleDateString()
            : 'N/A';
        }
  
        if (data.paymentMethodBrand) {
          if (brandEl)  brandEl.textContent = data.paymentMethodBrand + ' ****';
          if (last4El)  last4El.textContent = data.paymentMethodLast4 || '';
          userHasCardOnFile = true;
        } else {
          if (brandEl)  brandEl.textContent = 'No card';
          if (last4El)  last4El.textContent = '';
          userHasCardOnFile = false;
        }
  
        // Show/hide a cancellation banner
        if (data.cancelAtPeriodEnd && cancellationAlert) {
          cancellationAlert.style.display = 'block';
          cancellationAlert.textContent = data.nextBillDate
            ? `Your plan is set to cancel at the end of this billing period on ${new Date(data.nextBillDate).toLocaleDateString()}.`
            : 'Your plan is set to cancel at the end of this billing period.';
        } else if (cancellationAlert) {
          cancellationAlert.style.display = 'none';
        }
  
      } catch (err) {
        console.error('Error loading billing info:', err);
        showAlert('error', err.message);
      }
    }
    loadBillingInfo();
  
  
    /******************************************
     * 4) DOM REFERENCES
     ******************************************/
    // Subscription wizard
    const subscriptionModalEl = document.getElementById('subscriptionModal');
    const updateCardModalEl   = document.getElementById('updateCardModal');
    const cancelModalEl       = document.getElementById('cancelSubscriptionModal');
  
    const subscriptionModalInstance = subscriptionModalEl
      ? new bootstrap.Modal(subscriptionModalEl, { backdrop: 'static', keyboard: false })
      : null;
  
    const updateCardModalInstance = updateCardModalEl
      ? new bootstrap.Modal(updateCardModalEl, { backdrop: 'static', keyboard: false })
      : null;
  
    const cancelModalInstance = cancelModalEl
      ? new bootstrap.Modal(cancelModalEl, { backdrop: 'static', keyboard: false })
      : null;
  
  
    // Wizard steps & nav buttons
    const wizardStep1         = document.getElementById('wizard-step-1');
    const wizardStep2         = document.getElementById('wizard-step-2');
    const wizardStep3         = document.getElementById('wizard-step-3');
    const wizardNextButton    = document.getElementById('wizard-next-button');
    const wizardPrevButton    = document.getElementById('wizard-prev-button');
    const wizardConfirmButton = document.getElementById('wizard-confirm-button');
    const wizardCancelButton  = document.getElementById('wizard-cancel-button');
  
    let currentWizardStep = 1;
  
    // Step indicator items
    const stepIndicatorItems = [
      document.getElementById('indicator-step-1'),
      document.getElementById('indicator-step-2'),
      document.getElementById('indicator-step-3'),
    ];
  
    // Plan selection
    const planFreeRadio = document.getElementById('modalPlanFreeRadio');
    const planProRadio  = document.getElementById('modalPlanProRadio');
    // Interval toggles
    const monthlyButton = document.getElementById('monthly-button');
    const annualButton  = document.getElementById('annual-button');
    // Seat input
    const seatCountInput = document.getElementById('modal-seat-count');
  
    // Payment info step
    const editPaymentMethodBtn = document.getElementById('edit-payment-method-button');
    const cardOnFileText       = document.getElementById('card-on-file-text');
  
    // Step 3 review
    const reviewPlanName        = document.getElementById('review-plan-name');
    const reviewBillingInterval = document.getElementById('review-billing-interval');
    const reviewSeatCount       = document.getElementById('review-seat-count');
    const reviewCostPerSeat     = document.getElementById('review-cost-per-seat');
    const reviewSubtotal        = document.getElementById('review-subtotal');
    const discountLine          = document.getElementById('discount-line');
    const discountAmount        = document.getElementById('review-discount-amount');
    const reviewCost            = document.getElementById('review-cost');
  
  
    // Main page buttons
    const changePlanButton   = document.getElementById('change-plan-button');
    const updateCardButton   = document.getElementById('update-card-button');
    const explicitCancelBtn  = document.getElementById('explicit-cancel-button');
    const downgradeFreeBtn   = document.getElementById('downgrade-free-button');
    const upgradeProBtn      = document.getElementById('upgrade-pro-button');
  
  
    /******************************************
     * 5) SUPPORTING FUNCTIONS
     ******************************************/
  
    function updateStepIndicator(step) {
      stepIndicatorItems.forEach((item, index) => {
        if (!item) return;
        const stepNumberElem = item.querySelector('.wizard-number');
        const stepIndex = index + 1;
  
        if (stepIndex < step) {
          item.classList.add('completed');
          if (stepNumberElem) {
            stepNumberElem.innerHTML = '<i class="fas fa-check"></i>';
          }
        } else {
          item.classList.remove('completed');
          if (stepNumberElem) {
            stepNumberElem.textContent = stepIndex.toString();
          }
        }
  
        if (stepIndex === step) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
    }
  
    function goToStep(step) {
      currentWizardStep = step;
      if (!wizardStep1 || !wizardStep2 || !wizardStep3) return;
  
      wizardStep1.style.display = (step === 1) ? 'flex' : 'none';
      wizardStep2.style.display = (step === 2) ? 'flex' : 'none';
      wizardStep3.style.display = (step === 3) ? 'flex' : 'none';
  
      if (wizardPrevButton)   wizardPrevButton.style.display = (step > 1) ? 'inline-block' : 'none';
      if (wizardNextButton)   wizardNextButton.style.display = (step < 3) ? 'inline-block' : 'none';
      if (wizardConfirmButton)wizardConfirmButton.style.display = (step === 3) ? 'inline-block' : 'none';
      if (wizardCancelButton) wizardCancelButton.style.display  = (step === 1) ? 'inline-block' : 'none';
  
      updateStepIndicator(step);
  
      // Step-specific logic
      if (step === 2) {
        // Payment info step
        if (userHasCardOnFile) {
          if (cardOnFileText) {
            cardOnFileText.textContent = 'We will use your existing card on file:';
          }
          // Enable next
          wizardNextButton.disabled = false;
        } else {
          if (cardOnFileText) {
            cardOnFileText.textContent = 'No card on file. Please add or update your card.';
          }
          // Disable next until they add a card
          wizardNextButton.disabled = true;
        }
      }
      if (step === 3) {
        // Review step
        if (reviewPlanName)        reviewPlanName.textContent = selectedPlan;
        if (reviewBillingInterval) reviewBillingInterval.textContent = billingInterval;
        if (reviewSeatCount)       reviewSeatCount.textContent = (selectedPlan === 'pro') ? seatCount : '1';
  
        // Check the cost breakdown
        if (selectedPlan === 'pro') {
          const seats = seatCount;
          // monthly or annual
          if (billingInterval === 'annual') {
            // e.g. 1140 per seat pre-discount, or you can do 1026 as the discounted price
            const raw = RAW_ANNUAL_PRO_COST_PER_SEAT;
            const subtotal = seats * raw;
            // 10% discount
            const discountVal = subtotal * 0.1;
            const finalCost = subtotal - discountVal;
  
            if (reviewCostPerSeat) reviewCostPerSeat.textContent = `$${raw}`;
            if (reviewSubtotal)    reviewSubtotal.textContent    = `$${subtotal.toFixed(2)}`;
            if (discountLine)      discountLine.style.display    = 'flex';
            if (discountAmount)    discountAmount.textContent    = `- $${discountVal.toFixed(2)}`;
            if (reviewCost)        reviewCost.textContent        = `$${finalCost.toFixed(2)}`;
          } else {
            // monthly
            const monthlyRate = MONTHLY_PRO_COST_PER_SEAT;
            const subtotal = seats * monthlyRate;
  
            if (reviewCostPerSeat) reviewCostPerSeat.textContent = `$${monthlyRate}`;
            if (reviewSubtotal)    reviewSubtotal.textContent    = `$${subtotal.toFixed(2)}`;
            if (discountLine)      discountLine.style.display    = 'none';
            if (reviewCost)        reviewCost.textContent        = `$${subtotal.toFixed(2)}`;
          }
        } else if (selectedPlan === 'free') {
          // free => $0
          if (reviewCostPerSeat) reviewCostPerSeat.textContent = '$0';
          if (reviewSubtotal)    reviewSubtotal.textContent    = '$0';
          if (discountLine)      discountLine.style.display    = 'none';
          if (reviewCost)        reviewCost.textContent        = '$0.00';
        } else {
          // enterprise => handle differently
          if (reviewCost) reviewCost.textContent = '$0.00';
        }
      }
    }
  
    // If you need to show brand, last4, name, expiry on the “mock credit card”
    function updateMockCardDisplay(brand, last4, cardHolderName, expMonth, expYear) {
      const brandLogoEl      = document.getElementById('card-brand-logo');
      const cardLast4El      = document.getElementById('card-last4');
      const cardHolderNameEl = document.getElementById('card-holder-text');
      const cardExpEl        = document.getElementById('card-expiration');
  
      if (!brandLogoEl || !cardLast4El || !cardHolderNameEl || !cardExpEl) return;
  
      const normalizedBrand = (brand || '').toLowerCase();
      brandLogoEl.src = `/images/${normalizedBrand}.svg`; // fallback to generic on error
  
      cardLast4El.textContent      = last4 || '****';
      cardHolderNameEl.textContent = cardHolderName || 'N/A';
  
      if (expMonth && expYear) {
        const mm = expMonth.toString().padStart(2, '0');
        const yy = expYear.toString().slice(-2);
        cardExpEl.textContent = `${mm}/${yy}`;
      } else {
        cardExpEl.textContent = 'MM/YY';
      }
    }
  
  
    /******************************************
     * 6) HOOK UP MAIN PAGE BUTTONS
     ******************************************/
    if (changePlanButton) {
      changePlanButton.addEventListener('click', () => {
        if (!subscriptionModalInstance) return;
        // Start wizard at Step 1, using the user's current sub as a baseline
        selectedPlan     = userCurrentTier;
        billingInterval  = userCurrentInterval;
        seatCount        = userCurrentSeats;
        goToStep(1);
        subscriptionModalInstance.show();
      });
    }
  
    // Direct “Downgrade to Free” button
    if (downgradeFreeBtn) {
      downgradeFreeBtn.addEventListener('click', () => {
        if (!subscriptionModalInstance) return;
        selectedPlan = 'free';
        billingInterval = 'monthly'; // free doesn't matter
        seatCount = 1;
        goToStep(1);
        subscriptionModalInstance.show();
      });
    }
  
    // Direct “Upgrade to Pro” button
    if (upgradeProBtn) {
      upgradeProBtn.addEventListener('click', () => {
        if (!subscriptionModalInstance) return;
        selectedPlan = 'pro';
        billingInterval = 'monthly';
        seatCount = 1;
        goToStep(1);
        subscriptionModalInstance.show();
      });
    }
  
    // Cancel subscription
    if (explicitCancelBtn) {
      explicitCancelBtn.addEventListener('click', () => {
        if (!cancelModalInstance) return;
        // Open the multi-step wizard for cancellation
        cancelModalInstance.show();
      });
    }
  
    // Update card
    if (updateCardButton) {
      updateCardButton.addEventListener('click', () => {
        if (!updateCardModalInstance) return;
        cameFromSubscriptionWizard = false;
        updateCardModalInstance.show();
      });
    }
  
  
    /******************************************
     * 7) WIZARD INTERACTIONS
     ******************************************/
    // Plan radio buttons
    if (planFreeRadio) {
      planFreeRadio.addEventListener('change', () => {
        if (planFreeRadio.checked) {
          selectedPlan = 'free';
        }
      });
    }
    if (planProRadio) {
      planProRadio.addEventListener('change', () => {
        if (planProRadio.checked) {
          selectedPlan = 'pro';
        }
      });
    }
  
    // Billing interval toggles
    if (monthlyButton) {
      monthlyButton.addEventListener('click', () => {
        billingInterval = 'monthly';
        monthlyButton.classList.add('active');
        annualButton?.classList.remove('active');
      });
    }
    if (annualButton) {
      annualButton.addEventListener('click', () => {
        billingInterval = 'annual';
        annualButton.classList.add('active');
        monthlyButton?.classList.remove('active');
      });
    }
  
    // Seat count
    if (seatCountInput) {
      seatCountInput.addEventListener('input', () => {
        const val = parseInt(seatCountInput.value, 10) || 1;
        seatCount = val < 1 ? 1 : val;
      });
    }
  
    // Next / Prev
    wizardNextButton?.addEventListener('click', () => {
      if (currentWizardStep === 1) {
        // if enterprise, maybe jump straight to step 3, etc.
        goToStep(2);
      } else if (currentWizardStep === 2) {
        goToStep(3);
      }
    });
    wizardPrevButton?.addEventListener('click', () => {
      if (currentWizardStep === 2) {
        goToStep(1);
      } else if (currentWizardStep === 3) {
        goToStep(2);
      }
    });
  
    // Confirm subscription changes
    wizardConfirmButton?.addEventListener('click', async () => {
      if (selectedPlan === 'enterprise') {
        alert('Please contact Sales for Enterprise.');
        subscriptionModalInstance?.hide();
        return;
      }
      // If plan = free, just do the cancel logic
      if (selectedPlan === 'free') {
        if (!confirm('Switching to Free will cancel your Pro subscription at period end. Continue?')) return;
        try {
          const res = await fetch('/settings/billing/cancel', {
            method: 'POST',
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || 'Failed to downgrade.');
          showAlert('success', data.message);
          subscriptionModalInstance?.hide();
          loadBillingInfo();
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } catch (err) {
          console.error(err);
          showAlert('error', err.message);
        }
        return;
      }
  
      // Otherwise plan = pro
      try {
        const body = { 
          desiredSeats: seatCount, 
          billingInterval, 
          desiredTier: 'pro' 
        };
        const res = await fetch('/settings/billing/checkout', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json', 
            'X-Requested-With': 'XMLHttpRequest' 
          },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to create/update subscription.');
  
        showAlert('success', data.message);
        subscriptionModalInstance?.hide();
        loadBillingInfo();
        setTimeout(() => {
          window.location.reload();
        }, 1500);
  
      } catch (err) {
        console.error('Error upgrading to pro:', err);
        showAlert('error', err.message);
      }
    });
  
    // Cancel wizard “Cancel” button
    wizardCancelButton?.addEventListener('click', () => {
      subscriptionModalInstance?.hide();
    });
  
  
    /******************************************
     * 8) UPDATE CARD MODAL
     ******************************************/
    const saveCardBtn = document.getElementById('save-card-button');
    const closeCardModalX = document.getElementById('close-update-card-modal');
    const cancelUpdateCardBtn = document.getElementById('cancel-update-card-modal');
  
    // If user came from step 2, we close this & re-show step 2
    function closeCardModalAndReturn() {
      updateCardModalInstance?.hide();
      if (cameFromSubscriptionWizard) {
        subscriptionModalInstance?.show();
      }
    }
  
    // “X” close
    closeCardModalX?.addEventListener('click', () => {
      closeCardModalAndReturn();
    });
    // “Cancel” button
    cancelUpdateCardBtn?.addEventListener('click', () => {
      closeCardModalAndReturn();
    });
  
    // Actually save card
    saveCardBtn?.addEventListener('click', async () => {
      if (!stripe || !cardElement) {
        showAlert('error', 'Stripe not initialized.');
        return;
      }
      const cardHolderName = document.getElementById('card-holder-name')?.value.trim() || '';
      const billingEmail   = document.getElementById('card-billing-email')?.value.trim() || '';
  
      // 1) create PaymentMethod
      const { paymentMethod, error } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
        billing_details: { name: cardHolderName, email: billingEmail },
      });
      if (error) {
        showAlert('error', error.message || 'Card was declined.');
        return;
      }
  
      // 2) Send paymentMethodId to server
      try {
        const res = await fetch('/settings/billing/update-card', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json', 
            'X-Requested-With': 'XMLHttpRequest' 
          },
          body: JSON.stringify({ paymentMethodId: paymentMethod.id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to update card.');
  
        showAlert('success', data.message || 'Card updated successfully.');
        userHasCardOnFile = true;
  
        // Update the mock card display in step 2
        updateMockCardDisplay(
          data.brand      || '',
          data.last4      || '',
          data.holderName || '',
          data.expMonth   || '',
          data.expYear    || ''
        );
  
        closeCardModalAndReturn();
        loadBillingInfo(); // refresh brand/last4 on the page
        // Re-enable Next if in step 2
        if (wizardNextButton && currentWizardStep === 2) {
          wizardNextButton.disabled = false;
        }
  
      } catch (err) {
        console.error('Error updating card:', err);
        showAlert('error', err.message || 'Card update error');
      }
    });
  
  
    /******************************************
     * 9) CANCEL SUBSCRIPTION FLOW
     ******************************************/
    // For your multi-step cancel wizard, you'll replicate the same step logic, e.g.:
    // step 1 => #cancel-step1-continue, #cancel-step1-keepPlan
    // step 2 => #cancel-step2-next, #cancel-step2-back
    // ...
    // final => #cancel-confirm-cancel
    // then do fetch('/settings/billing/cancel', ...)
  
    const cancelConfirmBtn = document.getElementById('cancel-confirm-cancel');
    if (cancelConfirmBtn) {
      cancelConfirmBtn.addEventListener('click', async () => {
        // gather any feedback
        const feedback = { reason: 'Too expensive' }; // example
        try {
          const res = await fetch('/settings/billing/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            body: JSON.stringify({ feedback }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.message || 'Failed to cancel subscription.');
    
          showAlert('success', 'Subscription canceled. You will lose Pro features at period end.');
          cancelModalInstance?.hide();
          loadBillingInfo();
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } catch (err) {
          console.error('Error canceling subscription:', err);
          showAlert('error', err.message);
        }
      });
    }
  
    // (Similarly wire up your "Back" buttons for each step in the cancel wizard.)
  
  });
  