document.addEventListener('DOMContentLoaded', async () => {
  const advisorDropdownButton = document.getElementById('advisorFilterBtn');
  const advisorDropdownMenu = document.getElementById('advisorFilterDropdown');
  const selectedAdvisorsInput = document.getElementById('selectedAdvisorsInput');


  advisorDropdownButton.innerHTML = `
    <span class="material-symbols-outlined dropdown-icon">unfold_more</span>
    <span id="advisor-filter-text">Select Advisors...</span>
  `;
  const advisorFilterTextSpan = document.getElementById('advisor-filter-text');

  // State variables
  let advisorsMap = new Map();         // itemId -> itemName
  let allSelectableIds = [];           // everything except "all"
  let selectedAdvisorIds = new Set();  // all currently selected IDs
  let checkboxMap = {};               // { itemId: <input type="checkbox"> }

  const LOCAL_STORAGE_KEY = 'selectedAdvisors';

  /**************************************************************
   * LOCALSTORAGE: Save/Load
   **************************************************************/
  function saveSelectedAdvisors() {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(Array.from(selectedAdvisorIds)));
  }

  function loadSelectedAdvisors() {
    const savedAdvisors = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedAdvisors) {
      selectedAdvisorIds = new Set(JSON.parse(savedAdvisors));
    }
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

    // If the user checks 'all', select/deselect everything
    if (itemId === 'all') {
      if (isChecked) {
        selectAllAdvisors();
      } else {
        deselectAllAdvisors();
      }
      checkIfUserSelectedEverything();
      updateGlobalAdvisorSelectionDisplay();
      saveSelectedAdvisors();

      // RELOAD the page
      window.location.reload();
      return;
    }

    // If not "all", check if user now has everything => auto-check 'all'
    checkIfUserSelectedEverything();
    updateGlobalAdvisorSelectionDisplay();
    saveSelectedAdvisors();

    // RELOAD the page after any normal change
    window.location.reload();
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

      updateGlobalAdvisorSelectionDisplay();

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
      }
    }
  });

  // Load existing selection from Local Storage
  loadSelectedAdvisors();
  // Populate the dropdown
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
