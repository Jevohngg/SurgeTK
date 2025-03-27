// utils/sendEmails.js (example)
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Sends a "Welcome to Existing Firm" email after a user joins a firm.
 * @param {Object} options - e.g. { user, firm, roleName, roleDescription, roleLink }
 */
async function sendFirmWelcomeEmail(options) {
  const { user, firm, roleName, roleDescription, roleLink } = options;
  
  // Template: d-b23b39fa264741048122bf7a1a248626
  // Vars: {
  //   "firm_name":"Jarvis Finacial",
  //   "first_name":"Grayson",
  //   "user_role_name":"Admin",
  //   "role_description":"An Admin is responsible for everything under the sun",
  //   "role_link":"app.surgetk.com/help-center/user_role/"
  // }

  const msg = {
    to: user.email,
    from: 'SurgeTk <support@notifications.surgetk.com>',
    templateId: 'd-b23b39fa264741048122bf7a1a248626',
    dynamic_template_data: {
      firm_name:       firm.companyName || 'Your Firm',
      first_name:      user.firstName,
      user_role_name:  roleName || 'Team Member',
      role_description: roleDescription || 'You have important responsibilities in SurgeTK!',
      role_link:       roleLink || 'https://app.surgetk.com/help-center/user_role'
    }
  };

  await sgMail.send(msg);
}

module.exports = { sendFirmWelcomeEmail };
