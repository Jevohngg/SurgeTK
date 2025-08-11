/* --------------------------------------------------------------------------
 * public/js/householdHomework.js            created 2025‑08‑09
 * Mirrors householdBeneficiary.js behavior for the HOMEWORK value add.
 * - Supports deep-linking via ?va=<id>&snapshot=<snapshotId>
 * - Handles live/snapshot switching, save/download/email actions
 * - Skips the first auto-generate when a snapshot is preselected
 * -------------------------------------------------------------------------- */

console.log('homework script running');

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
  const generateBtn    = document.getElementById('generateHomeworkBtn');
  const saveBtn        = document.getElementById('saveHomeworkBtn');
  const downloadBtn    = document.getElementById('downloadHomeworkBtn');
  const emailBtn       = document.getElementById('emailHomeworkBtn');
  const iframe         = document.getElementById('homeworkIframe');
  const stickyNoteEl   = document.getElementById('stickyNote');
  const snapshotSelect = document.getElementById('homeworkSnapshotSelect');
  const householdId    = window.householdId || null;

  /* URL params ----------------------------------------------------------- */
  const urlParams     = new URLSearchParams(location.search);
  const preselectedVA = urlParams.get('va')       || null;
  const urlSnap       = urlParams.get('snapshot') || null;

  /* state ---------------------------------------------------------------- */
  let homeworkValueAddId = null;
  let currentSnapshot    = 'live';
  let skipFirstGenerate  = Boolean(urlSnap);   // skip first auto-generate if landing on a snapshot

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
    if (!homeworkValueAddId || !snapshotSelect) return;

    try {
      const res = await fetch(`/api/value-add/${homeworkValueAddId}/snapshots`);
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
    if (!snapshotSelect || !homeworkValueAddId || !iframe || !stickyNoteEl) return;

    currentSnapshot = snapshotSelect.value;

    if (currentSnapshot === 'live') {
      iframe.src          = `/api/value-add/${homeworkValueAddId}/view`;
      stickyNoteEl.value  = '';
      stickyNoteEl.disabled = false;
      adjustTextareaHeight(stickyNoteEl);
      return;
    }

    iframe.src = `/api/value-add/${homeworkValueAddId}/view/${currentSnapshot}`;

    try {
      const res  = await fetch(`/api/value-add/${homeworkValueAddId}/snapshot/${currentSnapshot}/notes`);
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
  async function initHomework() {
    try {
      let list;
      if (preselectedVA) {
        const single = await fetch(`/api/value-add/${preselectedVA}`).then(r => r.json());
        list = [single];
      } else {
        list = await fetch(`/api/value-add/household/${householdId}`).then(r => r.json());
      }
      if (!Array.isArray(list)) throw new Error('Unexpected response');

      let va = list.find(v => v.type === 'HOMEWORK');
      if (!va) {
        const created = await fetch(
          `/api/value-add/household/${householdId}/homework`,
          {method:'POST'}
        ).then(r => r.json());
        va = created.valueAdd;
      }

      homeworkValueAddId = preselectedVA || va._id;
      iframe.src = `/api/value-add/${homeworkValueAddId}/view`;

      await loadSnapshots();

      if (urlSnap && snapshotSelect) {
        const exists = Array.from(snapshotSelect.options).some(o => o.value === urlSnap);
        snapshotSelect.value = exists ? urlSnap : 'live';
        await handleSnapshotSelect();
      }

    } catch (err) {
      console.error(err);
      showAlert('danger','Error initializing homework.');
    }
  }

  /* ---------- Generate / refresh --------------------------------------- */
  async function handleGenerate() {
    /* Skip the very first auto‑generate if we arrived with ?snapshot=… */
    if (skipFirstGenerate) { skipFirstGenerate = false; return; }

    try {
      const list = await fetch(`/api/value-add/household/${householdId}`).then(r => r.json());
      let va     = list.find(v => v.type === 'HOMEWORK');

      if (!va || !va._id) {
        console.error('No valueAdd returned from API:', { list, va });
        showAlert('danger', 'Could not generate homework – no valueAdd returned.');
        return;
      }
      

      if (!va) {
        const created = await fetch(
          `/api/value-add/household/${householdId}/homework`,
          {method:'POST'}
        ).then(r => r.json());
        va = created.valueAdd;
      } else {
        const updated = await fetch(
          `/api/value-add/${va._id}/homework`,
          {method:'PUT'}
        ).then(r => r.json());
        va = updated.valueAdd;
      }

      homeworkValueAddId = va._id;
      iframe.src = `/api/value-add/${va._id}/view`;
      await loadSnapshots();

      if (stickyNoteEl) {
        stickyNoteEl.value = '';
        stickyNoteEl.disabled = false;
        adjustTextareaHeight(stickyNoteEl);
      }
      if (snapshotSelect) snapshotSelect.value = 'live';
      currentSnapshot = 'live';

    } catch (err) {
      console.error(err);
      showAlert('danger','Error generating homework.');
    }
  }

  /* ---------- Download / e‑mail ---------------------------------------- */
  async function handleDownload() {
    if (!homeworkValueAddId) { showAlert('danger','No ValueAdd found.'); return; }
    const sid = snapshotSelect ? snapshotSelect.value : 'live';
    window.location.href = (sid === 'live')
      ? `/api/value-add/${homeworkValueAddId}/download`
      : `/api/value-add/${homeworkValueAddId}/download/${sid}`;
  }

  async function handleEmail() {
    if (!homeworkValueAddId) { showAlert('danger','No ValueAdd found.'); return; }
    const recipient = prompt("Please enter recipient's email address:");
    if (!recipient) return;
    const sid   = snapshotSelect ? snapshotSelect.value : 'live';
    const route = (sid === 'live')
      ? `/api/value-add/${homeworkValueAddId}/email`
      : `/api/value-add/${homeworkValueAddId}/email-snapshot/${sid}`;

    try {
      const res = await fetch(route, {
        method :'POST',
        headers:{'Content-Type':'application/json'},
        body   : JSON.stringify({recipient})
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      showAlert('success','Homework emailed successfully!');
    } catch (err) {
      console.error(err);
      showAlert('danger',`Error emailing homework: ${err.message}`);
    }
  }

  /* ---------- Save snapshot ------------------------------------------- */
  async function handleSave() {
    if (!homeworkValueAddId) { showAlert('danger','No ValueAdd found.'); return; }
    try {
      const res = await fetch(`/api/value-add/${homeworkValueAddId}/save-snapshot`, {
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
  initHomework();         // no need to await

});
