/* --------------------------------------------------------------------------
 * public/js/householdBeneficiary.js               updated 2025‑06‑11 (b )
 * Fixes intermittent “notes don’t load” bug when landing via Saved‑Snapshots
 * table by (1) selecting the snapshot after the dropdown is populated and
 * (2) ignoring the first auto‑refresh if a snapshot was specified in the URL.
 * -------------------------------------------------------------------------- */

console.log('beneficiary script running');

"use strict";

/*────────────────────────  Alert helper  ────────────────────────*/
function showAlert(type, message) {
  const alertContainer = document.getElementById('alert-container');
  if (!alertContainer) return;

  const alert = document.createElement('div');
  alert.id    = (type === 'success') ? 'passwordChangeSuccess' : 'errorAlert';
  alert.className = `alert ${type === 'success' ? 'alert-success' : 'alert-error'}`;
  alert.setAttribute('role', 'alert');

  const iconWrap = document.createElement('div');
  iconWrap.className = type === 'success' ? 'success-icon-container'
                                          : 'error-icon-container';
  const icon = document.createElement('i');
  icon.className    = type === 'success' ? 'far fa-check-circle'
                                         : 'far fa-times-circle';
  iconWrap.appendChild(icon);

  const closeWrap = document.createElement('div');
  closeWrap.className = type === 'success' ? 'success-close-container'
                                           : 'error-close-container';
  const closeIcon = document.createElement('span');
  closeIcon.className = 'material-symbols-outlined successCloseIcon';
  closeIcon.innerText = 'close';
  closeWrap.appendChild(closeIcon);

  const textWrap = document.createElement('div');
  textWrap.className = 'success-text';
  const h3 = document.createElement('h3');
  h3.innerText = type === 'success' ? 'Success!' : 'Error!';
  const p = document.createElement('p');
  p.innerText = message;
  textWrap.append(h3, p);

  alert.append(iconWrap, closeWrap, textWrap);
  alertContainer.prepend(alert);

  void alert.offsetWidth;               // trigger re‑flow
  alert.classList.add('show');

  const closeAlert = () => {
    alert.classList.add('exit');
    setTimeout(() => alert.remove(), 500);
  };
  setTimeout(closeAlert, 5000);
  closeIcon.addEventListener('click', closeAlert);
}

