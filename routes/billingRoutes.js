// routes/billingRoutes.js

const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const CompanyID = require('../models/CompanyID');
const User = require('../models/User');
const { ensureOnboarded } = require('../middleware/onboardingMiddleware');
const { ensureAuthenticated } = require('../middleware/authMiddleware');
// You might also need your roleMiddleware or custom subscription checks:
const { ensureAdmin } = require('../middleware/roleMiddleware');
const { logError } = require('../utils/errorLogger');

// Utility function to calculate how many seats a firm can have based on tier + seatsPurchased
function calculateSeatLimits(firm) {
  if (!firm) return { maxAdvisors: 0, maxNonAdvisors: 0 };

  const tier = firm.subscriptionTier;
  if (tier === 'free') {
    return {
      maxAdvisors: parseInt(process.env.FREE_TIER_ADVISOR_LIMIT || '1'),
      maxNonAdvisors: parseInt(process.env.FREE_TIER_NON_ADVISOR_LIMIT || '2'),
    };
  }
  if (tier === 'enterprise') {
    // Let's say enterprise is unlimited:
    return { maxAdvisors: 999999, maxNonAdvisors: 999999 };
  }
  // Pro tier:
  const seats = firm.seatsPurchased || 0;
  const advisorPerSeat = parseInt(process.env.PRO_SEAT_ADVISOR || '1');
  const nonAdvisorPerSeat = parseInt(process.env.PRO_SEAT_NON_ADVISOR || '2');
  return {
    maxAdvisors: seats * advisorPerSeat,
    maxNonAdvisors: seats * nonAdvisorPerSeat,
  };
}

// routes/billingRoutes.js

