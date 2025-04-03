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

    // Default them to "N/A"
    let billingInterval = 'N/A';
    let billingTotal = 'N/A';

    // Example logic: If the firm is on the "pro" tier, figure out monthly vs annual
    // and then multiply seatsPurchased by your per-seat cost. Adjust as needed.
    if (firm.subscriptionTier === 'pro' && firm.subscriptionStatus !== 'canceled') {
      // You might already store an isAnnual flag in your DB or parse from the Price ID
      // For simplicity, let's check if the subscription is annual:
      // e.g. if you store a field `firm.subscriptionInterval = 'annual' || 'monthly'`
      const isAnnual = (firm.subscriptionInterval === 'annual');

      billingInterval = isAnnual ? 'Annual' : 'Monthly';

      // Example seat price, from your .env or a constant
      const monthlySeatPrice = parseInt(process.env.PRO_SEAT_COST_MONTHLY || '95', 10);
      const annualSeatPrice  = parseInt(process.env.PRO_SEAT_COST_ANNUAL  || '1026', 10);
      
      const seats = firm.seatsPurchased || 0;
      billingTotal = isAnnual
        ? (seats * annualSeatPrice)
        : (seats * monthlySeatPrice);
    }

    // Return these new fields along with the rest
    return res.json({
      subscriptionTier:   firm.subscriptionTier,
      subscriptionStatus: firm.subscriptionStatus,
      seatsPurchased:     firm.seatsPurchased,
      paymentMethodLast4: firm.paymentMethodLast4,
      paymentMethodBrand: firm.paymentMethodBrand,
      nextBillDate:       firm.nextBillDate || null,
      cancelAtPeriodEnd:  firm.cancelAtPeriodEnd,
    
      // newly included:
      paymentMethodHolderName: firm.paymentMethodHolderName || '',
      paymentMethodExpMonth:   firm.paymentMethodExpMonth,
      paymentMethodExpYear:    firm.paymentMethodExpYear,
    
      // The previously added data:
      billingInterval,
      billingTotal,
      billingName:           firm.billingName           || '',
      billingEmail:          firm.billingEmail          || '',
      billingAddressLine1:   firm.billingAddressLine1   || '',
      billingAddressCity:    firm.billingAddressCity    || '',
      billingAddressState:   firm.billingAddressState   || '',
      billingAddressPostal:  firm.billingAddressPostal  || '',
      billingAddressCountry: firm.billingAddressCountry || ''
    });
    
  } catch (err) {
    await logError(req, 'GET /settings/billing error:', { severity: 'warning' });
    console.error('GET /settings/billing error:', err);
    return res.status(500).json({ message: 'Server error retrieving billing info.' });
  }
});

  

