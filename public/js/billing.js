document.addEventListener('DOMContentLoaded', () => {
  let cameFromSubscriptionWizard = false;

  // 1) Grab references to your modals:
  const subscriptionModalElem = document.getElementById('subscriptionModal');
  const updateCardModalElem   = document.getElementById('updateCardModal');

  // 2) Instantiate them:
  const subscriptionModalInstance = new bootstrap.Modal(subscriptionModalElem, {
    backdrop: 'static',
    keyboard: false
  });
  const updateCardModalInstance = new bootstrap.Modal(updateCardModalElem, {
    backdrop: 'static',
    keyboard: false
  });

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
  const updateCardButton    = document.getElementById('update-card-button');

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
  const RAW_ANNUAL_PRO_COST_PER_SEAT = 1140;
  const monthlyYearlyCostDiff     = (MONTHLY_PRO_COST_PER_SEAT * 12) - ANNUAL_PRO_COST_PER_SEAT;

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 5) loadBillingInfo => store user’s current sub
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  let userCurrentTier       = 'free';    
  let userCurrentSeats      = 1;
  let userCurrentInterval   = 'monthly'; 
  const currentBillingFrequencyElem = document.getElementById('current-billing-frequency');
  const currentBillingTotalElem     = document.getElementById('current-billing-total');

  async function loadBillingInfo() {
    try {
      const res = await fetch('/settings/billing', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to load billing info.');

      // Display current plan info
      currentPlanText.textContent = data.subscriptionTier || 'free';
      currentSeatsElem.textContent = data.seatsPurchased;
      currentNextBillElem.textContent = data.nextBillDate
        ? new Date(data.nextBillDate).toLocaleDateString()
        : 'N/A';

      // Show/hide cancellation banner
      if (data.cancelAtPeriodEnd) {
        const cancellationBanner = document.getElementById('cancellation-banner');
        if (cancellationBanner) {
          cancellationBanner.textContent = data.nextBillDate
            ? `Your plan is set to cancel at the end of this billing period on ${new Date(data.nextBillDate).toLocaleDateString()}.`
            : 'Your plan is set to cancel at the end of this billing period.';
          cancellationBanner.style.display = 'block';
        }
      } else {
        const cancellationBanner = document.getElementById('cancellation-banner');
        if (cancellationBanner) {
          cancellationBanner.style.display = 'none';
        }
      }

      // Store subscription tier, seats
      userCurrentTier = data.subscriptionTier || 'free';
      userCurrentSeats = data.seatsPurchased || 1;

      // Check if billingInterval is "Annual"
      if (data.billingInterval && data.billingInterval.toLowerCase() === 'annual') {
        userCurrentInterval = 'annual';
      } else {
        userCurrentInterval = 'monthly';
      }

      // Payment method brand & last4
      if (data.paymentMethodBrand) {
        paymentMethodBrand.textContent = data.paymentMethodBrand + ' ****';
        paymentMethodLast4.textContent = data.paymentMethodLast4 || '';
        userHasCardOnFile = true;

        lastCardBrand         = data.paymentMethodBrand;
        lastCard4             = data.paymentMethodLast4 || '';
        lastCardHolderName    = data.paymentMethodHolderName || '';
        lastCardExpMonth      = data.paymentMethodExpMonth || null;
        lastCardExpYear       = data.paymentMethodExpYear || null;

      } else {
        paymentMethodBrand.textContent = 'No card';
        paymentMethodLast4.textContent = '';
        userHasCardOnFile = false;

        lastCardBrand         = '';
        lastCard4             = '';
        lastCardHolderName    = '';
        lastCardExpMonth      = null;
        lastCardExpYear       = null;
      }

      // Update the table's billing frequency + total
      currentBillingFrequencyElem.textContent = data.billingInterval || 'N/A';
      if (typeof data.billingTotal === 'number' && !isNaN(data.billingTotal)) {
        currentBillingTotalElem.textContent = `$${data.billingTotal}`;
      } else {
        currentBillingTotalElem.textContent = data.billingTotal || 'N/A';
      }

      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      //  PRO CARD PRICE UPDATE (on the middle "Pro" card)
      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      const proPriceText      = document.getElementById('pro-price-text');
      const proPriceFrequency = document.getElementById('pro-price-frequency');

      if (data.subscriptionTier === 'pro' && proPriceText && proPriceFrequency) {
        if (data.billingInterval && data.billingInterval.toLowerCase() === 'annual') {
          proPriceText.textContent = '$1026';
          proPriceFrequency.textContent = '/seat per year';
        } else {
          proPriceText.textContent = '$95';
          proPriceFrequency.textContent = '/seat per month';
        }
      }

      // Save any billing details for the card update modal
      window.existingBillingDetails = {
        name:  data.billingName,
        email: data.billingEmail,
      };

    } catch (err) {
      console.error('Error loading billing:', err);
      showAlert('error', err.message);
    }
  }

  loadBillingInfo();

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 6) “Change Plan” => open wizard with current sub
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  const changePlanButton = document.getElementById('change-plan-button');
  if (changePlanButton) {
    changePlanButton.addEventListener('click', () => {
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
      setTimeout(() => {
        window.location.reload();
      }, 1500);
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
  // 9) Single-click plan buttons
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
    [planFreeCard, planProCard].forEach((card) => {
      card.classList.remove('selected-plan');
    });
    if (plan === 'free') planFreeCard.classList.add('selected-plan');
    if (plan === 'pro')  planProCard.classList.add('selected-plan');

    // Interval
    if (interval === 'annual') {
      monthlyButton.classList.remove('active');
      annualButton.classList.add('active');
    } else {
      annualButton.classList.remove('active');
      monthlyButton.classList.add('active');
    }

    seatCountGroup.style.display = plan === 'pro' ? 'flex' : 'none';
    seatCountInput.value = seats.toString();

    updateProPrice();

    // Clear final review
    reviewPlanName.textContent       = '';
    reviewSeatCount.textContent      = '';
    reviewBillingInterval.textContent= '';
    reviewCost.textContent           = '$0.00';

    updateStepIndicator(1);
    subscriptionModalInstance.show();
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 10) Step 1 - Plan Selection & Interval Toggle
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  [planFreeCard, planProCard].forEach((card) => {
    card.addEventListener('click', () => {
      [planFreeCard, planProCard].forEach((c) => c.classList.remove('selected-plan'));
      card.classList.add('selected-plan');
      selectedPlan = card.dataset.plan || 'free';

      seatCountGroup.style.display = selectedPlan === 'pro' ? 'flex' : 'none';
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
    if (billingInterval === 'monthly') {
      proPriceElem.innerHTML = `
        <span class="price-amount">$${MONTHLY_PRO_COST_PER_SEAT}</span>
        <span class="price-suffix">/Month</span>
      `;
    } else {
      proPriceElem.innerHTML = `
        <span class="price-amount">$${ANNUAL_PRO_COST_PER_SEAT}</span>
        <span class="price-suffix">/Year</span>
      `;
    }
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 11) Wizard Navigation
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  wizardNextButton.addEventListener('click', () => {
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

    wizardStep1.style.display = step === 1 ? 'flex' : 'none';
    wizardStep2.style.display = step === 2 ? 'flex' : 'none';
    wizardStep3.style.display = step === 3 ? 'flex' : 'none';

    wizardPrevButton.style.display    = step > 1 ? 'flex' : 'none';
    wizardNextButton.style.display    = step < 3 ? 'flex' : 'none';
    wizardConfirmButton.style.display = step === 3 ? 'flex' : 'none';
    wizardCancelButton.style.display  = step === 1 ? 'flex' : 'none';

    updateStepIndicator(step);

    if (step === 1) {
      wizardNextButton.disabled = false;
    } else if (step === 2) {
      const mockCardContainer = document.querySelector('.card-on-file-container');
      if (userHasCardOnFile) {
        cardOnFileText.innerHTML = `We will use your existing card on file:`;
        wizardNextButton.disabled = false;
        if (mockCardContainer) {
          mockCardContainer.style.display = '';
        }
        updateMockCardDisplay(
          lastCardBrand,
          lastCard4,
          lastCardHolderName,
          lastCardExpMonth,
          lastCardExpYear
        );
      } else {
        cardOnFileText.textContent = 'No card on file. Please add or update your card.';
        wizardNextButton.disabled = true;
        if (mockCardContainer) {
          mockCardContainer.style.display = 'none';
        }
      }
    } else if (step === 3) {
      reviewPlanName.textContent        = selectedPlan;       
      reviewSeatCount.textContent       = '--';               
      reviewBillingInterval.textContent = billingInterval;     

      const totalLabel   = document.getElementById('review-total-label');
      const costPerSeatEl= document.getElementById('review-cost-per-seat');
      const subtotalEl   = document.getElementById('review-subtotal');
      const discountLine = document.getElementById('discount-line');
      const discountAmtEl= document.getElementById('review-discount-amount');

      if (billingInterval === 'annual') {
        totalLabel.textContent = 'Yearly Total';
      } else {
        totalLabel.textContent = 'Monthly Total';
      }

      if (selectedPlan === 'pro') {
        reviewSeatCount.textContent = seatCount;
        let rawCostPerSeat = 0;
        let subtotal       = 0;

        if (billingInterval === 'annual') {
          rawCostPerSeat = RAW_ANNUAL_PRO_COST_PER_SEAT; 
          const discountPercentage = 0.10; 
          subtotal = seatCount * rawCostPerSeat; 
          const discountValue = subtotal * discountPercentage;
          const finalCost     = subtotal - discountValue;

          costPerSeatEl.textContent = `$${rawCostPerSeat}`;
          subtotalEl.textContent    = `$${subtotal.toFixed(2)}`;
          discountLine.style.display = '';
          discountAmtEl.textContent  = `- $${discountValue.toFixed(2)}`;
          reviewCost.textContent     = `$${finalCost.toFixed(2)}`;

        } else {
          rawCostPerSeat = MONTHLY_PRO_COST_PER_SEAT;
          subtotal       = seatCount * rawCostPerSeat;
          costPerSeatEl.textContent = `$${rawCostPerSeat}`;
          subtotalEl.textContent    = `$${subtotal.toFixed(2)}`;
          discountLine.style.display = 'none';
          reviewCost.textContent     = `$${subtotal.toFixed(2)}`;
        }

      } else if (selectedPlan === 'free') {
        reviewSeatCount.textContent = '1';
        costPerSeatEl.textContent   = '$0';
        subtotalEl.textContent      = '$0';
        discountLine.style.display  = 'none';
        reviewCost.textContent      = '$0.00';

      } else {
        discountLine.style.display = 'none';
        reviewCost.textContent     = '$0.00';
      }
    }
  }

  function updateStepIndicator(currentStep) {
    stepIndicatorItems.forEach((item, index) => {
      const stepNumberElem = item.querySelector('.wizard-number');
      const stepIndex = index + 1;

      if (stepIndex < currentStep) {
        item.classList.add('completed');
        stepNumberElem.innerHTML = '<i class="fas fa-check"></i>';
      } else {
        item.classList.remove('completed');
        stepNumberElem.textContent = stepIndex.toString();
      }

      if (stepIndex === currentStep) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  /**
   * Dynamically updates the mock credit card display
   */
  function updateMockCardDisplay(brand, last4, cardHolderName, expMonth, expYear) {
    const brandLogoEl      = document.getElementById('card-brand-logo');
    const cardLast4El      = document.getElementById('card-last4');
    const cardHolderNameEl = document.getElementById('card-holder-text');
    const cardExpEl        = document.getElementById('card-expiration');

    if (!brandLogoEl || !cardLast4El || !cardHolderNameEl || !cardExpEl) return;

    const normalizedBrand = (brand || '').toLowerCase();
    brandLogoEl.src = `/images/${normalizedBrand}.svg`;

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

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 12) Confirm (Step 3)
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  wizardConfirmButton.addEventListener('click', async () => {
    const rect = wizardConfirmButton.getBoundingClientRect();
    wizardConfirmButton.style.width = rect.width + "px";
    wizardConfirmButton.style.height = rect.height + "px";
  
    // 2) Disable pointer events
    wizardConfirmButton.disabled = true;
  
    // 3) Add .loading to hide text & show spinner
    wizardConfirmButton.classList.add('loading');
    if (selectedPlan === 'enterprise') {
      alert('Please contact Sales for Enterprise.');
      bootstrap.Modal.getInstance(subscriptionModal)?.hide();
      return;
    }
    if (selectedPlan === 'free') {
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
        skipGlobalLoader: true,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to create/update subscription.');
      showAlert('success', data.message);
      bootstrap.Modal.getInstance(subscriptionModal)?.hide();
      loadBillingInfo();
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      console.error('Error upgrading to pro:', err);
      showAlert('error', err.message);
    }
  });

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 13) Payment Info - “Edit / Add Card”
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  editPaymentMethodBtn.addEventListener('click', () => {
    cameFromSubscriptionWizard = true;
    subscriptionModalInstance.hide();
    updateCardModalInstance.show();
  });

  updateCardButton.addEventListener('click', () => {
    cameFromSubscriptionWizard = false;
    subscriptionModalInstance.hide();
    updateCardModalInstance.show();
  });

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 14) Prepopulate #updateCardModal
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  function populateCardModalFields() {
    if (!window.existingBillingDetails) return;
    document.getElementById('card-holder-name').value   = window.existingBillingDetails.name  || '';
    document.getElementById('card-billing-email').value = window.existingBillingDetails.email || '';
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
      const rect = saveCardButton.getBoundingClientRect();
      saveCardButton.style.width = rect.width + "px";
      saveCardButton.style.height = rect.height + "px";
  
      // 2) Disable the button to prevent multiple clicks
      saveCardButton.disabled = true;
  
      // 3) Add the .loading class (instantly hides the button text, shows spinner)
      saveCardButton.classList.add('loading');
      if (!stripe || !cardElement) {
        showAlert('error', 'Stripe is not initialized.');
        return;
      }

      const name  = document.getElementById('card-holder-name').value.trim();
      const email = document.getElementById('card-billing-email').value.trim();

      const billingDetails = { name, email };

      // 1) Create PaymentMethod with Stripe
      const { paymentMethod, error } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
        billing_details: billingDetails,
      });
      if (error) {
        console.error('Stripe createPaymentMethod error:', error);
        showAlert('error', error.message || 'Your card was declined.');
        return;
      }

      // 2) Send paymentMethodId to server
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
          skipGlobalLoader: true,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || 'Failed to update card.');
        }

        // 3) Show success
        showAlert('success', data.message || 'Card updated successfully.');
        updateCardModalInstance.hide();

        // ============ KEY CHANGE ============
        // Only re-open the subscription modal if they came from it
        if (cameFromSubscriptionWizard) {
          subscriptionModalInstance.show();
          cameFromSubscriptionWizard = false; 
        } else {
          // Otherwise, reload the page
          window.location.reload();
          return;
        }
        // ============ END KEY CHANGE ============

        // 4) Update local variables so Step 2 can display the new card
        userHasCardOnFile  = true;
        lastCardBrand      = data.brand      || '';
        lastCard4          = data.last4      || '';
        lastCardHolderName = data.holderName || '';
        lastCardExpMonth   = data.expMonth   || '';
        lastCardExpYear    = data.expYear    || '';

        paymentMethodBrand.textContent = (lastCardBrand || 'Card') + ' ****';
        paymentMethodLast4.textContent = lastCard4;

        // 5) Re-draw the "mock" credit card in Step 2
        updateMockCardDisplay(
          lastCardBrand,
          lastCard4,
          lastCardHolderName,
          lastCardExpMonth,
          lastCardExpYear
        );

        // 6) Enable the Next button in Step 2 
        // (now that there's a card on file).
        wizardNextButton.disabled = false;

      } catch (err) {
        console.error('Error updating card:', err);
        showAlert('error', err.message);
      }
    });
  }

  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // 16) Close updateCardModal
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  const closeUpdateCardBtn  = document.getElementById('close-update-card-modal');
  const cancelUpdateCardBtn = document.getElementById('cancel-update-card-modal');

  closeUpdateCardBtn?.addEventListener('click', () => {
    updateCardModalInstance.hide();
    if (cameFromSubscriptionWizard) {
      subscriptionModalInstance.show();
    }
  });

  cancelUpdateCardBtn?.addEventListener('click', () => {
    updateCardModalInstance.hide();
    if (cameFromSubscriptionWizard) {
      subscriptionModalInstance.show();
    }
  });
});