router.get('/billing', ensureAuthenticated, ensureOnboarded, async (req, res) => {
  try {
    const firm = await CompanyID.findById(req.session.user.firmId).lean();
    if (!firm) {
      return res.status(404).json({ message: 'Firm not found.' });
    }

    // Prepare default values
    let billingInterval = 'N/A';
    let billingTotal = 'N/A';

    // If the firm is on "pro" and not fully canceled
    if (firm.subscriptionTier === 'pro' && firm.subscriptionStatus !== 'canceled') {
      const isAnnual = (firm.subscriptionInterval === 'annual');

      billingInterval = isAnnual ? 'Annual' : 'Monthly';

      const monthlySeatPrice = parseInt(process.env.PRO_SEAT_COST_MONTHLY || '95', 10);
      const annualSeatPrice  = parseInt(process.env.PRO_SEAT_COST_ANNUAL  || '1026', 10);

      const seats = firm.seatsPurchased || 0;
      billingTotal = isAnnual
        ? (seats * annualSeatPrice)
        : (seats * monthlySeatPrice);
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // SUBSCRIPTION ALERT LOGIC (OPTIONAL for JSON)
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    let showSubAlert = false;
    let subAlertType = '';
    if (['canceled', 'past_due', 'unpaid'].includes(firm.subscriptionStatus)) {
      showSubAlert = true;
      subAlertType = firm.subscriptionStatus; 
    }

    // Return JSON for your front-end to consume
    return res.json({
      subscriptionTier:   firm.subscriptionTier,
      subscriptionStatus: firm.subscriptionStatus,
      seatsPurchased:     firm.seatsPurchased,
      paymentMethodLast4: firm.paymentMethodLast4,
      paymentMethodBrand: firm.paymentMethodBrand,
      nextBillDate:       firm.nextBillDate || null,
      cancelAtPeriodEnd:  firm.cancelAtPeriodEnd,

      // Payment Method details
      paymentMethodHolderName: firm.paymentMethodHolderName || '',
      paymentMethodExpMonth:   firm.paymentMethodExpMonth,
      paymentMethodExpYear:    firm.paymentMethodExpYear,

      // Computed
      billingInterval,
      billingTotal,

      // Additional Billing Info
      billingName:           firm.billingName           || '',
      billingEmail:          firm.billingEmail          || '',
      billingAddressLine1:   firm.billingAddressLine1   || '',
      billingAddressCity:    firm.billingAddressCity    || '',
      billingAddressState:   firm.billingAddressState   || '',
      billingAddressPostal:  firm.billingAddressPostal  || '',
      billingAddressCountry: firm.billingAddressCountry || '',

      // OPTIONAL: sub alert
      showSubAlert,
      subAlertType,
    });
  } catch (err) {
    await logError(req, 'GET /settings/billing error:', { severity: 'warning' });
    console.error('GET /settings/billing error:', err);
    return res.status(500).json({ message: 'Server error retrieving billing info.' });
  }
});


  
/**
 * POST /settings/billing/checkout
 * Creates or updates a Stripe subscription, ensuring seat usage checks
 * and finalizing payment. Also updates the session to avoid redirect loops.
 */
router.post('/billing/checkout', ensureAuthenticated, ensureOnboarded, ensureAdmin, async (req, res) => {
  try {
    const { desiredSeats, billingInterval = 'monthly', desiredTier = 'pro' } = req.body;
    const userFirm = await CompanyID.findById(req.session.user.firmId);
    if (!userFirm) {
      return res.status(404).json({ message: 'Firm not found.' });
    }

    // If user selects "enterprise", block or handle differently
    if (desiredTier === 'enterprise') {
      return res.status(400).json({ message: 'Enterprise tier requires contacting sales.' });
    }

    // Seat usage checks (to prevent downgrading below existing usage)
    if (desiredTier === 'pro') {
      const advisorsCount = await User.countDocuments({
        firmId: userFirm._id,
        role: { $in: ['admin', 'leadAdvisors'] }
      });
      const totalMembersCount = await User.countDocuments({ firmId: userFirm._id });
      const nonAdvisorsCount = totalMembersCount - advisorsCount;

      const advisorPerSeat = parseInt(process.env.PRO_SEAT_ADVISOR || '1', 10);
      const nonAdvisorPerSeat = parseInt(process.env.PRO_SEAT_NON_ADVISOR || '2', 10);

      const minSeatsForAdvisors = Math.ceil(advisorsCount / advisorPerSeat);
      const minSeatsForNonAdvisors = Math.ceil(nonAdvisorsCount / nonAdvisorPerSeat);
      const minSeatsRequired = Math.max(minSeatsForAdvisors, minSeatsForNonAdvisors);

      if (desiredSeats < minSeatsRequired) {
        return res.status(400).json({
          message: `You have ${advisorsCount} advisor(s) and ${nonAdvisorsCount} non-advisor(s). ` +
                   `That requires at least ${minSeatsRequired} seat(s). ` +
                   `Please remove or adjust team members before downgrading.`
        });
      }
    }

    // Ensure Stripe customer exists
    if (!userFirm.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: req.session.user.email,
        name: userFirm.companyName || 'No Name',
      });
      userFirm.stripeCustomerId = customer.id;
      await userFirm.save();
    }
    const stripeCustomerId = userFirm.stripeCustomerId;

    // Identify correct Price ID
    let priceId;
    if (desiredTier === 'pro') {
      priceId = (billingInterval === 'annual')
        ? process.env.STRIPE_PRO_ANNUAL_PRICE_ID
        : process.env.STRIPE_PRO_MONTHLY_PRICE_ID;
    } else {
      // If "free," use /billing/cancel or handle separately
      return res.status(400).json({
        message: 'Use the billing/cancel endpoint for free tier, or handle directly in code.'
      });
    }

    // Create or update subscription
    let subscription;
    if (!userFirm.stripeSubscriptionId) {
      // ----------------------------
      // CREATE new subscription
      // ----------------------------
      subscription = await stripe.subscriptions.create({
        customer: stripeCustomerId,
        items: [{ price: priceId, quantity: desiredSeats }],
        proration_behavior: 'create_prorations',
        payment_behavior: 'error_if_incomplete',
        expand: ['latest_invoice'],
      });
    } else {
      // ----------------------------
      // UPDATE existing subscription
      // ----------------------------
      const existingSub = await stripe.subscriptions.retrieve(userFirm.stripeSubscriptionId);
      const subscriptionItemId = existingSub.items.data[0].id;

      subscription = await stripe.subscriptions.update(userFirm.stripeSubscriptionId, {
        items: [{ id: subscriptionItemId, price: priceId, quantity: desiredSeats }],
        proration_behavior: 'create_prorations',
        payment_behavior: 'error_if_incomplete',
        expand: ['latest_invoice'],
      });
    }

    // Pay the subscription's latest invoice if not already paid/void
    if (subscription.latest_invoice) {
      const latestInvoice = subscription.latest_invoice;
      if (latestInvoice.status !== 'paid' && latestInvoice.status !== 'void') {
        await stripe.invoices.pay(latestInvoice.id);
      }
    }

    // Save updated subscription info to DB
    userFirm.subscriptionTier     = desiredTier;        // e.g., 'pro'
    userFirm.subscriptionInterval = billingInterval;    // 'monthly' or 'annual'
    userFirm.subscriptionStatus   = subscription.status;
    userFirm.stripeSubscriptionId = subscription.id;
    userFirm.seatsPurchased       = desiredSeats;

    if (subscription.current_period_end) {
      userFirm.nextBillDate = new Date(subscription.current_period_end * 1000);
    }
    await userFirm.save();

    // ---------------------------------------------------------------------
    // If subscription is now active, update session so the user won't be
    // forced back to /billing-limited. Then explicitly save the session.
    // ---------------------------------------------------------------------
    if (subscription.status === 'active') {
      req.session.limitedAccess = false; // or whatever flag your code uses
      // If you store user data in the session, also update it
      if (req.session.user) {
        req.session.user.limitedAccess = false;
        req.session.user.subscriptionStatus = 'active'; // optional for your checks
      }

      await new Promise((resolve, reject) => {
        req.session.save(err => (err ? reject(err) : resolve()));
      });
    }

    return res.json({
      message: 'Subscription updated',
      subscriptionStatus: subscription.status,
    });

  } catch (err) {
    await logError(req, 'POST /settings/billing/checkout error:', { severity: 'warning' });
    console.error('POST /settings/billing/checkout error:', err);
    return res.status(500).json({ message: 'Error creating or updating subscription.' });
  }
});

  

