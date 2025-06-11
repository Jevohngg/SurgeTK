console.log('netWorth script running')

// public/js/householdnetWorth.js
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
  const generateBtn = document.getElementById('generateNetWorthBtn');
  const saveBtn = document.getElementById('saveNetWorthBtn'); // "Save" button
  const downloadBtn = document.getElementById('downloadNetWorthBtn');
  const emailBtn = document.getElementById('emailNetWorthBtn');
  const iframe = document.getElementById('netWorthIframe');
  const householdId = window.householdId || null;
  // Sticky‑note helpers
  const stickyNoteEl   = document.getElementById('stickyNote');
  let   currentSnapshot = 'live';

 function adjustTextareaHeight(t) {
   t.style.height = 'auto';
   t.style.height = `${t.scrollHeight}px`;
 }

 if (stickyNoteEl) {
   stickyNoteEl.addEventListener('input', () => adjustTextareaHeight(stickyNoteEl));
   window.addEventListener('load', () => adjustTextareaHeight(stickyNoteEl));
 }

  // NEW: Dropdown for snapshots (if the Pug template includes it)
  const snapshotSelect = document.getElementById('netWorthSnapshotSelect');

  let netWorthValueAddId = null;

  // 1) Initialize netWorth on page load
  async function initNetWorth() {
    try {
      const resAll = await fetch(`/api/value-add/household/${householdId}`);
      const list = await resAll.json();
      if (!Array.isArray(list)) {
        showAlert('danger', 'Unexpected response fetching ValueAdds.');
        return;
      }

      let netWorthVA = list.find(va => va.type === 'NET_WORTH');
      if (!netWorthVA) {
        // create if not found
        const createRes = await fetch(`/api/value-add/household/${householdId}/networth`, { method: 'POST' });
        const createData = await createRes.json();
        if (!createRes.ok) {
          showAlert('danger', `Error creating netWorth: ${createData.message}.`);
          return;
        }
        netWorthVA = createData.valueAdd;
      }

      // Store the ValueAdd ID so we can reference it for snapshot operations
      if (netWorthVA) {
        netWorthValueAddId = netWorthVA._id;
        // Load the "live" version in the iframe
        iframe.src = `/api/value-add/${netWorthVA._id}/view`;
      }

      // After the ValueAdd is created/found, load any saved snapshots
      await loadSnapshots();
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error initializing netWorth.');
    }
  }

  // 2) Generate/Refresh
  async function handleGenerate() {
    try {
      const resAll = await fetch(`/api/value-add/household/${householdId}`);
      const list = await resAll.json();

      let netWorthVA = list.find(va => va.type === 'NET_WORTH');
      if (!netWorthVA) {
        // create
        const createRes = await fetch(`/api/value-add/household/${householdId}/networth`, { method: 'POST' });
        const createData = await createRes.json();
        if (!createRes.ok) {
          showAlert('danger', `Error creating netWorth: ${createData.message}`);
          return;
        }
        netWorthVA = createData.valueAdd;
      } else {
        // update
        const updateRes = await fetch(`/api/value-add/${netWorthVA._id}/networth`, { method: 'PUT' });
        const updateData = await updateRes.json();
        if (!updateRes.ok) {
          showAlert('danger', `Error updating netWorth: ${updateData.message}`);
          return;
        }
        netWorthVA = updateData.valueAdd;
      }
      if (netWorthVA && iframe) {
        iframe.src = `/api/value-add/${netWorthVA._id}/view`;
      }
        // Clear & enable note for live view
  if (stickyNoteEl) {
    stickyNoteEl.value    = '';
    stickyNoteEl.disabled = false;
    adjustTextareaHeight(stickyNoteEl);
  }
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error generating netWorth.');
    }
  }

  async function handleDownload() {
    try {
      if (!netWorthValueAddId) {
        showAlert('danger', 'No netWorth ValueAdd found to download.');
        return;
      }
      const snapshotId = (snapshotSelect) ? snapshotSelect.value : 'live';
      if (snapshotId === 'live') {
        // old route
        window.location.href = `/api/value-add/${netWorthValueAddId}/download`;
      } else {
        // new snapshot route
        window.location.href = `/api/value-add/${netWorthValueAddId}/download/${snapshotId}`;
      }
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error downloading netWorth.');
    }
  }
  
  async function handleEmail() {
    try {
      if (!netWorthValueAddId) {
        showAlert('danger', 'No netWorth ValueAdd found to email.');
        return;
      }
      const recipientEmail = prompt("Please enter recipient's email address:");
      if (!recipientEmail) return;
  
      const snapshotId = (snapshotSelect) ? snapshotSelect.value : 'live';
      const route = (snapshotId === 'live')
        ? `/api/value-add/${netWorthValueAddId}/email`
        : `/api/value-add/${netWorthValueAddId}/email-snapshot/${snapshotId}`;
  
      const emailRes = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: recipientEmail })
      });
      if (!emailRes.ok) {
        const errData = await emailRes.json();
        showAlert('danger', `Error emailing netWorth: ${errData.message || 'Unknown'}`);
        return;
      }
      showAlert('success', 'netWorth emailed successfully!');
    } catch (err) {
      console.error(err);
      showAlert('danger', 'Error emailing netWorth.');
    }
  }
  

  // NEW: Load snapshots from /api/value-add/:id/snapshots
  async function loadSnapshots() {
    if (!netWorthValueAddId || !snapshotSelect) return;
    try {
      const res = await fetch(`/api/value-add/${netWorthValueAddId}/snapshots`);
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
    async function handleSnapshotSelect() {
        if (!snapshotSelect || !netWorthValueAddId || !iframe || !stickyNoteEl) return;
        currentSnapshot = snapshotSelect.value;
    
        if (currentSnapshot === 'live') {
          iframe.src = `/api/value-add/${netWorthValueAddId}/view`;
          stickyNoteEl.value    = '';
          stickyNoteEl.disabled = false;
          adjustTextareaHeight(stickyNoteEl);
          return;
        }
    
        iframe.src = `/api/value-add/${netWorthValueAddId}/view/${currentSnapshot}`;
        try {
          const res  = await fetch(
            `/api/value-add/${netWorthValueAddId}/snapshot/${currentSnapshot}/notes`
          );
          const data = await res.json();
          stickyNoteEl.value    = data.notes || '';
          stickyNoteEl.disabled = true;
        } catch (e) {
          console.error('Failed to load snapshot notes', e);
          stickyNoteEl.value    = '(failed to load notes)';
          stickyNoteEl.disabled = true;
        }
        adjustTextareaHeight(stickyNoteEl);
      }

  // NEW: Handle "Save" action => /api/value-add/:id/save-snapshot
  async function handleSave() {
    try {
      if (!netWorthValueAddId) {
        showAlert('danger', 'No netWorth ValueAdd found.');
        return;
      }
            const res = await fetch(
              `/api/value-add/${netWorthValueAddId}/save-snapshot`,
              {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ notes: stickyNoteEl?.value || '' })
              }
            );
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
  initNetWorth().then(() => {
    const urlSnap = new URLSearchParams(location.search).get('snapshot');
    if (urlSnap && snapshotSelect) {
      snapshotSelect.value = urlSnap;
      snapshotSelect.dispatchEvent(new Event('change'));
    }
  });
  if (stickyNoteEl) adjustTextareaHeight(stickyNoteEl);

});
