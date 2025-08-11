/************************************************************
 *  public/js/surgeDetail.js
 *  – Surge Composer front‑end logic  (ENHANCED)
 ************************************************************/

const selectedHouseholds = new Set();

const householdNameById  = new Map();      // <–– NEW


document.addEventListener('DOMContentLoaded', () => {

    /* ──────────────────────────────────────────────────────────
     *  SECTION 0 – Edit‑Surge modal (unchanged)
     * ────────────────────────────────────────────────────────── */
    const editBtn    = document.getElementById('editSurgeBtn');
    const editModal  = new bootstrap.Modal(document.getElementById('editSurgeModal'));
    const editForm   = document.getElementById('editSurgeForm');
    const nameInput  = document.getElementById('editSurgeName');
    const startInput = document.getElementById('editStartDate');
    const endInput   = document.getElementById('editEndDate');
  
    editBtn.addEventListener('click', () => {
      nameInput.value  = surge.name || '';
      startInput.value = surge.startDate ? surge.startDate.slice(0, 10) : '';
      endInput.value   = surge.endDate   ? surge.endDate.slice(0, 10)   : '';
      editModal.show();
    });
  
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const updated = {
        name:      nameInput.value.trim(),
        startDate: startInput.value,
        endDate:   endInput.value
      };
      try {
        const res = await fetch(`/api/surge/${surge._id}`, {
          method : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify(updated)
        });
        if (!res.ok) throw new Error('Failed to update Surge');
        const { surge: fresh } = await res.json();
  
        document.querySelector('h2.householdDetailHeader').firstChild.textContent = fresh.name;
        window.surge = fresh;
  
        const ms = document.querySelector('.date-range-container');
        if (ms) {
          const opts = { month: 'short', day: 'numeric', year: 'numeric' };
          ms.innerHTML = `<i class="fas fa-calendar-alt me-1"></i>`
                       + `${new Date(fresh.startDate).toLocaleDateString('en-US', opts)}`
                       + ' – '
                       + `${new Date(fresh.endDate  ).toLocaleDateString('en-US', opts)}`;
        }
  
        editModal.hide();
        showAlert('success', 'Surge details updated');
        setTimeout(() => window.location.reload(), 2000);
      } catch (err) {
        console.error(err);
        showAlert('danger', 'Unable to save changes');
      }
    });
  
    /* ──────────────────────────────────────────────────────────
     *  Toast‑style Alert Helper  (unchanged)
     * ────────────────────────────────────────────────────────── */
    function showAlert (type, message, options = {}) {
      const alertContainer = document.getElementById('alert-container');
      if (!alertContainer) return;
  
      const alert = document.createElement('div');
      alert.id        = type === 'success' ? 'passwordChangeSuccess' : 'errorAlert';
      alert.className = `alert ${type === 'success' ? 'alert-success' : 'alert-error'}`;
      alert.setAttribute('role', 'alert');
  
      const iconBox = document.createElement('div');
      iconBox.className = type === 'success' ? 'success-icon-container' : 'error-icon-container';
      const icon = document.createElement('i');
      icon.className = type === 'success' ? 'far fa-check-circle' : 'far fa-times-circle';
      iconBox.appendChild(icon);
  
      const closeBox = document.createElement('div');
      closeBox.className = type === 'success' ? 'success-close-container' : 'error-close-container';
      const closeIc = document.createElement('span');
      closeIc.className = 'material-symbols-outlined successCloseIcon';
      closeIc.textContent = 'close';
      closeBox.appendChild(closeIc);
  
      const textBox = document.createElement('div');
      textBox.className = 'success-text';
      const title = document.createElement('h3');
      title.textContent = type === 'success' ? 'Success!' : 'Error!';
      const body = document.createElement('p');
      body.textContent = message;
      textBox.append(title, body);
  
      if (options.undo) {
        const undoBtn = document.createElement('button');
        undoBtn.className = 'alert-undo-button';
        undoBtn.textContent = 'Undo';
        undoBtn.onclick = () => { options.undoCallback(); closeAlert(alert); };
        textBox.appendChild(undoBtn);
      }
  
      function closeAlert (el) {
        el.classList.add('exit');
        setTimeout(() => el.remove(), 500);
      }
  
      alert.append(iconBox, closeBox, textBox);
      alertContainer.prepend(alert);
      void alert.offsetWidth;
      alert.classList.add('show');
  
      closeIc.onclick = () => closeAlert(alert);
      setTimeout(() => closeAlert(alert), 5000);
    }
  
    /* ──────────────────────────────────────────────────────────
     *  0.  Hydrate & normalise Surge object
     * ────────────────────────────────────────────────────────── */
    let raw = window.surge || {};
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = {}; } }
  
    raw.valueAdds = Array.isArray(raw.valueAdds) ? raw.valueAdds : [];
    raw.uploads   = Array.isArray(raw.uploads)   ? raw.uploads   : [];
    raw.order     = Array.isArray(raw.order)     ? raw.order     : [];
  
    const surge        = raw;                                   // safe reference
    const cardDeck     = document.getElementById('vaCardDeck');
    const tbody        = document.querySelector('#wHouseholdTable tbody');
    const uploadBtn    = document.getElementById('addUploadBtn');
    const hiddenFile   = document.getElementById('hiddenUploadInput');
  
    /* ---------------------------------------------------------
     *  Globals
     * -------------------------------------------------------- */
    let firmEnabledVAs = null;                                   // cached once
    const pageLimit    = 20;                                     // rows per page
  
    // Dynamic state for Surge‑household table
    let currentPage      = 1;
    let currentSearch    = '';
    let currentSortOrder = 'asc';            // only one sortable column
    let currentWarn      = '';               // '', 'NO_ACCTS', …
    let currentPrepared  = 'all';            // 'yes' | 'no' | 'all'
        /* ⇢ NEW – arrays for multi‑checkbox filters */
        let selectedWarns      = [];          // e.g. ['ANY','NO_ACCTS']
        let selectedPrepared   = [];          // ['yes','no']
    
  


  
    /* Small debounce helper (identical to households.js) */
    function debounce (fn, wait = 300) {
      let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
    }
  
    /* ---------------------------------------------------------
     *  1.  Static lookup for Value‑Add icons / labels
     * -------------------------------------------------------- */
    const VA_CONFIG = {
      BUCKETS:     { icon: 'analytics',       label: 'Buckets'      },
      GUARDRAILS:  { icon: 'add_road',        label: 'Guardrails'   },
      BENEFICIARY: { icon: 'diversity_1',     label: 'Beneficiary'  },
      NET_WORTH:   { icon: 'account_balance', label: 'Net Worth'    },
      HOMEWORK:    { icon: 'inventory',       label: 'Homework'     }
    };
  
    /* ---------------------------------------------------------
     *  2.  Helper – fetch once which VAs the firm has enabled
     * -------------------------------------------------------- */
    async function fetchFirmVAs () {
      if (firmEnabledVAs) return firmEnabledVAs;
      const res = await fetch('/api/firm/value-adds');
      if (!res.ok) { showAlert('danger', 'Unable to load firm settings'); return []; }
      firmEnabledVAs = await res.json();
      return firmEnabledVAs;
    }
  
    /* ---------------------------------------------------------
     *  3.  Card strip (existing implementation) – unchanged
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
  
    async function renderCards () {
      const firmVAs = await fetchFirmVAs();
      cardDeck.innerHTML = '';
  
      const vaMap = new Map(surge.valueAdds.map(v => [v.type, v]));
      const upMap = new Map(surge.uploads .map(u => [u._id,  u]));
      const seen  = new Set();
  
      surge.order.forEach(tok => {
        if (seen.has(tok)) return;
  
        if (!/^[0-9a-fA-F]{24}$/.test(tok) && vaMap.has(tok)) {     // Value‑Add
          if (!firmVAs.includes(tok)) return;
          const { icon, label } = VA_CONFIG[tok] || { icon:'description', label:tok };
          cardDeck.appendChild(makeCard({ label, icon, id: tok, isUpload:false }));
          seen.add(tok); return;
        }
  
        if (upMap.has(tok)) {                                       // Upload
          const u = upMap.get(tok);
          cardDeck.appendChild(makeCard({
            label: u.fileName, icon: 'picture_as_pdf', id: u._id, isUpload:true
          }));
          seen.add(tok);
        }
      });
  
      surge.valueAdds.forEach(v => {
        if (seen.has(v.type) || !firmVAs.includes(v.type)) return;
        const { icon, label } = VA_CONFIG[v.type] || { icon:'description', label:v.type };
        cardDeck.appendChild(makeCard({ label, icon, id:v.type, isUpload:false }));
      });
  
      surge.uploads.forEach(u => {
        if (seen.has(u._id)) return;
        cardDeck.appendChild(makeCard({
          label:u.fileName, icon:'picture_as_pdf', id:u._id, isUpload:true
        }));
      });
    }
    renderCards();
  
    /* ---------------------------------------------------------
     *  4.  Sortable card strip (unchanged)
     * -------------------------------------------------------- */
    Sortable.create(cardDeck, {
      animation: 150,
      handle   : '.handle',
      onEnd    : async () => {
        surge.order = [...cardDeck.children].map(c => c.dataset.id);
        await fetch(`/api/surge/${surge._id}/reorder`, {
          method : 'PATCH',
          headers: { 'Content-Type':'application/json' },
          body   : JSON.stringify({ order: surge.order })
        });
      }
    });
  
    /* ──────────────────────────────────────────────────────────
     *  SECTION A – Value‑Add chooser (unchanged)
     * ────────────────────────────────────────────────────────── */
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
          const label   = (VA_CONFIG[t] || { label:t }).label;
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
          headers: { 'Content-Type':'application/json' },
          body   : JSON.stringify({ valueAdds: selected })
        });
  
        surge.valueAdds = selected.map(t => ({ type:t }));
        surge.order = [...selected, ...surge.uploads.map(u => u._id)];
        renderCards();
        fetchHouseholds();
        vaModal.hide();
        showAlert('success', 'Value‑Adds updated');
      });
    }
  
    /* ──────────────────────────────────────────────────────────
     *  SECTION B –  Delete upload (unchanged)
     * ────────────────────────────────────────────────────────── */
    let deleteModal;
    (function buildDeleteModal () {
      const html = `
        <div class="modal fade" id="deleteUploadModal" tabindex="-1">
          <div class="modal-dialog"><div class="modal-content">
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
          </div></div>
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
          const res = await fetch(`/api/surge/${surge._id}/upload/${pendingDeleteId}`, { method:'DELETE' });
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
  
    /* ──────────────────────────────────────────────────────────
     *  SECTION C – Upload PDF flow (unchanged)
     * ────────────────────────────────────────────────────────── */
    uploadBtn.addEventListener('click', () => hiddenFile.click());
  
    hiddenFile.addEventListener('change', async () => {
      if (!hiddenFile.files.length) return;
      const file = hiddenFile.files[0];
      if (file.type !== 'application/pdf') { showAlert('danger', 'Please choose a PDF file.'); return; }
  
      const formData = new FormData(); formData.append('file', file);
  
      uploadBtn.disabled = true;
      uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Uploading…';
  
      try {
        const res = await fetch(`/api/surge/${surge._id}/upload`, { method:'POST', body:formData });
        if (!res.ok) throw new Error('upload error');
        const { upload } = await res.json();
  
        surge.uploads.push(upload); surge.order.push(upload._id);
        renderCards(); showAlert('success', 'PDF uploaded');
      } catch (err) {
        console.error('[Surge] uploadPdf error:', err);
        showAlert('danger', 'Upload failed – see console.');
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = '<i class="fas fa-file-upload me-2"></i>Add File (PDF)';
        hiddenFile.value = '';
      }
    });
  
    /* ──────────────────────────────────────────────────────────
     *  SECTION D – Surge‑household table  (NEW LOGIC)
     * ────────────────────────────────────────────────────────── */
  
    /* Grab new controls that exist in the updated Pug */
    const searchInput      = document.getElementById('search-surge-hh');
    const warningFilterSel = document.getElementById('warningFilter');
    const preparedFilterSel= document.getElementById('preparedFilter');
    const spinner          = document.getElementById('surge-hh-loading');
    const pagerUL          = document.getElementById('surge-hh-pagination');
    const pagerInfo        = document.getElementById('surge-hh-pageinfo');
  
    /* Header select‑all checkbox */
    const headerChk = document.querySelector('#wHouseholdTable thead .placeholder-cell input[type="checkbox"]');
    if (headerChk) headerChk.id = 'surgeSelectAll';            // give stable id
  
        /* Build URLSearchParams with multi‑value support */
        function buildParams () {
            const qs = new URLSearchParams({
              page     : currentPage,
              limit    : pageLimit,
              search   : currentSearch,
              sortField: 'householdName',
              sortOrder: currentSortOrder
            });
      
            selectedWarns.forEach(w => qs.append('warn', w));
            if (selectedPrepared.length)
              selectedPrepared.forEach(p => qs.append('prepared', p));
      
            return qs;
          }
      

    /* Fetch + render cycle */
    async function fetchHouseholds () {
      spinner.classList.remove('hidden');
      tbody.innerHTML = '';
      if (headerChk) headerChk.checked = false;
  
      try {

  
        const res = await fetch(`/api/surge/${surge._id}/households?${buildParams()}`);

        if (!res.ok) throw new Error('fetch error');
        const { households, currentPage:page, totalPages, totalHouseholds } = await res.json();
  
        renderHouseholdRows(households);
        /* Empty‑state toggle */
        const emptyState = document.getElementById('emptyStateContainer');
        const tableWrap  = document.querySelector('.table-and-pagination-container');
        if (households.length === 0) {
          emptyState.classList.remove('hidden');
          tableWrap.classList.add('hidden');
        } else {
          emptyState.classList.add('hidden');
          tableWrap.classList.remove('hidden');
        }


        buildPager(page, totalPages, totalHouseholds);
      } catch (err) {
        console.error(err);
        showAlert('danger', 'Failed to load households');
      } finally { spinner.classList.add('hidden'); }
    }
  
    /* Build <tr> rows (existing row markup reused) */
    function renderHouseholdRows (households) {



      tbody.innerHTML = '';
  
      households.forEach(hh => {
        householdNameById.set(hh._id, hh.householdName)
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="placeholder-cell">
     <input type="checkbox" class="hhChk form-check-input"
            data-id="${hh._id}" ${selectedHouseholds.has(hh._id) ? 'checked' : ''}>
          </td>
          <td>
            <a href="/households/${hh._id}" class="text-decoration-none">
              ${hh.householdName}
            </a>
          </td>
          <td>${hh.advisorName || '—'}</td>
          <td class="warning-cell">${hh.warningIcons || ''}</td>
          <td>
            ${hh.prepared
               ? '<span class="material-symbols-outlined text-success" title="Prepared">check_circle</span>'
               : ''}
          </td>
          <td class="packet-cell">
            ${hh.prepared
               ? `<img src="/images/pdf-image.png" class="download-pdf-img"
                       data-id="${hh._id}" alt="Download packet" title="Download advisor packet">`
               : ''}
          </td>`;
        tbody.appendChild(tr);
      });
      const allOnPage = tbody.querySelectorAll('.hhChk').length &&
                  [...tbody.querySelectorAll('.hhChk')]
                    .every(cb => cb.checked);
