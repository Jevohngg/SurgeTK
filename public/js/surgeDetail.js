/************************************************************
 *  public/js/surgeDetail.js
 *  – Surge Composer front‑end logic (COMPLETE FILE)
 ************************************************************/
document.addEventListener('DOMContentLoaded', () => {

    const editBtn    = document.getElementById('editSurgeBtn');
    const editModal  = new bootstrap.Modal(document.getElementById('editSurgeModal'));
    const editForm   = document.getElementById('editSurgeForm');
    const nameInput  = document.getElementById('editSurgeName');
    const startInput = document.getElementById('editStartDate');
    const endInput   = document.getElementById('editEndDate');
  
    // 1) When cog is clicked, populate and show modal
    editBtn.addEventListener('click', () => {
      nameInput.value  = surge.name || '';
      // format ISO for <input type="date">
      startInput.value = surge.startDate ? surge.startDate.slice(0,10) : '';
      endInput.value   = surge.endDate   ? surge.endDate.slice(0,10)   : '';
      editModal.show();
    });
  
    // 2) Handle form submission
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const updated = {
        name:      nameInput.value.trim(),
        startDate: startInput.value,
        endDate:   endInput.value
      };
      try {
        const res = await fetch(`/api/surge/${surge._id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(updated)
        });
        if (!res.ok) throw new Error('Failed to update Surge');
        const { surge: fresh } = await res.json();
        // 3) Update UI in-place
        document.querySelector('h2.householdDetailHeader').firstChild.textContent = fresh.name;
        window.surge = fresh;
        // rebuild dateRange display
        const ms = document.querySelector('.date-range-container');
        if (ms) {
          const opts = { month:'short', day:'numeric', year:'numeric' };
          ms.innerHTML = `<i class="fas fa-calendar-alt me-1"></i>`
                       + `${new Date(fresh.startDate).toLocaleDateString('en-US',opts)}`
                       + ' – '
                       + `${new Date(fresh.endDate  ).toLocaleDateString('en-US',opts)}`;
        }
        editModal.hide();
        showAlert('success','Surge details updated');
        setTimeout(() => {
            window.location.reload();
          }, 2000);
      } catch(err) {
        console.error(err);
        showAlert('danger','Unable to save changes');
      }
    });

    /* ──────────────────────────────────────────────────────────
     *  A.  Toast‑style Alert Helper
     * ────────────────────────────────────────────────────────── */
    function showAlert (type, message, options = {}) {
      const alertContainer = document.getElementById('alert-container');
      if (!alertContainer) return;                     // safety
  
      const alert = document.createElement('div');
      alert.id        = type === 'success' ? 'passwordChangeSuccess' : 'errorAlert';
      alert.className = `alert ${type === 'success' ? 'alert-success' : 'alert-error'}`;
      alert.setAttribute('role', 'alert');
  
      /* icon */
      const iconBox = document.createElement('div');
      iconBox.className = type === 'success' ? 'success-icon-container'
                                             : 'error-icon-container';
      const icon = document.createElement('i');
      icon.className = type === 'success' ? 'far fa-check-circle'
                                          : 'far fa-times-circle';
      iconBox.appendChild(icon);
  
      /* close */
      const closeBox = document.createElement('div');
      closeBox.className = type === 'success' ? 'success-close-container'
                                              : 'error-close-container';
      const closeIc = document.createElement('span');
      closeIc.className = 'material-symbols-outlined successCloseIcon';
      closeIc.textContent = 'close';
      closeBox.appendChild(closeIc);
  
      /* text */
      const textBox = document.createElement('div');
      textBox.className = 'success-text';
      const title = document.createElement('h3');
      title.textContent = type === 'success' ? 'Success!' : 'Error!';
      const body = document.createElement('p');
      body.textContent = message;
      textBox.append(title, body);
  
      /* optional UNDO */
      if (options.undo) {
        const undoBtn = document.createElement('button');
        undoBtn.className = 'alert-undo-button';
        undoBtn.textContent = 'Undo';
        undoBtn.onclick = () => { options.undoCallback(); closeAlert(alert); };
        textBox.appendChild(undoBtn);
      }
  
      /* helper to fade‑out & remove */
      function closeAlert (el) {
        el.classList.add('exit');
        setTimeout(() => el.remove(), 500);
      }
  
      /* assemble & show */
      alert.append(iconBox, closeBox, textBox);
      alertContainer.prepend(alert);
      void alert.offsetWidth;        // re‑flow for transition
      alert.classList.add('show');
  
      /* events */
      closeIc.onclick = () => closeAlert(alert);
      setTimeout(() => closeAlert(alert), 5000);
    }
  
    /* ──────────────────────────────────────────────────────────
     * 0.  Hydrate & normalise the incoming surge object
     * ────────────────────────────────────────────────────────── */
    let raw = window.surge || {};
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch { raw = {}; }
    }
  
    raw.valueAdds = Array.isArray(raw.valueAdds) ? raw.valueAdds : [];
    raw.uploads   = Array.isArray(raw.uploads)   ? raw.uploads   : [];
    raw.order     = Array.isArray(raw.order)     ? raw.order     : [];
  
    const surge        = raw;                              // safe reference
    const cardDeck     = document.getElementById('vaCardDeck');
    const tbody        = document.querySelector('#wHouseholdTable tbody');
    const uploadBtn    = document.getElementById('addUploadBtn');
    const hiddenFile   = document.getElementById('hiddenUploadInput');
  
    /* ---------------------------------------------------------
     *  Globals (cached later)
     * -------------------------------------------------------- */
    let firmEnabledVAs = null;                             // [ 'BUCKETS', … ]
  
    /* ---------------------------------------------------------
     * 1.  Static lookup for Value‑Add icons / labels
     * -------------------------------------------------------- */
    const VA_CONFIG = {
      BUCKETS:     { icon: 'analytics',       label: 'Buckets'      },
      GUARDRAILS:  { icon: 'add_road',        label: 'Guardrails'   },
      BENEFICIARY: { icon: 'diversity_1',     label: 'Beneficiary'  },
      NET_WORTH:   { icon: 'account_balance', label: 'Net Worth'    }
    };
  
    /* ---------------------------------------------------------
     * 2.  Helper – fetch once which VAs the firm has enabled
     * -------------------------------------------------------- */
    async function fetchFirmVAs () {
      if (firmEnabledVAs) return firmEnabledVAs;
      const res = await fetch('/api/firm/value-adds');
      if (!res.ok) { showAlert('danger', 'Unable to load firm settings'); return []; }
      firmEnabledVAs = await res.json();                   // e.g. [ 'BUCKETS', … ]
      return firmEnabledVAs;
    }
  
    /* ---------------------------------------------------------
     * 3.  DOM factory for a card (VA or Upload)
     * -------------------------------------------------------- */
    function makeCard ({ label, icon, id, isUpload }) {
      const div = document.createElement('div');
      div.className  = 'va-card';
      div.dataset.id = id;
  
      const iconHtml = `<span class="material-symbols-outlined value-add-icon">${icon}</span>`;
      const handle   = `<div class="handle">⋮⋮</div>`;
      const title    = `<span class="value-add-title summary-header">${label}</span>`;
      const trash    = isUpload
        ? `<span class="material-symbols-outlined delete-upload-btn" title="Delete">delete</span>`
        : '';
  
      div.innerHTML = `${handle}${iconHtml}${title}${trash}`;
      return div;
    }
  
    /* ---------------------------------------------------------
     * 4.  Render the card strip
     * -------------------------------------------------------- */
    async function renderCards () {
      const firmVAs = await fetchFirmVAs();
      cardDeck.innerHTML = '';
  
      const vaMap = new Map(surge.valueAdds.map(v => [v.type, v]));
      const upMap = new Map(surge.uploads  .map(u => [u._id,  u]));
      const seen  = new Set();
  
      /* 4‑A. Primary pass – honour surge.order exactly */
      surge.order.forEach(tok => {
        if (seen.has(tok)) return;
  
        /* Value‑Add */
        if (!/^[0-9a-fA-F]{24}$/.test(tok) && vaMap.has(tok)) {
          if (!firmVAs.includes(tok)) return;              // firm disabled
          const { icon, label } = VA_CONFIG[tok] || { icon: 'description', label: tok };
          cardDeck.appendChild(makeCard({ label, icon, id: tok, isUpload: false }));
          seen.add(tok);
          return;
        }
  
        /* Upload */
        if (upMap.has(tok)) {
          const u = upMap.get(tok);
          cardDeck.appendChild(makeCard({
            label: u.fileName,
            icon : 'picture_as_pdf',
            id   : u._id,
            isUpload: true
          }));
          seen.add(tok);
        }
      });
  
      /* 4‑B. Fallback pass – append any missing tokens */
      surge.valueAdds.forEach(v => {
        if (seen.has(v.type) || !firmVAs.includes(v.type)) return;
        const { icon, label } = VA_CONFIG[v.type] || { icon: 'description', label: v.type };
        cardDeck.appendChild(makeCard({ label, icon, id: v.type, isUpload: false }));
      });
  
      surge.uploads.forEach(u => {
        if (seen.has(u._id)) return;
        cardDeck.appendChild(makeCard({
          label: u.fileName,
          icon : 'picture_as_pdf',
          id   : u._id,
          isUpload: true
        }));
      });
    }
    renderCards();
  
    /* ---------------------------------------------------------
     * 5.  Sortable – persist order
     * -------------------------------------------------------- */
    Sortable.create(cardDeck, {
      animation: 150,
      handle   : '.handle',
      onEnd    : async () => {
        surge.order = [...cardDeck.children].map(c => c.dataset.id);
        await fetch(`/api/surge/${surge._id}/reorder`, {
          method : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({ order: surge.order })
        });
      }
    });
  
    /* ════════════════════════════════
     *  SECTION A –  CHOOSE VALUE‑ADDS
     * ════════════════════════════════ */
    const chooseBtn   = document.getElementById('chooseVABtn');
    const vaModal     = new bootstrap.Modal(document.getElementById('chooseVAModal'));
    const vaForm      = document.getElementById('vaCheckboxForm');
    const saveVaBtn   = document.getElementById('saveVaSelectionBtn');
  
    if (chooseBtn) {
      chooseBtn.addEventListener('click', async () => {
        const list = await fetchFirmVAs();
        vaForm.innerHTML = '';
        list.forEach(t => {
          const checked = surge.valueAdds.some(v => v.type === t) ? 'checked' : '';
          const label   = (VA_CONFIG[t] || { label: t }).label;
          vaForm.insertAdjacentHTML('beforeend',
            `<div class="form-check mb-2">
               <input class="form-check-input" type="checkbox" value="${t}" id="chk_${t}" ${checked}>
               <label class="form-check-label" for="chk_${t}">${label}</label>
             </div>`);
        });
        vaModal.show();
      });
  
      saveVaBtn.addEventListener('click', async () => {
        const selected = [...vaForm.querySelectorAll('input:checked')].map(chk => chk.value);
        if (!selected.length) { showAlert('danger', 'Select at least one Value‑Add'); return; }
  
        await fetch(`/api/surge/${surge._id}/value-adds`, {
          method : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({ valueAdds: selected })
        });
  
        surge.valueAdds = selected.map(t => ({ type: t }));
        surge.order     = [...selected, ...surge.uploads.map(u => u._id)];
        renderCards();
        loadHouseholds();
        vaModal.hide();
        showAlert('success', 'Value‑Adds updated');
      });
    }
  
    /* ════════════════════════════════
     *  SECTION B –  DELETE UPLOAD
     * ════════════════════════════════ */
    let deleteModal;
    (function buildDeleteModal () {
      const html = `
        <div class="modal fade" id="deleteUploadModal" tabindex="-1">
          <div class="modal-dialog">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">Delete PDF</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
              </div>
              <div class="modal-body">
                Are you sure you want to delete this PDF from the Surge? This cannot be undone.
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-danger" id="confirmDeleteUploadBtn">Delete</button>
              </div>
            </div>
          </div>
        </div>`;
      document.body.insertAdjacentHTML('beforeend', html);
      deleteModal = new bootstrap.Modal(document.getElementById('deleteUploadModal'));
    })();
  
    let pendingDeleteId = null;
  
    cardDeck.addEventListener('click', (e) => {
      const btn = e.target.closest('.delete-upload-btn');
      if (!btn) return;
      pendingDeleteId = btn.closest('.va-card').dataset.id;
      deleteModal.show();
    });
  
    document.getElementById('confirmDeleteUploadBtn')
      .addEventListener('click', async () => {
        if (!pendingDeleteId) return;
        try {
          const res = await fetch(
            `/api/surge/${surge._id}/upload/${pendingDeleteId}`,
            { method: 'DELETE' }
          );
          if (!res.ok) throw new Error('delete error');
  
          surge.uploads = surge.uploads.filter(u => u._id !== pendingDeleteId);
          surge.order   = surge.order.filter(tok => tok !== pendingDeleteId);
          renderCards();
          deleteModal.hide();
          showAlert('success', 'PDF deleted');
        } catch (err) {
          console.error('[Surge] delete upload error:', err);
          showAlert('danger', 'Failed to delete PDF – see console.');
        } finally {
          pendingDeleteId = null;
        }
      });
  
    /* ════════════════════════════════
     *  SECTION C –  UPLOAD PDF FLOW
     * ════════════════════════════════ */
    uploadBtn.addEventListener('click', () => hiddenFile.click());
  
    hiddenFile.addEventListener('change', async () => {
      if (!hiddenFile.files.length) return;
      const file = hiddenFile.files[0];
      if (file.type !== 'application/pdf') {
        showAlert('danger', 'Please choose a PDF file.'); return;
      }
  
      const formData = new FormData();
      formData.append('file', file);
  
      uploadBtn.disabled = true;
      uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Uploading…';
  
      try {
        const res = await fetch(`/api/surge/${surge._id}/upload`, {
          method: 'POST', body: formData
        });
        if (!res.ok) throw new Error('upload error');
        const { upload } = await res.json();
  
        surge.uploads.push(upload);
        surge.order.push(upload._id);
        renderCards();
        showAlert('success', 'PDF uploaded');
      } catch (err) {
        console.error('[Surge] uploadPdf error:', err);
        showAlert('danger', 'Upload failed – see console.');
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = '<i class="fas fa-file-upload me-2"></i>Add File (PDF)';
        hiddenFile.value = '';
      }
    });
  
    /* ════════════════════════════════
     *  SECTION D –  Household table
     * ════════════════════════════════ */
    async function loadHouseholds() {
        // 1) Fetch the list of households for this Surge
        const res = await fetch(`/api/surge/${surge._id}/households?page=1&limit=200`);
        if (!res.ok) {
          showAlert('danger', 'Failed to load households');
          return;
        }
        const { households } = await res.json();
      
        // 2) Clear any existing rows
        tbody.innerHTML = '';
      
        // 3) Build one <tr> per household
        households.forEach(hh => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td class="placeholder-cell">
              <input
                type="checkbox"
                class="hhChk form-check-input"
                data-id="${hh._id}">
            </td>
            <td>
              <a
                href="/households/${hh._id}"
                class="text-decoration-none">
                ${hh.householdName}
              </a>
            </td>
            <td>${hh.advisorName || '—'}</td>
            <td class="warning-cell">
              ${hh.warningIcons || ''}
            </td>
            <td>
              ${hh.prepared
                 ? '<span class="material-symbols-outlined text-success" title="Prepared">check_circle</span>'
                 : ''}
            </td>
            <td class="packet-cell">
              ${hh.prepared
                 ? `<img
                      src="/images/pdf-image.png"
                      class="download-pdf-img"
                      data-id="${hh._id}"
                      alt="Download packet"
                      title="Download advisor packet">`
                 : ''}
            </td>
          `;
          tbody.appendChild(tr);
        });
      
        // 4) Activate Bootstrap tooltips for any elements marked with data-bs-toggle="tooltip"
        //    (Assumes your warningIcons spans or other elements carry that attribute.)
        const tooltipTriggerList = Array.from(
          document.querySelectorAll('[data-bs-toggle="tooltip"]')
        );
        tooltipTriggerList.forEach(el =>
          new bootstrap.Tooltip(el, {
            container: 'body',
            boundary: 'viewport'
          })
        );
      }
      

      
    loadHouseholds();

 /* ---------------------------------------------------------
 *  GLOBAL helper – reuse anywhere in the app
 * -------------------------------------------------------- */
async function fetchPacketUrl (surgeId, householdId) {
    const res = await fetch(`/api/surge/${surgeId}/packet/${householdId}`);
    if (!res.ok) throw new Error('link fetch failed');
    const { url } = await res.json();
    return url;
  }
  
  /* One delegated click listener for all future PDF icons */
  tbody.addEventListener('click', async (e) => {
      const img = e.target.closest('.download-pdf-img');
      if (!img) return;
    
      const hhId = img.dataset.id;
      img.classList.add('opacity-50');               // simple visual feedback
    try {
      const url = await fetchPacketUrl(surge._id, hhId);
      /* ---- OPTION A —— force file download (works in all browsers) ---- */
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      a.target = '_blank';
      a.click();
      /* ---- OPTION B —— open in new tab (PDF viewer) ------------------- */
      // window.open(url, '_blank');
    } catch (err) {
      console.error('[Surge] packet download failed', err);
      showAlert('danger', 'Unable to fetch the packet – try again.');
    } finally {
      icon.classList.remove('fa-spin');
    }
  });
     
  
  const preparedCellIndex = 4;  // zero-based index of your “Prepared” column

  document.getElementById('togglePrepared')
    .addEventListener('change', (e) => {
      const hide = e.target.checked;
      tbody.querySelectorAll('tr').forEach(tr => {
        const cell = tr.children[preparedCellIndex];
        // if there's a <span class="material-symbols-outlined…"> in that cell, it's prepared
        const isPrepared = cell.querySelector('.material-symbols-outlined') !== null;
        tr.style.display = hide && isPrepared ? 'none' : '';
      });
    });
  
  
    /* ════════════════════════════════
     *  SECTION E –  Prepare modal
     * ════════════════════════════════ */
    const prepModalBtn = document.getElementById('openPrepareModalBtn');
    const prepModal    = new bootstrap.Modal(document.getElementById('prepareModal'));
    const selList      = document.getElementById('selectedHouseholdList');
  
    prepModalBtn.addEventListener('click', () => {
      selList.innerHTML = '';
      document.querySelectorAll('.hhChk:checked').forEach(chk => {
        const li = document.createElement('li');
        li.className  = 'list-group-item dragHandle';
        li.dataset.id = chk.dataset.id;
        li.textContent = chk.closest('tr').children[1].textContent;
        selList.appendChild(li);
      });
      if (!selList.children.length) {
        showAlert('danger', 'Please select at least one household.'); return;
      }
      Sortable.create(selList, { animation: 150 });
      prepModal.show();
    });
  
    async function batchAction (action) {
      const ids = [...selList.children].map(li => li.dataset.id);
      if (!ids.length) return;
  
      await fetch(`/api/surge/${surge._id}/prepare`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ households: ids, order: ids, action })
      });
      prepModal.hide();
      /* progress overlay handled in surgeProgress.js */
    }
  
    document.getElementById('saveBtn')
            .addEventListener('click', () => batchAction('save'));
    document.getElementById('saveDownloadBtn')
            .addEventListener('click', () => batchAction('save-download'));
    document.getElementById('printBtn')
            .addEventListener('click', () => batchAction('save-print'));
  });
  