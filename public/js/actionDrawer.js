/* actionDrawer.js (hardened)
 * Requires Bootstrap 5 (offcanvas)
 */

(function () {
    'use strict';
  
    const THRESHOLD = 1300;
    const DRAWER_CLASS = 'value-add-actions-drawer';
    const SETTINGS_BTN_CLASS = 'va-settings-trigger';
    const PLACEHOLDER_CLASS = 'va-actions-placeholder';
  
    // Per-container state
    const state = new WeakMap();
    let fallbackCounter = 0;
  
    const debounce = (fn, wait = 150) => {
      let t;
      return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
    };
  
    const slugify = (str) =>
      (str || '').toString().trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
  
    // === Robust section title (global-first, then local, then fallback) ===
    const getSectionTitle = () => {
      const global = document.querySelector('.value-adds-title .value-add-title');
      if (global && global.textContent.trim()) return global.textContent.trim();
      // Try any visible value-add title as backup
      const any = Array.from(document.querySelectorAll('.value-add-title'))
        .find(el => el.offsetParent !== null && el.textContent.trim());
      if (any) return any.textContent.trim();
      return ''; // let caller decide fallback
    };
  
    const getOrInitContainerState = (containerEl) => {
      if (state.has(containerEl)) return state.get(containerEl);
  
      const title = getSectionTitle();
      const baseSlug = slugify(title) || `actions-${++fallbackCounter}`;
      const drawerId = `vaDrawer-${baseSlug}`;
  
      // Create placeholder for restore position
      const placeholder = document.createElement('div');
      placeholder.className = PLACEHOLDER_CLASS;
      placeholder.style.display = 'none';
      containerEl.insertAdjacentElement('beforebegin', placeholder);
  
      const s = { drawerId, title: title || 'Actions', placeholder, wired: false };
      state.set(containerEl, s);
      return s;
    };
  
// Replace your ensureDrawer with this:
const ensureDrawer = (containerEl) => {
    const s = getOrInitContainerState(containerEl);
    let drawer = document.getElementById(s.drawerId);
    if (drawer) return drawer;
  
    drawer = document.createElement('div');
    // add rt-drawer class so your CSS applies
    drawer.className = `offcanvas offcanvas-end value-add-actions-drawer rt-drawer`;
    drawer.id = s.drawerId;
    drawer.tabIndex = -1;
    drawer.setAttribute('aria-labelledby', `${s.drawerId}-label`);
  
    drawer.innerHTML = `
      <div class="offcanvas-header rt-drawer__header">
        <h5 class="offcanvas-title rt-drawer__title" id="${s.drawerId}-label">${s.title} Actions</h5>
        <button type="button" class="rt-drawer__close btn p-0" data-bs-dismiss="offcanvas" aria-label="Close">
  <span class="material-symbols-outlined" style="font-size:22px;line-height:1;color:#fff;">close</span>
</button>

      </div>
      <div class="offcanvas-body rt-drawer__body d-flex flex-wrap gap-2 align-items-start"></div>
    `;
  
    document.body.appendChild(drawer);
    return drawer;
  };
  
  
  const ensureSettingsButton = (containerEl) => {
    const s = getOrInitContainerState(containerEl);
  
    // Header & switcher
    const headerRow = document.querySelector('.d-flex.align-items-center.header-space-between');
    const titleWrap = document.querySelector('.value-adds-title.dropdown');
    if (!headerRow || !titleWrap) return null;
  
    // Make sure the switcher (and anything after it) hugs the right
    if (!titleWrap.classList.contains('ms-auto')) {
      titleWrap.classList.add('ms-auto');
    }
  
    // Re-use if already present
    const existing = headerRow.querySelector(`.${SETTINGS_BTN_CLASS}[data-target-id="${s.drawerId}"]`);
    if (existing) {
      // Ensure it's placed immediately after the dropdown
      if (existing.previousElementSibling !== titleWrap) {
        titleWrap.insertAdjacentElement('afterend', existing);
      }
      return existing;
    }
  
    // Create button and place it AFTER the dropdown
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${SETTINGS_BTN_CLASS} btn btn-light btn-sm ms-2 d-inline-flex align-items-center`;
    btn.setAttribute('aria-label', 'Open actions');
    btn.setAttribute('data-bs-toggle', 'offcanvas');
    btn.setAttribute('data-bs-target', `#${s.drawerId}`);
    btn.setAttribute('data-target-id', s.drawerId);
    btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px;line-height:1;">tune</span>`;
  
    titleWrap.insertAdjacentElement('afterend', btn);
    return btn;
  };
  
  
    const moveIntoDrawer = (containerEl) => {
      const drawer = ensureDrawer(containerEl);
      const body = drawer.querySelector('.offcanvas-body');
      if (!body) return;
      if (containerEl.parentNode !== body) body.appendChild(containerEl);
    };
  
    const restoreFromDrawer = (containerEl) => {
      const { placeholder } = getOrInitContainerState(containerEl);
      if (placeholder && placeholder.parentNode && containerEl.previousElementSibling !== placeholder) {
        placeholder.insertAdjacentElement('afterend', containerEl);
      }
    };
  
    const wireDrawerEvents = (containerEl) => {
      const s = getOrInitContainerState(containerEl);
      if (s.wired) return;
      s.wired = true;
  
      const drawer = ensureDrawer(containerEl);
  
      // On open: ensure the correct content is inside (in case of race)
      drawer.addEventListener('show.bs.offcanvas', () => {
        moveIntoDrawer(containerEl);
      });
  
      // On close: if wide, restore inline
      drawer.addEventListener('hidden.bs.offcanvas', () => {
        if (window.innerWidth > THRESHOLD) restoreFromDrawer(containerEl);
      });
    };
  
    const applyLayout = () => {
      const narrow = window.innerWidth <= THRESHOLD;
      const containers = document.querySelectorAll('.value-add-action-buttons');
  
      containers.forEach((containerEl) => {
        if (!containerEl || !containerEl.isConnected) return;
  
        getOrInitContainerState(containerEl);  // initializes unique id/title + placeholder
        ensureDrawer(containerEl);
        ensureSettingsButton(containerEl);
        wireDrawerEvents(containerEl);
  
        if (narrow) moveIntoDrawer(containerEl);
        else restoreFromDrawer(containerEl);
      });
    };
  
    document.addEventListener('DOMContentLoaded', () => {
      if (!document.querySelector('.value-add-action-buttons')) return;
  
      applyLayout();
      window.addEventListener('resize', debounce(applyLayout, 150));
  
      // If your app hot-swaps DOM, keep it in sync
      const mo = new MutationObserver(debounce(applyLayout, 120));
      mo.observe(document.body, { childList: true, subtree: true });
    });
  })();
  