/* public/js/householdInsurance.js
 * Insurance tab frontend – SurgeTK/Invictus
 * Mirrors assets/liabilities/accounts UX:
 * - Fetch & render table with empty state, pagination, search & server-side sort
 * - Row selection, bulk selection, selection bar animation
 * - 3-dot menus: View details / Edit / Delete
 * - Confirm deletion modal (single & bulk)
 * - Add/Edit modal with dynamic visibility rules
 * - Beneficiaries UI with 100% per-tier validation
 */

(() => {
  'use strict';

  // ----------------------- Config / Endpoints -----------------------
  const INSURANCE_ENDPOINT = '/api/insurance';

  // ----------------------- Friendly label defaults ------------------
  const DEFAULT_META = Object.freeze({
    TYPE_LABELS: {
      TERM: 'Term',
      PERMANENT: 'Permanent'
    },
    SUBTYPE_LABELS: {
      LEVEL_TERM: 'Level Term',
      DECREASING_TERM: 'Decreasing Term',
      RENEWABLE_TERM: 'Renewable Term',
      CONVERTIBLE_TERM: 'Convertible Term',
      WHOLE_LIFE: 'Whole Life',
      UL: 'Universal Life',
      IUL: 'Indexed Universal Life',
      VUL: 'Variable Universal Life',
      GUL: 'Guaranteed Universal Life',
      OTHER: 'Other'
    },
    STATUS_LABELS: {
      IN_FORCE: 'In Force',
      LAPSED: 'Lapsed',
      EXPIRED: 'Expired',
      SURRENDERED: 'Surrendered',
      CLAIM_PAID: 'Claim Paid'
    },
    SUBTYPE_OPTIONS: {
      TERM: ['LEVEL_TERM','DECREASING_TERM','RENEWABLE_TERM','CONVERTIBLE_TERM','OTHER'],
      PERMANENT: ['WHOLE_LIFE','UL','IUL','VUL','GUL','OTHER']
    }
  });

  // ----------------------- State -----------------------
  const state = {
    firmId: '',
    householdId: '',
    search: '',
    page: 1,
    limit: 10,
    totalPages: 1,
    total: 0,
    sortBy: 'createdAt', // server sort fallback
    sortDir: 'desc',
    // client-side sort UI state for fields the server can't sort (owner/type)
    clientSortField: null, // 'owner' | 'type' | null
    clientSortDir: 'asc',
    rows: [],
    selected: new Set(),
    // meta (friendly labels); server may override these on /list
    meta: DEFAULT_META,
    // create/edit
    editingId: null
  };

  // ----------------------- DOM -----------------------
  const root = document.querySelector('#insurance.tab-panel');
  if (!root) return; // not on this page

  // Context passed via data-* on the tab container
  state.firmId = normalizeFirmId(root.dataset.firmId || '');

  // Money label for the table cell
const cashValueLabel = (item) => {
  // Show "$0" if cashValue is 0; show "—" only when null/undefined
  if (item.cashValue == null) return '—';
  return '$' + Number(item.cashValue).toLocaleString();
};


  function normalizeFirmId(raw) {
    if (!raw) return '';
    if (typeof raw !== 'string') return String(raw);
    const s = raw.trim();
    // If someone injected the whole object as a JSON string by mistake, pull _id
    if (s.startsWith('{') && s.endsWith('}')) {
      try {
        const obj = JSON.parse(s);
        return (obj && obj._id) ? obj._id : '';
      } catch {/* ignore */}
    }
    // If it accidentally became "[object Object]"
    if (s === '[object Object]') return '';
    return s;
  }
  state.householdId = root.dataset.householdId || '';

  // Elements
  const els = {
    tbody: root.querySelector('#insurance-table-body'),
    search: root.querySelector('#search-insurance'),
    addBtn: root.querySelector('#add-insurance-button'),
    emptyAddBtn: root.querySelector('#empty-add-insurance-button'),
    emptyState: root.querySelector('.empty-state.insurance'),
    tableContainer: root.querySelector('.table-container.insurance'),
    selectAll: root.querySelector('#select-all-insurance'),
    selectionBar: root.querySelector('.selection-container-insurance'),
    selectionCount: root.querySelector('#insurance-selection-count'),
    clearSelection: root.querySelector('#clear-insurance-selection'),
    deleteSelected: root.querySelector('#delete-selected-insurance'),
    pagination: root.querySelector('#insurance-pagination ul.pagination'),
    paginationInfo: root.querySelector('#insurance-pagination-info')
  };

  // Modals & buttons
  const modalConfirm = document.getElementById('modal-insurance-confirm-delete');
  const modalConfirmDeleteBtn = document.getElementById('insurance-confirm-delete');
  const modalConfirmList = document.getElementById('insurance-delete-list');
  const modalBulkWarning = document.getElementById('insurance-bulk-warning');

  const modalView = document.getElementById('modal-insurance-view');
  const modalViewBody = document.getElementById('insurance-view-body');

  const modalForm = document.getElementById('modal-insurance-create');
  const form = document.getElementById('insurance-form');
  const saveBtn = document.getElementById('insurance-save');

  // Form fields
  const f = {
    id: document.getElementById('ins-policy-id'),

    // selects instead of text + hidden ids
    ownerSelect: document.getElementById('ins-owner-select'),
    ownerIsInsured: document.getElementById('ins-owner-is-insured'),
    insuredWrapper: document.getElementById('ins-insured-wrapper'),
    insuredSelect: document.getElementById('ins-insured-select'),

    familySelect: document.getElementById('ins-policy-family'),
    subtype: document.getElementById('ins-subtype'),
    carrier: document.getElementById('ins-carrier'),
    policyNumber: document.getElementById('ins-policy-number'),
    status: document.getElementById('ins-status'),
    face: document.getElementById('ins-face'),
    effective: document.getElementById('ins-effective'),
    expWrapper: document.getElementById('ins-expiration-wrapper'),
    expiration: document.getElementById('ins-expiration'),
    hasCash: document.getElementById('ins-has-cash'),
    cashWrapper: document.getElementById('ins-cash-wrapper'),
    cash: document.getElementById('ins-cash'),
    premAmt: document.getElementById('ins-premium-amount'),
    premMode: document.getElementById('ins-premium-mode'),
    notes: document.getElementById('ins-notes'),
    badge: document.getElementById('cashvalue-asset-badge'),
    benPrimary: document.getElementById('beneficiaries-primary'),
    benCont: document.getElementById('beneficiaries-contingent'),
    sumPrimary: document.getElementById('sum-primary'),
    sumCont: document.getElementById('sum-contingent')
  };

  // Bootstrap modal helpers
  const getBsModal = (el) => {
    const m = bootstrap.Modal.getInstance(el);
    return m || new bootstrap.Modal(el);
  };

  // ----------------------- Utils -----------------------

  /********************************************************
   * Copy of your existing accounts showAlert function
   ********************************************************/
  function showAlert(type, message, options = {}) {
    const alertContainer = document.getElementById('alert-container');
    if (!alertContainer) return;

    const alert = document.createElement('div');
    alert.id = type === 'success' ? 'passwordChangeSuccess' : 'errorAlert';
    alert.className = `alert ${type === 'success' ? 'alert-success' : 'alert-error'}`;
    alert.setAttribute('role', 'alert');

    const iconContainer = document.createElement('div');
    iconContainer.className = type === 'success' ? 'success-icon-container' : 'error-icon-container';
    const icon = document.createElement('i');
    icon.className = type === 'success' ? 'far fa-check-circle' : 'far fa-times-circle';
    iconContainer.appendChild(icon);

    const closeContainer = document.createElement('div');
    closeContainer.className = type === 'success' ? 'success-close-container' : 'error-close-container';
    const closeIcon = document.createElement('span');
    closeIcon.className = 'material-symbols-outlined successCloseIcon';
    closeIcon.innerText = 'close';
    closeContainer.appendChild(closeIcon);

    const textContainer = document.createElement('div');
    textContainer.className = type === 'success' ? 'success-text' : 'error-text';
    const title = document.createElement('h3');
    title.innerText = type === 'success' ? 'Success!' : 'Error!';
    const text = document.createElement('p');
    text.innerText = message;

    textContainer.appendChild(title);
    textContainer.appendChild(text);

    if (options.undo) {
      const undoButton = document.createElement('button');
      undoButton.className = 'alert-undo-button';
      undoButton.innerText = 'Undo';
      undoButton.addEventListener('click', () => {
        options.undoCallback();
        closeAlert(alert);
      });
      textContainer.appendChild(undoButton);
    }

    alert.appendChild(iconContainer);
    alert.appendChild(closeContainer);
    alert.appendChild(textContainer);

    alertContainer.prepend(alert);

    void alert.offsetWidth;
    alert.classList.add('show');

    setTimeout(() => closeAlert(alert), 5000);
    closeIcon.addEventListener('click', () => closeAlert(alert));

    function closeAlert(a) {
      a.classList.add('exit');
      setTimeout(() => {
        if (a && a.parentNode) {
          a.parentNode.removeChild(a);
        }
      }, 500);
    }
  }

  const html = (strings, ...vals) =>
    strings.map((s, i) => s + (vals[i] == null ? '' : String(vals[i]))).join('');

  const esc = (s) => (s == null ? '' : String(s)
    .replace(/&/g, '&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;'));

  const formatDate = (d) => {
    if (!d) return '--';
    const dt = (typeof d === 'string' || typeof d === 'number') ? new Date(d) : d;
    if (isNaN(dt.getTime())) return '--';
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth()+1).padStart(2,'0');
    const dd = String(dt.getUTCDate()).padStart(2,'0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const debounce = (fn, ms=300) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };

  // ---- Friendly label helpers
  function metaOrEmpty() {
    return state.meta || DEFAULT_META;
  }
  const famLabel     = (code) => (metaOrEmpty().TYPE_LABELS[code]    || code || '--');
  const subtypeLabel = (code) => (metaOrEmpty().SUBTYPE_LABELS[code] || code || '--');
  const statusLabel  = (code) => (metaOrEmpty().STATUS_LABELS[code]  || code || '--');

  const policyTypeLabel = (item) => {
    const fam = famLabel(item.policyFamily || '');
    const sub = item.policySubtype ? subtypeLabel(item.policySubtype) : '';
    return sub && sub.toLowerCase() !== 'other' ? `${fam} — ${sub}` : fam || '--';
  };

  const periodLabel = (item) => {
    const eff = formatDate(item.effectiveDate);
    if ((item.policyFamily || '').toUpperCase() === 'TERM') {
      const exp = formatDate(item.expirationDate);
      return `${eff} → ${exp}`;
    }
    return `${eff} → Lifetime`;
  };

  function ownerName(item) {
    const c = item.ownerClient;
    if (!c) return '--';
    const parts = [c.firstName, c.lastName].filter(Boolean);
    return parts.join(' ') || c.displayName || '--';
  }
  function ownerFirst(item) {
    const c = item.ownerClient;
    if (!c) return '--';
    if (c.firstName) return c.firstName;
    if (c.displayName) return String(c.displayName).split(' ')[0] || '--';
    return '--';
  }

  // ----------------------- Fetching -----------------------
  async function fetchList() {
    const params = new URLSearchParams({
      firmId: state.firmId || '',
      household: state.householdId || '',
      page: String(state.page),
      limit: String(state.limit),
      sortBy: state.sortBy,
      sortDir: state.sortDir,
      search: state.search || '',
      populate: 'ownerClient,insuredClient,household'
    });
    const res = await fetch(`${INSURANCE_ENDPOINT}?` + params.toString());
    if (!res.ok) throw new Error(`Failed to fetch insurance: ${res.status}`);
    const json = await res.json();
    state.rows = json.items || [];
    state.total = json.total || 0;
    state.totalPages = json.totalPages || 1;
    state.page = json.page || 1;
    // allow server-provided labels, merged over defaults
    if (json.meta) {
      state.meta = {
        TYPE_LABELS:    { ...DEFAULT_META.TYPE_LABELS,    ...(json.meta.TYPE_LABELS    || {}) },
        SUBTYPE_LABELS: { ...DEFAULT_META.SUBTYPE_LABELS, ...(json.meta.SUBTYPE_LABELS || {}) },
        STATUS_LABELS:  { ...DEFAULT_META.STATUS_LABELS,  ...(json.meta.STATUS_LABELS  || {}) },
        SUBTYPE_OPTIONS:{ ...DEFAULT_META.SUBTYPE_OPTIONS, ...(json.meta.SUBTYPE_OPTIONS|| {}) }
      };
    }
  }

  // ----------------------- Rendering -----------------------
  function render() {
    renderRows();
    renderEmptyState();
    renderPagination();
    updateSelectionBar();
    updateSortIndicators();
    // keep select-all in sync
    els.selectAll.checked = state.rows.length > 0 && state.rows.every(r => state.selected.has(r._id));
  }

  function renderRows() {
    if (!els.tbody) return;
    const rowsHtml = state.rows.map(item => {
      const id = item._id;
      const selected = state.selected.has(id);
      return html`
        <tr data-id="${esc(id)}">
          <td class="inputTh">
            <input type="checkbox"
                   class="insurance-row-checkbox liability-checkbox"
                   data-id="${esc(id)}"
                   ${selected ? 'checked' : ''} />
          </td>
          <td class="liability-owner-cell">
            <div class="">${esc(ownerFirst(item))}</div>
          </td>
          <td class="liability-type-cell term-cell">
            <div class="">${esc(famLabel(item.policyFamily || ''))}</div>
            <div class="text-muted small">${esc(item.policySubtype ? subtypeLabel(item.policySubtype) : '')}</div>
          </td>
<td class="liability-balance-cell">
  ${esc(cashValueLabel(item))}
</td>

          <td class="actions-cell text-end position-relative">
            <button type="button" class="btn btn-link p-0 three-dots-btn liabilities-more-button" aria-expanded="false" aria-label="Row actions">
              <i class="fas fa-ellipsis-v"></i>
            </button>
            <ul class="dropdown-menu row-action-menu insurance-dropdown">
              <li><a class="dropdown-item js-insurance-view" href="#" data-id="${esc(id)}">View details</a></li>
              <li><a class="dropdown-item js-insurance-edit" href="#" data-id="${esc(id)}">Edit</a></li>
              <li><a class="dropdown-item text-danger js-insurance-delete" href="#" data-id="${esc(id)}">Delete</a></li>
            </ul>
          </td>
        </tr>
      `;
    }).join('');
    els.tbody.innerHTML = rowsHtml;

    // Wire row-level listeners (checkboxes + menus + actions)
    els.tbody.querySelectorAll('.insurance-row-checkbox').forEach(cb => {
      cb.addEventListener('change', onRowCheckboxChange);
    });
    els.tbody.querySelectorAll('.three-dots-btn').forEach(btn => {
      btn.addEventListener('click', toggleRowMenu);
    });
    els.tbody.querySelectorAll('.js-insurance-view').forEach(a => {
      a.addEventListener('click', (e) => { e.preventDefault(); openViewModal(a.dataset.id); closeAllMenus(); });
    });
    els.tbody.querySelectorAll('.js-insurance-edit').forEach(a => {
      a.addEventListener('click', (e) => { e.preventDefault(); openFormModal(a.dataset.id); closeAllMenus(); });
    });
    els.tbody.querySelectorAll('.js-insurance-delete').forEach(a => {
      a.addEventListener('click', (e) => { e.preventDefault(); confirmDelete([a.dataset.id]); closeAllMenus(); });
    });
  }

  function renderEmptyState() {
    const isEmpty = !state.rows || state.rows.length === 0; // primary check

    // Show/hide the empty state (handle both utility classes)
    if (els.emptyState) {
      els.emptyState.classList.toggle('hidden', !isEmpty);
      els.emptyState.classList.toggle('d-none', !isEmpty);
    }

    // Hide table + pagination when empty
    const tableWrap = root.querySelector('.table-container.insurance');
    const pagerWrap = root.querySelector('#insurance-pagination');
    tableWrap?.classList.toggle('d-none', isEmpty);
    pagerWrap?.classList.toggle('d-none', isEmpty);

    // Also collapse the selection bar if there’s nothing in the table
    if (isEmpty) {
      state.selected.clear();
      updateSelectionBar();
    }
  }

  function renderPagination() {
    if (!els.pagination) return;
    const page = state.page, totalPages = state.totalPages;
    const prevDisabled = page <= 1 ? 'disabled' : '';
       const nextDisabled = page >= totalPages ? 'disabled' : '';

    const items = [];
    items.push(`<li class="page-item ${prevDisabled}"><a class="page-link" href="#" data-page="${page-1}">Previous</a></li>`);
    // basic windowed pager
    const windowSize = 5;
    let start = Math.max(1, page - Math.floor(windowSize/2));
    let end = Math.min(totalPages, start + windowSize - 1);
    if (end - start + 1 < windowSize) start = Math.max(1, end - windowSize + 1);
    for (let p = start; p <= end; p++) {
      items.push(`<li class="page-item ${p === page ? 'active' : ''}"><a class="page-link" href="#" data-page="${p}">${p}</a></li>`);
    }
    items.push(`<li class="page-item ${nextDisabled}"><a class="page-link" href="#" data-page="${page+1}">Next</a></li>`);
    els.pagination.innerHTML = items.join('');

    els.pagination.querySelectorAll('a.page-link').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const p = Number(a.dataset.page);
        if (p >= 1 && p <= state.totalPages && p !== state.page) {
          state.page = p;
          loadAndRender();
        }
      });
    });

    if (els.paginationInfo) {
      const startIdx = (state.page - 1) * state.limit + 1;
      const endIdx = Math.min(state.page * state.limit, state.total);
      els.paginationInfo.textContent = state.total ? `Showing ${startIdx}-${endIdx} of ${state.total}` : '';
    }
  }

  // ----------------------- Selection Bar -----------------------
  function onRowCheckboxChange(e) {
    const id = e.target.dataset.id;
    if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
    updateSelectionBar();
    // update select-all if needed
    els.selectAll.checked = state.rows.length > 0 && state.rows.every(r => state.selected.has(r._id));
  }

  function updateSelectionBar() {
    const count = state.selected.size;
    if (count > 0) {
      els.selectionBar?.setAttribute('aria-hidden','false');
      els.selectionBar?.classList.add('visible');
      els.selectionCount.textContent = `${count} ${count === 1 ? 'policy' : 'policies'} selected.`;
    } else {
      els.selectionBar?.setAttribute('aria-hidden','true');
      els.selectionBar?.classList.remove('visible');
      els.selectionCount.textContent = 'No insurance selected.';
    }
  }

  function clearSelection() {
    state.selected.clear();
    root.querySelectorAll('.insurance-row-checkbox').forEach(cb => cb.checked = false);
    els.selectAll.checked = false;
    updateSelectionBar();
  }

  // ----------------------- Row Menus -----------------------
  function closeAllMenus() {
    root.querySelectorAll('.row-action-menu.show').forEach(menu => menu.classList.remove('show'));
  }

  function toggleRowMenu(e) {
    e.preventDefault();
    const btn = e.currentTarget;
    const menu = btn.parentElement.querySelector('.row-action-menu');
    const isOpen = menu.classList.contains('show');
    closeAllMenus();
    if (!isOpen) {
      menu.classList.add('show');
      // basic positioning near the button
      menu.style.position = 'absolute';
      // Note: align to the right edge of the button to avoid clipping near table edges
      menu.style.right = `${btn.offsetRight}px`;
      menu.style.top = `${btn.offsetTop + btn.offsetHeight + 4}px`;
    }
  }

  document.addEventListener('click', (e) => {
    // Close menus when clicking outside
    if (!e.target.closest('.actions-cell')) closeAllMenus();
  });

  // ----------------------- Sorting -----------------------
  // NOTE: We sort server-side only for "period" (date); "owner" and "type" are client-side, stable sorts.
  function normalizeSortField(field) {
    if (field === 'owner.firstName') return 'owner';
    if (field === 'insuranceType')   return 'type';
    if (field === 'cash')            return 'cash';   // ← add
    return field;
  }
  

  function stableSortRows(field, dir) {
    const mult = dir === 'asc' ? 1 : -1;
    const withIndex = state.rows.map((r, i) => ({ r, i }));
    withIndex.sort((a, b) => {
      let av = '', bv = '';
  
      if (field === 'owner') {
        av = (ownerFirst(a.r) || '').toLowerCase();
        bv = (ownerFirst(b.r) || '').toLowerCase();
      } else if (field === 'type') {
        av = (policyTypeLabel(a.r) || '').toLowerCase();
        bv = (policyTypeLabel(b.r) || '').toLowerCase();
      } else if (field === 'cash') {
        // numeric compare; put blanks at the bottom in both directions
        const fallback = (dir === 'asc') ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
        const an = Number.isFinite(Number(a.r.cashValue)) ? Number(a.r.cashValue) : fallback;
        const bn = Number.isFinite(Number(b.r.cashValue)) ? Number(b.r.cashValue) : fallback;
        if (an < bn) return -1 * mult;
        if (an > bn) return  1 * mult;
        return (a.i - b.i);
      }
  
      if (av < bv) return -1 * mult;
      if (av > bv) return  1 * mult;
      return (a.i - b.i); // stable tie-breaker
    });
    state.rows = withIndex.map(x => x.r);
  }
  

  function updateSortIndicators() {
    root.querySelectorAll('.sort-icon[data-field]').forEach(icon => {
      let field = normalizeSortField(icon.dataset.field);
      const th = icon.closest('th');
  
      // default
      icon.textContent = 'arrow_upward';
      th?.removeAttribute('aria-sort');
  
      if (field === 'owner' || field === 'type' || field === 'cash') {
        if (state.clientSortField === field) {
          const dir = state.clientSortDir || 'asc';
          icon.textContent = (dir === 'asc') ? 'arrow_upward' : 'arrow_downward';
          th?.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
        }
      } else if (field === 'period') {
        // legacy period (server sort) - leave as-is if you still have that header elsewhere
        if (state.sortBy === 'effectiveDate') {
          const dir = state.sortDir || 'asc';
          icon.textContent = (dir === 'asc') ? 'arrow_upward' : 'arrow_downward';
          th?.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
        }
      }
    });
  }
  

  function handleSortClick(e) {
    let field = normalizeSortField(e.currentTarget.dataset.field);
  
    // Server-side sort only for "period" (effectiveDate)
    if (field === 'period') {
      state.clientSortField = null;
      if (state.sortBy === 'effectiveDate') {
        state.sortDir = (state.sortDir === 'asc' ? 'desc' : 'asc');
      } else {
        state.sortBy = 'effectiveDate';
        state.sortDir = 'asc';
      }
      loadAndRender();
      return;
    }
  
    // Client-side for owner/type/cash
    const prevField = state.clientSortField;
    const prevDir = state.clientSortDir;
    if (prevField === field) {
      state.clientSortDir = (prevDir === 'asc' ? 'desc' : 'asc');
    } else {
      state.clientSortField = field;
      state.clientSortDir = 'asc';
    }
    stableSortRows(state.clientSortField, state.clientSortDir);
    renderRows();
    updateSortIndicators();
  }
  

  // ----------------------- Deletion -----------------------
  function confirmDelete(ids) {
    // Fill modal list
    modalConfirmList.innerHTML = '';
    const items = state.rows.filter(r => ids.includes(r._id));
    items.forEach(item => {
      const li = document.createElement('li');
      li.textContent = `${ownerName(item)} — ${policyTypeLabel(item)}`;
      modalConfirmList.appendChild(li);
    });
    modalBulkWarning.classList.toggle('d-none', ids.length <= 1);
    modalConfirmDeleteBtn.dataset.ids = JSON.stringify(ids);
    getBsModal(modalConfirm).show();
  }

  async function performDelete(ids) {
    if (!ids || ids.length === 0) return;
    if (ids.length === 1) {
      const res = await fetch(`${INSURANCE_ENDPOINT}/${ids[0]}?firmId=${encodeURIComponent(state.firmId)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete insurance');
    } else {
      const res = await fetch(`${INSURANCE_ENDPOINT}/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ firmId: state.firmId, ids })
      });
      if (!res.ok) throw new Error('Failed to bulk delete insurance');
    }
  }

  // ----------------------- View Modal -----------------------
  function openViewModal(id) {
    const item = state.rows.find(r => r._id === id);
    if (!item) return;
    modalViewBody.innerHTML = `
      <div class="col-md-6">
        <div><span class="text-muted">Owner:</span> <strong>${esc(ownerFirst(item))}</strong></div>
        <div><span class="text-muted">Insured:</span> <strong>${esc(item.insuredClient ? ((item.insuredClient.firstName||'') + ' ' + (item.insuredClient.lastName||'')) : ownerName(item))}</strong></div>
        <div class="mt-2"><span class="text-muted">Carrier:</span> ${esc(item.carrierName || '--')}</div>
        <div><span class="text-muted">Policy #:</span> ${esc(item.policyNumber || '--')}</div>
        <div class="mt-2"><span class="text-muted">Status:</span> ${esc(statusLabel(item.status || '--'))}</div>
        <div class="mt-2"><span class="text-muted">Type:</span> ${esc(policyTypeLabel(item))}</div>
      </div>
      <div class="col-md-6">
        <div><span class="text-muted">Face Amount:</span> ${item.faceAmount != null ? ('$' + esc(Number(item.faceAmount).toLocaleString())) : '--'}</div>
        <div><span class="text-muted">Effective:</span> ${esc(formatDate(item.effectiveDate))}</div>
        <div><span class="text-muted">Expiration:</span> ${esc(item.policyFamily === 'TERM' ? formatDate(item.expirationDate) : '—')}</div>
        <div class="mt-2"><span class="text-muted">Has Cash Value:</span> ${item.hasCashValue ? 'Yes' : 'No'}</div>
        ${item.hasCashValue ? `<div><span class="text-muted">Cash Value:</span> $${esc(Number(item.cashValue || 0).toLocaleString())}</div>` : ''}
        <div class="mt-2"><span class="text-muted">Premium:</span> ${item.premiumAmount ? ('$' + esc(Number(item.premiumAmount).toLocaleString())) : '--'} ${item.premiumMode ? '(' + esc(item.premiumMode) + ')' : ''}</div>
      </div>
      <div class="col-12 mt-3">
        <div class="text-muted mb-1">Beneficiaries — PRIMARY</div>
        ${renderBeneficiariesView(item.beneficiaries, 'PRIMARY')}
        <div class="text-muted mt-3 mb-1">Beneficiaries — CONTINGENT</div>
        ${renderBeneficiariesView(item.beneficiaries, 'CONTINGENT')}
      </div>
      ${item.notes ? `<div class="col-12 mt-3"><div class="text-muted mb-1">Notes</div><div class="border rounded p-2 bg-light">${esc(item.notes)}</div></div>` : ''}
    `;
    getBsModal(modalView).show();
  }

  function renderBeneficiariesView(list, tier) {
    const rows = (list || []).filter(b => b.tier === tier);
    if (rows.length === 0) return `<div class="small text-muted">None</div>`;
    return `
      <div class="table-responsive">
        <table class="table table-sm table-striped mb-0">
          <thead><tr><th>Beneficiary</th><th>Allocation %</th><th>Revocable</th><th>Relationship</th></tr></thead>
          <tbody>
            ${rows.map(b => {
              const name =
                (b && typeof b === 'object' && 'name' in b && b.name) ? b.name :
                (b.client ? `${b.client.firstName || ''} ${b.client.lastName || ''}`.trim() || b.client.displayName : '--');
              return `
                <tr>
                  <td>${esc(name || '--')}</td>
                  <td>${esc(b.allocationPct)}%</td>
                  <td>${b.revocable ? 'Yes' : 'No'}</td>
                  <td>${esc(b.relationshipToInsured || '--')}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ----------------------- Create/Edit Modal -----------------------
  function populateFamilySelect() {
    if (!f.familySelect) return;
    const labels = metaOrEmpty().TYPE_LABELS || {};
    // Preserve a leading "Select Type" option if modal markup includes one
    const hasPlaceholder = !!f.familySelect.querySelector('option[value=""]');
    const opts =
      `<option value="TERM">${esc(labels.TERM || 'TERM')}</option>` +
      `<option value="PERMANENT">${esc(labels.PERMANENT || 'PERMANENT')}</option>`;
    f.familySelect.innerHTML = (hasPlaceholder ? `<option value="">Select Type</option>` : '') + opts;
  }

  function openFormModal(id = null) {
    populateStatusSelect();
    populateFamilySelect();
    resetForm();
    state.editingId = id;
    document.getElementById('insuranceCreateLabel').textContent = id ? 'Edit Insurance' : 'Add Insurance';
    if (!id) {
      // Defaults: owner from page, owner is insured (checked), TERM selected, subtype list updated
      prefillOwnerFromContext();
      applyFamilyDefaults(getFamily());
      getBsModal(modalForm).show();
      return;
    }
    // Editing: load from state.rows
    const item = state.rows.find(r => r._id === id);
    if (!item) return;

    f.id.value = item._id;
    // Owner
    f.ownerSelect.value = item.ownerClient?._id || '';

    // Insured toggling
    const ownerIsInsured = !item.insuredClient || (
      item.insuredClient && item.ownerClient && (String(item.insuredClient._id) === String(item.ownerClient._id))
    );
    f.ownerIsInsured.checked = ownerIsInsured;
    setInsuredVisibility(!ownerIsInsured);
    f.insuredSelect.value = (!ownerIsInsured && item.insuredClient) ? (item.insuredClient._id || '') : '';

    // Family & subtype
    const fam = (item.policyFamily || 'TERM').toUpperCase();
    if (f.familySelect) f.familySelect.value = fam;
    updateSubtypeOptions();               // refresh subtype options for selected family
    f.subtype.value = item.policySubtype || 'OTHER'; // keep existing subtype (or default)
    setExpirationVisibility(fam === 'TERM');

    // Basics
    f.carrier.value = item.carrierName || '';
    f.policyNumber.value = item.policyNumber || '';
    f.status.value = item.status || 'IN_FORCE';

    // Coverage & dates
    f.face.value = item.faceAmount != null ? String(item.faceAmount) : '';
    f.effective.value = formatDate(item.effectiveDate);
    f.expiration.value = fam === 'TERM' ? formatDate(item.expirationDate) : '';

    // Cash / premium
    f.hasCash.checked = !!item.hasCashValue;
    setCashVisibility(f.hasCash.checked, (item.policyFamily || '').toUpperCase());
    f.cash.value = item.cashValue != null ? String(item.cashValue) : '';
    f.premAmt.value = item.premiumAmount != null ? String(item.premiumAmount) : '';
    f.premMode.value = item.premiumMode || '';

    // Beneficiaries (Name-only UI)
    (item.beneficiaries || []).forEach(b => {
      const defaultName =
        (b && typeof b === 'object' && 'name' in b && b.name) ? b.name :
        (b.client ? `${b.client.firstName || ''} ${b.client.lastName || ''}`.trim() || b.client.displayName : '');
      addBeneficiaryRow(b.tier, {
        name: defaultName || '',
        allocationPct: b.allocationPct || '',
        revocable: (b.revocable !== false),
        relationship: b.relationshipToInsured || ''
      }, false);
    });
    refreshBeneficiarySums();

    // Notes
    f.notes.value = item.notes || '';

    getBsModal(modalForm).show();
  }

  function resetForm() {
    form.reset();
    f.id.value = '';

    // Owner/Insured (selects)
    if (f.ownerSelect) f.ownerSelect.value = '';
    f.ownerIsInsured.checked = true;
    setInsuredVisibility(false);          // hides insured select
    if (f.insuredSelect) f.insuredSelect.value = '';

    // Family defaults
    if (f.familySelect) f.familySelect.value = 'TERM';
    updateSubtypeOptions();               // refresh subtype options for TERM by default
    f.subtype.value = 'LEVEL_TERM';       // default TERM subtype
    setExpirationVisibility(true);

    // Money defaults
    f.hasCash.checked = false;
    setCashVisibility(false, 'TERM');
    f.cash.value = '';
    f.premAmt.value = '';
    f.premMode.value = '';

    // Beneficiaries + notes
    f.benPrimary.innerHTML = '';
    f.benCont.innerHTML = '';
    refreshBeneficiarySums();
    f.notes.value = '';
  }

  function prefillOwnerFromContext() {
    const defaultOwnerId = root.dataset.defaultOwnerId || '';
    if (defaultOwnerId && f.ownerSelect) {
      f.ownerSelect.value = defaultOwnerId; // if not present, the select will keep current value
    }
  }

  function getFamily() { return (f.familySelect && f.familySelect.value ? f.familySelect.value.toUpperCase() : 'TERM'); }

  function updateSubtypeOptions() {
    const fam = getFamily();
    const all = (state.meta && state.meta.SUBTYPE_OPTIONS && state.meta.SUBTYPE_OPTIONS[fam]) || [];
    const lab = (state.meta && state.meta.SUBTYPE_LABELS) || {};
    f.subtype.innerHTML = all.map(o => `<option value="${o}">${esc(lab[o] || o)}</option>`).join('');
  }

  function populateStatusSelect() {
    if (!state.meta || !f.status) return;
    const opts = Object.entries(state.meta.STATUS_LABELS || {}).map(([val, label]) =>
      `<option value="${esc(val)}">${esc(label)}</option>`
    ).join('');
    f.status.innerHTML = opts;
    if ((state.meta.STATUS_LABELS || {}).IN_FORCE) f.status.value = 'IN_FORCE';
  }

  function applyFamilyDefaults(fam) {
    updateSubtypeOptions();
    if (fam === 'TERM') {
      f.subtype.value = 'LEVEL_TERM';
      setExpirationVisibility(true);
      f.hasCash.checked = false;
      setCashVisibility(false, fam);
    } else {
      f.subtype.value = 'WHOLE_LIFE';
      setExpirationVisibility(false);
      f.hasCash.checked = true; // default true for PERMANENT
      setCashVisibility(true, fam);
    }
  }

  function setInsuredVisibility(show) {
    f.insuredWrapper.classList.toggle('d-none', !show);
  }

  function setExpirationVisibility(show) {
    f.expWrapper.classList.toggle('d-none', !show);
    // Expiration is OPTIONAL even for TERM, per requirements
    f.expiration.required = false;
    if (!show) f.expiration.value = '';
  }

  function setCashVisibility(show, _fam) {
    f.cashWrapper.classList.toggle('d-none', !show);
    f.cash.required = show;
    f.badge.classList.toggle('d-none', !(show));
    if (!show) f.cash.value = '';
  }

  // Family select (dropdown)
  if (f.familySelect) {
    f.familySelect.addEventListener('change', () => {
      applyFamilyDefaults(getFamily());
    });
  }

  // Owner is Insured toggle
  f.ownerIsInsured.addEventListener('change', () => {
    const showInsured = !f.ownerIsInsured.checked;
    setInsuredVisibility(showInsured);
    if (!showInsured) {
      // When owner is insured, clear the insured select and rely on owner value
      f.insuredSelect.value = '';
    }
  });

  // Has Cash toggle
  f.hasCash.addEventListener('change', () => setCashVisibility(f.hasCash.checked, getFamily()));

  // ----------------------- Beneficiaries — UI (Name-only) -----------------------
  function addBeneficiaryRow(tier, defaults = {}, focus = true) {
    const container = tier === 'PRIMARY' ? f.benPrimary : f.benCont;
    const row = document.createElement('div');
    row.className = 'row g-2 align-items-end beneficiary-row';
    row.dataset.tier = tier;
    row.innerHTML = `
      <div class="col-12 col-md-6">
        <label class="form-label small">Name</label>
        <input type="text" class="form-control ben-name" maxlength="120" placeholder="Full name" />
      </div>
      <div class="col-6 col-md-2">
        <label class="form-label small">Allocation %</label>
        <input type="number" min="0" max="100" step="0.01" class="form-control ben-pct" />
      </div>
      <div class="col-6 col-md-2">
        <div class="form-check mt-4">
          <input class="form-check-input ben-revocable" type="checkbox" checked />
          <label class="form-check-label small">Revocable</label>
        </div>
      </div>
      <div class="col-12 col-md-2 text-md-end">
        <button type="button" class="btn btn-sm btn-outline-danger ben-remove" aria-label="Remove beneficiary"><i class="fas fa-times"></i></button>
      </div>
      <div class="col-12 col-md-4">
        <label class="form-label small">Relationship</label>
        <input type="text" class="form-control ben-relationship" maxlength="120" placeholder="e.g., Spouse, Child" />
      </div>
      <div class="col-12"><hr class="mt-2 mb-2"></div>
    `;
    container.appendChild(row);

    // defaults
    row.querySelector('.ben-name').value = defaults.name || '';
    row.querySelector('.ben-pct').value = defaults.allocationPct || '';
    row.querySelector('.ben-revocable').checked = (defaults.revocable !== false);
    row.querySelector('.ben-relationship').value = defaults.relationship || '';

    // wiring
    row.querySelector('.ben-remove').addEventListener('click', () => {
      row.remove();
      refreshBeneficiarySums();
    });
    row.querySelector('.ben-pct').addEventListener('input', refreshBeneficiarySums);

    if (focus) row.querySelector('.ben-name').focus();
  }

  function refreshBeneficiarySums() {
    const sumTier = (tier) => {
      const container = tier === 'PRIMARY' ? f.benPrimary : f.benCont;
      let sum = 0;
      container.querySelectorAll('.ben-pct').forEach(inp => sum += Number(inp.value || 0));
      return Math.round(sum * 100) / 100;
    };
    const pSum = sumTier('PRIMARY');
    const cSum = sumTier('CONTINGENT');
    f.sumPrimary.textContent = pSum + '%';
    f.sumCont.textContent = cSum + '%';
    f.sumPrimary.classList.toggle('text-danger', Math.abs(pSum - 100) > 0.01 && pSum !== 0);
    f.sumCont.classList.toggle('text-danger', Math.abs(cSum - 100) > 0.01 && cSum !== 0);
  }

  document.getElementById('add-beneficiary-primary').addEventListener('click', () => addBeneficiaryRow('PRIMARY'));
  document.getElementById('add-beneficiary-contingent').addEventListener('click', () => addBeneficiaryRow('CONTINGENT'));

  // ----------------------- Form submit -----------------------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const payload = collectFormPayload();
      validatePayload(payload); // throws on error

      const isEdit = !!state.editingId;
      const url = isEdit ? `${INSURANCE_ENDPOINT}/${encodeURIComponent(state.editingId)}` : INSURANCE_ENDPOINT;
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await safeJson(res);
        throw new Error(err?.message || 'Failed to save insurance');
      }

      showAlert('success', isEdit ? 'Insurance updated.' : 'Insurance created.');
      getBsModal(modalForm).hide();
      await loadAndRender();
    } catch (err) {
      showAlert('error', err.message || String(err));
    }
  });

  function collectFormPayload() {
    const fam = getFamily();
    const ownerId = f.ownerSelect.value.trim();
    const insuredId = f.ownerIsInsured.checked ? ownerId : (f.insuredSelect.value.trim() || '');

    const beneficiaries = []
      .concat(collectBenFromContainer(f.benPrimary, 'PRIMARY'))
      .concat(collectBenFromContainer(f.benCont, 'CONTINGENT'));

    const payload = {
      firmId: state.firmId,
      household: state.householdId || undefined,
      ownerClient: ownerId || undefined,
      insuredClient: insuredId || undefined,
      policyFamily: fam,
      policySubtype: f.subtype.value || 'OTHER',
      carrierName: f.carrier.value.trim() || undefined,    // optional
      policyNumber: f.policyNumber.value.trim(),
      status: f.status.value || 'IN_FORCE',
      faceAmount: toNumberOrNull(f.face.value),             // optional
      effectiveDate: f.effective.value || undefined,        // optional (yyyy-mm-dd)
      expirationDate: fam === 'TERM' ? (f.expiration.value || undefined) : null, // optional for TERM
      hasCashValue: !!f.hasCash.checked,
      cashValue: f.hasCash.checked ? toNumberOrNull(f.cash.value) : undefined,
      premiumAmount: toNumberOrNull(f.premAmt.value),
      premiumMode: f.premMode.value || undefined,
      beneficiaries,
      notes: f.notes.value.trim() || undefined
    };
    return payload;
  }

  function collectBenFromContainer(container, tier) {
    const rows = container.querySelectorAll('.beneficiary-row');
    const out = [];
    rows.forEach(r => {
      const name = r.querySelector('.ben-name').value.trim();
      const pct = Number(r.querySelector('.ben-pct').value || 0);
      const revocable = r.querySelector('.ben-revocable').checked;
      const relationship = r.querySelector('.ben-relationship').value.trim();
      // Require a name to include the row
      if (!name) return; // skip empty rows
      out.push({
        tier,
        name,
        allocationPct: pct,
        revocable,
        relationshipToInsured: relationship || undefined
      });
    });
    return out;
  }

  function toNumberOrNull(v) { const n = Number(v); return isNaN(n) ? undefined : n; }

  function validatePayload(p) {
    const errors = [];
    if (!p.firmId) errors.push('Missing firm.');
    if (!p.ownerClient) errors.push('Owner is required.');
    if (!p.policyNumber) errors.push('Policy Number is required.');
    if (!p.policyFamily) errors.push('Type is required (Term or Permanent).');
    // Insured, Carrier, Face Amount, Effective Date, Expiration Date are NOT required
    if (p.hasCashValue && p.cashValue == null) errors.push('Cash Value is required when Has Cash Value is on.');

    // beneficiary sums (if any exist in a tier)
    const sumTier = (tier) => (p.beneficiaries || [])
        .filter(b => b.tier === tier)
        .reduce((acc, b) => acc + Number(b.allocationPct || 0), 0);
    const hasPrim = (p.beneficiaries || []).some(b => b.tier === 'PRIMARY');
    const hasCont = (p.beneficiaries || []).some(b => b.tier === 'CONTINGENT');
    const eq100 = (x) => Math.abs(x - 100) < 0.01;
    if (hasPrim && !eq100(sumTier('PRIMARY'))) errors.push('Primary beneficiaries must sum to 100%.');
    if (hasCont && !eq100(sumTier('CONTINGENT'))) errors.push('Contingent beneficiaries must sum to 100%.');

    if (errors.length) throw new Error(errors.join('\n'));
  }

  async function safeJson(res) {
    try { return await res.json(); } catch { return null; }
  }

  // ----------------------- Events -----------------------
  // Search
  els.search?.addEventListener('input', debounce(() => {
    state.search = els.search.value.trim();
    state.page = 1;
    loadAndRender();
  }, 300));

  // Add buttons
  els.addBtn?.addEventListener('click', () => openFormModal(null));
  els.emptyAddBtn?.addEventListener('click', () => openFormModal(null));

  // Select all
  els.selectAll?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    state.rows.forEach(r => { if (checked) state.selected.add(r._id); else state.selected.delete(r._id); });
    root.querySelectorAll('.insurance-row-checkbox').forEach(cb => cb.checked = checked);
    updateSelectionBar();
  });

  // Clear selection
  els.clearSelection?.addEventListener('click', (e) => {
    e.preventDefault();
    clearSelection();
  });

  // Delete selected
  els.deleteSelected?.addEventListener('click', () => {
    if (state.selected.size === 0) return;
    confirmDelete([...state.selected]);
  });

  // Confirm delete modal action
  modalConfirmDeleteBtn.addEventListener('click', async () => {
    try {
      const ids = JSON.parse(modalConfirmDeleteBtn.dataset.ids || '[]');
      await performDelete(ids);
      getBsModal(modalConfirm).hide();
      clearSelection();
      await loadAndRender();
      showAlert('success', ids.length > 1 ? 'Policies deleted.' : 'Policy deleted.');
    } catch (err) {
      showAlert('error', err.message || String(err));
    }
  });

  // Sort icon clicks
  root.querySelectorAll('.sort-icon[data-field]').forEach(icon => {
    icon.addEventListener('click', handleSortClick);
  });

  // ----------------------- Initialize -----------------------
  async function loadAndRender() {
    await fetchList();
    // Re-apply client-side sort if one is active (owner/type)
    if (state.clientSortField) {
      stableSortRows(state.clientSortField, state.clientSortDir || 'asc');
    }
    render();
  }

  // Preload: fetch and render, then optionally prefill default owner text
  (async function init() {
    try {
      await loadAndRender();
      // Prefill owner control helper text if available
      const defName = root.dataset.defaultOwnerName;
      if (defName && document.getElementById('ins-owner-helper')) {
        document.getElementById('ins-owner-helper').textContent = `Default: ${defName}`;
      }
      populateFamilySelect();
    } catch (err) {
      console.error(err);
      showAlert('error', 'Failed to load insurance list.');
    }
  })();

})();
