/****************************************************
 * routes/limitedBillingRoutes.js
 ****************************************************/

const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/authMiddleware');
const CompanyID = require('../models/CompanyID');
const User = require('../models/User');
const { logError } = require('../utils/errorLogger');

// GET /billing-limited => show the new standalone billing page
router.get('/billing-limited', ensureAuthenticated, async (req, res) => {
  try {
    const user = req.session.user;

    // Enforce that only admins can see limited billing
    const isAdminUser =
      user.permission === 'admin' ||
      (Array.isArray(user.roles) && user.roles.includes('admin')) ||
      (user.permissions?.admin === true);

    if (!isAdminUser) {
      // Non-admin => redirect to login or block
      return res.redirect('/login');
    }

    // Fetch the firm
    const firm = await CompanyID.findById(user.firmId).lean();
    if (!firm) {
      return res.status(404).send('Firm not found');
    }

    // If the firm's subscription status is NOT in a limited state (canceled/past_due/unpaid),
    // redirect them to the dashboard, since they're in good standing.
    const limitedStatuses = ['canceled', 'past_due', 'unpaid'];
    if (!limitedStatuses.includes(firm.subscriptionStatus)) {
      return res.redirect('/dashboard');
    }

    // Gather subscription data
    const subscriptionTier   = firm.subscriptionTier   || 'free';
    const subscriptionStatus = firm.subscriptionStatus || 'none';
    const seatsPurchased     = firm.seatsPurchased     || 0;
    const cancelAtPeriodEnd  = firm.cancelAtPeriodEnd  || false;
    const nextBillDate       = firm.nextBillDate       || null;
    const paymentMethodBrand = firm.paymentMethodBrand || null;
    const paymentMethodLast4 = firm.paymentMethodLast4 || null;

    // Convert subscriptionInterval -> 'Annual' or 'Monthly'
    let billingInterval = 'Monthly';
    if (firm.subscriptionInterval === 'annual') {
      billingInterval = 'Annual';
    }

    // Build sub-alert if canceled/past_due/unpaid
    let showSubAlert = false;
    let subAlertType = '';
    if (['canceled', 'past_due', 'unpaid'].includes(subscriptionStatus)) {
      showSubAlert = true;
      subAlertType = subscriptionStatus;
    }

    // If you want user data in the Pug template
    const userData = {
      ...user,
      companyName: firm.companyName || '',
      companyId: firm.companyId || '',
    };

    // Render the new billing-limited page
    return res.render('billing-limited', {
      // user data if needed in the template
      user: userData,

      // subscription data
      subscriptionTier,
      subscriptionStatus,
      seatsPurchased,
      billingInterval,
      cancelAtPeriodEnd,
      nextBillDate,
      paymentMethodBrand,
      paymentMethodLast4,

      // sub alert logic
      showSubAlert,
      subAlertType,
    });

  } catch (err) {
    console.error('Error rendering limited billing page:', err);
    await logError(req, 'Error rendering limited billing page', { severity: 'warning' });
    return res.status(500).send('Server error');
  }
});

module.exports = router;
