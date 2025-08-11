(function () {
    const modal = document.getElementById('oneTimeTxModal');
    if (!modal) return;
  
    // DOM refs
    const tblBody = modal.querySelector('#oneTimeTxTable tbody');
    const form = modal.querySelector('#oneTimeTxForm');
    const inputId = modal.querySelector('#oneTimeTxId');
    const inputKind = modal.querySelector('#oneTimeTxKind');
    const inputAmount = modal.querySelector('#oneTimeTxAmount');
    const inputDate = modal.querySelector('#oneTimeTxDate');
    const inputNote = modal.querySelector('#oneTimeTxNote');
    const accountNameEl = modal.querySelector('#oneTimeTxAccountName');
    const last4El = modal.querySelector('#oneTimeTxLast4');
    const addBtn = modal.querySelector('#oneTimeTxAdd');
    const clearBtn = modal.querySelector('#oneTimeTxClear');
    const saveBtn = document.getElementById('oneTimeTxSave');
  
    let currentAccountId = null;
    let bsModal; // Bootstrap modal instance
  
    // --- Modal controls (Bootstrap) ---
    function openModal() {
      if (!bsModal) bsModal = new bootstrap.Modal(modal);
      bsModal.show();
    }
    function closeModal() {
      if (bsModal) bsModal.hide();
    }
  
    // Toggle inline button mode ("add" vs "update")
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
      inputId.value = '';
      inputKind.value = 'deposit';
      inputAmount.value = '';
      inputDate.value = '';
      inputNote.value = '';
      setInlineMode('add');
    }
  
    // Reset the form whenever the modal is fully hidden
    modal.addEventListener('hidden.bs.modal', resetForm);
  
    // --- Formatting helpers ---
    function fmtCurrency(n) {
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n);
      } catch {
        return Number(n).toFixed(2);
      }
    }
    function fmtDate(d) {
      try {
        return new Date(d).toLocaleDateString();
      } catch {
        return d;
      }
    }
  
    // --- API ---
    async function apiList(accountId) {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/one-time-transactions`);
      if (!res.ok) throw new Error('Failed to load transactions');
      const json = await res.json();
      return json.data || [];
    }
    async function apiCreate(accountId, payload) {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/one-time-transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Create failed');
      return (await res.json()).data;
    }
    async function apiUpdate(accountId, txnId, payload) {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/one-time-transactions/${encodeURIComponent(txnId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Update failed');
      return (await res.json()).data;
    }
    async function apiDelete(accountId, txnId) {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/one-time-transactions/${encodeURIComponent(txnId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Delete failed');
      return true;
    }
  
    // --- Table rendering & DOM helpers ---
    function buildRow(row) {
      const tr = document.createElement('tr');
      tr.dataset.id = row._id;
      tr.dataset.occurredOn = row.occurredOn;
  
      const tdDate = document.createElement('td');
      tdDate.textContent = fmtDate(row.occurredOn);
  
      const tdKind = document.createElement('td');
      tdKind.textContent = row.kind === 'deposit' ? 'Deposit' : 'Withdrawal';
  
      const tdAmount = document.createElement('td');
      const isWithdrawal = row.kind === 'withdrawal';
      const sign = isWithdrawal ? '-' : '+';
      
      // Format the currency normally
      tdAmount.textContent = `${sign}${fmtCurrency(Number(row.amount))}`;
      
      // Add color styling
      tdAmount.classList.add(isWithdrawal ? 'text-danger' : 'text-success');
      
  
      const tdNote = document.createElement('td');
      tdNote.textContent = row.note || '';
  
      const tdActions = document.createElement('td');
      tdActions.className = 'text-end';
  
      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.textContent = 'Edit';
      btnEdit.className = 'btn btn-sm btn-outline-secondary me-2';
      btnEdit.addEventListener('click', () => {
        inputId.value = row._id;
        inputKind.value = row.kind;
        inputAmount.value = Number(row.amount).toFixed(2);
        inputDate.value = (row.occurredOn || '').slice(0, 10);
        inputNote.value = row.note || '';
        setInlineMode('update');
        inputAmount.focus();
      });
  
      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.textContent = 'Delete';
      btnDelete.className = 'btn btn-sm btn-outline-danger';
      btnDelete.addEventListener('click', async () => {
        if (!confirm('Delete this transaction?')) return;
        try {
          await apiDelete(currentAccountId, row._id);
          const existing = tblBody.querySelector(`tr[data-id="${row._id}"]`);
          if (existing) existing.remove();
          // if list became empty, show the empty state
          if (!tblBody.querySelector('tr')) {
            const trEmpty = document.createElement('tr');
            trEmpty.dataset.empty = '1';
            const td = document.createElement('td');
            td.colSpan = 5;
            td.textContent = 'None';
            trEmpty.appendChild(td);
            tblBody.appendChild(trEmpty);
          }
          // If the edited row was selected in the form, clear the form back to Add mode
          if (inputId.value === row._id) resetForm();
        } catch (e) {
          alert(e.message || 'Delete failed');
        }
      });
  
      tdActions.append(btnEdit, btnDelete);
      tr.append(tdDate, tdKind, tdAmount, tdNote, tdActions);
      return tr;
    }
  
    function insertRowSorted(row) {
      // Remove empty-state row if present
      const emptyRow = tblBody.querySelector('tr[data-empty]');
      if (emptyRow) emptyRow.remove();
  
      const newTr = buildRow(row);
      const newTime = new Date(row.occurredOn).getTime();
  
      const rows = Array.from(tblBody.querySelectorAll('tr'));
      let inserted = false;
      for (const tr of rows) {
        const t = new Date(tr.dataset.occurredOn).getTime();
        // Descending by date (most recent first)
        if (newTime > t) {
          tblBody.insertBefore(newTr, tr);
          inserted = true;
          break;
        }
      }
      if (!inserted) tblBody.appendChild(newTr);
    }
  
    function upsertRowSorted(row) {
      const existing = tblBody.querySelector(`tr[data-id="${row._id}"]`);
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
      rows.forEach(r => tblBody.appendChild(buildRow(r)));
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
  
    // --- Open from the 3-dot menu (single handler) ---
    document.addEventListener('click', async (ev) => {
      const link = ev.target.closest('.js-open-one-time-tx');
      if (!link) return;
  
      ev.preventDefault();
  
      currentAccountId = link.dataset.accountId || link.getAttribute('data-account-id');
      accountNameEl.textContent =
        link.dataset.accountName || link.getAttribute('data-account-name') || '';
  
      const last4 = link.dataset.accountLast4 || link.getAttribute('data-account-last4') || '';
      if (last4El) last4El.textContent = last4 ? `•••• ${last4}` : '—';
  
      openModal();
      await refreshTable();
      inputAmount.focus();
    });
  
    // --- Inline "Add / Update" button ---
    addBtn.addEventListener('click', async () => {
      if (!currentAccountId) return;
  
      const payload = {
        kind: inputKind.value,
        amount: inputAmount.value,
        occurredOn: inputDate.value,
        note: inputNote.value,
      };
  
      if (!payload.amount || Number(payload.amount) <= 0 || !payload.occurredOn) {
        alert('Please enter a positive amount and a date.');
        return;
      }
  
      try {
        addBtn.disabled = true;
  
        // If we're editing (txnId present OR mode=update), update instead of create
        if (addBtn.dataset.mode === 'update' && inputId.value) {
          const updated = await apiUpdate(currentAccountId, inputId.value, payload);
          upsertRowSorted(updated);
        } else {
          const created = await apiCreate(currentAccountId, payload);
          insertRowSorted(created); // immediate append in sorted order
        }
  
        resetForm();
        inputAmount.focus();
      } catch (e) {
        alert(e.message || 'Save failed');
      } finally {
        addBtn.disabled = false;
      }
    });
  
    // --- Inline "Clear" button ---
    clearBtn.addEventListener('click', () => {
      resetForm();
      inputAmount.focus();
    });
  
    // --- Footer "Save" (form submit) — supports both create/update as well ---
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!currentAccountId) return;
  
      const payload = {
        kind: inputKind.value,
        amount: inputAmount.value,
        occurredOn: inputDate.value,
        note: inputNote.value,
      };
  
      if (!payload.amount || Number(payload.amount) <= 0 || !payload.occurredOn) {
        alert('Please enter a positive amount and a date.');
        return;
      }
  
      try {
        saveBtn.disabled = true;
  
        if (inputId.value) {
          const updated = await apiUpdate(currentAccountId, inputId.value, payload);
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
        saveBtn.disabled = false;
      }
    });
  })();
  