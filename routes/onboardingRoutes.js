// routes/onboardingRoutes.js

/**
 * COMPLETE FILE: onboardingRoutes.js
 * 
 * This file now includes:
 *  - Existing onboarding routes for creating/joining a firm.
 *  - Updated "create-firm" route that redirects to a new subscription step instead of the dashboard.
 *  - New routes (GET/POST) for /onboarding/subscription, allowing the user to pick Free vs. Pro,
 *    attach a card (optional for Free, required for Pro), and create/update their Stripe subscription.
 * 
 * Copy and paste this file into your codebase to replace the existing `onboardingRoutes.js`.
 */

const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Models
const CompanyID = require('../models/CompanyID');
const User = require('../models/User');

// Middleware
const { ensureAuthenticated } = require('../middleware/authMiddleware');

// Stripe
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

/* --------------------------------------------
   GET /onboarding
   Shows options to set up a new firm or join
   an existing one.
   -------------------------------------------- */
router.get('/', ensureAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.user._id);

  // If user already has a firmId, skip onboarding
  if (user.firmId) {
    return res.redirect('/dashboard');
  }

  res.render('onboarding', { user });
});

/* --------------------------------------------
   POST /onboarding/create-firm
   Handles form data from the multi-step form,
   creating a new firm, assigning user as admin.
   Then redirects to /onboarding/subscription
   -------------------------------------------- */
// routes/onboardingRoutes.js

router.post('/create-firm', ensureAuthenticated, async (req, res) => {
  try {
    console.log('--- createFirm route triggered ---');
    console.log('Incoming form fields:', req.body);

    // Step One fields
    const { 
      companyName, 
      companyEmail, 
      phoneNumber, 
      companyAddress,
      companyWebsite 
    } = req.body;

    // Step Two fields
    const {
      custodian,
      brokerDealer,        // 'yes' or 'no'
      isRIA,               // 'yes' or 'no'
      areYouRunningSurges, // 'yes' or 'no'
      totalAUM,
      totalHouseholds,
      numberOfTeamMembers,
      painPoint,
      successCriteria
    } = req.body;

    // Basic validation
    if (!companyName) {
      return res.render('onboarding', {
        user: req.session.user,
        errorMessage: 'Company Name is required.'
      });
    }

    // Ensure user is loaded
    const user = await User.findById(req.session.user._id);
    if (!user) {
      console.log('User not found in session. Something is wrong.');
      return res.redirect('/dashboard');
    }

    // If user already has a firm, skip
    if (user.firmId) {
      console.log('User already has a firmId. Redirecting to dashboard.');
      return res.redirect('/dashboard');
    }

    // Generate a random short Company ID
    const generatedCompanyId = crypto.randomBytes(3).toString('hex').toLowerCase();
    console.log('Generated random Company ID =>', generatedCompanyId);

    // Convert yes/no => boolean
    const brokerDealerBool        = (brokerDealer === 'yes');
    const isRIABool               = (isRIA === 'yes');
    const areYouRunningSurgesBool = (areYouRunningSurges === 'yes');

    // Create new firm
    const newFirm = new CompanyID({
      companyId: generatedCompanyId,
      companyName,
      assignedEmail: companyEmail,
      phoneNumber,
      companyAddress,
      isUsed: true,
      companyWebsite: companyWebsite || '',
      companyLogo: '',
      custodian: custodian || '',
      brokerDealer: brokerDealerBool,
      isRIA: isRIABool,
      areYouRunningSurges: areYouRunningSurgesBool,
      totalAUM: totalAUM || '',
      totalHouseholds: totalHouseholds ? parseInt(totalHouseholds, 10) : 0,
      numberOfTeamMembers: numberOfTeamMembers ? parseInt(numberOfTeamMembers, 10) : 0,
      painPoint: painPoint || '',
      successCriteria: successCriteria || '',
      invitedUsers: [
        {
          email: user.email,
          roles: ['admin'],
          permission: 'admin',
        },
      ],
    });

    // Save new firm
    const savedFirm = await newFirm.save();
    console.log('Saved new firm =>', savedFirm);

    // Mark user as the firm creator/admin
    user.firmId = savedFirm._id;
    user.roles = ['admin'];
    user.permission = 'admin';
    user.companyId = generatedCompanyId; 
    user.companyName = companyName;
    user.isFirmCreator = true;

    // Remove user from invitedUsers array to avoid duplication
    savedFirm.invitedUsers = savedFirm.invitedUsers.filter(
      (inv) => inv.email.toLowerCase() !== user.email.toLowerCase()
    );
    await savedFirm.save();

    // Save updated user
    const savedUser = await user.save();
    console.log('Updated user =>', savedUser);

    // Send a welcome email here — AFTER user is saved
    try {
      const msg = {
        to: savedUser.email,
        from: 'SurgeTk <support@notifications.surgetk.com>',
        templateId: 'd-85a676388c9a4ecfa46a9a0da6983989', // Replace with your actual SendGrid dynamic template ID
        dynamic_template_data: {
          first_name: savedUser.firstName || 'Advisor', // Fallback if firstName is missing
          firm_name: savedFirm.companyName,
        },
      };
      await sgMail.send(msg);
      console.log('Welcome email sent successfully to:', savedUser.email);
    } catch (emailErr) {
      console.error('Error sending welcome email:', emailErr);
      // Decide if you want to fail silently or show an error
      // Typically, you'd log and proceed with the redirect.
    }

    // Update session
    req.session.user = savedUser;

    // First-time welcome logic
    if (!savedUser.hasSeenWelcomeModal) {
      req.session.showWelcomeModal = true;
      savedUser.hasSeenWelcomeModal = true;
      await savedUser.save();
    }

    // Wait for session to finish saving
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    // Redirect to subscription step
    return res.redirect('/onboarding/subscription');

  } catch (error) {
    console.error('Error creating firm:', error);
    return res.status(500).render('onboarding', {
      user: req.session.user,
      errorMessage: 'An error occurred while creating your firm. Please try again.'
    });
  }
});

  

