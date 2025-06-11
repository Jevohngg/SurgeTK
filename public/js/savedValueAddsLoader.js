/* --------------------------------------------------------------------
 *  public/js/savedValueAddsLoader.js    ⟶  COMPLETE REPLACEMENT
 *  Implements:
 *    • Server‑side pagination (10 rows per page, identical nav UI)
 *    • “Notes” column (ellipsed, single‑line)
 * ------------------------------------------------------------------*/
(() => {
  document.addEventListener('DOMContentLoaded', () => {
    /* ---------- Static refs ---------- */
    const householdId =
      window.householdId || document.getElementById('household-id')?.value;

    const tbody        = document.getElementById('savedValueAddsTbody');
    const tblContainer = document.querySelector(
      '.saved-value-adds-table .table-container'
    );
    const emptyState   = document.querySelector('.empty-state.value-adds');
    const pagerWrap    = document.getElementById('savedValueAdds-pagination');
    const pagerInfo    = document.getElementById(
      'savedValueAdds-pagination-info'
    );

    if (!householdId || !tbody || !tblContainer || !emptyState || !pagerWrap || !pagerInfo) {
      console.warn('[SavedVA] Required DOM elements missing.');
      return;
    }

    /* ---------- Metadata ---------- */
    const META = {
      BUCKETS    : { slug: 'buckets',    icon: 'analytics'       },
      GUARDRAILS : { slug: 'guardrails', icon: 'add_road'        },
      BENEFICIARY: { slug: 'beneficiary',icon: 'diversity_1'     },
      NET_WORTH  : { slug: 'net-worth',  icon: 'account_balance' }
    };

    const LIMIT = 10;
    let   page  = 1;
    let   total = 0;

    /* ---------- Helpers ---------- */
    const titleCase = s =>
      s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(/_/g, ' ');

    const shortDate = iso =>
      new Date(iso).toLocaleDateString('en-US', {
        month: 'short',
        day  : 'numeric',
        year : 'numeric'
      });

          /**
           * @param {string|number} label
           * @param {boolean} disabled
           * @param {boolean} active
           * @param {function} handler
           */
          const buildLi = (label, disabled, active, handler) => {
            const li = document.createElement('li');
            li.classList.add('page-item');
            if (disabled) li.classList.add('disabled');
            if (active)   li.classList.add('active');       // ← NEW
      
            const btn = document.createElement('button');
            btn.classList.add('page-link');
            btn.type = 'button';
            btn.textContent = label;
            // Only clickable if not disabled and not already active
            if (!disabled && !active) btn.onclick = handler;
      
            li.appendChild(btn);
            return li;
          };

    const pageWindow = (cur, max, span = 2) => {
      const start = Math.max(1, cur - span);
      const end   = Math.min(max, cur + span);
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    };

    /* ---------- Renderers ---------- */
    const renderRows = rows => {
      tbody.innerHTML = '';
      rows.forEach(r => {
        const m = META[r.type];
        if (!m) return;
    
        const tr = document.createElement('tr');
        tr.dataset.slug       = m.slug;
        tr.dataset.snapshotId = r.snapshotId;
        tr.dataset.valueAddId = r.valueAddId;
    
        tr.innerHTML = `
          <td class="text-center icon-td">
            <span class="material-symbols-outlined">${m.icon}</span>
          </td>
          <td class="value-add-td">${titleCase(r.type)}</td>
          <td class="notes-td">
            <div class="notes-content">${(r.notes||'—').replace(/</g,'&lt;')}</div>
          </td>
          <td class="date-created-td">${shortDate(r.timestamp)}</td>
          <td class="text-center delete-td">
            <span class="material-symbols-outlined snapshot-delete-icon"
                  title="Delete snapshot">delete</span>
          </td>
        `;
        tbody.appendChild(tr);
      });
    };
    

    const renderPager = () => {
      const totalPages = Math.max(1, Math.ceil(total / LIMIT));
      const ul = pagerWrap.querySelector('ul.pagination');
      ul.innerHTML = '';

      ul.appendChild(
        buildLi('Prev', page === 1, false, () => changePage(page - 1))
      );

      pageWindow(page, totalPages).forEach(p =>
        ul.appendChild(
          buildLi(p, false, p === page, () => changePage(p))  // ← pass `p === page`
        )
      );

      ul.appendChild(
        buildLi('Next', page === totalPages, false, () => changePage(page + 1))
      );

      pagerInfo.textContent = `Page ${page} of ${totalPages} (${total} snapshot${total === 1 ? '' : 's'})`;
    };

    /* ---------- Navigation ---------- */
    tbody.addEventListener('click', e => {
      const delIcon = e.target.closest('.snapshot-delete-icon');
      if (delIcon) {
        // --- Delete flow ---
        const tr = delIcon.closest('tr');
        pendingDelete = {
          valueAddId : tr.dataset.valueAddId,
          snapshotId : tr.dataset.snapshotId
        };
        delModal?.show();
        return;
      }
    
      // --- Standard navigation ---
      const tr = e.target.closest('tr');
      if (!tr) return;
      window.location.href =
        `/households/${householdId}/${tr.dataset.slug}?va=${tr.dataset.valueAddId}&snapshot=${tr.dataset.snapshotId}`;
    });
    

    /* ---------- Data ---------- */
    async function fetchPage(p) {
      const res = await fetch(
        `/api/value-add/household/${householdId}/all-snapshots?page=${p}&limit=${LIMIT}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }

    async function load() {
      try {
        const { total: t, snapshots } = await fetchPage(page);
        total = t;

        if (total === 0) {
          tblContainer.classList.add('hidden');
          emptyState.classList.remove('hidden');
          pagerWrap.classList.add('hidden');
          return;
        }

        tblContainer.classList.remove('hidden');
        emptyState.classList.add('hidden');
        pagerWrap.classList.remove('hidden');

        renderRows(snapshots);
        renderPager();
      } catch (err) {
        console.error('[SavedVA] fetch error:', err);
      }
    }

    function changePage(newPage) {
      const totalPages = Math.max(1, Math.ceil(total / LIMIT));
      if (newPage < 1 || newPage > totalPages || newPage === page) return;
      page = newPage;
      load();
      window.scrollTo({ top: tblContainer.offsetTop - 80, behavior: 'smooth' });
    }




  /* ---------- Delete‑modal refs ---------- */
  const delModalEl  = document.getElementById('deleteSnapshotModal');
  const delModal    = delModalEl ? new bootstrap.Modal(delModalEl) : null;
  const confirmDelBtn = document.getElementById('confirmDeleteSnapshot');
  
  /* Snapshot targeted for deletion */
  let pendingDelete = { valueAddId: '', snapshotId: '' };
  
  /* ---------- Show‑alert helper (re‑used in other files) ---------- */
  if (typeof window.showAlert !== 'function') {
    window.showAlert = function (type, message) {
      const alertCtn = document.getElementById('alert-container');
      if (!alertCtn) return;
  
      const alert = document.createElement('div');
      alert.className = `alert alert-${type === 'success' ? 'success' : 'danger'}`;
      alert.textContent = message;
      alertCtn.prepend(alert);
  
      setTimeout(() => alert.remove(), 4000);
    };
  }
  
  
  
  confirmDelBtn?.addEventListener('click', async () => {
    const { valueAddId, snapshotId } = pendingDelete;
    if (!valueAddId || !snapshotId) return;
  
    try {
      const res = await fetch(
        `/api/value-add/${valueAddId}/snapshot/${snapshotId}`,
        { method: 'DELETE' }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || res.statusText);
  
      showAlert('success', 'Snapshot deleted.');
      delModal.hide();
      load();                       // refresh list
    } catch (err) {
      console.error('[SavedVA] delete error:', err);
      showAlert('danger', err.message || 'Delete failed.');
    }
  });





    /* ---------- Init ---------- */
    load();
  });







})();


