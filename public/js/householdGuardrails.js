// public/js/householdGuardrails.js
"use strict";

/**
 * Alert Function
 * Displays alert messages to the user.
 * @param {string} type - 'success' or 'danger'
 * @param {string} message - The alert message
 */
function showAlert(type, message) {
  const alertContainer = document.getElementById('alert-container');
  if (!alertContainer) return;

  const alert = document.createElement('div');
  alert.id = (type === 'success') ? 'passwordChangeSuccess' : 'errorAlert';
  alert.className = `alert ${(type === 'success') ? 'alert-success' : 'alert-error'}`;
  alert.setAttribute('role', 'alert');

  // Icon container
  const iconContainer = document.createElement('div');
  iconContainer.className = (type === 'success') ? 'success-icon-container' : 'error-icon-container';
  const icon = document.createElement('i');
  icon.className = (type === 'success') ? 'far fa-check-circle' : 'far fa-times-circle';
  iconContainer.appendChild(icon);

  // Close container
  const closeContainer = document.createElement('div');
  closeContainer.className = (type === 'success') ? 'success-close-container' : 'error-close-container';
  const closeIcon = document.createElement('span');
  closeIcon.className = 'material-symbols-outlined successCloseIcon';
  closeIcon.innerText = 'close';
  closeContainer.appendChild(closeIcon);

  // Text container
  const textContainer = document.createElement('div');
  textContainer.className = 'success-text';
  const title = document.createElement('h3');
  title.innerText = (type === 'success') ? 'Success!' : 'Error!';
  const text = document.createElement('p');
  text.innerText = message;
  textContainer.appendChild(title);
  textContainer.appendChild(text);

  // Close logic
  function closeAlert() {
    alert.classList.add('exit');
    setTimeout(() => {
      if (alert.parentNode) {
        alert.parentNode.removeChild(alert);
      }
    }, 500);
  }

  alert.appendChild(iconContainer);
  alert.appendChild(closeContainer);
  alert.appendChild(textContainer);
  alertContainer.prepend(alert);

  void alert.offsetWidth; // trigger reflow for CSS transition
  alert.classList.add('show');

  // Auto-close after 5s
  setTimeout(() => closeAlert(), 5000);
  closeIcon.addEventListener('click', () => closeAlert());
}

document.addEventListener('DOMContentLoaded', () => {
  const generateBtn = document.getElementById('generateGuardrailsBtn');
  const downloadBtn = document.getElementById('downloadGuardrailsBtn');   // <-- new
  const emailBtn = document.getElementById('emailGuardrailsBtn');         // <-- new
  const iframe = document.getElementById('guardrailsIframe');
  const householdId = window.householdId || null;
  console.log('[householdGuardrails] householdId =>', householdId);

  // 1) Initialize Guardrails
  async function initGuardrails() {
    try {
      const resAll = await fetch(`/api/value-add/household/${householdId}`);
      const list = await resAll.json();
      if (!Array.isArray(list)) {
        showAlert('danger', 'Unexpected response fetching ValueAdds.');
        return;
      }

      let guardrailsVA = list.find(va => va.type === 'GUARDRAILS');
      if (!guardrailsVA) {
        const createRes = await fetch(`/api/value-add/household/${householdId}/guardrails`, { method: 'POST' });
        const createData = await createRes.json();
        if (!createRes.ok) {
          showAlert('danger', `Error creating Guardrails: ${createData.message}. Missing: ${createData.missingFields || ''}`);
          return;
        }
        guardrailsVA = createData.valueAdd;
      }
      if (guardrailsVA && iframe) {
        iframe.src = `/api/value-add/${guardrailsVA._id}/view`;
      }
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error initializing guardrails.');
    }
  }

  // 2) Generate/Refresh
  async function handleGenerate() {
    try {
      const resAll = await fetch(`/api/value-add/household/${householdId}`);
      const list = await resAll.json();

      let guardrailsVA = list.find(va => va.type === 'GUARDRAILS');
      if (!guardrailsVA) {
        const createRes = await fetch(`/api/value-add/household/${householdId}/guardrails`, { method: 'POST' });
        const createData = await createRes.json();
        if (!createRes.ok) {
          showAlert('danger', `Error creating Guardrails: ${createData.message}`);
          return;
        }
        guardrailsVA = createData.valueAdd;
      } else {
        const updateRes = await fetch(`/api/value-add/${guardrailsVA._id}/guardrails`, { method: 'PUT' });
        const updateData = await updateRes.json();
        if (!updateRes.ok) {
          showAlert('danger', `Error updating Guardrails: ${updateData.message}`);
          return;
        }
        guardrailsVA = updateData.valueAdd;
      }
      if (guardrailsVA && iframe) {
        iframe.src = `/api/value-add/${guardrailsVA._id}/view`;
      }
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error generating Guardrails.');
    }
  }

  // 3) Download => /api/value-add/:id/download
  async function handleDownload() {
    try {
      const resAll = await fetch(`/api/value-add/household/${householdId}`);
      const list = await resAll.json();
      let guardrailsVA = list.find(va => va.type === 'GUARDRAILS');
      if (!guardrailsVA) {
        showAlert('danger', 'No Guardrails ValueAdd found to download.');
        return;
      }
      // Trigger the file download
      window.location.href = `/api/value-add/${guardrailsVA._id}/download`;
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error downloading Guardrails.');
    }
  }

  // 4) Email => /api/value-add/:id/email
  async function handleEmail() {
    try {
      // Prompt user for the recipient
      const recipientEmail = prompt("Please enter recipient's email address:");
      if (!recipientEmail) {
        // user canceled or left blank
        return;
      }

      // Fetch all ValueAdds
      const resAll = await fetch(`/api/value-add/household/${householdId}`);
      const list = await resAll.json();

      let guardrailsVA = list.find(va => va.type === 'GUARDRAILS');
      if (!guardrailsVA) {
        showAlert('danger', 'No Guardrails ValueAdd found to email.');
        return;
      }

      // POST to /api/value-add/:id/email
      const emailRes = await fetch(`/api/value-add/${guardrailsVA._id}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: recipientEmail })
      });

      if (!emailRes.ok) {
        const errData = await emailRes.json();
        showAlert('danger', `Error emailing Guardrails: ${errData.message || 'Unknown'}`);
        return;
      }
      showAlert('success', 'Guardrails emailed successfully!');
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error emailing Guardrails.');
    }
  }

  // 5) Attach event listeners
  if (generateBtn) {
    generateBtn.addEventListener('click', handleGenerate);
  }

  // If you have corresponding buttons in your Pug:
  if (downloadBtn) {
    downloadBtn.addEventListener('click', handleDownload);
  }
  if (emailBtn) {
    emailBtn.addEventListener('click', handleEmail);
  }

  // 6) Start
  initGuardrails();
});
