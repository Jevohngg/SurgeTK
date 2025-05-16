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
  const downloadBtn = document.getElementById('downloadGuardrailsBtn');
  const emailBtn = document.getElementById('emailGuardrailsBtn');
  const iframe = document.getElementById('guardrailsIframe');
  const householdId = window.householdId || null;
  console.log('[householdGuardrails] householdId =>', householdId);

  // NEW: If your Pug template has a snapshot dropdown and a Save button, get them here
  const snapshotSelect = document.getElementById('guardrailsSnapshotSelect');
  const saveBtn = document.getElementById('saveGuardrailsBtn');

  // We'll store the ValueAdd ID for guardrails here
  let guardrailsValueAddId = null;

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

      // Store the ID for snapshot-related operations
      if (guardrailsVA) {
        guardrailsValueAddId = guardrailsVA._id;
        if (iframe) {
          iframe.src = `/api/value-add/${guardrailsVA._id}/view`;
        }
      }

      // After creation/finding, load snapshots if the dropdown exists
      await loadSnapshots();
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

  async function handleDownload() {
    try {
      if (!guardrailsValueAddId) {
        showAlert('danger', 'No Guardrails ValueAdd found to download.');
        return;
      }
      // We'll see if there's a snapshot selected
      let snapshotId = (snapshotSelect) ? snapshotSelect.value : 'live';
  
      // If user is viewing "live," go to the original route
      // e.g. /api/value-add/:id/download
      if (snapshotId === 'live') {
        window.location.href = `/api/value-add/${guardrailsValueAddId}/download`;
      } else {
        // If user is viewing a snapshot, go to /api/value-add/:id/download/:snapshotId
        window.location.href = `/api/value-add/${guardrailsValueAddId}/download/${snapshotId}`;
      }
  
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error downloading Guardrails.');
    }
  }
  
  async function handleEmail() {
    try {
      if (!guardrailsValueAddId) {
        showAlert('danger', 'No Guardrails ValueAdd found to email.');
        return;
      }
      const recipientEmail = prompt("Please enter recipient's email address:");
      if (!recipientEmail) return;
  
      // Same logic: check if "live" or a snapshot
      let snapshotId = (snapshotSelect) ? snapshotSelect.value : 'live';
      
      let route;
      if (snapshotId === 'live') {
        // live route => POST /api/value-add/:id/email
        route = `/api/value-add/${guardrailsValueAddId}/email`;
      } else {
        // snapshot route => POST /api/value-add/:id/email-snapshot/:snapshotId
        route = `/api/value-add/${guardrailsValueAddId}/email-snapshot/${snapshotId}`;
      }
  
      const emailRes = await fetch(route, {
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
  

  // NEW: Load snapshots list
  async function loadSnapshots() {
    // Only proceed if we actually have an ID and a dropdown
    if (!guardrailsValueAddId || !snapshotSelect) return;
    try {
      const res = await fetch(`/api/value-add/${guardrailsValueAddId}/snapshots`);
      if (!res.ok) {
        showAlert('danger', 'Failed to load snapshots.');
        return;
      }
      const snapshots = await res.json();

      // Clear existing <option> elements except the "Live" placeholder
      while (snapshotSelect.options.length > 1) {
        snapshotSelect.remove(1);
      }

      // Populate new snapshot options
      snapshots.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s._id;
        const dateObj = new Date(s.timestamp);
        opt.textContent = `${dateObj.toLocaleString()}`;
        snapshotSelect.appendChild(opt);
      });
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error loading snapshots.');
    }
  }

  // NEW: Handle snapshot dropdown changes
  function handleSnapshotSelect() {
    if (!snapshotSelect || !guardrailsValueAddId || !iframe) return;
    const val = snapshotSelect.value;
    if (val === 'live') {
      // Show the live version
      iframe.src = `/api/value-add/${guardrailsValueAddId}/view`;
    } else {
      // Show the saved snapshot
      iframe.src = `/api/value-add/${guardrailsValueAddId}/view/${val}`;
    }
  }

  // NEW: Handle "Save" => POST /api/value-add/:id/save-snapshot
  async function handleSave() {
    try {
      if (!guardrailsValueAddId) {
        showAlert('danger', 'No Guardrails ValueAdd found.');
        return;
      }
      const res = await fetch(`/api/value-add/${guardrailsValueAddId}/save-snapshot`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) {
        showAlert('danger', `Error saving snapshot: ${data.message || 'Unknown'}`);
        return;
      }
      showAlert('success', 'Snapshot saved!');
      // Reload the snapshots
      await loadSnapshots();
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error saving snapshot.');
    }
  }

  // 5) Attach event listeners
  if (generateBtn) {
    generateBtn.addEventListener('click', handleGenerate);
  }
  if (downloadBtn) {
    downloadBtn.addEventListener('click', handleDownload);
  }
  if (emailBtn) {
    emailBtn.addEventListener('click', handleEmail);

  // NEW: If your Pug has a #saveGuardrailsBtn button
  }
  if (saveBtn) {
    saveBtn.addEventListener('click', handleSave);
  }

  // NEW: If your Pug has a #guardrailsSnapshotSelect dropdown
  if (snapshotSelect) {
    snapshotSelect.addEventListener('change', handleSnapshotSelect);
  }

  // 6) Start
  initGuardrails();
});
