// public/js/householdBuckets.js
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

  // Append everything
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
  const generateBtn = document.getElementById('generateBucketsBtn');
  const downloadBtn = document.getElementById('downloadBucketsBtn');
  const emailBtn = document.getElementById('emailBucketsBtn');
  const iframe = document.getElementById('bucketsIframe');
  const householdId = window.householdId || null;

  // 1) init
  async function initBuckets() {
    try {
      const resAll = await fetch(`/api/value-add/household/${householdId}`);
      const list = await resAll.json();
      if (!Array.isArray(list)) {
        showAlert('danger', 'Unexpected response fetching ValueAdds.');
        return;
      }

      let bucketsVA = list.find(va => va.type === 'BUCKETS');
      if (!bucketsVA) {
        // create
        const createRes = await fetch(`/api/value-add/household/${householdId}/buckets`, { method: 'POST' });
        const createData = await createRes.json();
        if (!createRes.ok) {
          showAlert('danger', `Error creating Buckets: ${createData.message}.`);
          return;
        }
        bucketsVA = createData.valueAdd;
      }
      if (bucketsVA && iframe) {
        iframe.src = `/api/value-add/${bucketsVA._id}/view`;
      }
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error initializing Buckets.');
    }
  }

  // 2) Generate/Refresh
  async function handleGenerate() {
    try {
      const resAll = await fetch(`/api/value-add/household/${householdId}`);
      const list = await resAll.json();

      let bucketsVA = list.find(va => va.type === 'BUCKETS');
      if (!bucketsVA) {
        // create
        const createRes = await fetch(`/api/value-add/household/${householdId}/buckets`, { method: 'POST' });
        const createData = await createRes.json();
        if (!createRes.ok) {
          showAlert('danger', `Error creating Buckets: ${createData.message}`);
          return;
        }
        bucketsVA = createData.valueAdd;
      } else {
        // update
        const updateRes = await fetch(`/api/value-add/${bucketsVA._id}/buckets`, { method: 'PUT' });
        const updateData = await updateRes.json();
        if (!updateRes.ok) {
          showAlert('danger', `Error updating Buckets: ${updateData.message}`);
          return;
        }
        bucketsVA = updateData.valueAdd;
      }
      if (bucketsVA && iframe) {
        iframe.src = `/api/value-add/${bucketsVA._id}/view`;
      }
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error generating Buckets.');
    }
  }

  // 3) Download => /api/value-add/:id/download
  async function handleDownload() {
    try {
      const resAll = await fetch(`/api/value-add/household/${householdId}`);
      const list = await resAll.json();
      let bucketsVA = list.find(va => va.type === 'BUCKETS');
      if (!bucketsVA) {
        showAlert('danger', 'No Buckets ValueAdd found to download.');
        return;
      }
      window.location.href = `/api/value-add/${bucketsVA._id}/download`;
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error downloading Buckets.');
    }
  }

  async function handleEmail() {
    try {
      // 1) Prompt user for the recipient
      const recipientEmail = prompt("Please enter recipient's email address:");
      if (!recipientEmail) {
        // User canceled or left it blank
        return;
      }
  
      // 2) Fetch all ValueAdds for the household
      const resAll = await fetch(`/api/value-add/household/${householdId}`);
      const list = await resAll.json();
  
      // 3) Locate the correct ValueAdd
      let bucketsVA = list.find(va => va.type === 'BUCKETS');
      if (!bucketsVA) {
        showAlert('danger', 'No Buckets ValueAdd found to email.');
        return;
      }
  
      // 4) Call your server's email route, passing the typed recipient
      const emailRes = await fetch(`/api/value-add/${bucketsVA._id}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: recipientEmail })
      });
  
      // 5) Check response
      if (!emailRes.ok) {
        const errData = await emailRes.json();
        showAlert('danger', `Error emailing Buckets: ${errData.message || 'Unknown'}`);
        return;
      }
  
      // success
      showAlert('success', 'Buckets emailed successfully!');
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error emailing Buckets.');
    }
  }
  

  // 5) attach events
  if (generateBtn) generateBtn.addEventListener('click', handleGenerate);
  if (downloadBtn) downloadBtn.addEventListener('click', handleDownload);
  if (emailBtn) emailBtn.addEventListener('click', handleEmail);

  // 6) init
  initBuckets();
});