headerChk.checked = allOnPage;

  
      // Activate tool‑tips (icons)
      Array.from(document.querySelectorAll('[data-bs-toggle="tooltip"]'))
        .forEach(el => new bootstrap.Tooltip(el, { container:'body', boundary:'viewport' }));
    }
  
    /* Pager UI builder */
/* Pager UI builder – windowed (e.g. 1 … 8 9 10 11 12 … 42) */
function buildPager(page, totalPages, totalCount) {
    pagerUL.innerHTML = '';
    pagerInfo.textContent =
      `Page ${page} of ${totalPages} | Total Households: ${totalCount}`;
  
    /* helper */
    function addBtn(label, disabled, cb, active = false) {
      const li = document.createElement('li');
      li.className =
        `page-item${disabled ? ' disabled' : ''}${active ? ' active' : ''}`;
      const btn = document.createElement('button');
      btn.className = 'page-link';
      btn.textContent = label;
      if (!disabled) btn.onclick = cb;
      li.appendChild(btn);
      pagerUL.appendChild(li);
    }
  
    /* ← Prev */
    addBtn('Prev', page === 1, () => { currentPage = page - 1; fetchHouseholds(); });
  
    /* ---- numeric window ---- */
    const windowSize = 2;                 // how many neighbours to show
    const pagesToShow = new Set([1, totalPages]);
  
    for (let i = page - windowSize; i <= page + windowSize; i++) {
      if (i >= 1 && i <= totalPages) pagesToShow.add(i);
    }
  
    let last = 0;
    Array.from(pagesToShow).sort((a, b) => a - b).forEach(num => {
      if (num - last > 1) {
        // gap → ellipsis
        addBtn('…', true, null);          // disabled “button” as ellipsis
      }
      addBtn(num, false, () => { currentPage = num; fetchHouseholds(); }, num === page);
      last = num;
    });
  
    /* Next → */
    addBtn('Next', page === totalPages, () => { currentPage = page + 1; fetchHouseholds(); });
  }
  
  
    /* Initial load */
    fetchHouseholds();
  
    /* ── Event listeners for new controls ───────────────────── */
    searchInput?.addEventListener('input', debounce(e => {
      currentSearch = e.target.value.trim();
      currentPage   = 1;
      fetchHouseholds();
    }));
  
    warningFilterSel?.addEventListener('change', e => {
      currentWarn   = e.target.value;
      currentPage   = 1;
      fetchHouseholds();
    });
  
    preparedFilterSel?.addEventListener('change', e => {
      currentPrepared = e.target.value;
      currentPage     = 1;
      fetchHouseholds();
    });
  
    // Sort toggle on Household column header
    const sortIcon = document.querySelector('#wHouseholdTable thead th:nth-child(2) .sort-icon');
    if (sortIcon) {
      sortIcon.addEventListener('click', () => {
        currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
        currentPage = 1; fetchHouseholds();
        sortIcon.textContent = currentSortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward';
      });
    }

      /* Helper – refresh filters & reload */
      function updateFilters () {
        selectedWarns    = [...document.querySelectorAll('.warning-cb:checked')]
                             .map(cb => cb.value);
  
        if (document.getElementById('filterWarnAny').checked)
          selectedWarns.push('ANY');
        if (document.getElementById('filterWarnNone').checked)
          selectedWarns.push('NONE');
  
        selectedPrepared = [];
        if (document.getElementById('filterPreparedYes').checked)
          selectedPrepared.push('yes');
        if (document.getElementById('filterPreparedNo').checked)
          selectedPrepared.push('no');
  
        currentPage = 1;
              /* Toggle “Clear” button visibility */
      const clearBtn = document.getElementById('clearFiltersBtn');
      if (selectedWarns.length || selectedPrepared.length) {
        clearBtn.classList.remove('hidden');
      } else {
        clearBtn.classList.add('hidden');
      }
      refreshFilterBadge();
        fetchHouseholds();
      }

      /* --------------------------------------------------
 *  Badge helper – show count of checked filters
 * --------------------------------------------------*/
