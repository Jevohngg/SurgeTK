document.addEventListener('DOMContentLoaded', () => {
    // Plan selection
    const freePlanRadio     = document.getElementById('freePlanRadio');
    const paidPlanRadio     = document.getElementById('paidPlanRadio');
    const freePlanBlock     = document.getElementById('freePlanBlock');
    const paidPlanBlock     = document.getElementById('paidPlanBlock');
  
    // Free plan "Add card?" or skip
    const freePlanCardChoice = document.getElementById('freePlanCardChoice');
    const freeAddCardRadio   = document.getElementById('freeAddCardRadio');
    const freeNoCardRadio    = document.getElementById('freeNoCardRadio');
  
    // Paid plan details
    const paidPlanDetails  = document.getElementById('paidPlanDetails');
    const seatCountInput   = document.getElementById('seatCount');
    const monthlyRadio     = document.getElementById('monthlyRadio');
    const annualRadio      = document.getElementById('annualRadio');
    const costDisplay      = document.getElementById('costDisplay');
  
    // Payment info container + card form
    const paymentInfoContainer = document.querySelector('.payment-info');
    const cardWrapperDiv   = document.getElementById('cardWrapperDiv');
    const billingNameInput = document.getElementById('billingName');
    const billingEmailInput= document.getElementById('billingEmail');
    const cardElementDiv   = document.getElementById('card-element');
    const cardErrors       = document.getElementById('card-errors');
  
    // Final
    const finishBtn        = document.getElementById('finishOnboardingBtn');
    const alertContainer   = document.getElementById('alert-container');
  
    // Env variables
    const STRIPE_PUBLIC_KEY         = window.STRIPE_PUBLIC_KEY || '';
    const PRO_COST_PER_SEAT         = parseFloat(window.PRO_COST_PER_SEAT || '40');
    const PRO_COST_PER_SEAT_ANNUAL  = parseFloat(window.PRO_COST_PER_SEAT_ANNUAL || '384');
  
    let stripe, cardElement;
    let cardComplete = false; // We'll track if Stripe card field is complete for the paid plan
  
    // -------------------------------------------------
    // Hide "Complete Onboarding" button initially
    // -------------------------------------------------
    finishBtn.style.display = 'none';
  
    // -------------------------------------------------
    // Plan selection clicks
    // -------------------------------------------------
    freePlanBlock.addEventListener('click', () => {
      selectPlan('free');
      showHideFinishButton();
    });
    paidPlanBlock.addEventListener('click', () => {
      selectPlan('pro');
      showHideFinishButton();
    });
  
    function selectPlan(plan) {
      if (plan === 'free') {
        freePlanBlock.classList.add('selected-plan');
        paidPlanBlock.classList.remove('selected-plan');
        freePlanRadio.checked = true;
  
        // Show the "add card or skip" choices
        freePlanCardChoice.style.display = 'block';
  
        // Hide paid details
        paidPlanDetails.style.display = 'none';
        // Hide the entire payment-info unless user picks "Yes"
        paymentInfoContainer.style.display = 'none';
  
        updateFreeCardChoiceUI();
      } else {
        paidPlanBlock.classList.add('selected-plan');
        freePlanBlock.classList.remove('selected-plan');
        paidPlanRadio.checked = true;
  
        // Hide free plan choice
        freePlanCardChoice.style.display = 'none';
  
        // Show paid plan details
        paidPlanDetails.style.display = 'block';
  
        // Payment info required => show container + card form
        paymentInfoContainer.style.display = 'block';
        cardWrapperDiv.style.display       = 'block';
      }
      updateCostDisplay();
    }
  
    // -------------------------------------------------
    // If free => "Add card?" vs. "No"
    // -------------------------------------------------
    freeAddCardRadio.addEventListener('change', () => {
      updateFreeCardChoiceUI();
      showHideFinishButton();
    });
    freeNoCardRadio.addEventListener('change', () => {
      updateFreeCardChoiceUI();
      showHideFinishButton();
    });
  
    function updateFreeCardChoiceUI() {
      if (freeAddCardRadio.checked) {
        paymentInfoContainer.style.display = 'block';
        cardWrapperDiv.style.display       = 'block';
      } else {
        paymentInfoContainer.style.display = 'none';
      }
    }
  
    // -------------------------------------------------
    // Seat count + cost display for paid
    // -------------------------------------------------
    monthlyRadio.addEventListener('change', updateCostDisplay);
    annualRadio.addEventListener('change', updateCostDisplay);
    seatCountInput.addEventListener('input', updateCostDisplay);
  
    function updateCostDisplay() {
      // If free plan is selected, cost is $0
      if (freePlanRadio.checked) {
        costDisplay.textContent = '$0.00';
        return;
      }
      // Otherwise, user is on paid plan
      const seats = parseInt(seatCountInput.value, 10) || 1;
      const isAnnual = annualRadio.checked;
      let cost = isAnnual
        ? seats * PRO_COST_PER_SEAT_ANNUAL
        : seats * PRO_COST_PER_SEAT;
      costDisplay.textContent = `$${cost.toFixed(2)}`;
    }
  
    // -------------------------------------------------
    // Stripe Setup
    // -------------------------------------------------
    if (STRIPE_PUBLIC_KEY) {
      stripe = Stripe(STRIPE_PUBLIC_KEY);
      const elements = stripe.elements();
      cardElement = elements.create('card', {
        style: {
          base: {
            fontSize: '16px',
            color: '#32325d',
          },
        },
      });
      cardElement.mount(cardElementDiv);
  
      // Listen for real-time validation changes
      cardElement.on('change', function(event) {
        cardComplete = event.complete;
        // Re-check if we can show the finish button
        showHideFinishButton();
  
        if (event.error) {
          cardErrors.textContent = event.error.message;
        } else {
          cardErrors.textContent = '';
        }
      });
    }
  
    // Also watch for name/email changes (for paid plan completeness)
    [billingNameInput, billingEmailInput].forEach(field => {
      field.addEventListener('input', showHideFinishButton);
    });
  
    // -------------------------------------------------
    // Show/hide "Complete Onboarding" button
    // -------------------------------------------------
    function showHideFinishButton() {
      // If NO plan is selected, hide the button
      if (!freePlanRadio.checked && !paidPlanRadio.checked) {
        finishBtn.style.display = 'none';
        return;
      }
  
      // FREE plan logic: show button if user chooses "Yes" or "No"
      if (freePlanRadio.checked) {
        if (freeAddCardRadio.checked || freeNoCardRadio.checked) {
          finishBtn.style.display = 'inline-block';
        } else {
          finishBtn.style.display = 'none';
        }
        return;
      }
  
      // PAID plan logic: must have card info complete + name + email
      if (paidPlanRadio.checked) {
        const nameFilled  = billingNameInput.value.trim().length > 0;
        const emailFilled = billingEmailInput.value.trim().length > 0;
  
        if (cardComplete && nameFilled && emailFilled) {
          finishBtn.style.display = 'inline-block';
        } else {
          finishBtn.style.display = 'none';
        }
      }
    }
  
// -------------------------------------------------
// Final "Complete Onboarding" => submission
// -------------------------------------------------
finishBtn.addEventListener('click', async () => {
    // 1) Lock the button's width & height so it won't shrink when text disappears
    const rect = finishBtn.getBoundingClientRect();
    finishBtn.style.width = rect.width + "px";
    finishBtn.style.height = rect.height + "px";
  
    // 2) Disable the button to prevent multiple clicks
    finishBtn.disabled = true;
  
    // 3) Show the spinner & hide the text instantly
    finishBtn.classList.add('loading');
  
    const planChoice = paidPlanRadio.checked ? 'pro' : 'free';
  
    // If pro => card is required
    // If free => only require card if user said "Yes"
    let mustHaveCard = false;
    if (planChoice === 'pro') {
      mustHaveCard = true;
    } else {
      mustHaveCard = freeAddCardRadio.checked;
    }
  
    // If paid => read seats + interval
    let seats = 1;
    let billingInterval = 'monthly';
    if (planChoice === 'pro') {
      seats = parseInt(seatCountInput.value, 10) || 1;
      billingInterval = annualRadio.checked ? 'annual' : 'monthly';
    }
  
    // Possibly create PaymentMethod if needed
    let paymentMethodId = null;
    if (mustHaveCard) {
      if (!stripe || !cardElement) {
        showAlert('error', 'Stripe is not initialized or no card element present.');
        revertFinishBtn();
        return;
      }
      const billingDetails = {
        name:  billingNameInput.value.trim(),
        email: billingEmailInput.value.trim(),
      };
      const { paymentMethod, error } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
        billing_details: billingDetails,
      });
      if (error) {
        cardErrors.textContent = error.message;
        revertFinishBtn();
        return;
      }
      paymentMethodId = paymentMethod.id;
    } else {
      // free plan => only create if user typed something
      const name  = billingNameInput.value.trim();
      const email = billingEmailInput.value.trim();
      if (name || email) {
        if (stripe && cardElement) {
          const { paymentMethod, error } = await stripe.createPaymentMethod({
            type: 'card',
            card: cardElement,
            billing_details: { name, email },
          });
          if (error) {
            cardErrors.textContent = error.message;
            revertFinishBtn();
            return;
          }
          paymentMethodId = paymentMethod.id;
        }
      }
    }
  
    // Send to server
    try {
      const body = { planChoice, seats, paymentMethodId, billingInterval };
      const response = await fetch('/onboarding/subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Error finalizing subscription.');
      }
      // If success => go to dashboard
      window.location.href = '/dashboard';
  
    } catch (err) {
      console.error('Error finalizing onboarding subscription:', err);
      showAlert('error', err.message);
      revertFinishBtn();
    }
  });
  
  // -------------------------------------------------
  // Helper: Revert button if an error occurs
  // -------------------------------------------------
  function revertFinishBtn() {
    finishBtn.disabled = false;
    finishBtn.classList.remove('loading');
    finishBtn.style.width = '';
    finishBtn.style.height = '';
  }
  
  
    // -------------------------------------------------
    // Helper functions
    // -------------------------------------------------
    function showAlert(type, message) {
      if (!alertContainer) return;
      const alertEl = document.createElement('div');
      alertEl.className = `alert alert-${type === 'error' ? 'danger' : 'success'}`;
      alertEl.textContent = message;
      alertContainer.innerHTML = '';
      alertContainer.appendChild(alertEl);
    }
  
    function revertFinishBtn() {
      finishBtn.disabled = false;
      finishBtn.style.backgroundColor = '';
      finishBtn.innerHTML = 'Complete Onboarding';
    }
  
    // -------------------------------------------------
    // Initialize
    // -------------------------------------------------
    // We do NOT auto-select any plan at page load;
    // everything remains hidden until the user clicks one.
    // No call to selectPlan() here — so no default selection.
  });
  