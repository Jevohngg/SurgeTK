/* public/js/surgeList.js
   ——— Complete, fully‑integrated version ——— */

   document.addEventListener('DOMContentLoaded', () => {
    /* ──────────────────────────────────────────────────────────
     * Elements
     * ────────────────────────────────────────────────────────── */
    const tableEl           = document.getElementById('wSurgeTable');
    const tableBody         = tableEl.querySelector('tbody');
    const createBtn         = document.getElementById('openCreateSurgeBtn');
    const createModalEl     = document.getElementById('createSurgeModal');
    const createForm        = document.getElementById('createSurgeForm');
    const deleteModalEl     = document.getElementById('confirmDeleteModal');
    const delSurgeNameEl    = document.getElementById('delSurgeName');
    const confirmDeleteBtn  = document.getElementById('confirmDeleteBtn2');
  
    /* Empty‑state elements */
    const emptyState        = document.getElementById('emptyState');                 // <div class="empty‑state‑container …">
    const emptyCreateBtn    = document.getElementById('empty-create-surge-button');  // lone button inside empty state
  
    const createModal  = new bootstrap.Modal(createModalEl);
    const deleteModal  = new bootstrap.Modal(deleteModalEl);
  
    let surgeToDelete = null;      // remembers { id, name } when trash icon clicked
  
    /* ──────────────────────────────────────────────────────────
     * Helpers
     * ────────────────────────────────────────────────────────── */
    const statusColor = st => ({ upcoming:'secondary', active:'success', past:'dark'}[st] || 'light');
  
    /** Global re‑usable alert helper */
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
      void alert.offsetWidth;      // trigger reflow for animation
      alert.classList.add('show');
  
      closeIc.onclick = () => closeAlert(alert);
      setTimeout(() => closeAlert(alert), 5000);
    }
  
    /* ──────────────────────────────────────────────────────────
     * Load & render table (and toggle empty state)
     * ────────────────────────────────────────────────────────── */
    async function loadSurges () {
      const res = await fetch('/api/surge?page=1&limit=50');
      const { surges } = await res.json();
  
      /* Toggle table ↔ empty‑state */
      if (surges.length === 0) {
        tableEl.classList.add('d-none');
        if (emptyState) emptyState.classList.remove('hidden');
        return;                                     // nothing more to render
      }
      tableEl.classList.remove('d-none');
      if (emptyState) emptyState.classList.add('hidden');
  
      /* Populate table */
      tableBody.innerHTML = '';
      surges.forEach(s => {
        const tr = document.createElement('tr');
  
        /* Whole‑row navigation (ignore trash icon) */
        tr.addEventListener('click', evt => {
          if (!evt.target.closest('.delete-surge')) {
            window.location.href = `/surge/${s._id}`;
          }
        });
  
        tr.innerHTML = `
          <td>${s.name}</td>
          <td>${new Date(s.startDate).toLocaleDateString()} – ${new Date(s.endDate).toLocaleDateString()}</td>
          <td><span class="badge bg-${statusColor(s.status)}">${s.status}</span></td>
          <td>${s.preparedCount}/${s.householdCount}</td>
          <td class="text-end placeholder-cell delete-cell">
            <i class="fas fa-trash-alt text-danger delete-surge" role="button"
               data-id="${s._id}" data-name="${s.name}" title="Delete"></i>
          </td>`;
        tableBody.appendChild(tr);
      });
    }
  
    /* ──────────────────────────────────────────────────────────
     * Create‑surge modal (from header button or empty‑state button)
     * ────────────────────────────────────────────────────────── */
    createBtn.addEventListener('click', () => createModal.show());
    if (emptyCreateBtn) emptyCreateBtn.addEventListener('click', () => createModal.show());
  
    createForm.addEventListener('submit', async evt => {
      evt.preventDefault();
      const body = {
        name      : createForm.surgeName.value.trim(),
        startDate : createForm.startDate.value,
        endDate   : createForm.endDate.value
      };
  
      const res = await fetch('/api/surge', {
        method : 'POST',
        headers: { 'Content-Type':'application/json' },
        body   : JSON.stringify(body)
      });
  
      if (res.ok) {
        createModal.hide();
        showAlert('success', 'New surge created');
        await loadSurges();
      } else {
        showAlert('error', 'Error creating surge');
      }
    });
  
    /* ──────────────────────────────────────────────────────────
     * Delete‑surge workflow
     * ────────────────────────────────────────────────────────── */
    tableBody.addEventListener('click', evt => {
      const icon = evt.target.closest('.delete-surge');
      if (!icon) return;
  
      surgeToDelete = { id: icon.dataset.id, name: icon.dataset.name };
      delSurgeNameEl.textContent = surgeToDelete.name;
      deleteModal.show();
      evt.stopPropagation();
    });
  
    confirmDeleteBtn.addEventListener('click', async () => {
      if (!surgeToDelete) return;
  
      confirmDeleteBtn.disabled = true;
      const res = await fetch(`/api/surge/${surgeToDelete.id}`, { method:'DELETE' });
      confirmDeleteBtn.disabled = false;
  
      if (res.ok) {
        deleteModal.hide();
        showAlert('success', `"${surgeToDelete.name}" deleted`);
        await loadSurges();
      } else {
        deleteModal.hide();
        showAlert('error', 'Delete failed. Please try again.');
      }
    });
  
    /* ──────────────────────────────────────────────────────────
     * Initial render
     * ────────────────────────────────────────────────────────── */
    loadSurges();
  });
  