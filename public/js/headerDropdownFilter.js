document.addEventListener('DOMContentLoaded', async () => { 
  // ------- Firm ID resolution (try DOM -> globals -> API) ------- 
  async function resolveFirmId() { 
    // 1) <div id="team" data-firm-id="..."> (same pattern you use elsewhere) 
    const teamEl = document.getElementById('team'); 
    if (teamEl?.dataset?.firmId) return teamEl.dataset.firmId;

    // 2) <body data-firm-id="..."> 
    const bodyFirm = document.body?.dataset?.firmId; 
    if (bodyFirm) return bodyFirm;

    // 3) <meta name="x-firm-id" content="..."> 
    const meta = document.querySelector('meta[name="x-firm-id"]'); 
    if (meta?.content) return meta.content;

    // 4) window global (if you set one server-side) 
    if (window.CURRENT_FIRM_ID) return window.CURRENT_FIRM_ID;

    // 5) Fallback: ask the session API 
    try { 
      const resp = await fetch('/api/session/me', { credentials: 'include' }); 
      if (resp.ok) { 
        const j = await resp.json(); 
        if (j?.firmId) return j.firmId; 
      } 
    } catch (_) {} 

    return 'unknown'; 
  } 

  const firmId = await resolveFirmId(); 

  const advisorDropdownButton = document.getElementById('advisorFilterBtn'); 
  const advisorDropdownMenu = document.getElementById('advisorFilterDropdown'); 
  const selectedAdvisorsInput = document.getElementById('selectedAdvisorsInput');

  advisorDropdownButton.innerHTML = 
    `<span class="material-symbols-outlined dropdown-icon">unfold_more</span> 
     <span id="advisor-filter-text">Select Advisors...</span>`; 

  const advisorFilterTextSpan = document.getElementById('advisor-filter-text');

  // State variables 
  let advisorsMap = new Map(); // itemId -> itemName 
  let allSelectableIds = [];   // everything except "all" 
  let selectedAdvisorIds = new Set(); // all currently selected IDs 
  let checkboxMap = {};        // { itemId: <input type="checkbox"> } 

  // Firm-scoped key so selections don't leak across firms 
  const STORAGE_PREFIX = 'selectedAdvisors:'; 
  const STORAGE_KEY = `${STORAGE_PREFIX}${firmId}`;



  // One-time migration: nuke the old global key if it exists 
  const OLD_KEY = 'selectedAdvisors'; 
  if (localStorage.getItem(OLD_KEY)) localStorage.removeItem(OLD_KEY);

// after STORAGE_KEY is defined
const LEGACY_KEY = 'selectedAdvisors';

function saveSelectedAdvisors() {
  const arr = Array.from(selectedAdvisorIds);
  const json = JSON.stringify(arr);
  localStorage.setItem(STORAGE_KEY, json);
  // back-compat for other scripts (households loader) still reading old key
  localStorage.setItem(LEGACY_KEY, json);
}


  function loadSelectedAdvisors() { 
    const raw = localStorage.getItem(STORAGE_KEY); 
    if (!raw) { selectedAdvisorIds = new Set(); return; } 
    try { selectedAdvisorIds = new Set(JSON.parse(raw)); } 
    catch { selectedAdvisorIds = new Set(); } 
  }

  function getStoredSelectionCsv() {
    try {
      const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(arr)) return '';
      // treat 'all' or empty as “no filter param”
      if (arr.length === 0 || (arr.length === 1 && arr[0] === 'all')) return '';
      return arr.join(',');
    } catch {
      return '';
    }
  }
  
  // Add or remove selectedAdvisors in a URL string based on storage
  function upsertSelectedAdvisorsParam(urlString) {
    const url = new URL(urlString, window.location.origin);
    const sel = getStoredSelectionCsv();
  
    if (sel) url.searchParams.set('selectedAdvisors', sel);
    else     url.searchParams.delete('selectedAdvisors');
  
    return url.pathname + (url.search ? `?${url.searchParams.toString()}` : '');
  }
  
  // On initial load, if URL missing param but storage has it, add it (no reload)
  function ensureUrlHasSelectedAdvisorsFromStorage() {
    const params = new URLSearchParams(window.location.search);
    const hasParam = params.has('selectedAdvisors');
    const sel = getStoredSelectionCsv();
  
    if (!hasParam && sel) {
      params.set('selectedAdvisors', sel);
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      history.replaceState(null, '', newUrl); // no reload; keeps back/forward sane
    } else if (hasParam && !sel) {
      // storage says “no filter” but URL has one; optional: strip it
      // params.delete('selectedAdvisors');
      // history.replaceState(null, '', params.toString() ? `${location.pathname}?${params}` : location.pathname);
    }
  }
  


  function syncCheckboxesFromSelection() { 
    Object.keys(checkboxMap).forEach(id => { 
      checkboxMap[id].checked = selectedAdvisorIds.has(id); 
    }); 
  }

  /** 
   * Ensure stored selection is valid for THIS firm. 
   * If any stored ID isn't present, reset to empty ("Select Advisors..."). 
   * Also normalizes the 'all' toggle. 
   */ 
  function validateSelectionAgainstCurrentFirm() { 
    // Allowed = everything we rendered (including static items) 
    const allowed = new Set([...advisorsMap.keys()]); // e.g., 'unassigned', 'all', and advisor _ids 

    // If any stored id is not in allowed, reset to empty 
    const hasInvalid = Array.from(selectedAdvisorIds).some(id => !allowed.has(id)); 
    if (hasInvalid) { 
      selectedAdvisorIds.clear(); 
      saveSelectedAdvisors(); 
      updateGlobalAdvisorSelectionDisplay(); 
      syncCheckboxesFromSelection(); 
      return; 
    } 

    // Keep 'all' honest: only keep it if literally everything else is selected 
    if (selectedAdvisorIds.has('all')) { 
      const everythingButAll = [...allowed].filter(k => k !== 'all'); 
      const allSelected = everythingButAll.every(k => selectedAdvisorIds.has(k)); 
      if (!allSelected) { 
        selectedAdvisorIds.delete('all'); 
        saveSelectedAdvisors(); 
      } 
    } 

    updateGlobalAdvisorSelectionDisplay(); 
    syncCheckboxesFromSelection(); 
  } 

  let isDirty = false; 

  function applyAdvisorSelectionAndReload() {
    // Persist selection in localStorage for UI
    saveSelectedAdvisors();
  
    // Build a querystring for the server to filter with
    const selected = Array.from(selectedAdvisorIds);
  
    // Normalize 'all' -> no param (show everything)
    const onlyAll = selected.length === 1 && selected[0] === 'all';
    const emptyOrAll = selected.length === 0 || onlyAll;
  
    const params = new URLSearchParams(window.location.search);
  
    if (emptyOrAll) {
      // No filter param -> server should show all
      params.delete('selectedAdvisors');
    } else {
      // Send comma-separated IDs (e.g., "unassigned,abc123,def456")
      params.set('selectedAdvisors', selected.join(','));
    }
  
    // Navigate with the updated querystring so the server can filter
    const newUrl =
      params.toString().length > 0
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname;
  
    window.location.assign(newUrl);
  }
  


  /** 
   * Provide a helper that returns the "globally" selected advisors as an array 
   */ 
  function getGlobalSelectedAdvisors() { 
    return Array.from(selectedAdvisorIds); 
  }

  /** 
   * handleCheck - Called whenever a checkbox is changed 
   * We reload the page after saving changes so the new filter is applied. 
   */ 
  function handleCheck(itemId, isChecked) { 
    if (isChecked) { 
      selectedAdvisorIds.add(itemId); 
    } else { 
      selectedAdvisorIds.delete(itemId); 
    } 

    // If the user checks 'all', select/deselect everything immediately 
    if (itemId === 'all') { 
      if (isChecked) { 
        selectAllAdvisors(); 
      } else { 
        deselectAllAdvisors(); 
      } 
      checkIfUserSelectedEverything(); 
      updateGlobalAdvisorSelectionDisplay(); 
      saveSelectedAdvisors(); 
      // Mark dirty, but DO NOT reload yet 
      isDirty = true; 
      return; 
    } 

    // For normal items, keep 'all' synced 
    checkIfUserSelectedEverything(); 
    updateGlobalAdvisorSelectionDisplay(); 
    saveSelectedAdvisors(); 

    // Mark that we have unapplied changes 
    isDirty = true; 
  } 

  function selectAllAdvisors() { 
    advisorsMap.forEach((_name, key) => { 
      selectedAdvisorIds.add(key); 
    }); 
    Object.keys(checkboxMap).forEach((id) => { 
      checkboxMap[id].checked = true; 
    }); 
  }

  function deselectAllAdvisors() { 
    selectedAdvisorIds.clear(); 
    Object.keys(checkboxMap).forEach((id) => { 
      checkboxMap[id].checked = false; 
    }); 
  }

  function checkIfUserSelectedEverything() { 
    const everythingButAll = [...advisorsMap.keys()].filter(k => k !== 'all'); 
    const hasAll = everythingButAll.every(k => selectedAdvisorIds.has(k)); 
    if (hasAll) { 
      selectedAdvisorIds.add('all'); 
      if (checkboxMap['all']) { 
        checkboxMap['all'].checked = true; 
      } 
    } else { 
      selectedAdvisorIds.delete('all'); 
      if (checkboxMap['all']) { 
        checkboxMap['all'].checked = false; 
      } 
    } 
  }

  function createAdvisorListItem(itemId, itemName) { 
    const li = document.createElement('li'); 
    li.classList.add('dropdown-item'); 

    const label = document.createElement('label'); 
    label.classList.add('d-flex', 'align-items-center'); 

    const checkbox = document.createElement('input'); 
    checkbox.type = 'checkbox'; 
    checkbox.classList.add('form-check-input', 'me-2'); 
    checkbox.value = itemId; 

    const span = document.createElement('span'); 
    span.textContent = itemName; 

    if (selectedAdvisorIds.has(String(itemId))) { 
      checkbox.checked = true; 
    } 
    checkbox.addEventListener('change', () => handleCheck(itemId, checkbox.checked)); 

    checkboxMap[itemId] = checkbox; 
    label.appendChild(checkbox); 
    label.appendChild(span); 
    li.appendChild(label); 
    return li; 
  } 

  async function populateGlobalAdvisorDropdown() { 
    advisorDropdownMenu.innerHTML = '<li class="dropdown-header">Loading advisors...</li>'; 

    try { 
      const response = await fetch('/api/households/api/leadAdvisors', { credentials: 'include' }); 
      if (!response.ok) throw new Error('Failed to fetch leadAdvisors'); 

      const data = await response.json(); 
      const leadAdvisors = data.leadAdvisors || []; 
      advisorDropdownMenu.innerHTML = ''; 
      checkboxMap = {}; 
      allSelectableIds = []; 

      const staticItems = [ 
        { _id: 'unassigned', name: 'Unassigned' }, 
        { _id: 'all', name: 'All' }, 
      ]; 
      staticItems.forEach(item => { 
        advisorsMap.set(item._id, item.name); 
        const liElement = createAdvisorListItem(item._id, item.name); 
        advisorDropdownMenu.appendChild(liElement); 
      }); 

      leadAdvisors.forEach(leadAdvisor => { 
        advisorsMap.set(leadAdvisor._id, leadAdvisor.name); 
        const liElement = createAdvisorListItem(leadAdvisor._id, leadAdvisor.name); 
        advisorDropdownMenu.appendChild(liElement); 
      }); 

      allSelectableIds = [...advisorsMap.keys()].filter(id => id !== 'all'); 

      // Validate firm-scoped selection; reset to empty if stale/invalid 
      validateSelectionAgainstCurrentFirm(); 

    } catch (err) { 
      console.error('Error fetching leadAdvisors:', err); 
      advisorDropdownMenu.innerHTML = '<li class="dropdown-item text-danger">Error loading leadAdvisors</li>'; 
    } 
  } 

  function updateGlobalAdvisorSelectionDisplay() { 
    if (selectedAdvisorIds.has('all')) { 
      advisorFilterTextSpan.textContent = 'All'; 
      if (selectedAdvisorsInput) selectedAdvisorsInput.value = 'all'; 
      return; 
    } 
    if (selectedAdvisorIds.size === 0) { 
      advisorFilterTextSpan.textContent = 'Select Advisors...'; 
      if (selectedAdvisorsInput) selectedAdvisorsInput.value = ''; 
      return; 
    } 
    const selectedNames = Array.from(selectedAdvisorIds).map(id => advisorsMap.get(id)); 
    advisorFilterTextSpan.textContent = selectedNames.join(', '); 
    if (selectedAdvisorsInput) { 
      selectedAdvisorsInput.value = Array.from(selectedAdvisorIds).join(','); 
    } 
  } 

  function showDropdown() { 
    advisorDropdownMenu.classList.remove('fade-out'); 
    advisorDropdownMenu.style.display = 'block'; 
    requestAnimationFrame(() => { 
      advisorDropdownMenu.classList.add('show'); 
    }); 
  } 

  function hideDropdown() { 
    advisorDropdownMenu.classList.remove('show'); 
    advisorDropdownMenu.classList.add('fade-out'); 
    advisorDropdownMenu.addEventListener('transitionend', function handleTransitionEnd() { 
      advisorDropdownMenu.removeEventListener('transitionend', handleTransitionEnd); 
      advisorDropdownMenu.classList.remove('fade-out'); 
      advisorDropdownMenu.style.display = 'none'; 
    }, { once: true }); 
  } 

  function toggleDropdown() { 
    if (advisorDropdownMenu.classList.contains('show')) { 
      hideDropdown(); 
    } else { 
      showDropdown(); 
    } 
  } 

  advisorDropdownButton.addEventListener('click', (e) => { 
    e.stopPropagation(); 
    toggleDropdown(); 
  }); 

  document.addEventListener('click', (e) => { 
    if (!advisorDropdownMenu.contains(e.target) && !advisorDropdownButton.contains(e.target)) { 
      if (advisorDropdownMenu.classList.contains('show')) { 
        hideDropdown(); 
        // If the user changed anything while it was open, apply on close 
        if (isDirty) { 
          // Give the hide animation a tick to finish 
          setTimeout(() => { 
            applyAdvisorSelectionAndReload(); 
          }, 0); 
        } 
        // Reset dirty for next open 
        isDirty = false; 
      } 
    } 
  }); 

  // Propagate selectedAdvisors to internal links so the filter persists across pages
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;

  // Only same-origin navigations; allow opt-out with attribute
  const sameOrigin = a.origin === window.location.origin;
  const skip = a.hasAttribute('data-skip-advisor-propagation') || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
  if (!sameOrigin || skip) return;

  a.href = upsertSelectedAdvisorsParam(a.href);
});


  // Load existing selection from Local Storage 

  loadSelectedAdvisors(); 
  ensureUrlHasSelectedAdvisorsFromStorage();

  // Populate the dropdown 
  function hydrateSelectionFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const qs = (params.get('selectedAdvisors') || '').trim();
  
    selectedAdvisorIds.clear();
    if (!qs) {
      // no param = nothing selected (or “All” depending on your UX)
      return;
    }
    qs.split(',').map(s => s.trim()).filter(Boolean).forEach(id => selectedAdvisorIds.add(id));
    saveSelectedAdvisors();
  }
  
  // Call this BEFORE populateGlobalAdvisorDropdown()
  hydrateSelectionFromQuery();
  

  await populateGlobalAdvisorDropdown(); 

  // If you still want to call fetchBannerStats on page load: 
  async function fetchBannerStats() { 
    try { 
      const selectedAdvisors = getGlobalSelectedAdvisors(); 
      const advisorsParam = selectedAdvisors.join(','); 

      const url = `/api/households/banner-stats?selectedAdvisors=${encodeURIComponent(advisorsParam)}`; 
      const response = await fetch(url, { credentials: 'include' }); 
      if (!response.ok) throw new Error('Failed to fetch banner stats'); 

      const data = await response.json(); 
      // data => { totalHouseholds, totalAccounts, totalValue } 

      // Insert total households 
      const householdsEl = document.getElementById('total-households-number'); 
      if (householdsEl) { 
        householdsEl.textContent = data.totalHouseholds.toString(); 
      } 

      // Insert total accounts 
      const accountsEl = document.getElementById('total-accounts-number'); 
      if (accountsEl) { 
        accountsEl.textContent = data.totalAccounts.toString(); 
      } 

      // Insert total value (without cents) 
      const valueEl = document.getElementById('total-value-amount'); 
      if (valueEl) { 
        const roundedValue = Math.round(data.totalValue || 0); 
        const formatted = new Intl.NumberFormat('en-US', { 
          style: 'currency', 
          currency: 'USD', 
          minimumFractionDigits: 0, 
          maximumFractionDigits: 0 
        }).format(roundedValue); 
        valueEl.textContent = formatted; 
      } 
    } catch (err) { 
      console.error('Error fetching banner stats:', err); 
    } 
  } 

  fetchBannerStats(); 
});