/* --------------------------------------------
   POST /onboarding/join-firm (unchanged)
   For scenario if user is invited to a firm
   but we keep as-is.
   -------------------------------------------- */
router.post('/join-firm', ensureAuthenticated, async (req, res) => {
  const user = await User.findById(req.session.user._id);
  if (!user) return res.redirect('/login');

  if (user.firmId) {
    return res.redirect('/dashboard');
  } else {
    return res.render('onboarding', {
      user,
      errorMessage: 'You are not yet invited to a firm. Please request an invitation.'
    });
  }
});

/* --------------------------------------------
   NEW: GET /onboarding/subscription
   Displays the new subscription page where the
   user can pick Free vs. Pro, seats, and card info.
   -------------------------------------------- */
router.get('/subscription', ensureAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.user._id);
    if (!user) {
      return res.redirect('/login');
    }

    // If user somehow already has a firm with a subscription,
    // you might skip or proceed with the page. We'll proceed anyway.
    return res.render('onboarding-subscription', {
      user,
      // Additional data if needed in the template
    });
  } catch (err) {
    console.error('Error displaying subscription page:', err);
    return res.status(500).send('Server error');
  }
});

router.post('/subscription', ensureAuthenticated, async (req, res) => {
  try {
    const { planChoice, seats, paymentMethodId, billingInterval } = req.body;
    const user = await User.findById(req.session.user._id);
    if (!user || !user.firmId) {
      return res.status(400).json({ message: 'No firm or user session found.' });
    }

    const firm = await CompanyID.findById(user.firmId);
    if (!firm) {
      return res.status(404).json({ message: 'Firm not found.' });
    }

    console.log(`Received billingInterval: ${billingInterval}`); // Debugging log

    if (planChoice === 'free') {
      // Mark the firm as free
      firm.subscriptionTier = 'free';
      firm.seatsPurchased = 0;
      firm.cancelAtPeriodEnd = false;

      // If user provided a PaymentMethod while on free, attach it (optional)
      if (paymentMethodId) {
        await attachPaymentMethodToFirm(firm, paymentMethodId);
      }

      // Save the firm and return response
      await firm.save();
      return res.json({ message: 'Subscription updated to free.' });

    } else if (planChoice === 'pro') {
      // Pro plan => card is required
      if (!paymentMethodId) {
        return res.status(400).json({ message: 'Payment method required for Pro.' });
      }

      // Attach or update the card in Stripe
      await attachPaymentMethodToFirm(firm, paymentMethodId);

      // Determine seats + interval
      const desiredSeats = parseInt(seats, 10) || 1;
      const chosenInterval = (billingInterval === 'annual') ? 'annual' : 'monthly';

      // Create or update the subscription using the correct price ID
      await createOrUpdateProSubscription(firm, desiredSeats, chosenInterval);

      // Save the subscription interval in the firm document
      firm.subscriptionInterval = chosenInterval;  // Save the interval (monthly/annual)
      await firm.save();

      return res.json({ message: 'Subscription updated to Pro.' });

    } else {
      return res.status(400).json({ message: 'Invalid plan choice.' });
    }

  } catch (error) {
    console.error('Error finalizing subscription:', error);
  
    // Specifically handle Stripe card errors (e.g. "Your card was declined.")
    if (error.type === 'StripeCardError') {
      // Return the message from Stripe: e.g. "Your card was declined."
      return res.status(402).json({ 
        message: error.message || 'Your card was declined.'
      });
    }
  
    // Otherwise, return a more generic message
    return res.status(500).json({
      message: 'We encountered an error finalizing your subscription. Please try again.'
    });
  }
});