const filterBadge = document.getElementById('filterBadge');

/** Recalculate badge every time filters change */
function refreshFilterBadge() {
  if (!filterBadge) return;
  // Count every *checked* box inside the filter bar
  const total = document.querySelectorAll('#filterBar input[type="checkbox"]:checked').length;
  if (total === 0) {
    filterBadge.classList.add('d-none');
  } else {
    filterBadge.textContent = total;
    filterBadge.classList.remove('d-none');
  }
}

  
      /* Attach change events */
      document.querySelectorAll('.filter-bar input[type="checkbox"]')
        .forEach(cb => cb.addEventListener('change', updateFilters));
  
      /* Clear‑all button */
      /* Clear‑all button */
      document.getElementById('clearFiltersBtn')?.addEventListener('click', () => {
        document.querySelectorAll('.filter-bar input[type="checkbox"]')
          .forEach(cb => { cb.checked = false; });
        updateFilters();                       // will hide the button again
      });

      /* --------------------------------------------------
 *  Filter‑bar toggle → add/remove .active class
 *  ------------------------------------------------*/
/* --------------------------------------------------
 *  Filter‑bar toggle – reliable programmatic control
 * --------------------------------------------------*/
(() => {
  const filterBtn = document.getElementById('household-filter-button');
  const filterBar = document.getElementById('filterBar');          // .collapse element
  if (!filterBtn || !filterBar) return;

  // Create a Bootstrap Collapse instance WITHOUT auto‑toggle
  const filterCollapse = new bootstrap.Collapse(filterBar, { toggle: false });

  /* click → open / close */
  filterBtn.addEventListener('click', () => {
    filterCollapse.toggle();               // show if hidden, hide if shown
  });

  /* active‑state class + aria‑expanded sync */
  filterBar.addEventListener('shown.bs.collapse', () => {
    filterBtn.classList.add('active');
    filterBtn.setAttribute('aria-expanded', 'true');
  });
  filterBar.addEventListener('hidden.bs.collapse', () => {
    filterBtn.classList.remove('active');
    filterBtn.setAttribute('aria-expanded', 'false');
  });
})();

  

  
    /* ── Page‑scoped Select‑All logic ───────────────────────── */
    headerChk?.addEventListener('change', e => {
      const checked = e.target.checked;
        tbody.querySelectorAll('.hhChk').forEach(cb => {
        cb.checked = checked;
        const id = cb.dataset.id;
        if (checked) selectedHouseholds.add(id);
        else         selectedHouseholds.delete(id);
      });
    });
  
    tbody.addEventListener('change', e => {
      if (!e.target.classList.contains('hhChk')) return;
      const id = e.target.dataset.id;
      if (e.target.checked) selectedHouseholds.add(id);
      else                  selectedHouseholds.delete(id);
  
      headerChk.checked =
      [...tbody.querySelectorAll('.hhChk')].every(cb => cb.checked);
    });
  
    /* ──────────────────────────────────────────────────────────
     *  GLOBAL helper – Advisor packet link (unchanged)
     * ────────────────────────────────────────────────────────── */
    async function fetchPacketUrl (surgeId, householdId) {
      const res = await fetch(`/api/surge/${surgeId}/packet/${householdId}`);
      if (!res.ok) throw new Error('link fetch failed');
      const { url } = await res.json();
      return url;
    }
  
    tbody.addEventListener('click', async (e) => {
      const img = e.target.closest('.download-pdf-img');
      if (!img) return;
    
      const hhId = img.dataset.id;
      img.classList.add('opacity-50');
    
      // Open a tab immediately so popup blockers are happy
      const previewTab = window.open('', '_blank', 'noopener');
    
      try {
        const url = await fetchPacketUrl(surge._id, hhId);
        if (previewTab) {
          previewTab.location = url;      // show the PDF inline
        } else {
          window.open(url, '_blank', 'noopener');
        }
      } catch (err) {
        console.error('[Surge] packet open failed', err);
        if (previewTab) previewTab.close();
        showAlert('danger', 'Unable to fetch the packet – try again.');
      } finally {
        img.classList.remove('opacity-50');
      }
    });
    
    
  
    /* ──────────────────────────────────────────────────────────
     *  SECTION E – Prepare modal  (unchanged)
     * ────────────────────────────────────────────────────────── */
    const prepModalBtn = document.getElementById('openPrepareModalBtn');
    const prepModal    = new bootstrap.Modal(document.getElementById('prepareModal'));
    const selList      = document.getElementById('selectedHouseholdList');
  
    prepModalBtn.addEventListener('click', () => {
      selList.innerHTML = '';
      [...selectedHouseholds].forEach(id => {
        const li = document.createElement('li');
        li.className  = 'list-group-item dragHandle';
        li.dataset.id = id;
       // first try the cache → else fall back to the row that’s on‑screen
       const cached = householdNameById.get(id);
       if (cached) {
         li.textContent = cached;
       } else {
         const tr = tbody.querySelector(`.hhChk[data-id="${id}"]`)?.closest('tr');
         li.textContent = tr ? tr.children[1].textContent.trim() : 'Household';
       }
        selList.appendChild(li);
      });
      if (!selList.children.length) { showAlert('danger', 'Please select at least one household.'); return; }
      Sortable.create(selList, { animation:150 });
      prepModal.show();
    });
  
    async function batchAction (action) {
      const ids = [...selList.children].map(li => li.dataset.id);
      if (!ids.length) return;
  
      await fetch(`/api/surge/${surge._id}/prepare`, {
        method : 'POST',
        headers: { 'Content-Type':'application/json' },
        body   : JSON.stringify({ households: ids, order: ids, action })
      });
      prepModal.hide();
      // progress overlay handled in surgeProgress.js
    }
  
    document.getElementById('saveBtn')       ?.addEventListener('click', () => batchAction('save'));
    document.getElementById('saveDownloadBtn')?.addEventListener('click', () => batchAction('save-download'));
    document.getElementById('printBtn')      ?.addEventListener('click', () => batchAction('save-print'));


    refreshFilterBadge();

  });
  