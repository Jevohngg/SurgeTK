/*  public/js/unlinkedAccounts.js  =========================================
    All selectors are scoped to #unlinkedAccountsModal to avoid conflicts.
*/
document.addEventListener('DOMContentLoaded', () => {
    /* ---------- element refs ---------- */
    const modalEl = document.getElementById('unlinkedAccountsModal');
    if (!modalEl) return;                                   // safety guard
    const modal = new bootstrap.Modal(modalEl);
  
    // outside‑modal elements we need
    const banner      = document.getElementById('unlinked-alert');
    const bannerBtn   = document.getElementById('show-unlinked-accounts');
    const bannerCount = document.getElementById('unlinked-count');
  
    // inside‑modal elements
    const tbody        = modalEl.querySelector('#unlinked-accounts-table tbody');
    const loader       = modalEl.querySelector('#ua-loading');
    const selectAllCb  = modalEl.querySelector('#ua-select-all');
    const selectionBar = modalEl.querySelector('.selection-container-unlinked');
    const selCountTxt  = modalEl.querySelector('#ua-selection-count');
    const clearSelBtn  = modalEl.querySelector('#ua-clear-selection');
    const bulkClientDd = modalEl.querySelector('#ua-bulk-client');
    const bulkClientTS = initTomSelect(bulkClientDd, '‑ Select client (bulk) ‑');

    const linkSelBtn   = modalEl.querySelector('#ua-link-selected');
    const delSelBtn    = modalEl.querySelector('#ua-delete-selected');
  
    /* ---------- state ---------- */
    let rows = [];                 // { _id, tr, cb }
    const selected = new Set();
  
    /* ---------- helpers ---------- */
    const fmtCur = v => new Intl.NumberFormat('en-US',
                      { style: 'currency', currency: 'USD' }).format(v);
  
    const showAlert = window.showAlert
          || ((type, msg) => alert(`${type}: ${msg}`));
  
    /* ---------- fetch banner + rows ---------- */
    fetchUnlinkedBanner();          // on page‑load
    bannerBtn?.addEventListener('click', () => modal.show());
  
    async function fetchUnlinkedBanner() {
      try {
        const r = await fetch('/api/accounts/unlinked', { credentials: 'include' });
        if (!r.ok) throw new Error('err');
        const { count } = await r.json();
        if (count) {
          bannerCount.textContent =
            `You have ${count} unlinked account${count > 1 ? 's' : ''}.`;
          banner.classList.remove('hidden');
        }
      } catch { /* silent */ }
    }
  
    /* fetch rows the *first* time the modal is opened */
    modalEl.addEventListener('show.bs.modal', () => {
      if (!rows.length) fetchRows();
    });
  
    async function fetchRows() {
      loader.classList.remove('hidden');
      try {
        const r = await fetch('/api/accounts/unlinked', { credentials: 'include' });
        if (!r.ok) throw new Error('err');
        const { accounts } = await r.json();
        rows = accounts.map(renderRow);
        tbody.replaceChildren(...rows.map(r => r.tr));

      } catch (err) {
        showAlert('danger', 'Failed to load unlinked accounts');
        console.error(err);
      } finally {
        loader.classList.add('hidden');
      }
    }
  
    /* ---------- row render ---------- */
    function renderRow(acc) {
      const tr = document.createElement('tr');
      tr.dataset.id = acc._id;
  
      const mkTd = (text, className) => {
        const t = document.createElement('td');
        t.className = className;
        t.textContent = text;
        return t;
      };
  
      /* (1) checkbox */
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'ua-row-cb';
      cb.addEventListener('change', () => toggleSelect(acc._id, cb.checked));
      const cbTd = document.createElement('td');
      cbTd.className = 'ua-checkbox-cell';
      cbTd.appendChild(cb);
  
      /* (2) account number  */
      const numTd = mkTd(acc.accountNumber || '—', 'ua-acc-number-cell');
  
      /* (3) type */
      const typeTd = mkTd(acc.accountType || '—', 'ua-acc-type-cell');
  
      /* (4) value */
      const valTd  = mkTd(acc.accountValue != null ? fmtCur(acc.accountValue) : '—',
                          'ua-acc-value-cell text-end');
  
      /* (5) client dropdown */
      const clientTd = document.createElement('td');
      clientTd.className = 'ua-client-cell';
      const dd = document.createElement('select');
      dd.className = 'form-select form-select-sm ua-client-dd';
      dd.innerHTML = '<option value="">‑ Select client ‑</option>';


      clientTd.appendChild(dd);
      initTomSelect(dd);
  
      /* (6) external account owner name */
      const ownerTd = mkTd(acc.externalAccountOwnerName || '—',
                           'ua-owner-name-cell');
  

  
      /* (8) link button */
      const linkBtn = document.createElement('button');
      linkBtn.className = 'btn btn-primary btn-sm ua-link-btn disabled';
      linkBtn.textContent = 'Link';
      linkBtn.addEventListener('click', () => linkSingle(acc._id, dd.value, tr));
      const linkTd = document.createElement('td');
      linkTd.className = 'ua-actions-cell';
      linkTd.appendChild(linkBtn);
  
      /* (9) trash */
      const trashI = document.createElement('i');
      trashI.className = 'fas fa-trash-alt text-danger ua-trash';
      trashI.addEventListener('click', () => deleteAccounts([acc._id]));
      const trashTd = document.createElement('td');
      trashTd.className = 'ua-trash-cell';
      trashTd.appendChild(trashI);
  
      tr.append(
        cbTd,
        numTd,
        typeTd,
        valTd,
        ownerTd,
        clientTd,
        linkTd,
        trashTd
      );
  
      /* enable/disable link on select change */
      dd.addEventListener('change', () =>
        dd.value
          ? linkBtn.classList.remove('disabled')
          : linkBtn.classList.add('disabled')
      );
  
      return { _id: acc._id, tr, cb };
    }
  
/* ---------- client dropdown enhancement ---------- */
function initTomSelect(selectEl, placeholder='‑ Select client ‑') {
    return new TomSelect(selectEl, {
      placeholder,
      valueField  : '_id',
      labelField  : 'full',
      searchField : ['firstName','lastName'],
      maxOptions  : 100,
      // remote search
      load(query, cb) {
        const url = '/api/clients?fields=_id,firstName,lastName' +
                    (query ? `&q=${encodeURIComponent(query)}` : '');
        fetch(url, { credentials:'include' })
          .then(r => r.json())
          .then(({ clients }) => {
            const data = clients.map(c => ({
              _id : c._id,
              firstName : c.firstName,
              lastName  : c.lastName,
              full : `${c.lastName}, ${c.firstName}`
            }));
            cb(data);
          })
          .catch(()=>cb());
      },
      render: {
        option: d => `<div>${d.lastName}, ${d.firstName}</div>`,
        item  : d => `<div>${d.lastName}, ${d.firstName}</div>`
      }
    });
  }
  
  
    /* ---------- selection bar ---------- */
    function toggleSelect(id, on) {
      on ? selected.add(id) : selected.delete(id);
      updateSelectionUI();
    }
    function updateSelectionUI() {
      const n = selected.size;
      selCountTxt.textContent = `${n} selected`;
      selectionBar.classList.toggle('visible', n > 0);
      linkSelBtn.classList.toggle('disabled', !n || !bulkClientDd.value);
      delSelBtn.classList.toggle('disabled', !n);
      /* header cb */
      /* header checkbox rules */
      selectAllCb.indeterminate = false;          // never show the dash
      selectAllCb.checked       = n > 0 && n === rows.length;
    }
  
/* ---- far simpler & atomic ---- */
selectAllCb?.addEventListener('change', () => {
    const allOn = selectAllCb.checked;         // capture once
  
    // 1) update every row checkbox *without* firing toggleSelect n times
    rows.forEach(r => (r.cb.checked = allOn));
  
    // 2) rebuild the selected set once
    selected.clear();
    if (allOn) rows.forEach(r => selected.add(r._id));
  
    // 3) refresh UI once
    updateSelectionUI();
  });
  
  
    clearSelBtn?.addEventListener('click', () => {
      rows.forEach(r => r.cb.checked = false);
      selected.clear();
      updateSelectionUI();
    });
  
    bulkClientDd?.addEventListener('change', updateSelectionUI);
  
    /* ---------- bulk buttons ---------- */
    linkSelBtn?.addEventListener('click', () => {
      if (linkSelBtn.classList.contains('disabled')) return;
      linkMany([...selected], bulkClientDd.value);
    });
    delSelBtn?.addEventListener('click', () => {
      if (delSelBtn.classList.contains('disabled')) return;
      deleteAccounts([...selected]);
    });
  
    /* ---------- Ajax actions ---------- */
    async function linkSingle(accountId, clientId, tr) {
      try {
        const r = await fetch(`/api/accounts/${accountId}/link`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId })
        });
        const res = await r.json();
        if (!r.ok) throw new Error(res.message || 'Link failed');
        removeRow(accountId);
        showAlert('success', 'Account linked');
      } catch (err) { showAlert('danger', err.message); }
    }
  
    async function linkMany(ids, clientId) {
      try {
        const r = await fetch('/api/accounts/bulk-link', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountIds: ids, clientId })
        });
        const res = await r.json();
        if (!r.ok) throw new Error(res.message || 'Bulk link failed');
        ids.forEach(removeRow);
        showAlert('success', 'Accounts linked');
      } catch (err) { showAlert('danger', err.message); }
    }
  
    async function deleteAccounts(ids) {
      if (!ids.length || !confirm(`Delete ${ids.length} account(s)?`)) return;
      try {
        const r = await fetch('/api/accounts/unlinked/bulk-delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountIds: ids })
        });
        const res = await r.json();
        if (!r.ok) throw new Error(res.message || 'Delete failed');
        ids.forEach(removeRow);
        showAlert('success', 'Deleted');
      } catch (err) { showAlert('danger', err.message); }
    }
  
    function removeRow(id) {
      const i = rows.findIndex(r => r._id === id);
      if (i > -1) { rows[i].tr.remove(); rows.splice(i, 1); }
      selected.delete(id);
      updateSelectionUI();
      if (!rows.length) tbody.innerHTML =
        '<tr><td colspan="9" class="text-muted text-center">None 🎉</td></tr>';
    }
  });
  