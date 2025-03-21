// public.js/billingRoutes.js


document.addEventListener('DOMContentLoaded', () => {

  /***********************************
   * 1) Enhanced showAlert function
   ***********************************/
  function showAlert(type, message, options = {}) {
    const alertContainer = document.getElementById('alert-container');
    if (!alertContainer) return;

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

    // A helper to close & remove the alert
    function closeAlert(alertEl) {
      alertEl.classList.add('exit');
      setTimeout(() => {
        if (alertEl && alertEl.parentNode) {
          alertEl.parentNode.removeChild(alertEl);
        }
      }, 500);
    }

    // If undo option is provided, add undo button
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

    // Assemble & prepend
    alert.appendChild(iconContainer);
    alert.appendChild(closeContainer);
    alert.appendChild(textContainer);
    alertContainer.prepend(alert);

    // Trigger fade-in
    void alert.offsetWidth;
    alert.classList.add('show');

    // Auto-close in 5s
    setTimeout(() => closeAlert(alert), 5000);

    // Close button
    closeIcon.addEventListener('click', () => closeAlert(alert));
  }

  /***********************************
   * 2) Stripe Setup
   ***********************************/
  let stripe, elements, cardElement;
  function initStripeElements() {
    if (!window.STRIPE_PUBLIC_KEY) {
      console.warn('STRIPE_PUBLIC_KEY not set. Stripe elements will not be initialized.');
      return;
    }
    stripe = Stripe(window.STRIPE_PUBLIC_KEY);
    elements = stripe.elements();

    cardElement = elements.create('card', {
      style: {
        base: {
          fontSize: '16px',
          color: '#32325d',
        },
      },
    });
    cardElement.mount('#card-element');
  }
  initStripeElements();

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // Wizard Steps / Indicators
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  const stepIndicatorItems = [
    document.getElementById('indicator-step-1'),
    document.getElementById('indicator-step-2'),
    document.getElementById('indicator-step-3'),
  ];

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 3) Billing Page Refs
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  const currentPlanText     = document.getElementById('current-plan-text');
  const currentSeatsElem    = document.getElementById('current-seats-purchased');
  const currentNextBillElem = document.getElementById('current-next-bill');
  const paymentMethodBrand  = document.getElementById('payment-method-brand');
  const paymentMethodLast4  = document.getElementById('payment-method-last4');
  const cancelProButton     = document.getElementById('cancel-pro-button');

  // Possibly optional seat adjust
  const quickSeatAdjust     = document.getElementById('quick-seat-adjust');
  const quickSeatInput      = document.getElementById('quick-seat-input');
  const quickSeatSaveButton = document.getElementById('quick-seat-save-button');

  // Plan card buttons on main page
  const downgradeFreeButton = document.getElementById('downgrade-free-button');
  const upgradeProButton    = document.getElementById('upgrade-pro-button');
  // e.g. const enterpriseButton = document.getElementById('enterprise-button');

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 4) Subscription Modal Refs (Wizard)
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  const subscriptionModal   = document.getElementById('subscriptionModal');
  const wizardStep1         = document.getElementById('wizard-step-1');
  const wizardStep2         = document.getElementById('wizard-step-2');
  const wizardStep3         = document.getElementById('wizard-step-3');
  const wizardPrevButton    = document.getElementById('wizard-prev-button');
  const wizardNextButton    = document.getElementById('wizard-next-button');
  const wizardConfirmButton = document.getElementById('wizard-confirm-button');
  const wizardCancelButton  = document.getElementById('wizard-cancel-button');

  // Step 1: plan cards + monthly/annual toggle + seat count
  const monthlyButton       = document.getElementById('monthly-button');
  const annualButton        = document.getElementById('annual-button');
  const planFreeCard        = document.getElementById('modal-plan-free');
  const planProCard         = document.getElementById('modal-plan-pro');
  const planEnterpriseCard  = document.getElementById('modal-plan-enterprise');
  const proPriceElem        = document.getElementById('modal-pro-price');
  const proSavingsElem      = document.getElementById('modal-pro-savings');
  const seatCountGroup      = document.getElementById('modal-seat-count-group');
  const seatCountInput      = document.getElementById('modal-seat-count');

  // Step 2: Payment Info
  const cardOnFileText      = document.getElementById('card-on-file-text');
  const editPaymentMethodBtn= document.getElementById('edit-payment-method-button');

  // Step 3: Review
  const reviewPlanName       = document.getElementById('review-plan-name');
  const reviewSeatCount      = document.getElementById('review-seat-count');
  const reviewBillingInterval= document.getElementById('review-billing-interval');
  const reviewCost           = document.getElementById('review-cost');

  // Wizard State
  let currentWizardStep = 1;
  let selectedPlan      = 'free';   // 'free' | 'pro' | 'enterprise'
  let billingInterval   = 'monthly';// 'monthly' | 'annual'
  let seatCount         = 1;
  let userHasCardOnFile = false;

  // For Step 2
  let lastCardBrand = '';
  let lastCard4     = '';

  // Hard-coded or from .env
  const MONTHLY_PRO_COST_PER_SEAT = parseFloat(window.PRO_COST_PER_SEAT || '95');
  const ANNUAL_PRO_COST_PER_SEAT  = parseFloat(window.PRO_COST_PER_SEAT_ANNUAL || '1026');
  const monthlyYearlyCostDiff     = (MONTHLY_PRO_COST_PER_SEAT * 12) - ANNUAL_PRO_COST_PER_SEAT;

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 5) loadBillingInfo => store user’s current sub
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  let userCurrentTier       = 'free';    // 'free'|'pro'|'enterprise'
  let userCurrentSeats      = 1;
  let userCurrentInterval   = 'monthly'; // or 'annual'

  async function loadBillingInfo() {
    try {
      const res = await fetch('/settings/billing', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to load billing info.');

      // Display info
      currentPlanText.textContent  = data.subscriptionTier || 'free';
      currentSeatsElem.textContent = data.seatsPurchased;
      currentNextBillElem.textContent = data.nextBillDate
        ? new Date(data.nextBillDate).toLocaleDateString()
        : 'N/A';

      // If you want to show a banner if cancelAtPeriodEnd is set:
      if (data.cancelAtPeriodEnd) {
        const cancellationBanner = document.getElementById('cancellation-banner');
        if (cancellationBanner) {
          cancellationBanner.textContent = data.nextBillDate
            ? `Your plan is set to cancel at the end of this billing period on ${new Date(data.nextBillDate).toLocaleDateString()}.`
            : 'Your plan is set to cancel at the end of this billing period.';
          cancellationBanner.style.display = 'block';
        }
      } else {
        // Hide the banner if no pending cancellation
        const cancellationBanner = document.getElementById('cancellation-banner');
        if (cancellationBanner) {
          cancellationBanner.style.display = 'none';
        }
      }

      // Save user’s current sub tier
      userCurrentTier  = data.subscriptionTier || 'free';
      userCurrentSeats = data.seatsPurchased  || 1;

      if (data.subscriptionInterval === 'annual') {
        userCurrentInterval = 'annual';
      } else {
        userCurrentInterval = 'monthly';
      }

      // Payment method brand & last4
      if (data.paymentMethodBrand) {
        paymentMethodBrand.textContent = data.paymentMethodBrand + ' ****';
        paymentMethodLast4.textContent = data.paymentMethodLast4 || '';
        userHasCardOnFile = true;
        lastCardBrand     = data.paymentMethodBrand;
        lastCard4         = data.paymentMethodLast4 || '';
      } else {
        paymentMethodBrand.textContent = 'No card';
        paymentMethodLast4.textContent = '';
        userHasCardOnFile = false;
        lastCardBrand     = '';
        lastCard4         = '';
      }

      // Optionally store existing billing details for the Update Card form
      window.existingBillingDetails = {
        name:    data.billingName,
        email:   data.billingEmail,
        line1:   data.billingAddressLine1,
        city:    data.billingAddressCity,
        state:   data.billingAddressState,
        postal:  data.billingAddressPostal,
        country: data.billingAddressCountry,
      };
    } catch (err) {
      console.error('Error loading billing:', err);
      showAlert('error', err.message);
    }
  }
  loadBillingInfo();

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 6) “Change Plan” => open wizard *with current sub*
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  const changePlanButton = document.getElementById('change-plan-button');
  if (changePlanButton) {
    changePlanButton.addEventListener('click', () => {
      // We open the wizard using the user’s current subscription details
      openSubscriptionWizard(userCurrentTier, userCurrentInterval, userCurrentSeats);
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 7) Cancel Subscription => set cancel_at_period_end
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  cancelProButton?.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to cancel your subscription? You will keep your plan until the end of the current billing period.')) return;
    try {
      const res = await fetch('/settings/billing/cancel', {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to cancel subscription.');
      showAlert('success', data.message);
      loadBillingInfo();
    } catch (err) {
      console.error('Error canceling subscription:', err);
      showAlert('error', err.message);
    }
  });

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 8) Quick Seat Adjust (Optional)
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  if (quickSeatSaveButton) {
    quickSeatSaveButton.addEventListener('click', async () => {
      const desiredSeats = parseInt(quickSeatInput.value, 10) || 1;
      try {
        const res = await fetch('/settings/billing/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({ desiredSeats }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to update subscription seats.');
        showAlert('success', data.message);
        loadBillingInfo();
      } catch (err) {
        console.error('Error updating seats:', err);
        showAlert('error', err.message);
      }
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 9) Another approach for specific plan buttons
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  downgradeFreeButton?.addEventListener('click', () => {
    openSubscriptionWizard('free', 'monthly', 1);
  });
  upgradeProButton?.addEventListener('click', () => {
    openSubscriptionWizard('pro', 'monthly', 1);
  });
  // enterpriseButton?.addEventListener('click', () => {
  //   openSubscriptionWizard('enterprise', 'monthly', 1);
  // });

  /*****************************************
   * openSubscriptionWizard with prefill
   *****************************************/
  function openSubscriptionWizard(plan = 'free', interval = 'monthly', seats = 1) {
    selectedPlan     = plan;
    billingInterval  = interval;
    seatCount        = seats;
    currentWizardStep= 1;

    // Reset step display
    wizardStep1.style.display = 'flex';
    wizardStep2.style.display = 'none';
    wizardStep3.style.display = 'none';

    wizardPrevButton.style.display = 'none';
    wizardNextButton.style.display = 'flex';
    wizardConfirmButton.style.display = 'none';
    wizardCancelButton.style.display = 'flex'; // Only for step 1

    // Clear any prior plan selection
    [planFreeCard, planProCard, planEnterpriseCard].forEach((card) => {
      card.classList.remove('selected-plan');
    });
    if (plan === 'free')       planFreeCard.classList.add('selected-plan');
    if (plan === 'pro')        planProCard.classList.add('selected-plan');
    if (plan === 'enterprise') planEnterpriseCard.classList.add('selected-plan');

    // Interval
    if (interval === 'annual') {
      monthlyButton.classList.remove('active');
      annualButton.classList.add('active');
    } else {
      annualButton.classList.remove('active');
      monthlyButton.classList.add('active');
    }

    // Show seat input only if pro
    seatCountGroup.style.display = (plan === 'pro') ? 'flex' : 'none';
    seatCountInput.value = seats.toString();

    // Update displayed price for Pro
    updateProPrice();

    // Clear final review
    reviewPlanName.textContent       = '';
    reviewSeatCount.textContent      = '';
    reviewBillingInterval.textContent= '';
    reviewCost.textContent           = '$0.00';

    // Step indicator => step 1
    updateStepIndicator(1);

    // Show modal
    const bsModal = new bootstrap.Modal(subscriptionModal);
    bsModal.show();
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 10) Step 1 - Plan Selection & Interval Toggle
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  [planFreeCard, planProCard, planEnterpriseCard].forEach((card) => {
    card.addEventListener('click', () => {
      [planFreeCard, planProCard, planEnterpriseCard].forEach((c) => c.classList.remove('selected-plan'));
      card.classList.add('selected-plan');
      selectedPlan = card.dataset.plan || 'free';

      seatCountGroup.style.display = (selectedPlan === 'pro') ? 'flex' : 'none';
      updateProPrice();
    });
  });

  monthlyButton.addEventListener('click', () => {
    billingInterval = 'monthly';
    monthlyButton.classList.add('active');
    annualButton.classList.remove('active');
    updateProPrice();
  });
  annualButton.addEventListener('click', () => {
    billingInterval = 'annual';
    annualButton.classList.add('active');
    monthlyButton.classList.remove('active');
    updateProPrice();
  });

  seatCountInput.addEventListener('input', () => {
    seatCount = parseInt(seatCountInput.value, 10) || 1;
    updateProPrice();
  });

  function updateProPrice() {
    // Remove the early return
    // if (selectedPlan !== 'pro') {
    //   proPriceElem.textContent = '$40 / mo / seat';
    //   proSavingsElem.style.display = 'none';
    //   return;
    // }
  
    if (billingInterval === 'monthly') {
      // Show monthly price for Pro
      proPriceElem.textContent = `$${MONTHLY_PRO_COST_PER_SEAT} / mo / seat`;
      proSavingsElem.style.display = 'none';
    } else {
      // Show annual price for Pro
      proPriceElem.textContent = `$${ANNUAL_PRO_COST_PER_SEAT} / year / seat`;
  
      if (monthlyYearlyCostDiff > 0) {
        proSavingsElem.textContent = `Save $${monthlyYearlyCostDiff} per year!`;
        // Optionally show proSavingsElem
        proSavingsElem.style.display = 'none'; 
      } else {
        proSavingsElem.style.display = 'none';
      }
    }
  }
  

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 11) Wizard Navigation
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  wizardNextButton.addEventListener('click', () => {
    // Decide which step to go to next
    if (currentWizardStep === 1) {
      if (selectedPlan === 'enterprise') {
        goToStep(3);
      } else {
        goToStep(2);
      }
    } else if (currentWizardStep === 2) {
      goToStep(3);
    }
  });

  wizardPrevButton.addEventListener('click', () => {
    if (currentWizardStep === 2) {
      goToStep(1);
    } else if (currentWizardStep === 3) {
      if (selectedPlan === 'enterprise') {
        goToStep(1);
      } else {
        goToStep(2);
      }
    }
  });

  function goToStep(step) {
    currentWizardStep = step;
  
    // Show/hide each wizard step container
    wizardStep1.style.display = (step === 1) ? 'flex' : 'none';
    wizardStep2.style.display = (step === 2) ? 'flex' : 'none';
    wizardStep3.style.display = (step === 3) ? 'flex' : 'none';
  
    // Toggle which buttons appear
    wizardPrevButton.style.display    = (step > 1) ? 'flex' : 'none';
    wizardNextButton.style.display    = (step < 3) ? 'flex' : 'none';
    wizardConfirmButton.style.display = (step === 3) ? 'flex' : 'none';
    wizardCancelButton.style.display  = (step === 1) ? 'flex' : 'none';
  
    // Update step indicator styling
    updateStepIndicator(step);
  
    if (step === 1) {
      // Always enable Next on Step 1
      wizardNextButton.disabled = false;
  
    } else if (step === 2) {
      // Payment info step
      if (userHasCardOnFile) {
        cardOnFileText.innerHTML = `We will use your existing card on file: <strong>${lastCardBrand} ****${lastCard4}</strong>`;
        wizardNextButton.disabled = false;
      } else {
        cardOnFileText.textContent = 'No card on file. Please add or update your card.';
        wizardNextButton.disabled = true;
      }
  
    } else if (step === 3) {
      // Step 3: Review
      reviewPlanName.textContent        = selectedPlan;
      reviewSeatCount.textContent       = (selectedPlan === 'pro') ? seatCount : 'N/A';
      reviewBillingInterval.textContent = billingInterval;
  
      let cost = 0;
      if (selectedPlan === 'pro') {
        if (billingInterval === 'monthly') {
          cost = seatCount * MONTHLY_PRO_COST_PER_SEAT;
          reviewCost.textContent = `$${cost} per month`;
        } else {
          cost = seatCount * ANNUAL_PRO_COST_PER_SEAT;
          reviewCost.textContent = `$${cost} per year`;
        }
      } else {
        reviewCost.textContent = '$0.00 per month';
      }
    }
  }
  

  function updateStepIndicator(step) {
    stepIndicatorItems.forEach((item, index) => {
      if (index + 1 === step) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 12) Confirm (Step 3)
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  wizardConfirmButton.addEventListener('click', async () => {
    if (selectedPlan === 'enterprise') {
      alert('Please contact Sales for Enterprise.');
      bootstrap.Modal.getInstance(subscriptionModal)?.hide();
      return;
    }
    if (selectedPlan === 'free') {
      // Cancel Pro to revert to free
      if (!confirm('Switching to Free will cancel your Pro subscription at period end. Continue?')) return;
      try {
        const res = await fetch('/settings/billing/cancel', {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Failed to downgrade to free.');
        showAlert('success', data.message);
        bootstrap.Modal.getInstance(subscriptionModal)?.hide();
        loadBillingInfo();
      } catch (err) {
        console.error('Error downgrading to free:', err);
        showAlert('error', err.message);
      }
      return;
    }

    // If plan = 'pro'
    try {
      const res = await fetch('/settings/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          desiredSeats: seatCount,
          billingInterval,
          desiredTier: 'pro',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create/update subscription.');
      showAlert('success', data.message);
      bootstrap.Modal.getInstance(subscriptionModal)?.hide();
      loadBillingInfo();
    } catch (err) {
      console.error('Error upgrading to pro:', err);
      showAlert('error', err.message);
    }
  });

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 13) Payment Info - “Edit / Add Card” button
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  editPaymentMethodBtn.addEventListener('click', () => {
    const updateCardButton = document.getElementById('update-card-button');
    if (updateCardButton) {
      updateCardButton.click();
    }
  });

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 14) Prepopulate #updateCardModal
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  function populateCardModalFields() {
    if (!window.existingBillingDetails) return;
    document.getElementById('card-holder-name').value     = window.existingBillingDetails.name  || '';
    document.getElementById('card-billing-email').value   = window.existingBillingDetails.email || '';
    document.getElementById('card-address-line1').value   = window.existingBillingDetails.line1 || '';
    document.getElementById('card-address-city').value    = window.existingBillingDetails.city  || '';
    document.getElementById('card-address-state').value   = window.existingBillingDetails.state || '';
    document.getElementById('card-address-postal').value  = window.existingBillingDetails.postal|| '';
    document.getElementById('card-address-country').value = window.existingBillingDetails.country|| '';
  }

  const updateCardModal = document.getElementById('updateCardModal');
  if (updateCardModal) {
    updateCardModal.addEventListener('show.bs.modal', populateCardModalFields);
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 15) “Save Card” => createPaymentMethod => server
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  const saveCardButton = document.getElementById('save-card-button');
  if (saveCardButton) {
    saveCardButton.addEventListener('click', async () => {
      if (!stripe || !cardElement) {
        showAlert('error', 'Stripe is not initialized.');
        return;
      }

      const name  = document.getElementById('card-holder-name').value.trim();
      const email = document.getElementById('card-billing-email').value.trim();

      const billingDetails = {
        name,
        email,
        address: {
          line1:       document.getElementById('card-address-line1').value.trim(),
          city:        document.getElementById('card-address-city').value.trim(),
          state:       document.getElementById('card-address-state').value.trim(),
          postal_code: document.getElementById('card-address-postal').value.trim(),
          country:     document.getElementById('card-address-country').value.trim(),
        },
      };

      const { paymentMethod, error } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
        billing_details: billingDetails,
      });

      if (error) {
        console.error('Stripe createPaymentMethod error:', error);
        if (error.type === 'card_error' && error.decline_code) {
          showAlert('error', `Your card was declined: ${error.decline_code}.`);
        } else {
          showAlert('error', error.message);
        }
        return;
      }

      // Send paymentMethodId to server
      try {
        const res = await fetch('/settings/billing/update-card', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: JSON.stringify({
            paymentMethodId: paymentMethod.id,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || 'Failed to update card.');
        }

        showAlert('success', data.message || 'Card updated successfully.');
        window.location.reload();
        const bsModal = bootstrap.Modal.getInstance(updateCardModal);
        if (bsModal) bsModal.hide();
        loadBillingInfo();
      } catch (err) {
        console.error('Error updating card:', err);
        showAlert('error', err.message);
      }
    });
  }
});