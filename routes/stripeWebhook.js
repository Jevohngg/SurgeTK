/****************************************************
 * routes/stripeWebhook.js   (drop‑in replacement)
 ****************************************************/

const express   = require('express');          // (only needed if you ever mount with router)
const stripe    = require('stripe')(process.env.STRIPE_SECRET_KEY);
const CompanyID = require('../models/CompanyID');
const { logError } = require('../utils/errorLogger');

/**
 * Stripe sends events with a signed *raw* body.  Express in `app.js`
 * must mount this handler behind `express.raw({ type: 'application/json' })`
 * so we can verify the signature.
 */
async function handleStripeWebhook(req, res) {
  /* 1. Verify signature */
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,                       // **raw** body from express.raw()
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    await logError(req, 'Stripe webhook signature verification failed:', {
      severity: 'warning'
    });
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  /* 2. React to the event */
  try {
    switch (event.type) {

      /* ───────────────────────────────
       * ❶ card declined / payment retry
       * ─────────────────────────────── */
      case 'invoice.payment_failed': {
        console.log('[Webhook] invoice.payment_failed');
        const subscriptionId = event.data.object.subscription;
        if (!subscriptionId) break;

        const firm = await CompanyID.findOne({ stripeSubscriptionId: subscriptionId });
        if (!firm) break;

        // Mirror Stripe’s own status: 'past_due' (retries) or 'unpaid' (dunning ended)
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        firm.subscriptionStatus = sub.status;                 // 'past_due' | 'unpaid'
        firm.nextBillDate      = new Date(sub.current_period_end * 1000);
        await firm.save();

        console.log(`[Webhook] → firm ${firm._id} marked ${sub.status}`);
        break;
      }

      /* ───────────────────────────────
       * ❷ payment eventually succeeds
       * ─────────────────────────────── */
      case 'invoice.payment_succeeded': {
        console.log('[Webhook] invoice.payment_succeeded');
        const subscriptionId = event.data.object.subscription;
        if (!subscriptionId) break;

        const firm = await CompanyID.findOne({ stripeSubscriptionId: subscriptionId });
        if (!firm) break;

        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        firm.subscriptionStatus = sub.status;                 // typically 'active'
        firm.nextBillDate      = new Date(sub.current_period_end * 1000);
        await firm.save();

        console.log(`[Webhook] → firm ${firm._id} back to ${sub.status}`);
        break;
      }

      /* ───────────────────────────────
       * ❸ subscription fully cancelled
       * ─────────────────────────────── */
      case 'customer.subscription.deleted': {
        console.log('[Webhook] customer.subscription.deleted');
        const sub  = event.data.object;
        const firm = await CompanyID.findOne({ stripeSubscriptionId: sub.id });
        if (!firm) break;

        firm.subscriptionStatus   = 'canceled';               // keep history
        firm.subscriptionTier     = 'free';
        firm.seatsPurchased       = 0;
        firm.nextBillDate         = null;
        firm.cancelAtPeriodEnd    = false;
        firm.stripeSubscriptionId = '';
        if (!firm.finalCancellationDate) {
          firm.finalCancellationDate = new Date();
        }
        await firm.save();

        console.log(`[Webhook] → firm ${firm._id} marked canceled`);
        break;
      }

      /* ───────────────────────────────
       * ❹ everything else
       * ─────────────────────────────── */
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    /* 3. Acknowledge receipt */
    return res.json({ received: true });

  } catch (err) {
    await logError(req, 'Error handling Stripe webhook event:', { severity: 'warning' });
    console.error('Error handling Stripe webhook event:', err);
    return res.status(500).send('Webhook handler failed');
  }
}

module.exports = handleStripeWebhook;
