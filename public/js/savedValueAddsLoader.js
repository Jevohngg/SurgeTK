// public/js/savedValueAddsLoader.js
(() => {
    document.addEventListener('DOMContentLoaded', async () => {
      console.log('savedValueAddsLoader.js loaded');
  
      // 1) Grab the DOM elements
      const tbody          = document.getElementById('savedValueAddsTbody');
      const tableContainer = document.querySelector('.saved-value-adds-table .table-container');
      const emptyState     = document.querySelector('.empty-state.value-adds');
      const householdId    = window.householdId || document.getElementById('household-id')?.value;
  
      if (!tbody || !tableContainer || !emptyState) {
        console.warn('[SavedVA] Required DOM elements not found.');
        return;
      }
      if (!householdId) {
        console.warn('[SavedVA] householdId not found.');
        return;
      }
  
      // 2) Map each ValueAdd type to its route slug and icon
      const meta = {
        BUCKETS:     { slug: 'buckets',     icon: 'analytics'       },
        GUARDRAILS:  { slug: 'guardrails',  icon: 'add_road'        },
        BENEFICIARY: { slug: 'beneficiary', icon: 'diversity_1'     },
        NET_WORTH:   { slug: 'net-worth',   icon: 'account_balance' }
      };
  
      // 3) Helper to title-case strings
      function titleCase(str) {
        return str
          .toLowerCase()
          .replace(/\b\w/g, c => c.toUpperCase());
      }
  
      // 4) Helper to format dates like "Jan 1 2025"
      function formatDateFriendly(value) {
        const d = new Date(value);
        if (isNaN(d)) return '—';
        return d.toLocaleDateString('en-US', {
          month: 'short',
          day:   'numeric',
          year:  'numeric'
        });
      }
  
      try {
        // 5) Fetch all snapshots for this household
        const res = await fetch(`/api/value-add/household/${householdId}/all-snapshots`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const list = await res.json();
        console.log('[SavedVA] fetched', list.length, 'snapshots', list);
  
        // 6) Clear any existing rows
        tbody.innerHTML = '';
  
        // 7) Show empty state if no snapshots
        if (list.length === 0) {
          tableContainer.classList.add('hidden');
          emptyState.classList.remove('hidden');
          return;
        }
        tableContainer.classList.remove('hidden');
        emptyState.classList.add('hidden');
  
        // 8) Sort snapshots newest → oldest
        list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
        // 9) Populate the table
        list.forEach(item => {
          const m = meta[(item.type || '').toUpperCase()];
          if (!m) return;  // Skip unknown types
  
          const tr = document.createElement('tr');
          tr.dataset.slug       = m.slug;
          tr.dataset.snapshotId = item.snapshotId;
  
          tr.innerHTML = `
            <td class="text-center icon-td">
              <span class="material-symbols-outlined">${m.icon}</span>
            </td>
            <td class="value-add-td">${titleCase(item.type.replace(/_/g, ' '))}</td>
            <td class="date-created-td">${formatDateFriendly(item.timestamp)}</td>
          `;
          tbody.appendChild(tr);
        });
  
        // 10) Navigate when a row is clicked
        tbody.addEventListener('click', e => {
          const tr = e.target.closest('tr');
          if (!tr) return;
          const slug = tr.dataset.slug;
          const snap = tr.dataset.snapshotId;
          window.location.href = `/households/${householdId}/${slug}?snapshot=${snap}`;
        });
  
      } catch (err) {
        console.error('[SavedVA] error fetching snapshots:', err);
      }
    });
  })();
  