/**
 * POST /settings/billing/cancel
 * Cancels the Pro subscription and sets cancel_at_period_end = true
 * The user keeps Pro until the end of the current billing cycle.
 */
router.post('/billing/cancel', ensureAuthenticated, ensureOnboarded, ensureAdmin, async (req, res) => {
  try {
    const userFirm = await CompanyID.findById(req.session.user.firmId);
    if (!userFirm) {
      return res.status(404).json({ message: 'Firm not found.' });
    }

    if (!userFirm.stripeSubscriptionId) {
      return res.status(400).json({ message: 'No active subscription to cancel.' });
    }

    // If user feedback was provided from the wizard, store it (optional).
    // Make sure your CompanyID schema has a "cancellationFeedback" (or similar) field if you want to save this.
    const { feedback } = req.body; 
    if (feedback) {
      userFirm.cancellationFeedback = feedback;
      // e.g. { reasons: [...], scheduledMeeting: true/false, pricingFeedback: "", freeformFeedback: "" }
    }

    // Check if the firm is able to move to free tier eventually
    // (e.g., if they're above free-tier user limits, block cancellation)
    const membersCount = await User.countDocuments({ firmId: userFirm._id });
    const advisorsCount = await User.countDocuments({
      firmId: userFirm._id,
      roles: { $in: ['admin', 'leadAdvisors'] }
    });
    const freeAdvisorLimit = parseInt(process.env.FREE_TIER_ADVISOR_LIMIT || '1', 10);
    const freeNonAdvisorLimit = parseInt(process.env.FREE_TIER_NON_ADVISOR_LIMIT || '2', 10);

    if (advisorsCount > freeAdvisorLimit || (membersCount - advisorsCount) > freeNonAdvisorLimit) {
      return res.status(400).json({
        message: 'You have more members than the Free tier allows. Remove or adjust team members first.'
      });
    }

    // Instead of immediately deleting, set cancel_at_period_end = true
    const subscription = await stripe.subscriptions.update(userFirm.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    // Update local DB to note the pending cancellation
    userFirm.subscriptionStatus = subscription.status; // usually 'active' or 'past_due'
    // If desired, store a flag to display a banner:
    userFirm.cancelAtPeriodEnd = true;
    // Do NOT revert to free yet; wait for the webhook when Stripe ends the subscription.

    await userFirm.save();

    const endDate = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toLocaleDateString()
      : 'unknown';

    return res.json({
      message: `Your subscription will cancel at the end of this billing period (on ${endDate}).`,
      subscriptionStatus: subscription.status,
      cancelAtPeriodEnd: true,
      currentPeriodEnd: subscription.current_period_end,
    });
  } catch (err) {
    await logError(req, 'POST /settings/billing/cancel error', { severity: 'warning' });
    console.error('POST /settings/billing/cancel error:', err);
    return res.status(500).json({ message: 'Error canceling subscription.' });
  }
});





router.post('/billing/update-card', ensureAuthenticated, ensureOnboarded, async (req, res) => {
  try {
    const { paymentMethodId } = req.body;
    if (!paymentMethodId) {
      return res.status(400).json({ message: 'Missing paymentMethodId.' });
    }

    const firm = await CompanyID.findById(req.session.user.firmId);
    if (!firm) {
      return res.status(404).json({ message: 'Firm not found.' });
    }

    // If no Stripe customer, create one
    if (!firm.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: req.session.user.email,
        name: firm.companyName || 'No Name',
      });
      firm.stripeCustomerId = customer.id;
      await firm.save();
    }

    // 1) Attach PaymentMethod to the customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: firm.stripeCustomerId,
    });

    // 2) Set it as the default payment method on the customer
    await stripe.customers.update(firm.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // 3) Retrieve PaymentMethod details for storing brand/last4 locally
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);

    // 4) Update local DB fields
    if (pm && pm.card) {
      firm.paymentMethodBrand  = pm.card.brand;
      firm.paymentMethodLast4  = pm.card.last4;
      firm.paymentMethodExpMonth = pm.card.exp_month;
      firm.paymentMethodExpYear  = pm.card.exp_year;
    }
    if (pm && pm.billing_details) {
      firm.billingName  = pm.billing_details.name  || '';
      firm.billingEmail = pm.billing_details.email || '';
      firm.paymentMethodHolderName = pm.billing_details.name || '';

      if (pm.billing_details.address) {
        firm.billingAddressLine1 = pm.billing_details.address.line1   || '';
        firm.billingAddressCity  = pm.billing_details.address.city    || '';
        firm.billingAddressState = pm.billing_details.address.state   || '';
        firm.billingAddressPostal= pm.billing_details.address.postal_code || '';
        firm.billingAddressCountry = pm.billing_details.address.country || '';
      }
    }

    // If the subscription is in a "past_due" or "unpaid" state, attempt payment again
    let subscriptionStatus = firm.subscriptionStatus || 'none';
    if (firm.stripeSubscriptionId && ['past_due', 'unpaid'].includes(subscriptionStatus)) {
      // Retrieve current subscription
      const sub = await stripe.subscriptions.retrieve(firm.stripeSubscriptionId);
      if (
        sub &&
        (sub.status === 'past_due' || sub.status === 'unpaid') &&
        sub.latest_invoice
      ) {
        const invoiceId = sub.latest_invoice.id || sub.latest_invoice;
        // Attempt to pay it using the new default card
        const paidInvoice = await stripe.invoices.pay(invoiceId);

        // Then re-check subscription
        const updatedSub = await stripe.subscriptions.retrieve(firm.stripeSubscriptionId);
        subscriptionStatus = updatedSub.status;
        firm.subscriptionStatus = subscriptionStatus;

        if (updatedSub.current_period_end) {
          firm.nextBillDate = new Date(updatedSub.current_period_end * 1000);
        }
      }
    }

    // Save firm updates
    await firm.save();

    // If now "active," update session so user isn't stuck on billing-limited
    if (subscriptionStatus === 'active') {
      req.session.limitedAccess = false;
      if (req.session.user) {
        req.session.user.limitedAccess = false;
        req.session.user.subscriptionStatus = 'active';
      }
      // Force session save
      await new Promise((resolve, reject) => {
        req.session.save(err => (err ? reject(err) : resolve()));
      });
    }

    // Return brand/last4 plus subscriptionStatus
    return res.json({
      message: 'Payment method updated successfully.',
      brand: firm.paymentMethodBrand,
      last4: firm.paymentMethodLast4,
      holderName: firm.paymentMethodHolderName,
      expMonth: firm.paymentMethodExpMonth,
      expYear:  firm.paymentMethodExpYear,
      subscriptionStatus,
    });

  } catch (err) {
    await logError(req, 'Error updating card info:', { severity: 'warning' });
    console.error('Error updating card info:', err);

    if (err.type === 'StripeCardError') {
      return res.status(402).json({ message: err.message || 'Your card was declined.' });
    }
    res.status(500).json({ message: 'Failed to update card.' });
  }
});



// settingsRoutes.js or billingRoutes.js
router.get('/subscription-status', async (req, res) => {
  try {
    const firm = await CompanyID.findById(req.session.user.firmId).lean();
    if (!firm) {
      return res.json({ subscriptionStatus: 'none' });
    }
    return res.json({ subscriptionStatus: firm.subscriptionStatus || 'none' });
  } catch (err) {
    console.error('Error fetching subscription status:', err);
    return res.status(500).json({ subscriptionStatus: 'error' });
  }
});



  
  
  

module.exports = router;