/*────────────────────────  Main module  ────────────────────────*/
document.addEventListener('DOMContentLoaded', () => {

  /* refs ----------------------------------------------------------------- */
  const generateBtn    = document.getElementById('generateBeneficiaryBtn');
  const saveBtn        = document.getElementById('saveBeneficiaryBtn');
  const downloadBtn    = document.getElementById('downloadBeneficiaryBtn');
  const emailBtn       = document.getElementById('emailBeneficiaryBtn');
  const iframe         = document.getElementById('beneficiaryIframe');
  const stickyNoteEl   = document.getElementById('stickyNote');
  const snapshotSelect = document.getElementById('beneficiarySnapshotSelect');
  const householdId    = window.householdId || null;

  /* URL params ----------------------------------------------------------- */
  const urlParams     = new URLSearchParams(location.search);
  const preselectedVA = urlParams.get('va')       || null;
  const urlSnap       = urlParams.get('snapshot') || null;

  /* state ---------------------------------------------------------------- */
  let beneficiaryValueAddId = null;
  let currentSnapshot       = 'live';
  let skipFirstGenerate     = Boolean(urlSnap);   // ← NEW flag

  /* util ----------------------------------------------------------------- */
  const adjustTextareaHeight = t => {
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight}px`;
  };
  if (stickyNoteEl) {
    stickyNoteEl.addEventListener('input', () => adjustTextareaHeight(stickyNoteEl));
    window.addEventListener('load',        () => adjustTextareaHeight(stickyNoteEl));
  }

  /* ---------- Snapshot helpers ----------------------------------------- */
  async function loadSnapshots() {
    if (!beneficiaryValueAddId || !snapshotSelect) return;

    try {
      const res = await fetch(`/api/value-add/${beneficiaryValueAddId}/snapshots`);
      if (!res.ok) { showAlert('danger','Failed to load snapshots.'); return; }

      const snaps = await res.json();

      while (snapshotSelect.options.length > 1) snapshotSelect.remove(1);

      snaps.forEach(s => {
        const o = document.createElement('option');
        o.value = s._id;
        o.textContent = new Date(s.timestamp).toLocaleString();
        snapshotSelect.appendChild(o);
      });
    } catch (err) {
      console.error(err);
      showAlert('danger','Error loading snapshots.');
    }
  }

  async function handleSnapshotSelect() {
    if (!snapshotSelect || !beneficiaryValueAddId || !iframe || !stickyNoteEl) return;

    currentSnapshot = snapshotSelect.value;

    if (currentSnapshot === 'live') {
      iframe.src       = `/api/value-add/${beneficiaryValueAddId}/view`;
      stickyNoteEl.value    = '';
      stickyNoteEl.disabled = false;
      adjustTextareaHeight(stickyNoteEl);
      return;
    }

    iframe.src = `/api/value-add/${beneficiaryValueAddId}/view/${currentSnapshot}`;

    try {
      const res  = await fetch(`/api/value-add/${beneficiaryValueAddId}/snapshot/${currentSnapshot}/notes`);
      const data = await res.json();
      stickyNoteEl.value = data.notes || '';
    } catch (e) {
      console.error('Failed to load snapshot notes', e);
      stickyNoteEl.value = '(failed to load notes)';
    }
    stickyNoteEl.disabled = true;
    adjustTextareaHeight(stickyNoteEl);
  }

  /* ---------- Initialisation ------------------------------------------- */
  async function initBeneficiary() {
    try {
      let list;
      if (preselectedVA) {
        const single = await fetch(`/api/value-add/${preselectedVA}`).then(r => r.json());
        list = [single];
      } else {
        list = await fetch(`/api/value-add/household/${householdId}`).then(r => r.json());
      }
      if (!Array.isArray(list)) throw new Error('Unexpected response');

      let va = list.find(v => v.type === 'BENEFICIARY');
      if (!va) {
        const created = await fetch(
          `/api/value-add/household/${householdId}/beneficiary`,
          {method:'POST'}
        ).then(r => r.json());
        va = created.valueAdd;
      }

      beneficiaryValueAddId = preselectedVA || va._id;
      iframe.src = `/api/value-add/${beneficiaryValueAddId}/view`;

      await loadSnapshots();

      if (urlSnap && snapshotSelect) {
        const exists = Array.from(snapshotSelect.options).some(o => o.value === urlSnap);
        snapshotSelect.value = exists ? urlSnap : 'live';
        await handleSnapshotSelect();
      }

    } catch (err) {
      console.error(err);
      showAlert('danger','Error initializing beneficiary.');
    }
  }

  /* ---------- Generate / refresh --------------------------------------- */
  async function handleGenerate() {
    /* Skip the very first auto‑generate if we arrived with ?snapshot=… */
    if (skipFirstGenerate) { skipFirstGenerate = false; return; }

    try {
      const list = await fetch(`/api/value-add/household/${householdId}`).then(r => r.json());
      let va     = list.find(v => v.type === 'BENEFICIARY');

      if (!va) {
        const created = await fetch(
          `/api/value-add/household/${householdId}/beneficiary`,
          {method:'POST'}
        ).then(r => r.json());
        va = created.valueAdd;
      } else {
        const updated = await fetch(
          `/api/value-add/${va._id}/beneficiary`,
          {method:'PUT'}
        ).then(r => r.json());
        va = updated.valueAdd;
      }

      beneficiaryValueAddId = va._id;
      iframe.src = `/api/value-add/${va._id}/view`;
      await loadSnapshots();

      stickyNoteEl && (stickyNoteEl.value = '', stickyNoteEl.disabled = false, adjustTextareaHeight(stickyNoteEl));
      snapshotSelect && (snapshotSelect.value = 'live');
      currentSnapshot = 'live';

    } catch (err) {
      console.error(err);
      showAlert('danger','Error generating beneficiary.');
    }
  }

  /* ---------- Download / e‑mail ---------------------------------------- */
  async function handleDownload() {
    if (!beneficiaryValueAddId) { showAlert('danger','No ValueAdd found.'); return; }
    const sid = snapshotSelect ? snapshotSelect.value : 'live';
    window.location.href = (sid === 'live')
      ? `/api/value-add/${beneficiaryValueAddId}/download`
      : `/api/value-add/${beneficiaryValueAddId}/download/${sid}`;
  }

  async function handleEmail() {
    if (!beneficiaryValueAddId) { showAlert('danger','No ValueAdd found.'); return; }
    const recipient = prompt("Please enter recipient's email address:");
    if (!recipient) return;
    const sid   = snapshotSelect ? snapshotSelect.value : 'live';
    const route = (sid === 'live')
      ? `/api/value-add/${beneficiaryValueAddId}/email`
      : `/api/value-add/${beneficiaryValueAddId}/email-snapshot/${sid}`;

    try {
      const res = await fetch(route, {
        method :'POST',
        headers:{'Content-Type':'application/json'},
        body   : JSON.stringify({recipient})
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      showAlert('success','Beneficiary emailed successfully!');
    } catch (err) {
      console.error(err);
      showAlert('danger',`Error emailing beneficiary: ${err.message}`);
    }
  }

  /* ---------- Save snapshot ------------------------------------------- */
  async function handleSave() {
    if (!beneficiaryValueAddId) { showAlert('danger','No ValueAdd found.'); return; }
    try {
      const res = await fetch(`/api/value-add/${beneficiaryValueAddId}/save-snapshot`, {
        method :'POST',
        headers:{'Content-Type':'application/json'},
        body   : JSON.stringify({notes: stickyNoteEl?.value || ''})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Unknown');
      showAlert('success','Snapshot saved!');
      await loadSnapshots();
    } catch (err) {
      console.error(err);
      showAlert('danger',`Error saving snapshot: ${err.message}`);
    }
  }

  /* ---------- Event wiring -------------------------------------------- */
  generateBtn     && generateBtn.addEventListener('click', handleGenerate);
  saveBtn         && saveBtn.addEventListener('click', handleSave);
  downloadBtn     && downloadBtn.addEventListener('click', handleDownload);
  emailBtn        && emailBtn.addEventListener('click', handleEmail);
  snapshotSelect  && snapshotSelect.addEventListener('change', handleSnapshotSelect);

  /* ---------- Kick‑off -------------------------------------------------- */
  initBeneficiary();         // no need to await

});
