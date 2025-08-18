(function () {
    const modal = document.getElementById('accountBillingModal');
    if (!modal) return;
  
    // --- DOM refs ---
    const tblBody = modal.querySelector('#acctBillingTable tbody');
    const form = modal.querySelector('#acctBillingForm');
  
    const inputEntryId = modal.querySelector('#acctBillingEntryId');
    const selPeriodType = modal.querySelector('#acctBillingPeriodType');
  
    const monthGroup = modal.querySelector('#acctBillingMonthGroup');
    const quarterGroup = modal.querySelector('#acctBillingQuarterGroup');
    const yearGroup = modal.querySelector('#acctBillingYearGroup');
  
    const inputMonth = modal.querySelector('#acctBillingMonth'); // YYYY-MM
    const selQuarterYear = modal.querySelector('#acctBillingQuarterYear');
    const selQuarter = modal.querySelector('#acctBillingQuarter');
    const selYear = modal.querySelector('#acctBillingYear');
  
    const inputAmount = modal.querySelector('#acctBillingAmount');
    const inputNote = modal.querySelector('#acctBillingNote');
  
    const addBtn = modal.querySelector('#acctBillingAdd');
    const clearBtn = modal.querySelector('#acctBillingClear');
    const saveBtn = modal.querySelector('#acctBillingSave'); // optional / may be absent
  
    const accountNameEl = modal.querySelector('#acctBillingAccountName');
    const last4El = modal.querySelector('#acctBillingLast4');
  
    let currentAccountId = null;
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
      selQuarterYear.value = String(new Date().getFullYear());
      selQuarter.value = 'Q1';
      selYear.value = String(new Date().getFullYear());
      inputAmount.value = '';
      inputNote.value = '';
      updatePeriodInputs();
      setInlineMode('add');
    }
  
    modal.addEventListener('hidden.bs.modal', resetForm);
  
    // --- Utility: formatting ---
    function fmtCurrency(n) {
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(n));
      } catch {
        return Number(n).toFixed(2);
      }
    }
    function titleCase(s) { return (s || '').charAt(0).toUpperCase() + (s || '').slice(1); }
  
    // Period label & sort helpers
    function periodLabel(periodType, periodKey) {
        if (periodType === 'month') {
            const [yy, mm] = periodKey.split('-').map(Number);
            const d = new Date(Date.UTC(yy, (mm - 1), 1));
            return d.toLocaleString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
          }
      if (periodType === 'quarter') {
        // 'YYYY-Q#' → 'Q# YYYY'
        const [yy, q] = periodKey.split('-Q');
        return `Q${q} ${yy}`;
      }
      return String(periodKey); // year
    }
    function periodSortKey(periodType, periodKey) {
      if (periodType === 'month') {
        const [yy, mm] = periodKey.split('-').map(Number);
        return Date.UTC(yy, (mm - 1), 1);
      }
      if (periodType === 'quarter') {
        const [yy, q] = periodKey.split('-Q').map(Number);
        const startMonth = (q - 1) * 3; // 0,3,6,9
        return Date.UTC(yy, startMonth, 1);
      }
      // year
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
  
    // --- Populate year selects (currentYear ± 10)
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
    async function apiList(accountId) {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/billing-entries`);
      if (!res.ok) throw new Error('No billing entries found');
      const json = await res.json();
      return json.data || [];
    }
    async function apiCreate(accountId, payload) {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/billing-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Create failed');
      return (await res.json()).data;
    }
    async function apiUpdate(accountId, entryId, payload) {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/billing-entries/${encodeURIComponent(entryId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Update failed');
      return (await res.json()).data;
    }
    async function apiDelete(accountId, entryId) {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/billing-entries/${encodeURIComponent(entryId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Delete failed');
      return true;
    }
  
    // --- Read current selection -> normalized period payload
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
      // year
      const y = (selYear.value || '').trim();
      if (!/^\d{4}$/.test(y)) return { error: 'Please select a valid year.' };
      return { periodType: 'year', periodKey: y };
    }
  
    // --- Table row helpers ---
    function rowId(row) {
      // Prefer backend-provided id, else synthesize
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
          inputMonth.value = (row.periodKey || '').slice(0, 7); // YYYY-MM
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
        if (!confirm('Delete this billing entry?')) return;
        try {
          await apiDelete(currentAccountId, id);
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
        // Desc by start-of-period (newest first)
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
      // Sort by start-of-period desc
      rows
        .slice()
        .sort((a, b) => periodSortKey(b.periodType, b.periodKey) - periodSortKey(a.periodType, a.periodKey))
        .forEach(r => tblBody.appendChild(buildRow(r)));
    }
  
    async function refreshTable() {
      if (!currentAccountId) return;
      try {
        const rows = await apiList(currentAccountId);
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
  
    // --- Open from the 3‑dot menu (single handler) ---
    document.addEventListener('click', async (ev) => {
      const link = ev.target.closest('.js-open-account-billing');
      if (!link) return;
  
      ev.preventDefault();
  
      currentAccountId = link.dataset.accountId || link.getAttribute('data-account-id');
      accountNameEl.textContent =
        link.dataset.accountName || link.getAttribute('data-account-name') || '';
  
      const last4 = link.dataset.accountLast4 || link.getAttribute('data-account-last4') || '';
      last4El.textContent = last4 ? `•••• ${last4}` : '—';
  
      openModal();
      await refreshTable();
      inputAmount.focus();
    });
  
    // --- Inline "Add / Update" ---
    addBtn.addEventListener('click', async () => {
      if (!currentAccountId) return;
  
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
          const updated = await apiUpdate(currentAccountId, inputEntryId.value, payload);
          upsertRowSorted(updated);
        } else {
          const created = await apiCreate(currentAccountId, payload);
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
  
    // --- Inline "Clear" ---
    clearBtn.addEventListener('click', () => {
      resetForm();
      inputAmount.focus();
    });
  
    // --- Footer submit support (optional)
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!currentAccountId) return;
  
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
          const updated = await apiUpdate(currentAccountId, inputEntryId.value, payload);
          upsertRowSorted(updated);
        } else {
          const created = await apiCreate(currentAccountId, payload);
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
  })();
  