/* public/js/exports.js */
(() => {
  // ----------- State ------------------------------------------------------
  const state = {
    exportType: 'accounts',
    columns: [],
    catalog: null,
    labelMap: {},        // id -> friendly label
    items: [],
    total: 0,
    skip: 0,
    limit: 100,          // number of rows loaded at a time; "visible" = what's rendered
    search: '',
    filters: {},
    sort: {},
    selection: new Set(),
    format: 'csv',
    options: {
      includeHeaders: true,
      delimiter: ',',
      timezone: 'UTC',
      dateFormat: 'iso',
    },
    leadAdvisorId: null,
    loading: false       // prevent duplicate fetches during infinite scroll
  };

  // ----------- Utilities --------------------------------------------------
  const el  = (sel, root = document) => root.querySelector(sel);
  const els = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  async function fetchJSON(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  function setBusy(b) {
    runBtn.disabled = b;
    previewBtn.disabled = b;
    exportAllBtn.disabled = b || state.total === 0;
    exportSelectedBtn.disabled = b || state.selection.size === 0;
  }

  // ----------- DOM (light DOM / page) ------------------------------------
  const exportTypeSelect  = el('#exportType');
  const scopeText         = el('#scopeText');
  const selectionStatus   = el('#selectionStatus');
  const exportAllBtn      = el('#exportAll');
  const exportSelectedBtn = el('#exportSelected');
  const previewBtn        = el('#previewBtn');
  const runBtn            = el('#runBtn');
  const historyLink       = el('#historyLink');
  const openHistoryMenu   = el('#open-history');
  const formatSelect      = el('#format');
  const csvHeaders        = el('#csvHeaders');
  const csvDelimiter      = el('#csvDelimiter');
  const timezoneInput     = el('#timezone');
  const dateFormatInput   = el('#dateFormat');
  const searchInput       = el('#globalSearch');
  const columnsGroupsEl   = el('#columnsGroups');
  const columnSearchEl    = el('#columnSearch');
  const columnsSaveBtn    = el('#columnsSave');
  const loadingEl         = el('#exports-loading');

  // ----------- Shadow DOM (isolated table) --------------------------------
  // The table is rendered inside a Shadow DOM to prevent all external CSS
  // (including your app’s table styles) from affecting it. Bootstrap CSS is
  // imported *inside* the shadow root so the table is purely Bootstrap-styled.
  const host = el('#exportsTableHost');
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>


      /* Import Bootstrap INTO the shadow root. */
      @import url('https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css');

      /* Let the host inherit document font/color, but isolate layout. */
      :host { color: inherit; font: inherit; }

      /* Horizontal scroll when the table is too wide. */
      .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }

      /* Never mess with display of table parts; keep perfect alignment. */
      table { width: 100%; border-collapse: collapse; }

      /* Narrow, consistent selection column. */
      th.select-col, td.select-col { width: 2.75rem; }
      th.select-col .form-check, td.select-col .form-check { margin: 0; }

      /* Keep cells on a single line for predictable width; overflow scroll handles extra. */
      th, td { white-space: nowrap; }

      /* For clickable headers (sorting) */
      .cursor-pointer { cursor: pointer; }

      /* Visual affordance for sorted column (optional, Bootstrap tones) */
      th.sorted-asc::after { content: " \\25B2"; font-size: .8em; }
      th.sorted-desc::after { content: " \\25BC"; font-size: .8em; }

      /* Infinite scroll footer */
      #sFooter { display: flex; flex-direction: column; align-items: center; }


      /* ---- Cell padding overrides (inside Shadow DOM) ------------------ */
      /* tweak these two to taste */
      :root { --cell-px: 16px; --cell-py: 8px; }

      #exportsTable > :not(caption) > * > th,
      #exportsTable > :not(caption) > * > td {
        padding: 16px 8px !important;
      }

      /* keep the checkbox column tight */
      #exportsTable th.select-col,
      #exportsTable td.select-col {
        padding-left: 16px !important;
        padding-right: 16px !important;
      }
    </style>

    <div class="table-wrap">
      <table class="table table-striped table-hover table-sm mb-0" id="exportsTable">
        <thead id="sHead"></thead>
        <tbody id="sBody"></tbody>
      </table>
      <div id="sFooter" class="py-2">
        <div id="sInfiniteSpinner" class="d-none text-muted text-center">
          <div class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></div>
          <span class="ms-2">Loading more…</span>
        </div>
        <div id="infiniteSentinel" style="height:1px;width:100%;"></div>
      </div>
    </div>
  `;

  // Shadow-root references
  const sHead = el('#sHead', shadow);
  const sBody = el('#sBody', shadow);
  const sInfiniteSpinner = el('#sInfiniteSpinner', shadow);
  const sSentinel = el('#infiniteSentinel', shadow);

  function showInfiniteSpinner() { sInfiniteSpinner?.classList.remove('d-none'); }
  function hideInfiniteSpinner() { sInfiniteSpinner?.classList.add('d-none'); }

  // ----------- Catalog & labels ------------------------------------------
  function buildLabelMap() {
    const map = {};
    (state.catalog.groups || []).forEach(g => {
      (g.columns || []).forEach(col => { map[col.id] = col.label || col.id; });
    });
    state.labelMap = map;
  }

  function loadSavedColumnsForType() {
    try {
      const key = `exports.columns.${state.exportType}`;
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (Array.isArray(saved) && saved.length) return saved;
    } catch (_) {}
    return null;
  }

  function saveColumnsForType() {
    try {
      const key = `exports.columns.${state.exportType}`;
      localStorage.setItem(key, JSON.stringify(state.columns));
    } catch (_) {}
  }

  async function loadCatalog() {
    const r = await fetchJSON(`/api/exports/columns?type=${state.exportType}`);
    state.catalog = r.data;
    buildLabelMap();

      const saved = loadSavedColumnsForType();
      // Filter saved columns to only those that still exist in the catalog
      let cols = Array.isArray(saved) ? saved : (state.catalog.defaults || []).slice();
      cols = cols.filter(id => !!state.labelMap[id]);
      if (!cols.length) cols = (state.catalog.defaults || []).slice();
      state.columns = cols;
      // If we dropped anything, persist the cleaned set
      if (Array.isArray(saved) && saved.length && saved.length !== cols.length) {
        saveColumnsForType();
      }

    renderColumnsHead();
    renderColumnsModal();
  }

  async function loadScopeText() {
    const r = await fetchJSON(`/api/exports/scope-text?type=${state.exportType}${state.leadAdvisorId ? `&leadAdvisorId=${state.leadAdvisorId}` : ''}`);
    scopeText.textContent = r.text;
  }

  // ----------- Table rendering (inside shadow root) -----------------------
  function setSortedHeaderIndicators() {
    // Clear existing indicators
    els('th', sHead).forEach(th => th.classList.remove('sorted-asc', 'sorted-desc'));
    const [key, dir] = Object.entries(state.sort)[0] || [null, null];
    if (!key || !dir) return;

    const th = els('th[data-key]', sHead).find(h => h.getAttribute('data-key') === key);
    if (th) th.classList.add(dir === 1 ? 'sorted-asc' : 'sorted-desc');
  }

  function renderColumnsHead() {
    sHead.innerHTML = '';

    const tr = document.createElement('tr');

    // Selection header with "Select all (visible)" checkbox
    const selTh = document.createElement('th');
    selTh.className = 'select-col';
    const checkWrap = document.createElement('div');
    checkWrap.className = 'form-check';
    const selAll = document.createElement('input');
    selAll.type = 'checkbox';
    selAll.className = 'form-check-input';
    selAll.id = 'selectAllVisible';
    selAll.setAttribute('aria-label', 'Select all visible rows');
    selAll.addEventListener('change', () => {
      const checked = selAll.checked;
      els('input.row-select', sBody).forEach(box => {
        box.checked = checked;
        const id = box.dataset.id;
        if (checked) state.selection.add(id);
        else state.selection.delete(id);
      });
      updateSelectionStatus();
      updateSelectAllCheckboxState(); // set indeterminate off
    });
    checkWrap.appendChild(selAll);
    selTh.appendChild(checkWrap);
    tr.appendChild(selTh);

    // Data headers
    for (const c of state.columns) {
      const th = document.createElement('th');
      th.textContent = state.labelMap[c] || c;
      th.className = 'cursor-pointer';
      th.tabIndex = 0;
      th.setAttribute('data-key', c);
      th.addEventListener('click', () => {
        const cur = state.sort[c] || 0;
        const next = cur === 1 ? -1 : 1;
        state.sort = { [c]: next };
        reload();
      });
      tr.appendChild(th);
    }

    sHead.appendChild(tr);
    setSortedHeaderIndicators();
  }

  function renderRows(items, reset = false) {
    if (reset) sBody.innerHTML = '';

    for (const it of items) {
      const tr = document.createElement('tr');

      // Selection cell
      const tdSel = document.createElement('td');
      tdSel.className = 'select-col';
      const checkWrap = document.createElement('div');
      checkWrap.className = 'form-check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'form-check-input row-select';
      cb.dataset.id = it._id;
      cb.checked = state.selection.has(it._id);
      cb.setAttribute('aria-label', `Select row ${it._id}`);
      cb.addEventListener('change', () => {
        if (cb.checked) state.selection.add(it._id);
        else state.selection.delete(it._id);
        updateSelectionStatus();
        updateSelectAllCheckboxState();
      });
      checkWrap.appendChild(cb);
      tdSel.appendChild(checkWrap);
      tr.appendChild(tdSel);

      // Data cells
      for (const c of state.columns) {
        const td = document.createElement('td');
        const v = it[c];
        td.textContent = (v === undefined || v === null) ? '' : String(v);
        tr.appendChild(td);
      }

      sBody.appendChild(tr);
    }

    updateSelectAllCheckboxState();
  }

  function updateSelectAllCheckboxState() {
    const selAll = el('#selectAllVisible', sHead);
    if (!selAll) return;

    const boxes = els('input.row-select', sBody);
    const total = boxes.length;
    const checked = els('input.row-select:checked', sBody).length;

    selAll.checked = total > 0 && checked === total;
    selAll.indeterminate = checked > 0 && checked < total;
  }

  function updateSelectionStatus() {
    const visible = shadow ? shadow.querySelectorAll('#sBody tr').length
                           : document.querySelectorAll('#tableBody tr').length;
    selectionStatus.textContent =
      `${state.selection.size} selected — ${visible} visible of ${state.total} total`;
    exportSelectedBtn.disabled = state.selection.size === 0;
    exportAllBtn.disabled = state.total === 0;
  }

  // ----------- Infinite scroll helpers -----------------------------------
  function hasMore() {
    return state.items.length < state.total;
  }

  let io; // IntersectionObserver instance

  function setupInfiniteScroll() {
    if (!sSentinel) return;
    if (io) io.disconnect();

    io = new IntersectionObserver(async (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (!hasMore() || state.loading) continue;

        // Bump skip to the next chunk and fetch
        state.skip += state.limit;
        showInfiniteSpinner();
        try {
          await loadPage(false);
        } catch (err) {
          console.error('Load more failed:', err);
        } finally {
          hideInfiniteSpinner();
        }
      }
    }, {
      root: null,                 // viewport
      rootMargin: '0px 0px 300px 0px', // start loading a bit before reaching bottom
      threshold: 0
    });

    io.observe(sSentinel);
  }

  // ----------- Data loading ----------------------------------------------
  async function reload() {
    state.skip = 0;
    state.items = [];
    state.selection.clear();
    updateSelectionStatus();
    renderColumnsHead();
    await loadPage(true);
  }

  async function loadPage(reset=false) {
    if (state.loading) return;
    if (!reset && !hasMore()) return;

    state.loading = true;
    if (reset) loadingEl?.classList.remove('hidden');

    try {
      const payload = {
        filters: state.filters,
        sort: state.sort
      };

      const url =
        `/api/exports/list` +
        `?type=${state.exportType}` +
        `&skip=${state.skip}` +
        `&limit=${state.limit}` +
        `&columns=${encodeURIComponent(state.columns.join(','))}` +
        `${state.leadAdvisorId ? `&leadAdvisorId=${state.leadAdvisorId}` : ''}` +
        `${state.search ? `&search=${encodeURIComponent(state.search)}` : ''}`;

      const res = await fetchJSON(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      state.total = res.total;
      state.items = reset ? res.items : state.items.concat(res.items);
      renderRows(res.items, reset);
      updateSelectionStatus();
    } catch (err) {
      console.error('Failed to load page:', err);
      // Optional: surface a friendly message
      try {
        alert('Failed to load more rows. Please try again.');
      } catch(_) {}
    } finally {
      if (reset) loadingEl?.classList.add('hidden');
      state.loading = false;
    }
  }

  // ----------- Preview / Run ---------------------------------------------
  async function doPreview() {
    setBusy(true);
    try {
      const r = await fetchJSON('/api/exports/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exportType: state.exportType,
          columns: state.columns,
          filters: state.filters,
          sort: state.sort,
          options: state.options,
          leadAdvisorId: state.leadAdvisorId
        })
      });
      alert(`Preview (${r.items.length} rows):\n\n` + JSON.stringify(r.items.slice(0, 10), null, 2));
    } finally { setBusy(false); }
  }

  function doRun(scopeMode) {
    setBusy(true);
    const payload = {
      exportType: state.exportType,
      columns: state.columns,
      filters: state.filters,
      sort: state.sort,
      options: state.options,
      scope: scopeMode, // 'all' | 'selected'
      selectedIds: Array.from(state.selection),
      leadAdvisorId: state.leadAdvisorId,
      format: state.format
    };

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/exports/run';
    form.target = '_blank';

    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'payload';
    input.value = JSON.stringify(payload);
    form.appendChild(input);

    document.body.appendChild(form);
    form.submit();
    form.remove();

    setBusy(false);
  }

  // ----------- History modal ---------------------------------------------
  async function loadHistory() {
    const r = await fetchJSON('/api/exports/history');
    const body = el('#historyBody');
    body.innerHTML = '';
    for (const j of r.items) {
      const tr = document.createElement('tr');
      const td = (t) => { const d = document.createElement('td'); d.textContent = t || ''; return d; };
      tr.appendChild(td(j.when));
      tr.appendChild(td(j.who));
      tr.appendChild(td(j.type));
      tr.appendChild(td(j.scope));
      tr.appendChild(td(j.format));
      tr.appendChild(td(j.status));
      const tdf = document.createElement('td');
      if (j.downloadUrl) {
        const a = document.createElement('a'); a.href = j.downloadUrl; a.textContent = 'Download';
        tdf.appendChild(a);
      } else tdf.textContent = '-';
      tr.appendChild(tdf);
      body.appendChild(tr);
    }
    const modalEl = el('#historyModal');
    if (modalEl) {
      const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
      bsModal.show();
    }
  }

  // ----------- Columns modal (builder) -----------------------------------
  function renderColumnsModal() {
    if (!columnsGroupsEl) return;
    columnsGroupsEl.innerHTML = '';

    const q = (columnSearchEl?.value || '').trim().toLowerCase();

    for (const group of (state.catalog.groups || [])) {
      const groupDiv = document.createElement('div');
      const h = document.createElement('h6');
      h.textContent = group.name;
      groupDiv.appendChild(h);

      for (const col of (group.columns || [])) {
        const match = !q || col.id.toLowerCase().includes(q) || (col.label || '').toLowerCase().includes(q);
        if (!match) continue;

        const id = `col_cb_${col.id.replace(/[^\w.-]/g,'_')}`;
        const wrap = document.createElement('div');
        wrap.className = 'form-check';

        const cb = document.createElement('input');
        cb.className = 'form-check-input';
        cb.type = 'checkbox';
        cb.id = id;
        cb.value = col.id;
        cb.checked = state.columns.includes(col.id);

        const lbl = document.createElement('label');
        lbl.className = 'form-check-label';
        lbl.htmlFor = id;
        lbl.textContent = col.label || col.id;

        wrap.appendChild(cb);
        wrap.appendChild(lbl);
        groupDiv.appendChild(wrap);
      }

      columnsGroupsEl.appendChild(groupDiv);
    }
  }

  columnSearchEl?.addEventListener('input', () => renderColumnsModal());

  columnsSaveBtn?.addEventListener('click', async () => {
    const checked = Array.from(columnsGroupsEl.querySelectorAll('input.form-check-input:checked')).map(i => i.value);
    if (checked.length === 0) return; // require at least one column
    state.columns = checked;
    saveColumnsForType();
    await reload();
  });

  // ----------- Wire events ------------------------------------------------
  exportTypeSelect.addEventListener('change', async () => {
    state.exportType = exportTypeSelect.value;
    await loadCatalog();
    await loadScopeText();
    await reload();
  });

  searchInput.addEventListener('input', async (e) => {
    state.search = e.target.value;
    await reload();
  });

  formatSelect.addEventListener('change', () => { state.format = formatSelect.value; });
  csvHeaders.addEventListener('change', () => { state.options.includeHeaders = csvHeaders.checked; });
  csvDelimiter.addEventListener('input', () => { state.options.delimiter = csvDelimiter.value || ','; });
  timezoneInput.addEventListener('input', () => { state.options.timezone = timezoneInput.value || 'UTC'; });
  dateFormatInput.addEventListener('input', () => { state.options.dateFormat = dateFormatInput.value || 'iso'; });

  exportAllBtn.addEventListener('click', () => doRun('all'));
  exportSelectedBtn.addEventListener('click', () => doRun('selected'));
  previewBtn.addEventListener('click', () => doPreview());
  runBtn.addEventListener('click', () => doRun('all'));
  historyLink?.addEventListener('click', () => loadHistory());
  openHistoryMenu?.addEventListener('click', () => loadHistory());

  // ----------- Init -------------------------------------------------------
  (async function init() {
    setupInfiniteScroll(); // set up observer once; it survives reloads
    await loadCatalog();
    await loadScopeText();
    await reload();
  })();

  // Optional: socket progress
  if (window.io) {
    const socket = window.io();
    socket.on('exportProgress', (payload) => {
      console.log('Export progress', payload);
    });
  }
})();