// routes/billingRoutes.js (Partial - Updated /billing/checkout route)
router.post('/billing/checkout', ensureAuthenticated, ensureOnboarded, ensureAdmin, async (req, res) => {
  try {
    const { desiredSeats, billingInterval = 'monthly', desiredTier = 'pro' } = req.body;
    const userFirm = await CompanyID.findById(req.session.user.firmId);
    if (!userFirm) {
      return res.status(404).json({ message: 'Firm not found.' });
    }

    // If user selects "enterprise", handle or block:
    if (desiredTier === 'enterprise') {
      return res.status(400).json({ message: 'Enterprise tier requires contacting sales.' });
    }

    // Seat usage check for Pro downgrades
    if (desiredTier === 'pro') {
      const advisorsCount = await User.countDocuments({
        firmId: userFirm._id,
        role: { $in: ['admin', 'advisor'] }
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
                   `That requires at least ${minSeatsRequired} seat(s). Please remove or adjust team members before downgrading.`
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
        items: [
          {
            price: priceId,
            quantity: desiredSeats,
          },
        ],
        proration_behavior: 'create_prorations',
        payment_behavior: 'error_if_incomplete', // or 'allow_incomplete'
        expand: ['latest_invoice'],
      });
    } else {
      // ----------------------------
      // UPDATE existing subscription
      // ----------------------------
      const existingSub = await stripe.subscriptions.retrieve(userFirm.stripeSubscriptionId);
      const subscriptionItemId = existingSub.items.data[0].id;

      subscription = await stripe.subscriptions.update(userFirm.stripeSubscriptionId, {
        items: [
          {
            id: subscriptionItemId,
            price: priceId,
            quantity: desiredSeats,
          },
        ],
        proration_behavior: 'create_prorations',
        payment_behavior: 'error_if_incomplete', // or 'allow_incomplete'
        expand: ['latest_invoice'],
      });
    }

    // Pay the subscription's latest invoice if not already paid or void
    if (subscription.latest_invoice) {
      const latestInvoice = subscription.latest_invoice;
      if (latestInvoice.status !== 'paid' && latestInvoice.status !== 'void') {
        await stripe.invoices.pay(latestInvoice.id);
      }
    }

    // Save updated subscription info to DB
    userFirm.subscriptionTier = desiredTier;   // e.g., 'pro'
    userFirm.subscriptionInterval = billingInterval; // 'monthly' or 'annual'
    userFirm.subscriptionStatus = subscription.status;
    userFirm.stripeSubscriptionId = subscription.id;
    userFirm.seatsPurchased = desiredSeats;

    if (subscription.current_period_end) {
      userFirm.nextBillDate = new Date(subscription.current_period_end * 1000);
    }
    await userFirm.save();

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

    // Check if the firm is able to move to free tier eventually
    // (e.g., if they're above free-tier user limits, block cancellation)
    const membersCount = await User.countDocuments({ firmId: userFirm._id });
    const advisorsCount = await User.countDocuments({
      firmId: userFirm._id,
      roles: { $in: ['admin', 'advisor'] }
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


/**
 * POST /webhooks/stripe
 * Stripe webhook to handle subscription updates, payment methods, etc.
 */
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    await logError(req, 'Stripe webhook signature verification failed:', { severity: 'warning' });
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  try {
    switch (event.type) {
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        // Update payment method info and next bill date if needed
        const subscriptionId = invoice.subscription;
        const paymentMethod = invoice.payment_intent?.charges?.data?.[0]?.payment_method_details?.card;
        // Find the firm by subscriptionId
        const firm = await CompanyID.findOne({ stripeSubscriptionId: subscriptionId });
        if (firm && paymentMethod) {
          firm.paymentMethodLast4 = paymentMethod.last4;
          firm.paymentMethodBrand = paymentMethod.brand;
          // next billing date can be derived from invoice.period_end or subscription current_period_end
          if (invoice.lines?.data?.[0]) {
            const periodEnd = invoice.lines.data[0].period?.end;
            if (periodEnd) {
              firm.nextBillDate = new Date(periodEnd * 1000);
            }
          }
          await firm.save();
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const firm = await CompanyID.findOne({ stripeSubscriptionId: subscription.id });
        if (firm) {
          firm.subscriptionStatus = subscription.status;
          // seatsPurchased => from subscription.items[0].quantity if you only have 1 item
          if (subscription.items?.data?.[0]) {
            firm.seatsPurchased = subscription.items.data[0].quantity;
          }
          // Update nextBillDate
          firm.nextBillDate = subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null;
      
          // If subscription canceled or ended, revert to free tier
          if (['canceled', 'incomplete_expired'].includes(subscription.status)) {
            firm.subscriptionTier = 'free';
            firm.subscriptionStatus = 'none';
            firm.stripeSubscriptionId = '';
            firm.seatsPurchased = 0;
            firm.nextBillDate = null;
            firm.cancelAtPeriodEnd = false; // Clear the flag
          }
          await firm.save();
        }
        break;
      }
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    await logError(req, 'Error handling Stripe webhook event:', { severity: 'warning' });
    console.error('Error handling Stripe webhook event:', err);
    res.status(500).send('Webhook handler failed');
  }
});

// routes/billingRoutes.js
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

    // 2) Set it as the default payment method
    await stripe.customers.update(firm.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // 3) Retrieve PaymentMethod details
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);

    // 4) Update local DB fields
    if (pm && pm.card) {
      firm.paymentMethodBrand = pm.card.brand;
      firm.paymentMethodLast4 = pm.card.last4;
      firm.paymentMethodExpMonth = pm.card.exp_month;
      firm.paymentMethodExpYear  = pm.card.exp_year;
    }
    if (pm && pm.billing_details) {
      firm.billingName  = pm.billing_details.name  || '';
      firm.billingEmail = pm.billing_details.email || '';
      firm.paymentMethodHolderName = pm.billing_details.name || '';

      if (pm.billing_details.address) {
        firm.billingAddressLine1 = pm.billing_details.address.line1 || '';
        firm.billingAddressCity  = pm.billing_details.address.city || '';
        firm.billingAddressState = pm.billing_details.address.state || '';
        firm.billingAddressPostal= pm.billing_details.address.postal_code || '';
        firm.billingAddressCountry = pm.billing_details.address.country || '';
      }
    }
    await firm.save();

    // 5) Send back the updated card fields too
    return res.json({
      message: 'Payment method updated successfully.',
      brand: firm.paymentMethodBrand,
      last4: firm.paymentMethodLast4,
      holderName: firm.paymentMethodHolderName,
      expMonth: firm.paymentMethodExpMonth,
      expYear: firm.paymentMethodExpYear,
    });

  } catch (err) {
    await logError(req, 'Error updating card info:', { severity: 'warning' });
    console.error('Error updating card info:', err);

    if (err.type === 'StripeCardError') {
      return res.status(402).json({
        message: err.message || 'Your card was declined.',
      });
    }
    res.status(500).json({ message: 'Failed to update card.' });
  }
});



  
  
  

module.exports = router;