/* --------------------------------------------
   attachPaymentMethodToFirm
   - If the firm doesn't have a stripeCustomerId,
     we create one in Stripe.
   - Attach the PaymentMethod, set it as default,
     and store brand/last4 in DB.
   -------------------------------------------- */
async function attachPaymentMethodToFirm(firm, paymentMethodId) {
  if (!firm.stripeCustomerId) {
    // Create a new Stripe customer
    const customer = await stripe.customers.create({
      email: firm.assignedEmail || 'noemail@example.com',
      name: firm.companyName || 'No Name',
    });
    firm.stripeCustomerId = customer.id;
    await firm.save();
  }

  // Attach the PaymentMethod
  await stripe.paymentMethods.attach(paymentMethodId, {
    customer: firm.stripeCustomerId,
  });

  // Set as default
  await stripe.customers.update(firm.stripeCustomerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });

  // Retrieve details so we can store brand + last4
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  if (pm && pm.card) {
    firm.paymentMethodLast4 = pm.card.last4;
    firm.paymentMethodBrand = pm.card.brand;
  }

  // Also store billing details if present
  if (pm && pm.billing_details) {
    firm.billingName = pm.billing_details.name || '';
    firm.billingEmail = pm.billing_details.email || '';
    if (pm.billing_details.address) {
      firm.billingAddressLine1 = pm.billing_details.address.line1 || '';
      firm.billingAddressCity  = pm.billing_details.address.city || '';
      firm.billingAddressState = pm.billing_details.address.state || '';
      firm.billingAddressPostal= pm.billing_details.address.postal_code || '';
      firm.billingAddressCountry = pm.billing_details.address.country || '';
    }
  }

  await firm.save();
}

async function createOrUpdateProSubscription(firm, desiredSeats, billingInterval) {
  // Pick the correct Price ID based on interval
  const priceId = (billingInterval === 'annual')
    ? process.env.STRIPE_PRO_ANNUAL_PRICE_ID
    : process.env.STRIPE_PRO_MONTHLY_PRICE_ID;

  const stripeCustomerId = firm.stripeCustomerId;

  // If no subscription exists, create a new one
  if (!firm.stripeSubscriptionId) {
    const subscription = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [
        {
          price: priceId,
          quantity: desiredSeats,
        },
      ],
      proration_behavior: 'create_prorations',
      payment_behavior: 'error_if_incomplete',
      expand: ['latest_invoice'],
    });

    // Attempt to pay the invoice immediately (if not already paid)
    if (subscription.latest_invoice && subscription.latest_invoice.status !== 'paid') {
      await stripe.invoices.pay(subscription.latest_invoice.id);
    }

    // Update local firm record
    firm.subscriptionTier = 'pro';
    firm.subscriptionStatus = subscription.status;
    firm.stripeSubscriptionId = subscription.id;
    firm.seatsPurchased = desiredSeats;
    if (subscription.current_period_end) {
      firm.nextBillDate = new Date(subscription.current_period_end * 1000);
    }

  } else {
    // Update existing subscription
    const existingSub = await stripe.subscriptions.retrieve(firm.stripeSubscriptionId);
    const itemId = existingSub.items.data[0].id;

    const updatedSub = await stripe.subscriptions.update(firm.stripeSubscriptionId, {
      items: [
        {
          id: itemId,
          price: priceId,
          quantity: desiredSeats,
        },
      ],
      proration_behavior: 'create_prorations',
      payment_behavior: 'error_if_incomplete',
      expand: ['latest_invoice'],
    });

    // Attempt to pay the invoice if it's not paid
    if (updatedSub.latest_invoice && updatedSub.latest_invoice.status !== 'paid') {
      await stripe.invoices.pay(updatedSub.latest_invoice.id);
    }

    // Update local firm record
    firm.subscriptionTier = 'pro';
    firm.subscriptionStatus = updatedSub.status;
    firm.stripeSubscriptionId = updatedSub.id;
    firm.seatsPurchased = desiredSeats;
    if (updatedSub.current_period_end) {
      firm.nextBillDate = new Date(updatedSub.current_period_end * 1000);
    }
  }

  // Save the subscription interval (monthly or annual)
  firm.subscriptionInterval = billingInterval;  // Add this line
  await firm.save();  // Ensure it's saved
}



module.exports = router;
