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
  const saveBtn = document.getElementById('saveBucketsBtn'); // "Save" button
  const downloadBtn = document.getElementById('downloadBucketsBtn');
  const emailBtn = document.getElementById('emailBucketsBtn');
  const iframe = document.getElementById('bucketsIframe');
  const householdId = window.householdId || null;

  // NEW: Dropdown for snapshots (if the Pug template includes it)
  const snapshotSelect = document.getElementById('bucketsSnapshotSelect');

  let bucketsValueAddId = null;

  // 1) Initialize Buckets on page load
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
        // create if not found
        const createRes = await fetch(`/api/value-add/household/${householdId}/buckets`, { method: 'POST' });
        const createData = await createRes.json();
        if (!createRes.ok) {
          showAlert('danger', `Error creating Buckets: ${createData.message}.`);
          return;
        }
        bucketsVA = createData.valueAdd;
      }

      // Store the ValueAdd ID so we can reference it for snapshot operations
      if (bucketsVA) {
        bucketsValueAddId = bucketsVA._id;
        // Load the "live" version in the iframe
        iframe.src = `/api/value-add/${bucketsVA._id}/view`;
      }

      // After the ValueAdd is created/found, load any saved snapshots
      await loadSnapshots();
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

  async function handleDownload() {
    try {
      if (!bucketsValueAddId) {
        showAlert('danger', 'No Buckets ValueAdd found to download.');
        return;
      }
      const snapshotId = (snapshotSelect) ? snapshotSelect.value : 'live';
      if (snapshotId === 'live') {
        // old route
        window.location.href = `/api/value-add/${bucketsValueAddId}/download`;
      } else {
        // new snapshot route
        window.location.href = `/api/value-add/${bucketsValueAddId}/download/${snapshotId}`;
      }
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error downloading Buckets.');
    }
  }
  
  async function handleEmail() {
    try {
      if (!bucketsValueAddId) {
        showAlert('danger', 'No Buckets ValueAdd found to email.');
        return;
      }
      const recipientEmail = prompt("Please enter recipient's email address:");
      if (!recipientEmail) return;
  
      const snapshotId = (snapshotSelect) ? snapshotSelect.value : 'live';
      const route = (snapshotId === 'live')
        ? `/api/value-add/${bucketsValueAddId}/email`
        : `/api/value-add/${bucketsValueAddId}/email-snapshot/${snapshotId}`;
  
      const emailRes = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: recipientEmail })
      });
      if (!emailRes.ok) {
        const errData = await emailRes.json();
        showAlert('danger', `Error emailing Buckets: ${errData.message || 'Unknown'}`);
        return;
      }
      showAlert('success', 'Buckets emailed successfully!');
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error emailing Buckets.');
    }
  }
  

  // NEW: Load snapshots from /api/value-add/:id/snapshots
  async function loadSnapshots() {
    if (!bucketsValueAddId || !snapshotSelect) return;
    try {
      const res = await fetch(`/api/value-add/${bucketsValueAddId}/snapshots`);
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
    if (!snapshotSelect || !bucketsValueAddId || !iframe) return;
    const val = snapshotSelect.value;
    if (val === 'live') {
      // Show the live version
      iframe.src = `/api/value-add/${bucketsValueAddId}/view`;
    } else {
      // Show the saved snapshot
      iframe.src = `/api/value-add/${bucketsValueAddId}/view/${val}`;
    }
  }

  // NEW: Handle "Save" action => /api/value-add/:id/save-snapshot
  async function handleSave() {
    try {
      if (!bucketsValueAddId) {
        showAlert('danger', 'No Buckets ValueAdd found.');
        return;
      }
      const res = await fetch(`/api/value-add/${bucketsValueAddId}/save-snapshot`, {
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
  initBuckets();
});
