// public/js/household-fees-modal.js
(function () {
    const modal = document.getElementById('householdFeesModal');
    if (!modal) return;
  
    // --- DOM refs ---
    const tblBody = modal.querySelector('#hhFeesTable tbody');
    const form = modal.querySelector('#hhFeesForm');
  
    const inputEntryId = modal.querySelector('#hhFeesEntryId');
    const selPeriodType = modal.querySelector('#hhFeesPeriodType');
  
    const monthGroup = modal.querySelector('#hhFeesMonthGroup');
    const quarterGroup = modal.querySelector('#hhFeesQuarterGroup');
    const yearGroup = modal.querySelector('#hhFeesYearGroup');
  
    const inputMonth = modal.querySelector('#hhFeesMonth'); // YYYY-MM
    const selQuarterYear = modal.querySelector('#hhFeesQuarterYear');
    const selQuarter = modal.querySelector('#hhFeesQuarter');
    const selYear = modal.querySelector('#hhFeesYear');
  
    const inputAmount = modal.querySelector('#hhFeesAmount');
    const inputNote = modal.querySelector('#hhFeesNote');
  
    const addBtn = modal.querySelector('#hhFeesAdd');
    const clearBtn = modal.querySelector('#hhFeesClear');
    const saveBtn = modal.querySelector('#hhFeesSave'); // optional
  
    const householdNameEl = modal.querySelector('#hhFeesHouseholdName');
    const householdIdEl = modal.querySelector('#hhFeesHouseholdId');
  
    let currentHouseholdId = null;
    let bsModal = null;
  
    // --- Modal controls ---
    function openModal() {
      if (!bsModal) bsModal = new bootstrap.Modal(modal);
      bsModal.show();
    }
    function closeModal() {
      if (bsModal) bsModal.hide();
    }
  
    function setInlineMode(mode) {
      if (mode === 'update') {
        addBtn.textContent = 'Update';
        addBtn.dataset.mode = 'update';
      } else {
        addBtn.textContent = 'Add';
        addBtn.dataset.mode = 'add';
      }
    }
  
    function resetForm() {
      inputEntryId.value = '';
      selPeriodType.value = 'month';
      inputMonth.value = '';
      const y = String(new Date().getFullYear());
      selQuarterYear.value = y;
      selQuarter.value = 'Q1';
      selYear.value = y;
      inputAmount.value = '';
      inputNote.value = '';
      updatePeriodInputs();
      setInlineMode('add');
    }
  
    modal.addEventListener('hidden.bs.modal', resetForm);
  
    // --- Formatting + helpers ---
    function fmtCurrency(n) {
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(n));
      } catch {
        return Number(n).toFixed(2);
      }
    }
    function titleCase(s) { return (s || '').charAt(0).toUpperCase() + (s || '').slice(1); }
  
    function periodLabel(periodType, periodKey) {
        if (periodType === 'month') {
            const [yy, mm] = periodKey.split('-').map(Number);
            const d = new Date(Date.UTC(yy, (mm - 1), 1));
            return d.toLocaleString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
          }
      if (periodType === 'quarter') {
        const [yy, q] = periodKey.split('-Q');
        return `Q${q} ${yy}`;
      }
      return String(periodKey);
    }
    function periodSortKey(periodType, periodKey) {
      if (periodType === 'month') {
        const [yy, mm] = periodKey.split('-').map(Number);
        return Date.UTC(yy, (mm - 1), 1);
      }
      if (periodType === 'quarter') {
        const [yy, q] = periodKey.split('-Q').map(Number);
        const startMonth = (q - 1) * 3;
        return Date.UTC(yy, startMonth, 1);
      }
      const y = Number(periodKey);
      return Date.UTC(y, 0, 1);
    }
  
    // --- Period input switching ---
    function updatePeriodInputs() {
      const t = selPeriodType.value;
      monthGroup.classList.toggle('d-none', t !== 'month');
      quarterGroup.classList.toggle('d-none', t !== 'quarter');
      yearGroup.classList.toggle('d-none', t !== 'year');
    }
    selPeriodType.addEventListener('change', updatePeriodInputs);
  
    // --- Populate year selects (±10 years)
    function populateYears(selectEl, span = 10) {
      const nowY = new Date().getFullYear();
      const start = nowY - span;
      const end = nowY + span;
      selectEl.innerHTML = '';
      for (let y = end; y >= start; y--) {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        selectEl.appendChild(opt);
      }
      selectEl.value = String(nowY);
    }
    populateYears(selQuarterYear);
    populateYears(selYear);
  
    // --- API ---
    async function apiList(householdId) {
      const res = await fetch(`/api/households/${encodeURIComponent(householdId)}/fee-entries`);
      if (!res.ok) throw new Error('No household fees found');
      const json = await res.json();
      return json.data || [];
    }
    async function apiCreate(householdId, payload) {
      const res = await fetch(`/api/households/${encodeURIComponent(householdId)}/fee-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Create failed');
      return (await res.json()).data;
    }
    async function apiUpdate(householdId, entryId, payload) {
      const res = await fetch(`/api/households/${encodeURIComponent(householdId)}/fee-entries/${encodeURIComponent(entryId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Update failed');
      return (await res.json()).data;
    }
    async function apiDelete(householdId, entryId) {
      const res = await fetch(`/api/households/${encodeURIComponent(householdId)}/fee-entries/${encodeURIComponent(entryId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Delete failed');
      return true;
    }
  
    // --- Read selection -> normalized period payload
    function readPeriodFromControls() {
      const t = selPeriodType.value;
      if (t === 'month') {
        const v = (inputMonth.value || '').trim(); // YYYY-MM
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return { error: 'Please select a valid month.' };
        return { periodType: 'month', periodKey: v };
      }
      if (t === 'quarter') {
        const y = (selQuarterYear.value || '').trim();
        const q = (selQuarter.value || '').trim(); // 'Q1'..'Q4'
        if (!/^\d{4}$/.test(y)) return { error: 'Please select a valid quarter year.' };
        if (!/^Q[1-4]$/.test(q)) return { error: 'Please select a valid quarter.' };
        return { periodType: 'quarter', periodKey: `${y}-${q}` };
      }
      const y = (selYear.value || '').trim();
      if (!/^\d{4}$/.test(y)) return { error: 'Please select a valid year.' };
      return { periodType: 'year', periodKey: y };
    }
  
    // --- Table row helpers ---
    function rowId(row) {
      return row.id || row._id || `${row.periodType}:${row.periodKey}`;
    }
  
    function buildRow(row) {
      const tr = document.createElement('tr');
      const id = rowId(row);
  
      tr.dataset.id = id;
      tr.dataset.periodType = row.periodType;
      tr.dataset.periodKey = row.periodKey;
      tr.dataset.sortKey = String(periodSortKey(row.periodType, row.periodKey));
  
      const tdPeriod = document.createElement('td');
      tdPeriod.textContent = periodLabel(row.periodType, row.periodKey);
  
      const tdCycle = document.createElement('td');
      tdCycle.textContent = titleCase(row.periodType);
  
      const tdAmount = document.createElement('td');
      tdAmount.textContent = fmtCurrency(Number(row.amount) || 0);
  
      const tdNote = document.createElement('td');
      tdNote.textContent = row.note || '';
  
      const tdActions = document.createElement('td');
      tdActions.className = 'text-end';
  
      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.textContent = 'Edit';
      btnEdit.className = 'btn btn-sm btn-outline-secondary me-2';
      btnEdit.addEventListener('click', () => {
        inputEntryId.value = id;
        selPeriodType.value = row.periodType;
        updatePeriodInputs();
  
        if (row.periodType === 'month') {
          inputMonth.value = (row.periodKey || '').slice(0, 7);
        } else if (row.periodType === 'quarter') {
          const [yy, q] = (row.periodKey || '').split('-Q');
          selQuarterYear.value = yy;
          selQuarter.value = `Q${q}`;
        } else if (row.periodType === 'year') {
          selYear.value = row.periodKey;
        }
  
        inputAmount.value = Number(row.amount).toFixed(2);
        inputNote.value = row.note || '';
        setInlineMode('update');
        inputAmount.focus();
      });
  
      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.textContent = 'Delete';
      btnDelete.className = 'btn btn-sm btn-outline-danger';
      btnDelete.addEventListener('click', async () => {
        if (!confirm('Delete this household fee entry?')) return;
        try {
          await apiDelete(currentHouseholdId, id);
          const existing = tblBody.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
          if (existing) existing.remove();
          if (!tblBody.querySelector('tr')) {
            const trEmpty = document.createElement('tr');
            trEmpty.dataset.empty = '1';
            const td = document.createElement('td');
            td.colSpan = 5;
            td.textContent = 'None';
            trEmpty.appendChild(td);
            tblBody.appendChild(trEmpty);
          }
          if (inputEntryId.value === id) resetForm();
        } catch (e) {
          alert(e.message || 'Delete failed');
        }
      });
  
      tdActions.append(btnEdit, btnDelete);
      tr.append(tdPeriod, tdCycle, tdAmount, tdNote, tdActions);
      return tr;
    }
  
    function insertRowSorted(row) {
      const emptyRow = tblBody.querySelector('tr[data-empty]');
      if (emptyRow) emptyRow.remove();
  
      const newTr = buildRow(row);
      const newKey = Number(newTr.dataset.sortKey);
  
      const rows = Array.from(tblBody.querySelectorAll('tr'));
      let inserted = false;
      for (const tr of rows) {
        const key = Number(tr.dataset.sortKey);
        if (newKey > key) {
          tblBody.insertBefore(newTr, tr);
          inserted = true;
          break;
        }
      }
      if (!inserted) tblBody.appendChild(newTr);
    }
  
    function upsertRowSorted(row) {
      const id = rowId(row);
      const existing = tblBody.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
      if (existing) existing.remove();
      insertRowSorted(row);
    }
  
    function renderRows(rows) {
      tblBody.innerHTML = '';
      if (!rows.length) {
        const tr = document.createElement('tr');
        tr.dataset.empty = '1';
        const td = document.createElement('td');
        td.colSpan = 5;
        td.textContent = 'None';
        tr.appendChild(td);
        tblBody.appendChild(tr);
        return;
      }
      rows
        .slice()
        .sort((a, b) => periodSortKey(b.periodType, b.periodKey) - periodSortKey(a.periodType, a.periodKey))
        .forEach(r => tblBody.appendChild(buildRow(r)));
    }
  
    async function refreshTable() {
      if (!currentHouseholdId) return;
      try {
        const rows = await apiList(currentHouseholdId);
        renderRows(rows);
      } catch (e) {
        tblBody.innerHTML = '';
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.textContent = e.message || 'Failed to load';
        tr.appendChild(td);
        tblBody.appendChild(tr);
      }
    }
  
    // --- Entry point from the summary menu
    document.addEventListener('click', async (ev) => {
      const link = ev.target.closest('.js-open-household-fees');
      if (!link) return;
    
      ev.preventDefault();
    
      currentHouseholdId = link.dataset.householdId || link.getAttribute('data-household-id');
      householdNameEl.textContent =
        link.dataset.householdName || link.getAttribute('data-household-name') || '';
    
      const dispId = link.dataset.householdDisplayId || link.getAttribute('data-household-display-id') || '';
      householdIdEl.textContent = dispId ? `${dispId}` : '—';
    
      // ✅ Close any open summary dropdown before showing modal
      closeAllSummaryMenus();
    
      openModal();
      await refreshTable();
      inputAmount.focus();
    });
  
    // --- Inline "Add / Update"
    addBtn.addEventListener('click', async () => {
      if (!currentHouseholdId) return;
  
      const p = readPeriodFromControls();
      if (p.error) {
        alert(p.error);
        return;
      }
      const amount = Number(inputAmount.value);
      if (!(amount >= 0)) {
        alert('Please enter a valid amount (0 or greater).');
        return;
      }
  
      const payload = {
        periodType: p.periodType,
        periodKey: p.periodKey,
        amount: amount,
        note: inputNote.value
      };
  
      try {
        addBtn.disabled = true;
  
        if (addBtn.dataset.mode === 'update' && inputEntryId.value) {
          const updated = await apiUpdate(currentHouseholdId, inputEntryId.value, payload);
          upsertRowSorted(updated);
        } else {
          const created = await apiCreate(currentHouseholdId, payload);
          insertRowSorted(created);
        }
        resetForm();
        inputAmount.focus();
      } catch (e) {
        alert(e.message || 'Save failed');
      } finally {
        addBtn.disabled = false;
      }
    });
  
    // --- Inline "Clear"
    clearBtn.addEventListener('click', () => {
      resetForm();
      inputAmount.focus();
    });
  
    // --- Footer submit support (if you enable Save button)
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!currentHouseholdId) return;
  
      const p = readPeriodFromControls();
      if (p.error) {
        alert(p.error);
        return;
      }
      const amount = Number(inputAmount.value);
      if (!(amount >= 0)) {
        alert('Please enter a valid amount (0 or greater).');
        return;
      }
      const payload = {
        periodType: p.periodType,
        periodKey: p.periodKey,
        amount: amount,
        note: inputNote.value
      };
  
      try {
        if (saveBtn) saveBtn.disabled = true;
  
        if (inputEntryId.value) {
          const updated = await apiUpdate(currentHouseholdId, inputEntryId.value, payload);
          upsertRowSorted(updated);
        } else {
          const created = await apiCreate(currentHouseholdId, payload);
          insertRowSorted(created);
        }
  
        resetForm();
        inputAmount.focus();
      } catch (e) {
        alert(e.message || 'Save failed');
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  
// ───────────────────────────────────────────────────────────
// Summary “more” menu behavior (Annual Billing card) — works on all tabs
// ───────────────────────────────────────────────────────────
function closeAllSummaryMenus(exceptMenu = null) {
  document.querySelectorAll('.summary-billing-menu').forEach(m => {
    if (m !== exceptMenu) {
      m.classList.remove('show-more-menu', 'fade-out');
      m.style.display = 'none';
      const parentBox = m.closest('.annual-billing-box');
      const btn = parentBox?.querySelector('.summary-more-button');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  });
}

document.addEventListener('click', (event) => {
  // 1) Toggle when clicking the three-dots button in ANY annual-billing box
  const btn = event.target.closest('.annual-billing-box .summary-more-button');
  if (btn) {
    event.preventDefault();
    event.stopPropagation();

    const box  = btn.closest('.annual-billing-box');
    const menu = box.querySelector('.summary-billing-menu');
    const isShown = menu.classList.contains('show-more-menu');

    if (isShown) {
      menu.classList.add('fade-out');
      menu.addEventListener('animationend', () => {
        menu.classList.remove('fade-out', 'show-more-menu');
        menu.style.display = 'none';
        btn.setAttribute('aria-expanded', 'false');
      }, { once: true });
    } else {
      closeAllSummaryMenus(menu);
      menu.style.display = 'block';
      menu.classList.add('show-more-menu');
      btn.setAttribute('aria-expanded', 'true');
    }
    return; // handled
  }

  // 2) If click is inside ANY open menu, don’t auto-close yet
  if (event.target.closest('.summary-billing-menu')) {
    return;
  }

  // 3) If click is inside ANY annual-billing box (but not the menu), leave it (no-op)
  if (event.target.closest('.annual-billing-box')) {
    return;
  }

  // 4) Otherwise, clicked outside — close all menus
  closeAllSummaryMenus();
});

// When choosing a menu item, close its *own* menu first
document.addEventListener('click', (ev) => {
  const feeLink = ev.target.closest('.js-open-household-fees');
  const brkLink = ev.target.closest('.js-open-household-billing-breakdown');

  const link = feeLink || brkLink;
  if (!link) return;

  ev.preventDefault();
  const menu = link.closest('.summary-billing-menu');
  if (menu) {
    // Close just this menu with the animation for consistency
    menu.classList.add('fade-out');
    menu.addEventListener('animationend', () => {
      menu.classList.remove('fade-out', 'show-more-menu');
      menu.style.display = 'none';
      const box = menu.closest('.annual-billing-box');
      const btn = box?.querySelector('.summary-more-button');
      if (btn) btn.setAttribute('aria-expanded', 'false');

      // Now run the action the user chose
      if (feeLink) {
        // existing open fees modal flow will pick this up
        feeLink.dispatchEvent(new Event('fees:open', { bubbles: true }));
      } else if (brkLink) {
        // open the breakdown modal
        const modalEl = document.getElementById('householdBillingBreakdownModal');
        if (modalEl) {
          const bm = new bootstrap.Modal(modalEl);
          bm.show();
        }
      }
    }, { once: true });
  }
});

  })();
  