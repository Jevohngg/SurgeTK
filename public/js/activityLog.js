(function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const listEl = $('#activityList');            // changed
  const pager = $('#activityPager');

  const inputs = {
    entity: $('#filterEntity'),
    action: $('#filterAction'),
    actor:  $('#filterActor'),
    q:      $('#filterQ'),
    from:   $('#filterFrom'),
    to:     $('#filterTo')
  };

  const applyBtn = $('#wApply');
  const resetBtn = $('#wReset');

  let state = { page: 1, limit: 25, pages: 1 };

  function qs(params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== '') query.set(k, v);
    });
    return query.toString();
  }

  function fmtISO(dt) {
    try { return new Date(dt).toISOString(); } catch { return dt; }
  }

  // "Aug 15 2025 @ 2:23pm"
  function fmtFriendly(dt) {
    try {
      const d = new Date(dt);
      const date = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
      // e.g., "2:23 PM" -> "2:23pm"
      const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                 .replace(' ', '').toLowerCase();
      return `${date} @ ${t}`;
    } catch { return dt; }
  }

  function escapeHTML(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Get a first name from actor
  function firstNameFromActor(actor) {
    if (!actor) return 'System';
    if (actor.firstName) return actor.firstName;
    if (actor.name) {
      const first = String(actor.name).trim().split(/\s+/)[0];
      return first || 'User';
    }
    if (actor.email) {
      const local = String(actor.email).split('@')[0] || 'user';
      const first = local.split(/[._-]/)[0];
      return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'User';
    }
    return 'User';
  }

  function initialsFromActor(actor) {
    const name = actor?.name || actor?.firstName || actor?.email || 'U';
    const parts = String(name).replace(/@.*/, '').split(/[ ._-]+/).filter(Boolean);
    const a = parts[0]?.[0] || 'U';
    const b = parts[1]?.[0] || '';
    return (a + b).toUpperCase();
  }

  function avatarMarkup(actor) {
    const url = actor?.avatarUrl || actor?.avatar || null;
    const alt = `${firstNameFromActor(actor)}'s avatar`;
    if (url) {
      return `<div class="activity-avatar"><img src="${escapeHTML(url)}" alt="${escapeHTML(alt)}" loading="lazy"></div>`;
    }
    return `<div class="activity-avatar" aria-hidden="true">${escapeHTML(initialsFromActor(actor))}</div>`;
  }

  // Humanization helpers
  const HUMAN_ENTITY = {
    CompanyID: 'firm',
    Household: 'household',
    Client: 'client',
    Account: 'account',
    ValueAdd: 'value add snapshot',
    Surge: 'surge',
    SurgeSnapshot: 'surge snapshot',
    HouseholdSnapshot: 'household snapshot',
    ImportReport: 'import',
    Liability: 'liability',
  };

  const ACTION_VERB = {
    create: 'created',
    update: 'updated',
    delete: 'deleted',
    import: 'imported',
    run: 'ran',
    snapshot: 'saved a snapshot for',
    login: 'logged in',
    logout: 'logged out',
  };

  function aOrAn(word) {
    if (!word) return 'a';
    return /^[aeiou]/i.test(word) ? 'an' : 'a';
  }

  function makeSentence(item) {
    const first = firstNameFromActor(item.actor);
    const action = item.action || 'did';
    const type = item.entity?.type || 'Other';
    const display = item.entity?.display || (item.entity?.id ? `${type} #${item.entity.id}` : '');
    const verb = ACTION_VERB[action] || action;

    // Special-case handling for certain combos
    if (type === 'Surge' && action === 'run') {
      // Try to infer "started" / "completed" from notes if present
      const notes = (item.meta?.notes || '').toLowerCase();
      const phase = notes.includes('started') ? 'started' :
                    notes.includes('completed') ? 'completed' : 'ran';
      return `${first} ${phase} a surge${display ? ` — ${display}` : ''}`;
    }

    if (type === 'ImportReport' || action === 'import') {
      // Try to extract the import kind from display, e.g., "Contacts import • file.csv"
      let kind = 'data';
      if (item.entity?.display) {
        const m = String(item.entity.display).match(/^([^•—-]*?)\s*import/i);
        if (m && m[1]) kind = m[1].trim().toLowerCase();
      }
      return `${first} imported ${kind}${display ? ` — ${display}` : ''}`;
    }

    if (action === 'snapshot') {
      // ValueAdd snapshot, etc.
      const noun = HUMAN_ENTITY[type]?.toLowerCase() || type.toLowerCase();
      return `${first} saved a snapshot for ${noun}${display ? ` — ${display}` : ''}`;
    }

    // Generic sentence
    const noun = HUMAN_ENTITY[type]?.toLowerCase() || type.toLowerCase();
    const article = (action === 'update' || action === 'delete') ? 'the' : aOrAn(noun);
    return `${first} ${verb} ${article} ${noun}${display ? ` — ${display}` : ''}`;
  }

  async function load(page = 1) {
    state.page = page;
    const params = {
      page,
      limit: state.limit,
      entityType: inputs.entity.value,
      action: inputs.action.value,
      actorEmail: inputs.actor.value,
      q: inputs.q.value,
      dateFrom: inputs.from.value,
      dateTo: inputs.to.value
    };

    listEl.innerHTML = `<li class="list-group-item text-center py-4">Loading…</li>`;
    pager.innerHTML = '';

    const res = await fetch(`/api/activity?${qs(params)}`, { credentials: 'same-origin' });
    const data = await res.json();

    if (!data.success) {
      listEl.innerHTML = `<li class="list-group-item text-danger">Failed to load.</li>`;
      return;
    }

    renderRows(data.items);
    renderPager(data.page, data.pages);
  }

  function renderRows(items) {
    if (!items || items.length === 0) {
      listEl.innerHTML = `<li class="list-group-item text-center py-4 text-muted">No activity found.</li>`;
      return;
    }

    listEl.innerHTML = items.map(it => {
      const sentence = escapeHTML(makeSentence(it));
      const when = fmtFriendly(it.createdAt);
      const iso = fmtISO(it.createdAt);
      const avatar = avatarMarkup(it.actor);

      // NOTE: "View" button is to the left of the timestamp so the timestamp remains far-right
      return `
        <li class="list-group-item activity-item" data-id="${it._id}">
          ${avatar}
          <div class="activity-main">
            <div class="activity-text">${sentence}</div>
          </div>
          <div class="activity-actions">
            <button class="btn btn-sm btn-outline-primary btn-view" data-id="${it._id}">
              View
            </button>
            <time class="activity-when" datetime="${iso}" title="${escapeHTML(new Date(it.createdAt).toString())}">
              ${when}
            </time>
          </div>
        </li>
      `;
    }).join('');

    // wire up view buttons
    $$('#activityList .btn-view').forEach(btn => {
      btn.addEventListener('click', () => openDetail(btn.dataset.id));
    });
  }

  function renderPager(page, pages) {
    state.pages = pages;
    if (pages <= 1) { pager.innerHTML = ''; return; }

    let html = `
      <li class="page-item ${page === 1 ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${page - 1}">Prev</a>
      </li>`;
    const max = 7;
    const start = Math.max(1, page - 3);
    const end = Math.min(pages, start + max - 1);
    for (let p = start; p <= end; p++) {
      html += `<li class="page-item ${p === page ? 'active' : ''}">
        <a class="page-link" href="#" data-page="${p}">${p}</a>
      </li>`;
    }
    html += `
      <li class="page-item ${page === pages ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${page + 1}">Next</a>
      </li>`;
    pager.innerHTML = html;

    $$('#activityPager a.page-link').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const p = Number(a.dataset.page);
        if (!isNaN(p)) load(p);
      });
    });
  }

  async function openDetail(id) {
    const res = await fetch(`/api/activity/${id}`, { credentials: 'same-origin' });
    const data = await res.json();
    if (!data.success) return;

    const it = data.item;
    $('#dlgWhen').textContent = new Date(it.createdAt).toLocaleString();
    $('#dlgActor').textContent = it.actor?.email || it.actor?.name || 'System';
    $('#dlgAction').textContent = it.action;
    $('#dlgEntity').textContent = `${it.entity?.type || 'Other'} ${it.entity?.display ? `— ${it.entity.display}` : ''}`;
    $('#dlgNotes').textContent = it.meta?.notes || '';

    const diff = it.changes?.diff ?? {};
    const meta = it.meta ?? {};
    $('#dlgDiff').textContent = Object.keys(diff).length ? JSON.stringify(diff, null, 2) : '(no changes)';
    $('#dlgMeta').textContent = JSON.stringify(meta, null, 2);

    const modal = new bootstrap.Modal(document.getElementById('activityDetailModal'));
    modal.show();
  }

  // Event handlers
  applyBtn.addEventListener('click', () => load(1));
  resetBtn.addEventListener('click', () => {
    inputs.entity.value = '';
    inputs.action.value = '';
    inputs.actor.value = '';
    inputs.q.value = '';
    inputs.from.value = '';
    inputs.to.value = '';
    load(1);
  });

  // Basic typing debounce for search
  let debounceTimer;
  inputs.q.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => load(1), 450);
  });

  // Initial load
  document.addEventListener('DOMContentLoaded', () => load(1));
})();
