console.log('beneficiary script running')

// public/js/householdBeneficiary.js
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
  const generateBtn = document.getElementById('generateBeneficiaryBtn');
  const saveBtn = document.getElementById('saveBeneficiaryBtn'); // "Save" button
  const downloadBtn = document.getElementById('downloadBeneficiaryBtn');
  const emailBtn = document.getElementById('emailBeneficiaryBtn');
  const iframe = document.getElementById('beneficiaryIframe');
  const householdId = window.householdId || null;

  // NEW: Dropdown for snapshots (if the Pug template includes it)
  const snapshotSelect = document.getElementById('beneficiarySnapshotSelect');

  let beneficiaryValueAddId = null;

  // 1) Initialize Beneficiary on page load
  async function initBeneficiary() {
    try {
      const resAll = await fetch(`/api/value-add/household/${householdId}`);
      const list = await resAll.json();
      if (!Array.isArray(list)) {
        showAlert('danger', 'Unexpected response fetching ValueAdds.');
        return;
      }

      let beneficiaryVA = list.find(va => va.type === 'BENEFICIARY');
      if (!beneficiaryVA) {
        // create if not found
        const createRes = await fetch(`/api/value-add/household/${householdId}/beneficiary`, { method: 'POST' });
        const createData = await createRes.json();
        if (!createRes.ok) {
          showAlert('danger', `Error creating beneficiary: ${createData.message}.`);
          return;
        }
        beneficiaryVA = createData.valueAdd;
      }

      // Store the ValueAdd ID so we can reference it for snapshot operations
      if (beneficiaryVA) {
        beneficiaryValueAddId = beneficiaryVA._id;
        // Load the "live" version in the iframe
        iframe.src = `/api/value-add/${beneficiaryVA._id}/view`;
      }

      // After the ValueAdd is created/found, load any saved snapshots
      await loadSnapshots();
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error initializing beneficiary.');
    }
  }

  // 2) Generate/Refresh
  async function handleGenerate() {
    try {
      const resAll = await fetch(`/api/value-add/household/${householdId}`);
      const list = await resAll.json();

      let beneficiaryVA = list.find(va => va.type === 'BENEFICIARY');
      if (!beneficiaryVA) {
        // create
        const createRes = await fetch(`/api/value-add/household/${householdId}/beneficiary`, { method: 'POST' });
        const createData = await createRes.json();
        if (!createRes.ok) {
          showAlert('danger', `Error creating beneficiary: ${createData.message}`);
          return;
        }
        beneficiaryVA = createData.valueAdd;
      } else {
        // update
        const updateRes = await fetch(`/api/value-add/${beneficiaryVA._id}/beneficiary`, { method: 'PUT' });
        const updateData = await updateRes.json();
        if (!updateRes.ok) {
          showAlert('danger', `Error updating beneficiary: ${updateData.message}`);
          return;
        }
        beneficiaryVA = updateData.valueAdd;
      }
      if (beneficiaryVA && iframe) {
        iframe.src = `/api/value-add/${beneficiaryVA._id}/view`;
      }
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error generating beneficiary.');
    }
  }

  async function handleDownload() {
    try {
      if (!beneficiaryValueAddId) {
        showAlert('danger', 'No beneficiary ValueAdd found to download.');
        return;
      }
      const snapshotId = (snapshotSelect) ? snapshotSelect.value : 'live';
      if (snapshotId === 'live') {
        // old route
        window.location.href = `/api/value-add/${beneficiaryValueAddId}/download`;
      } else {
        // new snapshot route
        window.location.href = `/api/value-add/${beneficiaryValueAddId}/download/${snapshotId}`;
      }
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error downloading beneficiary.');
    }
  }
  
  async function handleEmail() {
    try {
      if (!beneficiaryValueAddId) {
        showAlert('danger', 'No beneficiary ValueAdd found to email.');
        return;
      }
      const recipientEmail = prompt("Please enter recipient's email address:");
      if (!recipientEmail) return;
  
      const snapshotId = (snapshotSelect) ? snapshotSelect.value : 'live';
      const route = (snapshotId === 'live')
        ? `/api/value-add/${beneficiaryValueAddId}/email`
        : `/api/value-add/${beneficiaryValueAddId}/email-snapshot/${snapshotId}`;
  
      const emailRes = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: recipientEmail })
      });
      if (!emailRes.ok) {
        const errData = await emailRes.json();
        showAlert('danger', `Error emailing beneficiary: ${errData.message || 'Unknown'}`);
        return;
      }
      showAlert('success', 'beneficiary emailed successfully!');
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error emailing beneficiary.');
    }
  }
  

  // NEW: Load snapshots from /api/value-add/:id/snapshots
  async function loadSnapshots() {
    if (!beneficiaryValueAddId || !snapshotSelect) return;
    try {
      const res = await fetch(`/api/value-add/${beneficiaryValueAddId}/snapshots`);
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
        opt.value = s._id; // The snapshot ID
        const dateObj = new Date(s.timestamp);
        opt.textContent = `${dateObj.toLocaleString()}`;
        snapshotSelect.appendChild(opt);
      });
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error loading snapshots.');
    }
  }

  // NEW: Handle snapshot selection from the dropdown
  function handleSnapshotSelect() {
    if (!snapshotSelect || !beneficiaryValueAddId || !iframe) return;
    const val = snapshotSelect.value;
    if (val === 'live') {
      // Show the live version
      iframe.src = `/api/value-add/${beneficiaryValueAddId}/view`;
    } else {
      // Show the saved snapshot
      iframe.src = `/api/value-add/${beneficiaryValueAddId}/view/${val}`;
    }
  }

  // NEW: Handle "Save" action => /api/value-add/:id/save-snapshot
  async function handleSave() {
    try {
      if (!beneficiaryValueAddId) {
        showAlert('danger', 'No beneficiary ValueAdd found.');
        return;
      }
      const res = await fetch(`/api/value-add/${beneficiaryValueAddId}/save-snapshot`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) {
        showAlert('danger', `Error saving snapshot: ${data.message || 'Unknown'}`);
        return;
      }
      showAlert('success', 'Snapshot saved!');
      // Reload snapshots
      await loadSnapshots();
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error saving snapshot.');
    }
  }

  // 5) Attach event handlers
  if (generateBtn) generateBtn.addEventListener('click', handleGenerate);
  if (saveBtn) saveBtn.addEventListener('click', handleSave);
  if (downloadBtn) downloadBtn.addEventListener('click', handleDownload);
  if (emailBtn) emailBtn.addEventListener('click', handleEmail);
  if (snapshotSelect) snapshotSelect.addEventListener('change', handleSnapshotSelect);

  // 6) Initialize
  initBeneficiary().then(() => {
    const urlSnap = new URLSearchParams(location.search).get('snapshot');
    if (urlSnap && snapshotSelect) {
      snapshotSelect.value = urlSnap;
      snapshotSelect.dispatchEvent(new Event('change'));
    }
  });
});
