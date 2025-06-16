// public/js/households.js
// import ProgressManager from './progressManager.js';

document.addEventListener('DOMContentLoaded', () => {
    

 

    // References to DOM elements
    const householdsTableBody = document.getElementById('households-table')?.querySelector('tbody');
    const searchInput = document.getElementById('search-households');
    const addHouseholdModalElement = document.getElementById('addHouseholdModal');
    const addHouseholdModal = new bootstrap.Modal(addHouseholdModalElement);
    const addHouseholdForm = document.getElementById('add-household-form');
    const selectAllCheckbox = document.getElementById('select-all');
    const paginationContainer = document.querySelector('.pagination');
    const paginationInfo = document.getElementById('pagination-info');
    const addSingleHousehold = document.getElementById('add-single-household');
    const importHouseholds = document.getElementById('import-households');
    const fileUploadInput = document.getElementById('fileUpload');
    const uploadHouseholdsForm = document.getElementById('upload-households-form');
    const importHouseholdsModalElement = document.getElementById('importHouseholdsModal');
    const importHouseholdsModal = new bootstrap.Modal(importHouseholdsModalElement);
    const importModal = document.getElementById('universal-import-modal');
    if (!importModal) return;

    const mappingModalElement = document.getElementById('mappingModal');
    const mappingModal = mappingModalElement ? new bootstrap.Modal(mappingModalElement) : null;
    const removeFileButton = document.getElementById('removeFileButton');
    const submitUploadButton = document.getElementById('submitUploadButton');
    const selectionContainer = document.querySelector('.selection-container');
    const selectionCount = document.getElementById('selection-count');
    const selectAllRecordsLink = document.getElementById('select-all-records');
    const clearSelectionLink = document.getElementById('clear-selection');
    const deleteSelectedButton = document.getElementById('delete-selected');
    const deleteConfirmationModal = new bootstrap.Modal(document.getElementById('deleteConfirmationModal'));
    const confirmDeleteButton = document.getElementById('confirm-delete');

    let uploadStartTime = null;

    let s3Key = '';

    // State Management Variables
    let uploadState = 'idle'; // Possible states: 'idle', 'uploading', 'completed'
    let headers = []; // Define headers globally
    let uploadedData = []; // Global variable to store uploaded data
    let uploadedFileName = ''; // Store the uploaded file name

    // Initialize Socket.io
    const socket = io();

    const progressManager = new ProgressManager(socket);
    let isTransitioning = false; // Flag to prevent rapid toggles
    let selectedHouseholds = new Set(); // Store selected household IDs
    let selectAllAcrossPages = false; // Flag indicating all records are selected across pages
    let totalHouseholdsCount = 0; // Total number of households, to be updated from API response

  /**
 * Function to show the selection container with opacity and margin-bottom transitions.
 */
  function showSelectionContainer() {
    if (isTransitioning) return;
    isTransitioning = true;

    
    selectionContainer.classList.add('visible');
    

    selectionContainer.setAttribute('aria-hidden', 'false');

    // Listen for transition end to reset the flag
    const handleTransitionEnd = (event) => {
        if (event.propertyName === 'opacity' || event.propertyName === 'margin-bottom') {
            isTransitioning = false;
            selectionContainer.removeEventListener('transitionend', handleTransitionEnd);
        }
    };

    selectionContainer.addEventListener('transitionend', handleTransitionEnd);
}



const addHouseholdButton = document.getElementById('empty-add-household-button');
addHouseholdButton.addEventListener('click', (e) => {
    document.getElementById('add-household-form')?.reset();
    addHouseholdModal.show();

});

const uploadHouseholdButton = document.getElementById('empty-upload-household-button');
uploadHouseholdButton.addEventListener('click', (e) => {
    document.getElementById('upload-household-form')?.reset();
    const universalImportModal = new bootstrap.Modal(importModal);
universalImportModal.show();


});



/**
 * Function to hide the selection container with opacity and margin-bottom transitions.
 */
function hideSelectionContainer() {
    if (isTransitioning) return;
    isTransitioning = true;

   
    selectionContainer.classList.remove('visible');


    selectionContainer.setAttribute('aria-hidden', 'true');

    // Listen for transition end to reset the flag
    const handleTransitionEnd = (event) => {
        if (event.propertyName === 'opacity' || event.propertyName === 'margin-bottom') {
            isTransitioning = false;
            selectionContainer.removeEventListener('transitionend', handleTransitionEnd);
        }
    };

    selectionContainer.addEventListener('transitionend', handleTransitionEnd);
}

/**
 * Function to update the selection container visibility and text.
 */
function updateSelectionContainer() {
    const currentPageSelectedCount = getCurrentPageSelectedCount();
    const currentPageTotalCount = householdsTableBody.querySelectorAll('tr').length;
    const totalSelectedCount = selectAllAcrossPages ? totalHouseholdsCount : selectedHouseholds.size;

    // Determine if there are additional records beyond the current page
    const hasAdditionalPages = totalHouseholdsCount > currentPageTotalCount;

    if (currentPageSelectedCount > 0 || selectAllAcrossPages) {
        // If not already visible, show the container
        if (!selectionContainer.classList.contains('visible')) {
            showSelectionContainer();
        }

        if (selectAllAcrossPages) {
            // All records across all pages are selected
            selectionCount.textContent = `All ${totalHouseholdsCount} records from all pages have been selected.`;

            // Show or hide the "Select All Records" link based on additional records
            if (hasAdditionalPages) {
                selectAllRecordsLink.classList.remove('hidden');
            } else {
                selectAllRecordsLink.classList.add('hidden');
            }

            clearSelectionLink.classList.remove('hidden');

            // Update the "Select all {} records" button text
            selectAllRecordsLink.textContent = `Select all ${totalHouseholdsCount} total records from all pages`;
        } else {
            if (currentPageSelectedCount === currentPageTotalCount) {
                // All records on the current page are selected
                selectionCount.textContent = `All ${currentPageSelectedCount} records on this page have been selected.`;
            } else {
                // Partial selection on the current page
                selectionCount.textContent = `${currentPageSelectedCount} record${currentPageSelectedCount > 1 ? 's' : ''} on this page have been selected.`;
            }

            // Show or hide the "Select All Records" link based on additional records
            if (hasAdditionalPages) {
                selectAllRecordsLink.classList.remove('hidden');
            } else {
                selectAllRecordsLink.classList.add('hidden');
            }

            clearSelectionLink.classList.remove('hidden');

            // Update the "Select all {} records" button text to reflect total records
            selectAllRecordsLink.textContent = `Select all ${totalHouseholdsCount} total records from all pages`;
        }
    } else {
        // If visible, hide the container
        if (selectionContainer.classList.contains('visible')) {
            hideSelectionContainer();
        }
    }
}

/**
 * Function to get the count of selected households on the current page.
 * @returns {number} - Number of selected households on the current page.
 */
function getCurrentPageSelectedCount() {
    const checkboxes = householdsTableBody.querySelectorAll('.household-checkbox');
    let count = 0;
    checkboxes.forEach(cb => {
        if (cb.checked) count++;
    });
    return count;
}

// **Event Listeners for Selection Container Actions**

// Select All Records Across Pages
selectAllRecordsLink?.addEventListener('click', (e) => {
    e.preventDefault();
    selectAllAcrossPages = true;
    selectedHouseholds.clear(); // Clear individual selections

    // Update UI
    const checkboxes = householdsTableBody.querySelectorAll('.household-checkbox');
    checkboxes.forEach(cb => cb.checked = true);
    updateSelectionContainer();
});

// Clear Selection
clearSelectionLink?.addEventListener('click', (e) => {
    e.preventDefault();
    selectAllAcrossPages = false;
    selectedHouseholds.clear();

    const checkboxes = householdsTableBody.querySelectorAll('.household-checkbox');
    checkboxes.forEach(cb => cb.checked = false);

    // Uncheck the "Select All" checkbox and remove indeterminate state
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;

    updateSelectionContainer();
});

// **Event Listeners for Individual Row Checkboxes**

householdsTableBody?.addEventListener('change', (e) => {
    if (e.target.classList.contains('household-checkbox')) {
        const householdId = e.target.closest('tr').dataset.id;

        if (e.target.checked) {
            if (!selectAllAcrossPages) {
                selectedHouseholds.add(householdId);
            }
        } else {
            if (!selectAllAcrossPages) {
                selectedHouseholds.delete(householdId);
            }
            // If a single checkbox is unchecked while "Select All Across Pages" is active
            if (selectAllAcrossPages) {
                selectAllAcrossPages = false;
            }
        }

        // Update the "Select All" checkbox in the header
        const allCheckboxes = householdsTableBody.querySelectorAll('.household-checkbox');
        const allChecked = Array.from(allCheckboxes).every(cb => cb.checked);
        selectAllCheckbox.checked = allChecked;
        selectAllCheckbox.indeterminate = Array.from(allCheckboxes).some(cb => cb.checked) && !allChecked;

        updateSelectionContainer();
    }
});
// ===============================================
// FRONTEND JS SNIPPET FOR leadAdvisor DROPDOWN (MANUAL TOGGLE)
// ===============================================

// Global references for leadAdvisor dropdown
const advisorDropdownButton = document.getElementById('advisorDropdownButton');
const advisorDropdownMenu = document.getElementById('advisorDropdownMenu');
const selectedAdvisorsInput = document.getElementById('selectedAdvisorsInput');

// A map to store advisorId -> advisorName for quick lookups
let advisorsMap = new Map();
// A set to track selected advisors
let selectedAdvisorIds = new Set();

// Function to update the dropdown button text and hidden input
function updateAdvisorSelectionDisplay() {
    if (selectedAdvisorIds.size === 0) {
        advisorDropdownButton.textContent = 'Select advisors...';
    } else {
        const selectedNames = Array.from(selectedAdvisorIds).map(id => advisorsMap.get(id));
        advisorDropdownButton.textContent = selectedNames.join(', ');
        selectedAdvisorsInput.value = Array.from(selectedAdvisorIds).join(',');
    }
}

// Function to show the dropdown
function showDropdown() {
    advisorDropdownMenu.classList.add('show');
}

// Function to hide the dropdown
function hideDropdown() {
    advisorDropdownMenu.classList.remove('show');
}

// Toggle dropdown on button click
advisorDropdownButton.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent event from bubbling up to document
    if (advisorDropdownMenu.classList.contains('show')) {
        hideDropdown();
    } else {
        showDropdown();
    }
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!advisorDropdownMenu.contains(e.target) && !advisorDropdownButton.contains(e.target)) {
        hideDropdown();
    }
});

// On show of Add Household Modal, fetch advisors and populate dropdown
addHouseholdModalElement.addEventListener('show.bs.modal', async () => {
    advisorsMap.clear();
    selectedAdvisorIds.clear();
    selectedAdvisorsInput.value = '';
    advisorDropdownButton.textContent = 'Select advisors...';

    // Clear and show a loading message
    advisorDropdownMenu.innerHTML = '<li class="dropdown-header">Loading advisors...</li>';

    try {
        // Adjust this URL if needed to match your actual route
        const response = await fetch('/api/households/api/leadAdvisors', { credentials: 'include' });

        if (!response.ok) throw new Error('Failed to fetch advisors');
        
        const data = await response.json();
        const leadAdvisors = data.leadAdvisors || [];
        advisorDropdownMenu.innerHTML = ''; // Clear loading text

        if (leadAdvisors.length === 0) {
            const noAdvisorsItem = document.createElement('li');
            noAdvisorsItem.classList.add('dropdown-item', 'text-muted');
            noAdvisorsItem.textContent = 'No leadAdvisors found';
            advisorDropdownMenu.appendChild(noAdvisorsItem);
        } else {
            leadAdvisors.forEach(leadAdvisor => {
                advisorsMap.set(leadAdvisor._id, leadAdvisor.name);
                const li = document.createElement('li');
                li.classList.add('dropdown-item');

                const label = document.createElement('label');
                label.classList.add('d-flex', 'align-items-center');

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.classList.add('form-check-input', 'me-2');
                checkbox.value = leadAdvisor._id;

                const span = document.createElement('span');
                span.textContent = leadAdvisor.name;

                label.appendChild(checkbox);
                label.appendChild(span);
                li.appendChild(label);
                advisorDropdownMenu.appendChild(li);

                // Event listener for checkbox changes
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) {
                        selectedAdvisorIds.add(leadAdvisor._id);
                    } else {
                        selectedAdvisorIds.delete(leadAdvisor._id);
                    }
                    updateAdvisorSelectionDisplay();
                });
            });
        }
    } catch (err) {
        console.error('Error fetching leadAdvisors:', err);
        advisorDropdownMenu.innerHTML = '<li class="dropdown-item text-danger">Error loading leadAdvisors</li>';
    }
});


    /**
     * Function to fetch all household IDs (for "Select All Across Pages").
     * @returns {Promise<Array>} - Array of all household IDs.
     */
    async function fetchAllHouseholdIds() {
        try {
            const response = await fetch('/api/households?page=1&limit=all&search=&sortField=headOfHouseholdName&sortOrder=asc', {
                credentials: 'include',
                cache: 'no-store',
            });
            if (!response.ok) {
                throw new Error('Failed to fetch all household IDs.');
            }
            const data = await response.json();
            const allHouseholdIds = data.households.map(hh => hh._id);
            return allHouseholdIds;
        } catch (error) {
            console.error(error);
            showAlert('danger', 'Failed to select all records across pages.');
            return [];
        }
    }

    // **Event Listeners for Selection Container Actions**

    // Select All Records Across Pages
    selectAllRecordsLink?.addEventListener('click', async () => {
        selectAllAcrossPages = true;
        selectedHouseholds.clear(); // Clear individual selections

        // Optionally, you can fetch all household IDs if needed for further actions
        // const allHouseholdIds = await fetchAllHouseholdIds();
        // allHouseholdIds.forEach(id => selectedHouseholds.add(id));

        // Update UI
        const checkboxes = householdsTableBody.querySelectorAll('.household-checkbox');
        checkboxes.forEach(cb => cb.checked = true);
        updateSelectionContainer();
        selectAllRecordsLink.classList.add('hidden');
    });

    // Clear Selection
    clearSelectionLink?.addEventListener('click', () => {
        selectAllAcrossPages = false;
        selectedHouseholds.clear();

        const checkboxes = householdsTableBody.querySelectorAll('.household-checkbox');
        checkboxes.forEach(cb => cb.checked = false);

        // Uncheck the "Select All" checkbox and remove indeterminate state
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;

        updateSelectionContainer();
    });


    // Delete Selected Households
    deleteSelectedButton?.addEventListener('click', () => {
        // Show confirmation modal
        deleteConfirmationModal.show();
    });

  

    function openDeleteConfirmation(householdId) {
      deletingHouseholdId = householdId;
      deleteConfirmationModal.show();
    }
    
    confirmDeleteButton?.addEventListener('click', async () => {
        // Check if this is a single-household delete (deletingHouseholdId set)
        if (deletingHouseholdId) {
            // Single household deletion logic
            try {
                const response = await fetch(`/api/households/${deletingHouseholdId}`, {
                    method: 'DELETE'
                });
                const data = await response.json();
                if (response.ok && data.message && data.message.toLowerCase().includes('success')) {
                    showAlert('success', data.message);
                    deletingHouseholdId = null; // Reset after use
                    deleteConfirmationModal.hide();
                    fetchHouseholds(); // Refresh list
                } else {
                    showAlert('danger', data.message || 'Error deleting household.');
                    deletingHouseholdId = null; // Reset even on error
                    deleteConfirmationModal.hide();
                }
            } catch (err) {
                console.error('Error deleting household:', err);
                showAlert('danger', 'Error deleting household.');
                deletingHouseholdId = null;
                deleteConfirmationModal.hide();
            }
        } else {
            // Bulk deletion logic (same as before)
            let householdIdsToDelete = [];
    
            if (selectAllAcrossPages) {
                // Fetch all household IDs for the user
                try {
                    const response = await fetch('/api/households?page=1&limit=all&search=&sortField=headOfHouseholdName&sortOrder=asc', {
                        credentials: 'include',
                        cache: 'no-store',
                    });
                    if (!response.ok) {
                        throw new Error('Failed to fetch household IDs.');
                    }
                    const data = await response.json();
                    householdIdsToDelete = data.households.map(hh => hh._id);
                } catch (error) {
                    console.error(error);
                    showAlert('danger', 'Failed to retrieve households for deletion.');
                    deleteConfirmationModal.hide();
                    return;
                }
            } else {
                householdIdsToDelete = Array.from(selectedHouseholds);
            }
    
            if (householdIdsToDelete.length === 0) {
                showAlert('warning', 'No households selected for deletion.');
                deleteConfirmationModal.hide();
                return;
            }
    
            try {
                const response = await fetch('/api/households/bulk-delete', {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include',
                    body: JSON.stringify({ householdIds: householdIdsToDelete }),
                });
    
                const result = await response.json();
    
                if (response.ok) {
                    showAlert('success', 'Selected households have been deleted successfully.');
                    // Reset selection state
                    selectAllAcrossPages = false;
                    selectedHouseholds.clear();
                    selectAllCheckbox.checked = false;
                    selectAllCheckbox.indeterminate = false;
                    hideSelectionContainer();
                    
                    fetchHouseholds(); // Refresh households
                } else {
                    if (result.invalidHouseholdIds && result.invalidHouseholdIds.length > 0) {
                        showAlert('danger', `Failed to delete some households: ${result.invalidHouseholdIds.join(', ')}. They may not belong to you.`);
                    } else {
                        showAlert('danger', result.message || 'Failed to delete households.');
                    }
                }
            } catch (error) {
                console.error('Error deleting households:', error);
                showAlert('danger', 'An error occurred while deleting households.');
            } finally {
                deleteConfirmationModal.hide();
                updateSelectionContainer();
            }
        }
    });
    
    

    // **Event Listener: Select All Checkbox in Table Header**

    selectAllCheckbox?.addEventListener('change', () => {
        const isChecked = selectAllCheckbox.checked;
        const checkboxes = householdsTableBody.querySelectorAll('.household-checkbox');
        checkboxes.forEach(cb => cb.checked = isChecked);

        if (selectAllAcrossPages) {
            // If "Select All Across Pages" is active, individual selections are irrelevant
            // No action needed
        } else {
            if (isChecked) {
                checkboxes.forEach(cb => selectedHouseholds.add(cb.dataset.id));
            } else {
                checkboxes.forEach(cb => selectedHouseholds.delete(cb.dataset.id));
            }
        }

        updateSelectionContainer();
    });

    // **Event Listener: Individual Row Checkboxes**

    householdsTableBody?.addEventListener('change', (e) => {
        if (e.target.classList.contains('household-checkbox')) {
            const householdId = e.target.closest('tr').dataset.id;

            if (e.target.checked) {
                if (!selectAllAcrossPages) {
                    selectedHouseholds.add(householdId);
                }
            } else {
                if (!selectAllAcrossPages) {
                    selectedHouseholds.delete(householdId);
                }
                // If a single checkbox is unchecked while "Select All Across Pages" is active
                if (selectAllAcrossPages) {
                    selectAllAcrossPages = false;
                }
            }

            // Update the "Select All" checkbox in the header
            const allCheckboxes = householdsTableBody.querySelectorAll('.household-checkbox');
            const allChecked = Array.from(allCheckboxes).every(cb => cb.checked);
            selectAllCheckbox.checked = allChecked;
            selectAllCheckbox.indeterminate = Array.from(allCheckboxes).some(cb => cb.checked) && !allChecked;

            updateSelectionContainer();
        }
    });

    /**
     * Sorting functionality
     * Allows users to sort households by different fields.
     */
    let currentPage = 1;
    let totalPages = 1;
    let currentSearch = '';
    let currentSortField = 'headOfHouseholdName';
    let currentSortOrder = 'asc';

    const sortIcons = document.querySelectorAll('.sort-icon');
    sortIcons.forEach(icon => {
        icon.addEventListener('click', () => {
            const field = icon.dataset.field;
            if (currentSortField === field) {
                currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortField = field;
                currentSortOrder = 'asc';
            }
            // Update sort icons to reflect current sort
            sortIcons.forEach(i => {
                if (i.dataset.field === currentSortField) {
                    i.textContent = currentSortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward';
                } else {
                    i.textContent = 'arrow_upward';
                }
            });
            fetchHouseholds();
        });
    });

    /**
     * Alert Function
     * Displays alert messages to the user.
     * @param {string} type - Type of alert ('success' or 'danger').
     * @param {string} message - The alert message.
     * @param {Object} options - Additional options (e.g., undo).
     */
    function showAlert(type, message, options = {}) {
        const alertContainer = document.getElementById('alert-container');
        if (!alertContainer) return; // Exit if alert container doesn't exist

        const alert = document.createElement('div');
        alert.id = type === 'success' ? 'passwordChangeSuccess' : 'errorAlert';
        alert.className = `alert ${type === 'success' ? 'alert-success' : 'alert-error'}`;
        alert.setAttribute('role', 'alert');

        // Icon container
        const iconContainer = document.createElement('div');
        iconContainer.className = type === 'success' ? 'success-icon-container' : 'error-icon-container';
        const icon = document.createElement('i');
        icon.className = type === 'success' ? 'far fa-check-circle' : 'far fa-times-circle';
        iconContainer.appendChild(icon);

        // Close button container
        const closeContainer = document.createElement('div');
        closeContainer.className = type === 'success' ? 'success-close-container' : 'error-close-container';
        const closeIcon = document.createElement('span');
        closeIcon.className = 'material-symbols-outlined successCloseIcon';
        closeIcon.innerText = 'close';
        closeContainer.appendChild(closeIcon);

        // Text container
        const textContainer = document.createElement('div');
        textContainer.className = 'success-text';
        const title = document.createElement('h3');
        title.innerText = type === 'success' ? 'Success!' : 'Error!';
        const text = document.createElement('p');
        text.innerText = message;

        textContainer.appendChild(title);
        textContainer.appendChild(text);

        /**
         * Closes and removes an alert from the DOM.
         * @param {HTMLElement} alert - The alert element to close.
         */
        function closeAlert(alert) {
            alert.classList.add('exit');
            setTimeout(() => {
                if (alert && alert.parentNode) {
                    alert.parentNode.removeChild(alert);
                }
            }, 500);
        }

        // If undo option is provided, add undo button
        if (options.undo) {
            const undoButton = document.createElement('button');
            undoButton.className = 'alert-undo-button';
            undoButton.innerText = 'Undo';
            undoButton.addEventListener('click', () => {
                options.undoCallback();
                // Close the alert after undo is clicked
                closeAlert(alert);
            });
            textContainer.appendChild(undoButton);
        }

        // Append elements to the alert
        alert.appendChild(iconContainer);
        alert.appendChild(closeContainer);
        alert.appendChild(textContainer);

        // Prepend alert to the container
        alertContainer.prepend(alert);

        // Trigger fade-in transition
        void alert.offsetWidth;
        alert.classList.add('show');

        // Auto-close alert after 5 seconds
        setTimeout(() => closeAlert(alert), 5000);
        closeIcon.addEventListener('click', () => closeAlert(alert));
    }

  /**
 * Utility function to read the user's globally selected leadAdvisors (and/or "All", "Unassigned")
 * from localStorage. Returns an array of strings, e.g.: ["all"], ["unassigned","123"], etc.
 */
function getGlobalSelectedAdvisors() {
    const saved = localStorage.getItem('selectedAdvisors');
    if (!saved) {
        return [];
    }
    const arr = JSON.parse(saved); // e.g. ["all"] or ["unassigned","123","456"]
    // If "all" is present, we could interpret it as "no filtering needed"
    return arr; // Return exactly what's stored
}

/**
 * Fetch Households Function
 * Fetches households from the server with pagination, search, sorting,
 * and now filters by globally selected leadAdvisors/unassigned/all.
 */
const fetchHouseholds = async () => {
  // 1) Grab references to the loader and the table container
  const loadingIndicator = document.getElementById('households-loading');
  const tableAndPagination = document.querySelector('.table-and-pagination-container');

  try {
      console.log('[DEBUG] fetchHouseholds() called.');

      // 2) Show the loader, hide the table during fetch
      if (loadingIndicator) loadingIndicator.classList.remove('hidden');
      if (tableAndPagination) tableAndPagination.classList.add('hidden');

      // 3) Determine selected advisors and build query params
      const selectedAdvisors = getGlobalSelectedAdvisors(); // e.g. ["all"], ["unassigned","123"]...
      const selectedAdvisorsParam = selectedAdvisors.join(',');

      const response = await fetch(
          `/api/households?page=${currentPage}`
          + `&limit=${selectAllAcrossPages ? 'all' : 10}`
          + `&search=${encodeURIComponent(currentSearch)}`
          + `&sortField=${currentSortField}`
          + `&sortOrder=${currentSortOrder}`
          + `&selectedAdvisors=${selectedAdvisorsParam}`, 
          {
              credentials: 'include', // Ensure cookies are sent for session authentication
              cache: 'no-store',      // Prevent caching of the response
          }
      );

      if (!response.ok) {
          throw new Error('Failed to fetch households.');
      }

      // 4) Parse the response
      const data = await response.json();
      console.log('[DEBUG] Response status =>', response.status);
      console.log('[DEBUG] fetchHouseholds() response data =>', data);

      // 5) Update totalHouseholdsCount and render
      totalHouseholdsCount = data.totalHouseholds || 0;
      renderHouseholds(data.households);
      setupPagination(data.currentPage, data.totalPages, data.totalHouseholds);
      updateSelectionContainer();

  } catch (error) {
      console.error('Error fetching households:', error);
      showAlert('danger', 'Failed to load households.');
  } finally {
      // 6) Hide the loader, show the table regardless of success/fail
      if (loadingIndicator) loadingIndicator.classList.add('hidden');
      // if (tableAndPagination) tableAndPagination.classList.remove('hidden');
  }
};




/**
 * Render Households
 * Dynamically toggles the table/pagination and empty state visibility.
 * @param {Array} households - Array of household objects to render.
 * Each household object might include:
 * {
 *   _id: String,
 *   headOfHouseholdName: String,
 *   totalAccountValue: Number or String,
 *   leadAdvisors: [{ name: String, avatar: String }, ...]
 * }
 */
const renderHouseholds = (households) => {
   
    const tableContainer = document.querySelector('.table-and-pagination-container');
    const emptyStateContainer = document.querySelector('.empty-state-container');
    const tableBody = document.querySelector('#households-body');
    
    if (!tableContainer || !emptyStateContainer || !tableBody) return;

    // If no households returned, show empty state
    if (!households || households.length === 0) {
        tableContainer.classList.add('hidden');
        emptyStateContainer.classList.remove('hidden');
    } else {
        // Otherwise, show the table and hide empty state
        tableContainer.classList.remove('hidden');
        emptyStateContainer.classList.add('hidden');

        // Populate the table
        tableBody.innerHTML = ''; // Clear existing rows
        households.forEach(({ _id, headOfHouseholdName, totalAccountValue, redtailFamilyId }) => {
            const tr = document.createElement('tr');
            tr.dataset.id = _id;

            // Checkbox cell
            const checkboxTd = document.createElement('td');
            checkboxTd.classList.add('checkbox-cell');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.classList.add('household-checkbox');
            checkbox.dataset.id = _id;
            checkboxTd.appendChild(checkbox);

            // Head of household name cell
            const nameTd = document.createElement('td');
            nameTd.textContent = headOfHouseholdName || '---';
            nameTd.classList.add('household-name-cell');

            if (redtailFamilyId) {
                const linkedSpan = document.createElement('span');
                linkedSpan.classList.add('redtail-linked-tag');
              
                linkedSpan.innerHTML = `
                  <img src="/images/redtail-logo.png"
                       alt="Redtail-Logo"
                       class="redtail-logo" />
                `;
                
                // Add a simple tooltip
                linkedSpan.setAttribute('title', 'Synced with Redtail');
              
                nameTd.appendChild(document.createTextNode(' '));
                nameTd.appendChild(linkedSpan);
              }
              
                            

  // 4) Append to row, etc.
  tr.appendChild(nameTd);

            // Total account value cell
            const valueTd = document.createElement('td');
            valueTd.textContent = new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD'
              }).format(totalAccountValue || 0);
              
            valueTd.classList.add('household-value-cell');

            // Actions cell with 3-dot menu
            const actionsTd = document.createElement('td');
            actionsTd.classList.add('actionsCell', 'position-relative');

            const dropdownContainer = document.createElement('div');
            dropdownContainer.classList.add('dropdown');

            const dropdownToggle = document.createElement('button');
            dropdownToggle.classList.add('btn', 'btn-link', 'p-0', 'three-dots-btn', 'household-more-button');
            dropdownToggle.setAttribute('aria-expanded', 'false');
            dropdownToggle.innerHTML = `<i class="fas fa-ellipsis-v"></i>`; // 3-dot icon

            const dropdownMenu = document.createElement('ul');
            dropdownMenu.classList.add('dropdown-menu');
            dropdownMenu.innerHTML = `
                <li><a class="dropdown-item edit-household" href="#">Edit</a></li>
                <li><a class="dropdown-item text-danger delete-household" href="#">Delete</a></li>
            `;

            // Close all other dropdowns when opening this one
            function closeAllDropdowns(exceptDropdown = null) {
                document.querySelectorAll('.dropdown-menu.show-more-menu, .dropdown-menu.fade-out').forEach(menu => {
                    if (menu !== exceptDropdown) {
                        menu.classList.remove('show-more-menu', 'fade-out');
                        menu.style.display = 'none';
                    }
                });
            }

            // Event listener for 3-dot toggle
            dropdownToggle.addEventListener('click', (event) => {
                event.stopPropagation();
                const isShown = dropdownMenu.classList.contains('show-more-menu');

                if (isShown) {
                    // Fade out
                    dropdownMenu.classList.add('fade-out');
                    dropdownMenu.addEventListener('animationend', () => {
                        dropdownMenu.classList.remove('fade-out', 'show-more-menu');
                        dropdownMenu.style.display = 'none';
                        dropdownToggle.setAttribute('aria-expanded', 'false');
                    }, { once: true });
                } else {
                    // Close others first
                    closeAllDropdowns(dropdownMenu);
                    dropdownMenu.style.display = 'block';
                    dropdownMenu.classList.add('show-more-menu');
                    dropdownToggle.setAttribute('aria-expanded', 'true');
                }
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (event) => {
                if (!dropdownContainer.contains(event.target)) {
                    if (dropdownMenu.classList.contains('show-more-menu')) {
                        dropdownMenu.classList.add('fade-out');
                        dropdownMenu.addEventListener('animationend', () => {
                            dropdownMenu.classList.remove('fade-out', 'show-more-menu');
                            dropdownMenu.style.display = 'none';
                            dropdownToggle.setAttribute('aria-expanded', 'false');
                        }, { once: true });
                    }
                }
            });

            dropdownContainer.appendChild(dropdownToggle);
            dropdownContainer.appendChild(dropdownMenu);
            actionsTd.appendChild(dropdownContainer);

            // Append cells to the row
            tr.appendChild(checkboxTd);
            tr.appendChild(nameTd);
            tr.appendChild(valueTd);
            tr.appendChild(actionsTd);

            // Clicking row navigates to details, ignoring checkbox or 3-dot
            tr.addEventListener('click', (e) => {
                if (
                    e.target.type !== 'checkbox'
                    && !e.target.closest('.household-more-button')
                    && !e.target.closest('.dropdown-menu')
                ) {
                    window.location.href = `/households/${_id}`;
                }
            });

            tableBody.appendChild(tr);
        });
    }
};





// -----------------------------------------
// Insert this after your code that renders the households and sets up pagination in households.js
// -----------------------------------------

// References for Modals on Households Page
const pageEditHouseholdModalElement = document.getElementById('pageEditHouseholdModal');
const pageEditHouseholdModal = pageEditHouseholdModalElement ? new bootstrap.Modal(pageEditHouseholdModalElement) : null;
const pageEditHouseholdForm = document.getElementById('page-edit-household-form');

// leadAdvisor related elements for page edit household modal
const pageEditAdvisorDropdownButton = document.getElementById('pageEditAdvisorDropdownButton');
const pageEditAdvisorDropdownMenu = document.getElementById('pageEditAdvisorDropdownMenu');
const pageEditSelectedAdvisorsInput = document.getElementById('pageEditSelectedAdvisorsInput');

pageEditAdvisorDropdownButton.addEventListener('click', (e) => {
    e.stopPropagation();
    pageEditAdvisorDropdownMenu.classList.toggle('show');
  });
  
  document.addEventListener('click', (e) => {
    if (!pageEditAdvisorDropdownMenu.contains(e.target) && !pageEditAdvisorDropdownButton.contains(e.target)) {
      pageEditAdvisorDropdownMenu.classList.remove('show');
    }
  });
  

let currentEditingHouseholdId = null; // Store the currently editing household’s ID

// Attach event listener to table body for 3-dot menus
document.getElementById('households-body').addEventListener('click', (e) => {
  const dropdownToggle = e.target.closest('.household-more-button');
  if (dropdownToggle) {
    e.stopPropagation();
    const dropdownMenu = dropdownToggle.parentElement.querySelector('.dropdown-menu');
    const isShown = dropdownMenu.classList.contains('show-more-menu');

    if (isShown) {
      // Fade out logic
      dropdownMenu.classList.add('fade-out');
      dropdownMenu.addEventListener('animationend', () => {
        dropdownMenu.classList.remove('fade-out', 'show-more-menu');
        dropdownMenu.style.display = 'none';
        dropdownToggle.setAttribute('aria-expanded', 'false');
      }, { once: true });
    } else {
      closeAllDropdowns(dropdownMenu);
      dropdownMenu.style.display = 'block';
      dropdownMenu.classList.add('show-more-menu');
      dropdownToggle.setAttribute('aria-expanded', 'true');
    }
  }

  const editLink = e.target.closest('.edit-household');
  if (editLink) {
    e.preventDefault();
    const row = editLink.closest('tr');
    const householdId = row.dataset.id;
    openEditHouseholdModal(householdId);
    closeAllDropdowns(dropdownMenu);
    
  }

  const deleteLink = e.target.closest('.delete-household');
  if (deleteLink) {
    e.preventDefault();
    const row = deleteLink.closest('tr');
    const householdId = row.dataset.id;
    openDeleteConfirmation(householdId);
    closeAllDropdowns(dropdownMenu);
  }
});

function closeAllDropdowns(except) {
  document.querySelectorAll('.dropdown-menu.show-more-menu, .dropdown-menu.fade-out').forEach(menu => {
    if (menu !== except) {
      menu.classList.remove('show-more-menu');
      menu.classList.remove('fade-out');
      menu.style.display = 'none';
    }
  });
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('.dropdown')) {
    closeAllDropdowns();
  }
});

// Function to open edit modal for a household
async function openEditHouseholdModal(householdId) {
  currentEditingHouseholdId = householdId;

  // Fetch household data
  const response = await fetch(`/api/households/${householdId}`, { credentials: 'include' });
  const result = await response.json();
  if (!result.household) {
    showAlert('danger', 'Failed to fetch household details.');
    return;
  }

  const hh = result.household;
  // Populate modal fields
  document.getElementById('pageEditFirstName').value = hh.headOfHousehold.firstName || '';
  document.getElementById('pageEditLastName').value = hh.headOfHousehold.lastName || '';
  document.getElementById('pageEditDob').value = hh.headOfHousehold.dob ? formatDateForInput(hh.headOfHousehold.dob) : '';
  document.getElementById('pageEditSsn').value = hh.headOfHousehold.ssn || '';
  document.getElementById('pageEditTaxFilingStatus').value = hh.headOfHousehold.taxFilingStatus || '';
  document.getElementById('pageEditMaritalStatus').value = hh.headOfHousehold.maritalStatus || '';
  document.getElementById('pageEditMobileNumber').value = hh.headOfHousehold.mobileNumber || '';
  document.getElementById('pageEditHomePhone').value = hh.headOfHousehold.homePhone || '';
  document.getElementById('pageEditEmail').value = hh.headOfHousehold.email || '';
  document.getElementById('pageEditHomeAddress').value = hh.headOfHousehold.homeAddress || '';

  // Marginal Tax Bracket (may be null)
  document.getElementById('pageEditMarginalTaxBracket').value =
    hh.marginalTaxBracket != null ? hh.marginalTaxBracket : '';


  // leadAdvisors
  // Fetch leadAdvisors and select those that apply
  await populatePageEditAdvisors(hh.leadAdvisors || []);
  
  pageEditHouseholdModal.show();
}
// Ensure no data-bs-toggle on the button since we're manually handling the dropdown
// HTML (ensure something like this):
// <div class="dropdown" id="pageEditAdvisorDropdownContainer">
//   <button id="pageEditAdvisorDropdownButton" class="btn btn-outline-secondary" type="button">Select leadAdvisor...</button>
//   <ul id="pageEditAdvisorDropdownMenu" class="dropdown-menu"></ul>
// </div>

async function populatePageEditAdvisors(selectedAdvisorIds) {
    pageEditAdvisorDropdownMenu.innerHTML = '<li class="dropdown-header">Loading leadAdvisors...</li>';
  
    try {
      // Ensure we have an array of IDs
      selectedAdvisorIds = Array.isArray(selectedAdvisorIds) ? selectedAdvisorIds : [];
  
      // Fetch the list of possible leadAdvisors
      const response = await fetch('/api/households/api/leadAdvisors', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch leadAdvisors');
  
      const data = await response.json();
      const leadAdvisors = data.leadAdvisors || [];
      pageEditAdvisorDropdownMenu.innerHTML = '';
  
      const selectedIds = new Set(selectedAdvisorIds.map(id => id.toString()));
      const advisorsMap = new Map();
  
      // Build checkboxes for each leadAdvisor
      leadAdvisors.forEach(leadAdvisor => {
        advisorsMap.set(leadAdvisor._id, leadAdvisor.name);
  
        const li = document.createElement('li');
        li.classList.add('dropdown-item');
  
        const label = document.createElement('label');
        label.classList.add('d-flex', 'align-items-center');
  
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.classList.add('form-check-input', 'me-2');
        checkbox.value = leadAdvisor._id;
  
        const span = document.createElement('span');
        span.textContent = leadAdvisor.name;
  
        label.appendChild(checkbox);
        label.appendChild(span);
        li.appendChild(label);
        pageEditAdvisorDropdownMenu.appendChild(li);
  
        // Pre-check if this advisor ID is already in selectedAdvisorIds
        if (selectedIds.has(String(leadAdvisor._id))) {
          checkbox.checked = true;
        }
  
        // Listen for changes in the checkbox, then update the display
        checkbox.addEventListener('change', updatePageEditAdvisorSelectionDisplay);
      });
  
      // Initialize the button text/hidden input after building checkboxes
      updatePageEditAdvisorSelectionDisplay();
  
      // Re-attach the manual toggle logic after populating
      attachManualDropdownToggle();
  
      // Inner function to update button text & hidden input
      function updatePageEditAdvisorSelectionDisplay() {
        const checkedBoxes = pageEditAdvisorDropdownMenu.querySelectorAll('input[type="checkbox"]:checked');
        if (checkedBoxes.length === 0) {
          // If no advisors selected
          pageEditAdvisorDropdownButton.textContent = 'Select advisors...';
          pageEditSelectedAdvisorsInput.value = '';
        } else {
          // Build a list of names and IDs for the selected checkboxes
          const selected = Array.from(checkedBoxes).map(cb => {
            const adv = leadAdvisors.find(a => String(a._id) === cb.value);
            return adv ? adv.name : 'Unknown';
          });
          pageEditAdvisorDropdownButton.textContent = selected.join(', ');
  
          // Hidden input for the form so the IDs get submitted
          pageEditSelectedAdvisorsInput.value = Array.from(checkedBoxes)
            .map(cb => cb.value)
            .join(',');
        }
      }
    } catch (error) {
      console.error('Error fetching advisors:', error);
      pageEditAdvisorDropdownMenu.innerHTML = '<li class="dropdown-item text-danger">Error loading advisors</li>';
    }
  }
  
  
  function attachManualDropdownToggle() {
    // Remove any existing listeners to prevent double-binding if necessary
    pageEditAdvisorDropdownButton.replaceWith(pageEditAdvisorDropdownButton.cloneNode(true));
    const newButton = document.getElementById('pageEditAdvisorDropdownButton');
  
    newButton.addEventListener('click', (e) => {
      e.stopPropagation();
      pageEditAdvisorDropdownMenu.classList.toggle('show');
    });
  
    document.addEventListener('click', (e) => {
      if (!pageEditAdvisorDropdownMenu.contains(e.target) && !newButton.contains(e.target)) {
        pageEditAdvisorDropdownMenu.classList.remove('show');
      }
    });
  }
  
  // In openEditHouseholdModal after populatePageEditAdvisors is called, no additional toggle code needed as it's inside populatePageEditAdvisors
  
  
  

pageEditHouseholdForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(pageEditHouseholdForm);
    const data = Object.fromEntries(formData.entries());
  
    // Convert leadAdvisors
    if (data.leadAdvisors) {
      data.leadAdvisors = data.leadAdvisors.split(',').filter(id => id.trim() !== '');
    }

    // 👉 NEW – normalise marginalTaxBracket
    if (data.marginalTaxBracket === '') {
      delete data.marginalTaxBracket;            // treat blank as “unset”
    } else if (data.marginalTaxBracket !== undefined) {
      data.marginalTaxBracket = Number(data.marginalTaxBracket);
    }
  
    // Gather additional members
    data.additionalMembers = [];
    const memberContainers = pageEditHouseholdModalElement.querySelectorAll('.household-member');
    memberContainers.forEach((container) => {
      const member = {};
      member.firstName = container.querySelector('input[name$="[firstName]"]').value;
      member.lastName = container.querySelector('input[name$="[lastName]"]').value;
      member.dob = container.querySelector('input[name$="[dob]"]').value;
      member.ssn = container.querySelector('input[name$="[ssn]"]').value;
      member.taxFilingStatus = container.querySelector('select[name$="[taxFilingStatus]"]').value;
      member.maritalStatus = container.querySelector('select[name$="[maritalStatus]"]').value;
      member.mobileNumber = container.querySelector('input[name$="[mobileNumber]"]').value;
      member.homePhone = container.querySelector('input[name$="[homePhone]"]').value;
      member.email = container.querySelector('input[name$="[email]"]').value;
      member.homeAddress = container.querySelector('input[name$="[homeAddress]"]').value;
  
      const idInput = container.querySelector('input[name$="[_id]"]');
      if (idInput) {
        member._id = idInput.value;
      }
  
      if (member.firstName && member.lastName) {
        data.additionalMembers.push(member);
      }
    });
  
    fetch(`/api/households/${currentEditingHouseholdId}`, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(data)
    })
      .then(res => res.json())
      .then(result => {
        if (result.success) {
            const modalInstance = bootstrap.Modal.getInstance(pageEditHouseholdModalElement);
            if (modalInstance) {
              modalInstance.hide();
            }
            
          showAlert('success', 'Household updated successfully.');
          
        
          fetchHouseholds(); // Refresh households list
        } else {
          showAlert('danger', result.message || 'Failed to update household.');
        }
      })
      .catch(err => {
        console.error('Error updating household:', err);
        showAlert('danger', 'Unexpected error.');
      });
  });


// Household members logic for Edit Modal (similar to household details page)
function addPageEditMemberFields(memberData = {}, index) {
    const membersSection = pageEditHouseholdModalElement.querySelector('.household-members-section');
    const memberIndex = index !== undefined ? index : Date.now();
    
    const memberContainer = document.createElement('div');
    memberContainer.classList.add('household-member', 'mb-4');
    memberContainer.dataset.memberIndex = memberIndex;
  
    const header = document.createElement('h6');
    header.classList.add('formModalHeadersTwo');
    header.textContent = 'Additional Household Member';
  
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.classList.add('btn', 'btn-danger', 'remove-member-btn');
    removeButton.textContent = 'Remove Member';
    removeButton.addEventListener('click', () => {
      memberContainer.remove();
      updatePageEditMemberIndices();
    });
  
    memberContainer.appendChild(header);
  
    if (memberData._id) {
      const hiddenIdInput = document.createElement('input');
      hiddenIdInput.type = 'hidden';
      hiddenIdInput.name = `additionalMembers[${memberIndex}][_id]`;
      hiddenIdInput.value = memberData._id;
      memberContainer.appendChild(hiddenIdInput);
    }
  
    const fields = [
      { label: 'First Name *', type: 'text', name: 'firstName', required: true, placeholder: 'Enter first name', value: memberData.firstName || '' },
      { label: 'Last Name *', type: 'text', name: 'lastName', required: true, placeholder: 'Enter last name', value: memberData.lastName || '' },
      { label: 'Date of Birth', type: 'date', name: 'dob', required: false, value: memberData.dob ? formatDateForInput(memberData.dob) : '' },
      { label: 'Social Security Number (SSN)', type: 'text', name: 'ssn', required: false, placeholder: '123-45-6789', value: memberData.ssn || '' },
      { label: 'Mobile Number', type: 'tel', name: 'mobileNumber', required: false, placeholder: '123-456-7890', value: memberData.mobileNumber || '' },
      { label: 'Home Phone', type: 'tel', name: 'homePhone', required: false, placeholder: '123-456-7890', value: memberData.homePhone || '' },
      { label: 'Email', type: 'email', name: 'email', required: false, placeholder: 'example@domain.com', value: memberData.email || '' },
      { label: 'Home Address', type: 'text', name: 'homeAddress', required: false, placeholder: 'Enter home address', value: memberData.homeAddress || '' },
    ];
  
    fields.forEach(field => {
      const fieldDiv = document.createElement('div');
      fieldDiv.classList.add('mb-3');
      const label = document.createElement('label');
      label.classList.add('form-label');
      label.textContent = field.label;
  
      const input = document.createElement('input');
      input.type = field.type;
      input.classList.add('form-control');
      input.name = `additionalMembers[${memberIndex}][${field.name}]`;
      if (field.required) input.required = true;
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.value) input.value = field.value;
  
      fieldDiv.appendChild(label);
      fieldDiv.appendChild(input);
      memberContainer.appendChild(fieldDiv);
    });
  
    // Tax Filing Status
    const taxFilingStatusDiv = document.createElement('div');
    taxFilingStatusDiv.classList.add('mb-3');
    const taxFilingStatusLabel = document.createElement('label');
    taxFilingStatusLabel.classList.add('form-label');
    taxFilingStatusLabel.textContent = 'Tax Filing Status';
  
    const taxFilingStatusSelect = document.createElement('select');
    taxFilingStatusSelect.classList.add('form-select');
    taxFilingStatusSelect.name = `additionalMembers[${memberIndex}][taxFilingStatus]`;
    const taxFilingOptions = [
      { value: '', text: 'Select Tax Filing Status' },
      { value: 'Married Filing Jointly', text: 'Married Filing Jointly' },
      { value: 'Married Filing Separately', text: 'Married Filing Separately' },
      { value: 'Single', text: 'Single' },
      { value: 'Head of Household', text: 'Head of Household' },
      { value: 'Qualifying Widower', text: 'Qualifying Widower' },
    ];
    taxFilingOptions.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.text;
      if (memberData.taxFilingStatus === opt.value) option.selected = true;
      taxFilingStatusSelect.appendChild(option);
    });
  
    taxFilingStatusDiv.appendChild(taxFilingStatusLabel);
    taxFilingStatusDiv.appendChild(taxFilingStatusSelect);
    memberContainer.appendChild(taxFilingStatusDiv);
  
    // Marital Status
    const maritalStatusDiv = document.createElement('div');
    maritalStatusDiv.classList.add('mb-3');
    const maritalStatusLabel = document.createElement('label');
    maritalStatusLabel.classList.add('form-label');
    maritalStatusLabel.textContent = 'Marital Status';
  
    const maritalStatusSelect = document.createElement('select');
    maritalStatusSelect.classList.add('form-select');
    maritalStatusSelect.name = `additionalMembers[${memberIndex}][maritalStatus]`;
    const maritalStatusOptions = [
      { value: '', text: 'Select Marital Status' },
      { value: 'Married', text: 'Married' },
      { value: 'Single', text: 'Single' },
      { value: 'Widowed', text: 'Widowed' },
      { value: 'Divorced', text: 'Divorced' },
    ];
    maritalStatusOptions.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.text;
      if (memberData.maritalStatus === opt.value) option.selected = true;
      maritalStatusSelect.appendChild(option);
    });
  
    maritalStatusDiv.appendChild(maritalStatusLabel);
    maritalStatusDiv.appendChild(maritalStatusSelect);
    memberContainer.appendChild(maritalStatusDiv);
  
    memberContainer.appendChild(removeButton);
    membersSection.appendChild(memberContainer);
  }
  
  function updatePageEditMemberIndices() {
    const memberForms = pageEditHouseholdModalElement.querySelectorAll('.household-member');
    memberForms.forEach((form, index) => {
      const header = form.querySelector('h6.formModalHeadersTwo');
      if (header) {
        header.textContent = `Additional Household Member ${index + 1}`;
      }
    });
  }
  
  function handlePageEditAddMemberClick() {
    addPageEditMemberFields({});
    updatePageEditMemberIndices();
  }
  
  // Hooking up the add member button inside the page edit modal
  const pageEditAddMemberButton = document.getElementById('page-edit-add-household-member');
  if (pageEditAddMemberButton) {
    pageEditAddMemberButton.removeEventListener('click', handlePageEditAddMemberClick);
    pageEditAddMemberButton.addEventListener('click', handlePageEditAddMemberClick);
  }



  
  async function openEditHouseholdModal(householdId) {
    currentEditingHouseholdId = householdId;
    const response = await fetch(`/api/households/${currentEditingHouseholdId}`, { credentials: 'include' });
    const result = await response.json();
    
    if (!result.household) {
      showAlert('danger', 'Failed to fetch household details.');
      return;
    }
  
    const hh = result.household;

    const assignedAdvisorIds = Array.isArray(hh.leadAdvisors) ? hh.leadAdvisors.map(a => a._id || a) : [];
    await populatePageEditAdvisors(assignedAdvisorIds);
    
    // Clear existing members before populating
    const editModalSelector = '#pageEditHouseholdModal';
    const membersSection = document.querySelector(`${editModalSelector} .household-members-section`);
    membersSection.innerHTML = '';
  
    // Populate head of household fields
    document.getElementById('pageEditFirstName').value = hh.headOfHousehold.firstName || '';
    document.getElementById('pageEditLastName').value = hh.headOfHousehold.lastName || '';
    document.getElementById('pageEditDob').value = hh.headOfHousehold.dob ? formatDateForInput(hh.headOfHousehold.dob) : '';
    document.getElementById('pageEditSsn').value = hh.headOfHousehold.ssn || '';
    document.getElementById('pageEditTaxFilingStatus').value = hh.headOfHousehold.taxFilingStatus || '';
    document.getElementById('pageEditMaritalStatus').value = hh.headOfHousehold.maritalStatus || '';
    document.getElementById('pageEditMobileNumber').value = hh.headOfHousehold.mobileNumber || '';
    document.getElementById('pageEditHomePhone').value = hh.headOfHousehold.homePhone || '';
    document.getElementById('pageEditEmail').value = hh.headOfHousehold.email || '';
    document.getElementById('pageEditHomeAddress').value = hh.headOfHousehold.homeAddress || '';
      // Marginal Tax Bracket (may be null)
  document.getElementById('pageEditMarginalTaxBracket').value =
  hh.marginalTaxBracket != null ? hh.marginalTaxBracket : '';
  
    // Add existing additional members once
    const additionalMembers = (result.clients || []).filter(c => c._id !== hh.headOfHousehold._id);
  
    additionalMembers.forEach((member, index) => {
      addMemberFields(member, index, 'edit');
    });
  
    updateMemberIndices(editModalSelector);
  
    // Add event listener for the edit-add-household-member button here (remove any duplicates from elsewhere)
    const editAddMemberButton = document.querySelector(`${editModalSelector} #edit-add-household-member`);
    // Remove previously attached listeners if any (to prevent double-binding)
    editAddMemberButton.replaceWith(editAddMemberButton.cloneNode(true));
    const newEditAddMemberButton = document.querySelector(`${editModalSelector} #edit-add-household-member`);
    
    newEditAddMemberButton.addEventListener('click', () => {
      addMemberFields({}, undefined, 'edit');
      updateMemberIndices(editModalSelector);
    });
  
    // Show the modal
    const pageEditHouseholdModal = new bootstrap.Modal(document.getElementById('pageEditHouseholdModal'));
    pageEditHouseholdModal.show();
  }
  



   



const deleteConfirmationModalElement = document.getElementById('householdDeleteConfirmationModal');

const confirmDeleteHouseholdButton = document.getElementById('confirm-delete-household');

let deletingHouseholdId = null;

function openDeleteConfirmation(householdId) {
  deletingHouseholdId = householdId;
  deleteConfirmationModal.show();
}
if (confirmDeleteHouseholdButton){
    confirmDeleteHouseholdButton.addEventListener('click', () => {
    if (!deletingHouseholdId) return;
    fetch(`/api/households/${deletingHouseholdId}`, {
        method: 'DELETE'
    })
    .then(res => res.json())
    .then(data => {
        if (data.message && data.message.toLowerCase().includes('success')) {
        showAlert('success', data.message);
        deleteConfirmationModal.hide();
        fetchHouseholds(); // Refresh list
        } else {
        showAlert('danger', data.message || 'Error deleting household.');
        deleteConfirmationModal.hide();
        }
    })
    .catch(err => {
        console.error('Error deleting household:', err);
        showAlert('danger', 'Error deleting household.');
        deleteConfirmationModal.hide();
    });
    });
}

// Helper to format dates for input
function formatDateForInput(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date)) return '';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2,'0');
  const day = String(date.getUTCDate()).padStart(2,'0');
  return `${year}-${month}-${day}`;
}



function openAddHouseholdModal() {
    addHouseholdModal.show(); // Opens the modal defined in your HTML
}





    /**
     * Setup Pagination
     * @param {number} current - Current page number.
     * @param {number} total - Total number of pages.
     * @param {number} totalHouseholds - Total number of households.
     */
    const setupPagination = (current, total, totalHouseholds) => {
        currentPage = current;
        totalPages = total;

        if (!paginationContainer) return;
        paginationContainer.innerHTML = '';

        // Max number of visible pages in pagination
        const maxVisiblePages = 5;
        const startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
        const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

        // Previous Button
        const prevLi = document.createElement('li');
        prevLi.classList.add('page-item');
        if (currentPage === 1) {
            prevLi.classList.add('disabled');
        }
        const prevBtn = document.createElement('button');
        prevBtn.classList.add('page-link');
        prevBtn.textContent = 'Previous';
        prevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                fetchHouseholds();
            }
        });
        prevLi.appendChild(prevBtn);
        paginationContainer.appendChild(prevLi);

        // Ellipsis before the start (if necessary)
        if (startPage > 1) {
            const ellipsisLi = document.createElement('li');
            ellipsisLi.classList.add('page-item', 'disabled');
            const ellipsisSpan = document.createElement('span');
            ellipsisSpan.classList.add('page-link');
            ellipsisSpan.textContent = '...';
            ellipsisLi.appendChild(ellipsisSpan);
            paginationContainer.appendChild(ellipsisLi);
        }

        // Page Numbers
        for (let i = startPage; i <= endPage; i++) {
            const pageLi = document.createElement('li');
            pageLi.classList.add('page-item');
            if (i === currentPage) {
                pageLi.classList.add('active');
            }
            const pageBtn = document.createElement('button');
            pageBtn.classList.add('page-link');
            pageBtn.textContent = i;
            pageBtn.addEventListener('click', () => {
                currentPage = i;
                fetchHouseholds();
            });
            pageLi.appendChild(pageBtn);
            paginationContainer.appendChild(pageLi);
        }

        // Ellipsis after the end (if necessary)
        if (endPage < totalPages) {
            const ellipsisLi = document.createElement('li');
            ellipsisLi.classList.add('page-item', 'disabled');
            const ellipsisSpan = document.createElement('span');
            ellipsisSpan.classList.add('page-link');
            ellipsisSpan.textContent = '...';
            ellipsisLi.appendChild(ellipsisSpan);
            paginationContainer.appendChild(ellipsisLi);
        }

        // Next Button
        const nextLi = document.createElement('li');
        nextLi.classList.add('page-item');
        if (currentPage === totalPages) {
            nextLi.classList.add('disabled');
        }
        const nextBtn = document.createElement('button');
        nextBtn.classList.add('page-link');
        nextBtn.textContent = 'Next';
        nextBtn.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                fetchHouseholds();
            }
        });
        nextLi.appendChild(nextBtn);
        paginationContainer.appendChild(nextLi);

        // Pagination Info
        if (paginationInfo) {
            paginationInfo.textContent = `Page ${currentPage} of ${totalPages} | Total Households: ${totalHouseholds}`;
        }
    };

    // Search functionality with debounce
    let debounceTimeout;
    searchInput?.addEventListener('input', () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
            currentSearch = searchInput.value.trim();
            currentPage = 1;
            fetchHouseholds();
        }, 300);
    });



// Handle Add Household Modal Submission with the updated naming scheme
addHouseholdForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
  
    const formData = new FormData(addHouseholdForm);
    const data = Object.fromEntries(formData.entries());
    // Marginal Tax Bracket
    if (data.marginalTaxBracket === '') delete data.marginalTaxBracket;
    else data.marginalTaxBracket = Number(data.marginalTaxBracket);
  
    // Ensure head of household DOB is set to null if empty
    const dob = formData.get('dob');
    data.dob = dob ? dob : null;
  
    // Collect additional household members' data using the new scheme
    const memberContainers = document.querySelectorAll('#addHouseholdModal .household-member');
    data.additionalMembers = [];
  
    memberContainers.forEach((container) => {
      const member = {};
      member.firstName = container.querySelector('input[name$="[firstName]"]').value;
      member.lastName = container.querySelector('input[name$="[lastName]"]').value;
      member.dob = container.querySelector('input[name$="[dob]"]').value || null;
      member.ssn = container.querySelector('input[name$="[ssn]"]').value || null;
      member.taxFilingStatus = container.querySelector('select[name$="[taxFilingStatus]"]').value || null;
      member.maritalStatus = container.querySelector('select[name$="[maritalStatus]"]').value || null;
      member.mobileNumber = container.querySelector('input[name$="[mobileNumber]"]').value || null;
      member.homePhone = container.querySelector('input[name$="[homePhone]"]').value || null;
      member.email = container.querySelector('input[name$="[email]"]').value || null;
      member.homeAddress = container.querySelector('input[name$="[homeAddress]"]').value || null;
  
      if (member.firstName && member.lastName) {
        data.additionalMembers.push(member);
      }
    });
  
    try {
      const response = await fetch('/api/households', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
  
      const result = await response.json();
  
      if (response.ok) {
        showAlert('success', 'Household added successfully.');
        fetchHouseholds();
        addHouseholdModal.hide();
      } else {
        showAlert('danger', result.message || 'Failed to add household.');
      }
    } catch (err) {
      console.error('Error adding household:', err);
      showAlert('danger', 'An error occurred while adding the household.');
    }
  });




  // Reference to the Add Household modal elements
const addHouseholdModalSelector = '#addHouseholdModal';
const membersSection = document.querySelector(`${addHouseholdModalSelector} .household-members-section`);
const addMemberButton = document.querySelector(`${addHouseholdModalSelector} #add-household-member`);


function addMemberFields(memberData = {}, index, mode) {
    const modalSelector = mode === 'edit' ? '#pageEditHouseholdModal' : '#addHouseholdModal';
    const membersSection = document.querySelector(`${modalSelector} .household-members-section`);

    const memberIndex = index !== undefined ? index : Date.now();
    const memberContainer = document.createElement('div');
    memberContainer.classList.add('household-member', 'mb-4');
    memberContainer.dataset.memberIndex = memberIndex;

    const header = document.createElement('h6');
    header.classList.add('formModalHeadersTwo');
    header.textContent = 'Additional Household Member';

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.classList.add('btn', 'btn-danger', 'remove-member-btn');
    removeButton.textContent = 'Remove Member';

    removeButton.addEventListener('click', () => {
      memberContainer.remove();
      updateMemberIndices();
    });

    memberContainer.appendChild(header);

    if (memberData._id) {
      const hiddenIdInput = document.createElement('input');
      hiddenIdInput.type = 'hidden';
      hiddenIdInput.name = `additionalMembers[${memberIndex}][_id]`;
      hiddenIdInput.value = memberData._id;
      memberContainer.appendChild(hiddenIdInput);
    }

    const fields = [
      {
        label: 'First Name *',
        type: 'text',
        name: 'firstName',
        required: true,
        placeholder: 'Enter first name',
        value: memberData.firstName || '',
      },
      {
        label: 'Last Name *',
        type: 'text',
        name: 'lastName',
        required: true,
        placeholder: 'Enter last name',
        value: memberData.lastName || '',
      },
      {
        label: 'Date of Birth',
        type: 'date',
        name: 'dob',
        required: false,
        value: formatDateForInput(memberData.dob),
      },
      {
        label: 'Social Security Number (SSN)',
        type: 'text',
        name: 'ssn',
        required: false,
        placeholder: '123-45-6789',
        value: memberData.ssn || '',
      },
      {
        label: 'Mobile Number',
        type: 'tel',
        name: 'mobileNumber',
        required: false,
        placeholder: '123-456-7890',
        value: memberData.mobileNumber || '',
      },
      {
        label: 'Home Phone',
        type: 'tel',
        name: 'homePhone',
        required: false,
        placeholder: '123-456-7890',
        value: memberData.homePhone || '',
      },
      {
        label: 'Email',
        type: 'email',
        name: 'email',
        required: false,
        placeholder: 'example@domain.com',
        value: memberData.email || '',
      },
      {
        label: 'Home Address',
        type: 'text',
        name: 'homeAddress',
        required: false,
        placeholder: 'Enter home address',
        value: memberData.homeAddress || '',
      },
    ];

    fields.forEach((field) => {
      const fieldDiv = document.createElement('div');
      fieldDiv.classList.add('mb-3');

      const label = document.createElement('label');
      label.classList.add('form-label');
      label.setAttribute('for', `member_${field.name}_${memberIndex}`);
      label.textContent = field.label;

      const input = document.createElement('input');
      input.type = field.type;
      input.classList.add('form-control');
      input.id = `member_${field.name}_${memberIndex}`;
      input.name = `additionalMembers[${memberIndex}][${field.name}]`;
      if (field.required) input.required = true;
      if (field.placeholder) input.placeholder = field.placeholder;
      if (field.value) input.value = field.value;

      fieldDiv.appendChild(label);
      fieldDiv.appendChild(input);

      memberContainer.appendChild(fieldDiv);
    });

    const taxFilingStatusDiv = document.createElement('div');
    taxFilingStatusDiv.classList.add('mb-3');

    const taxFilingStatusLabel = document.createElement('label');
    taxFilingStatusLabel.classList.add('form-label');
    taxFilingStatusLabel.setAttribute('for', `memberTaxFilingStatus_${memberIndex}`);
    taxFilingStatusLabel.textContent = 'Tax Filing Status';

    const taxFilingStatusSelect = document.createElement('select');
    taxFilingStatusSelect.classList.add('form-select');
    taxFilingStatusSelect.id = `memberTaxFilingStatus_${memberIndex}`;
    taxFilingStatusSelect.name = `additionalMembers[${memberIndex}][taxFilingStatus]`;

    const taxFilingStatusOptions = [
      { value: '', text: 'Select Tax Filing Status' },
      { value: 'Married Filing Jointly', text: 'Married Filing Jointly' },
      { value: 'Married Filing Separately', text: 'Married Filing Separately' },
      { value: 'Single', text: 'Single' },
      { value: 'Head of Household', text: 'Head of Household' },
      { value: 'Qualifying Widower', text: 'Qualifying Widower' },
    ];

    taxFilingStatusOptions.forEach((optionData) => {
      const option = document.createElement('option');
      option.value = optionData.value;
      option.textContent = optionData.text;
      if (memberData.taxFilingStatus === optionData.value) {
        option.selected = true;
      }
      taxFilingStatusSelect.appendChild(option);
    });

    taxFilingStatusDiv.appendChild(taxFilingStatusLabel);
    taxFilingStatusDiv.appendChild(taxFilingStatusSelect);
    memberContainer.appendChild(taxFilingStatusDiv);

    const maritalStatusDiv = document.createElement('div');
    maritalStatusDiv.classList.add('mb-3');

    const maritalStatusLabel = document.createElement('label');
    maritalStatusLabel.classList.add('form-label');
    maritalStatusLabel.setAttribute('for', `memberMaritalStatus_${memberIndex}`);
    maritalStatusLabel.textContent = 'Marital Status';

    const maritalStatusSelect = document.createElement('select');
    maritalStatusSelect.classList.add('form-select');
    maritalStatusSelect.id = `memberMaritalStatus_${memberIndex}`;
    maritalStatusSelect.name = `additionalMembers[${memberIndex}][maritalStatus]`;

    const maritalStatusOptions = [
      { value: '', text: 'Select Marital Status' },
      { value: 'Married', text: 'Married' },
      { value: 'Single', text: 'Single' },
      { value: 'Widowed', text: 'Widowed' },
      { value: 'Divorced', text: 'Divorced' },
    ];

    maritalStatusOptions.forEach((optionData) => {
      const option = document.createElement('option');
      option.value = optionData.value;
      option.textContent = optionData.text;
      if (memberData.maritalStatus === optionData.value) {
        option.selected = true;
      }
      maritalStatusSelect.appendChild(option);
    });

    maritalStatusDiv.appendChild(maritalStatusLabel);
    maritalStatusDiv.appendChild(maritalStatusSelect);
    memberContainer.appendChild(maritalStatusDiv);

    memberContainer.appendChild(removeButton);
    membersSection.appendChild(memberContainer);
  }

// Ensure formatDateForInput is defined or imported from your householdDetails.js code
// If not defined here, add it:
function formatDateForInput(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (isNaN(date)) return '';
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function updateMemberIndices(modalSelector = '#addHouseholdModal') {
    const memberForms = document.querySelectorAll(`${modalSelector} .household-member`);
    memberForms.forEach((form, index) => {
      const header = form.querySelector('h6.formModalHeadersTwo');
      if (header) {
        header.textContent = `Additional Household Member ${index + 1}`;
      }
    });
  }
  

// Replace your previous addEventListener snippet with this:
addMemberButton.addEventListener('click', () => {
  // Add a new member field set using the common addMemberFields function
  // Passing {} for memberData since this is a new member, and 'add' for mode
  addMemberFields({}, undefined, 'add'); 
  updateMemberIndices(addHouseholdModalSelector);
});




    // Event Listener: Import Households
    if (importHouseholds && importHouseholdsModalElement) {
        importHouseholds.addEventListener('click', (e) => {
            e.preventDefault();
            if (uploadHouseholdsForm) {
                uploadHouseholdsForm.reset(); // Reset the form
                resetUploadState(); // Ensure the modal starts in 'idle' state
            }
            const universalImportModal = new bootstrap.Modal(importModal);
universalImportModal.show();

            console.log('click');
        });
    } else {
        console.error('Import households button or modal element not found.');
    }

    /**
     * Function: Set Upload State
     * Manages the UI state based on the upload progress.
     * @param {string} state - The current state ('idle', 'uploading', 'completed').
     * @param {Object} file - The uploaded file object.
     */
    function setUploadState(state, file) {
        uploadState = state;

        const uploadBox = document.querySelector('.upload-box.household-import-box');
        const progressSection = document.querySelector('.upload-progress');
        const completedSection = document.querySelector('.upload-completed');

        if (state === 'idle') {
            uploadBox.classList.remove('hidden');
            progressSection.classList.add('hidden');
            completedSection.classList.add('hidden');
            submitUploadButton.disabled = true; // Disable Submit until upload is complete
        } else if (state === 'uploading') {
            uploadBox.classList.add('hidden');
            progressSection.classList.remove('hidden');
            completedSection.classList.add('hidden');
            submitUploadButton.disabled = true; // Disable Submit during upload

            // Set file icon based on file type
            const fileIcon = document.getElementById('fileIcon');
            if (fileIcon) {
                if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
                    fileIcon.src = '/images/csv-icon.png'; // Ensure you have this icon
                    fileIcon.alt = 'CSV Icon';
                } else if (
                    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                    file.name.endsWith('.xlsx')
                ) {
                    fileIcon.src = '/images/excel-file-icon.png'; // Ensure you have this icon
                    fileIcon.alt = 'Excel Icon';
                }
            }

            // Initialize progress bar
            updateProgressBar(0);
        } else if (state === 'completed') {
            progressSection.classList.add('hidden');
            completedSection.classList.remove('hidden');

            // Set completed file icon based on file type
            const completedFileIcon = document.getElementById('completedFileIcon');
            if (completedFileIcon) {
                if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
                    completedFileIcon.src = '/images/csv-icon.png';
                    completedFileIcon.alt = 'CSV Icon';
                } else if (
                    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                    file.name.endsWith('.xlsx')
                ) {
                    completedFileIcon.src = '/images/excel-file-icon.png';
                    completedFileIcon.alt = 'Excel Icon';
                }
            }

            // Set completed file name
            const completedFileName = document.getElementById('completedFileName');
            if (completedFileName) {
                completedFileName.innerHTML = `File "<span class="file-name" title="${file.name}">${file.name}</span>" uploaded successfully.`;
            }

            // Enable Submit button
            submitUploadButton.disabled = false;
        }
    }

    /**
     * Function: Update Progress Bar
     * @param {number} percent - The completion percentage of the upload.
     */
    function updateProgressBar(percent) {
        const progressBar = document.querySelector('.upload-progress .progress-bar');
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
            progressBar.setAttribute('aria-valuenow', percent);
            progressBar.textContent = `${percent}%`;
        }
    }

    /**
     * Function: Reset Upload State
     * Resets the upload UI to the 'idle' state.
     */
    function resetUploadState() {
        setUploadState('idle');
    }

    // Event Listener: Remove File Button
    if (removeFileButton) {
        removeFileButton.addEventListener('click', () => {
            // Reset the form and upload state
            uploadHouseholdsForm.reset();
            resetUploadState();
        });
    }

    /**
     * Event Listener: File Selection (Click to Upload)
     * Handles file selection via input or drag-and-drop.
     */
    if (fileUploadInput) {
        // Disable the submit button initially
        submitUploadButton.disabled = true;

        // Event Listener: Change Event
        fileUploadInput.addEventListener('change', () => {
            const file = fileUploadInput.files[0];
            if (file && isSpreadsheetFile(file)) {
                initiateUpload(file);
            } else {
                showAlert('danger', 'Only spreadsheet files (CSV, Excel) are allowed.');
                uploadHouseholdsForm.reset();
                submitUploadButton.disabled = true;
            }
        });

        // Drag-and-drop functionality
        const uploadBox = document.querySelector('.upload-box.household-import-box');
        if (uploadBox) {
            uploadBox.addEventListener('dragover', (event) => {
                event.preventDefault();
                uploadBox.classList.add('drag-over');
            });

            uploadBox.addEventListener('dragleave', () => {
                uploadBox.classList.remove('drag-over');
            });

            uploadBox.addEventListener('drop', (event) => {
                event.preventDefault();
                uploadBox.classList.remove('drag-over');

                const file = event.dataTransfer.files[0];
                if (file && isSpreadsheetFile(file)) {
                    const dataTransfer = new DataTransfer(); // Create a new DataTransfer object
                    dataTransfer.items.add(file); // Add the dropped file to it
                    fileUploadInput.files = dataTransfer.files; // Assign the files to the input

                    initiateUpload(file); // Start upload immediately
                } else {
                    showAlert('danger', 'Only spreadsheet files (CSV, Excel) are allowed.');
                    uploadHouseholdsForm.reset();
                    submitUploadButton.disabled = true;
                }
            });
        }

        /**
         * Validates if the uploaded file is a spreadsheet file.
         * @param {File} file - The file to validate.
         * @returns {boolean} - True if the file is a valid spreadsheet, false otherwise.
         */
        function isSpreadsheetFile(file) {
            const allowedTypes = [
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'text/csv'
            ];
            return allowedTypes.includes(file.type);
        }

        /**
         * Initiates the file upload process.
         * @param {File} file - The file to upload.
         */
        function initiateUpload(file) {
            uploadHouseholdsForm.reset(); // Reset the form to prevent multiple uploads

            // Record the upload start time
            uploadStartTime = Date.now();

            // Update UI to Uploading State
            setUploadState('uploading', file);

            // Create XMLHttpRequest to handle upload with progress
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/households/import', true);

            // Update progress bar
            xhr.upload.onprogress = function (event) {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    updateProgressBar(percentComplete);
                }
            };

            // Handle response
            xhr.onload = function () {
                if (xhr.status === 200) {
                    // Assume successful upload
                    const result = JSON.parse(xhr.responseText);
                    handleUploadSuccess(result, file.name);
                } else {
                    // Handle error
                    showAlert('danger', 'Failed to upload file.');
                    resetUploadState();
                }
            };

            xhr.onerror = function () {
                showAlert('danger', 'An error occurred during the upload.');
                resetUploadState();
            };

            // Send the file
            const formData = new FormData();
            formData.append('fileUpload', file);
            xhr.send(formData);
        }
    }

    /**
 * Handles successful upload and prepares for mapping.
 * @param {Object} result - The server response.
 * @param {string} fileName - The name of the uploaded file.
 */
function handleUploadSuccess(result, fileName) {
    // Store headers and data globally
    headers = result.headers;
    uploadedData = result.uploadedData || [];
    s3Key = result.s3Key; // Capture the s3Key from the response

 

    if (uploadedData.length === 0) {
        showAlert('danger', 'No data extracted from the uploaded file.');
        resetUploadState();
        return;
    }

    // Calculate elapsed time since upload started
    const elapsedTime = Date.now() - uploadStartTime;
    const minUploadTime = 3000; // Minimum duration in milliseconds (3 seconds)
    const remainingTime = minUploadTime - elapsedTime;

    // Update progress bar to 100%
    updateProgressBar(100);

    if (remainingTime > 0) {
        // Wait for the remaining time before setting the completed state
        setTimeout(() => {
            setUploadState('completed', { name: fileName, type: getFileType(fileName) });
          
        }, remainingTime);
    } else {
        // Set the completed state immediately
        setUploadState('completed', { name: fileName, type: getFileType(fileName) });
   
    }
}


    /**
     * Determines the file type based on its name.
     * @param {string} fileName - The name of the file.
     * @returns {string} - The type of the file ('csv' or 'excel').
     */
    function getFileType(fileName) {
        if (fileName.endsWith('.csv')) return 'csv';
        if (fileName.endsWith('.xlsx')) return 'excel';
        return 'unknown';
    }

    /**
     * Function: Populate Mapping Dropdowns
     * Populates the dropdowns in the mapping modal with the uploaded file's headers.
     * @param {Array} headers - Array of header strings from the uploaded file.
     */
    function populateMappingDropdowns(headers) {
        const mappingForm = document.getElementById('mapping-form');
        const selects = mappingForm.querySelectorAll('select');

        selects.forEach((select) => {
            select.innerHTML = `<option value=''>-- Select Column --</option><option value='None'>None</option>`;
            headers.forEach((header) => {
                const option = document.createElement('option');
                option.value = header;
                option.textContent = header;
                select.appendChild(option);
            });
        });

        // Update other dropdowns when an option is selected
        selects.forEach((select) => {
            select.addEventListener('change', () => {
                updateDropdownOptions(selects);
            });
        });
    }

    /**
     * Function: Update Dropdown Options
     * Disables already selected options in other dropdowns to prevent duplicate mappings.
     * @param {NodeList} selects - All select elements in the mapping form.
     */
    function updateDropdownOptions(selects) {
        const selectedValues = Array.from(selects).map((select) => select.value).filter((value) => value && value !== 'None');

        selects.forEach((select) => {
            const currentValue = select.value;

            // Enable all options initially
            Array.from(select.options).forEach((option) => {
                option.disabled = false;
            });

            // Disable already selected options in other selects
            selectedValues.forEach((value) => {
                if (value !== currentValue) {
                    const optionToDisable = select.querySelector(`option[value="${value}"]`);
                    if (optionToDisable) {
                        optionToDisable.disabled = true;
                    }
                }
            });
        });
    }

    /**
     * Event Listener: Submit Button to Open Mapping Modal
     * Opens the mapping modal if the upload is completed.
     */
    submitUploadButton.addEventListener('click', () => {
        if (uploadState === 'completed') {
            if (headers.length === 0) {
                showAlert('danger', 'No headers found from the uploaded file.');
                return;
            }
            populateMappingDropdowns(headers); // Populate dropdowns with headers
            mappingModal.show(); // Open the mapping modal
        } else {
            showAlert('danger', 'Please complete the file upload before proceeding.');
        }
    });

//  /**
//  * Event Listener: Mapping Form Submission
//  * Handles mapping and initiates the import process.
//  */
// document.getElementById('mapping-form')?.addEventListener('submit', async (e) => {
//     e.preventDefault();

//     if (!uploadedData || uploadedData.length === 0) {
//         showAlert('danger', 'No uploaded data available. Please re-upload the file.');
//         return;
//     }

//     const formData = new FormData(e.target);

//     // ---------------------------------------------------------------------
//     // NEW LOGIC: Either map "Client Full Name" OR "Client First" + "Client Last"
//     // ---------------------------------------------------------------------
//     const fullNameSelection  = formData.get('mapping[Client Full Name]');
//     const firstNameSelection = formData.get('mapping[Client First]');
//     const lastNameSelection  = formData.get('mapping[Client Last]');

//     let validMapping = true;
//     let errorMsg = '';

//     // If user did NOT select a column for "Client Full Name", 
//     // then we require both "Client First" and "Client Last".
//     if (!fullNameSelection || fullNameSelection === 'None') {
//         if (!firstNameSelection || firstNameSelection === 'None' ||
//             !lastNameSelection  || lastNameSelection  === 'None') {
//           validMapping = false;
//           errorMsg = 'Please map EITHER "Client Full Name" OR both "Client First" and "Client Last".';
//         }
//     }

//     if (!validMapping) {
//         console.warn(errorMsg);
//         showAlert('danger', errorMsg);
//         return; // Stop form submission
//     }
//     // ---------------------------------------------------------------------

//     const mapping = {};
//     // Normalize headers for comparison
//     const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());

//     // Map selected columns, skipping empty or "None" values
//     formData.forEach((value, key) => {
//         if (value && value !== 'None') {
//             const normalizedValue = value.trim().toLowerCase();
//             const index = normalizedHeaders.indexOf(normalizedValue);
//             if (index === -1) {
//                 console.warn(`Mapping failed for field: ${key} with value: ${value}`);
//             } else {
//                 mapping[key] = index;
//             }
//         }
//     });

//     // Close the mapping modal immediately
//     mappingModal.hide();
//     importHouseholdsModal.hide();

//     try {
//         // Initiate the import process asynchronously
//         initiateImportProcess(mapping, uploadedData);
//     } catch (err) {
//         console.error('Error initiating import process:', err);
//         showAlert('danger', 'An error occurred while initiating the import process.');
//     }
// });


//    /**
//  * Function: Initiate Import Process
//  * Sends the mapping and uploaded data to the server to start the import.
//  * @param {Object} mapping - The mapping of CSV columns to fields.
//  * @param {Array} uploadedData - The uploaded household data.
//  */
// function initiateImportProcess(mapping, uploadedData) {
//     // Send mapping and uploaded data to the server to start import
//     fetch('/api/households/import/mapped', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ mapping, uploadedData, s3Key }), // Include s3Key here
//     })
//     .then(response => response.json())
//     .then(data => {
        
//         showAlert('success', 'Records import complete');
//         // The progress updates will be handled via Socket.io
//         setTimeout(() => {
//             window.location.reload();
//           }, 6000);
//     })
//     .catch(err => {
//         console.error('Error initiating import process:', err);
//         showAlert('danger', 'Failed to start the import process.');
//     });
// }


 

    /**
     * Dropdown Functionality
     * Toggles the visibility of dropdown menus.
     * @param {HTMLElement} button - The button that toggles the dropdown.
     * @param {HTMLElement} dropdown - The dropdown menu element.
     */
    function toggleDropdown(button, dropdown) {
        const isVisible = dropdown.classList.contains('show');

        if (isVisible) {
            dropdown.classList.remove('show');
            dropdown.classList.add('fade-out');
            setTimeout(() => {
                dropdown.style.display = 'none';
                dropdown.classList.remove('fade-out');
            }, 300); // Match CSS transition duration
        } else {
            dropdown.style.display = 'block';
            dropdown.classList.add('show');
        }
    }

    const dropdownButton = document.getElementById('add-household-dropdown');
    const dropdownMenu = document.querySelector('.dropdown-menu[aria-labelledby="add-household-dropdown"]');

    dropdownButton?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleDropdown(dropdownButton, dropdownMenu);
    });

    document.addEventListener('click', (event) => {
        if (!dropdownMenu.contains(event.target) && !dropdownButton.contains(event.target)) {
            if (dropdownMenu.classList.contains('show')) {
                toggleDropdown(dropdownButton, dropdownMenu);
            }
        }
    });


    const dropdownItems = dropdownMenu?.querySelectorAll('.dropdown-item');
    dropdownItems?.forEach((item) => {
        item.addEventListener('click', (e) => {
            e.preventDefault();

            if (item.id === 'add-single-household') {
                document.getElementById('add-household-form')?.reset();
                addHouseholdModal.show();
            } else if (item.id === 'import-households') {
                // This is already handled by the 'importHouseholds' button event listener
            }

            toggleDropdown(dropdownButton, dropdownMenu);
        });
    });




////////////////////////////////////////
// 1) Toggle for Single vs. Split name mapping (Households)
////////////////////////////////////////
const useHouseholdFullNameRadio = document.getElementById('useHouseholdFullName');
const useHouseholdSplitNamesRadio = document.getElementById('useHouseholdSplitNames');
const householdFullNameContainer = document.querySelector('.householdFullNameContainer');
const householdSplitNamesContainer = document.querySelector('.householdSplitNamesContainer');

function updateHouseholdNameMode() {
  if (useHouseholdFullNameRadio && useHouseholdFullNameRadio.checked) {
    // Show single full name container
    householdFullNameContainer.style.display = 'flex';
    // Hide the separate F/M/L container
    householdSplitNamesContainer.style.display = 'none';
  } else {
    // Show the split container
    householdFullNameContainer.style.display = 'none';
    householdSplitNamesContainer.style.display = 'flex';
  }
}

// Listen for changes
if (useHouseholdFullNameRadio) {
  useHouseholdFullNameRadio.addEventListener('change', updateHouseholdNameMode);
}
if (useHouseholdSplitNamesRadio) {
  useHouseholdSplitNamesRadio.addEventListener('change', updateHouseholdNameMode);
}

// Initialize once on page load
updateHouseholdNameMode();






// 1) References
const assignAdvisorsButton = document.getElementById('assign-advisors');
const assignAdvisorsModalElement = document.getElementById('assignAdvisorsModal');
const assignAdvisorsModal = assignAdvisorsModalElement ? new bootstrap.Modal(assignAdvisorsModalElement) : null;
const assignAdvisorsList = document.getElementById('assignAdvisorsList');
const confirmAssignAdvisorsButton = document.getElementById('confirm-assign-advisors');

// 2) When user clicks "Assign Advisors"
assignAdvisorsButton?.addEventListener('click', async () => {
  // If no households are selected, do nothing or show an alert
  if (!selectAllAcrossPages && selectedHouseholds.size === 0) {
    showAlert('warning', 'Please select at least one household first.');
    return;
  }

  // Clear the existing list
  assignAdvisorsList.innerHTML = '<li class="list-group-item text-muted">Loading advisors...</li>';

  // Open the modal
  if (assignAdvisorsModal) {
    assignAdvisorsModal.show();
  }

  try {
    // 3) Fetch advisors from your existing endpoint
    const response = await fetch('/api/households/api/leadAdvisors', { credentials: 'include' });
    if (!response.ok) {
      throw new Error('Failed to fetch advisors');
    }
    const data = await response.json();
    const leadAdvisor = data.leadAdvisors || [];

    // Clear loading text
    assignAdvisorsList.innerHTML = '';

    if (leadAdvisor.length === 0) {
      // If no leadAdvisor
      const li = document.createElement('li');
      li.classList.add('list-group-item', 'text-muted');
      li.textContent = 'No advisors found.';
      assignAdvisorsList.appendChild(li);
    } else {
      // Populate with checkboxes
      leadAdvisor.forEach(leadAdvisor => {
        const li = document.createElement('li');
        li.classList.add('list-group-item');

        const label = document.createElement('label');
        label.classList.add('d-flex', 'align-items-center');

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = leadAdvisor._id;
        checkbox.classList.add('form-check-input', 'me-2');

        const span = document.createElement('span');
        span.textContent = leadAdvisor.name;

        label.appendChild(checkbox);
        label.appendChild(span);
        li.appendChild(label);
        assignAdvisorsList.appendChild(li);
      });
    }
  } catch (error) {
    console.error('Error fetching advisors:', error);
    assignAdvisorsList.innerHTML = '<li class="list-group-item text-danger">Error loading advisors</li>';
  }
});

confirmAssignAdvisorsButton?.addEventListener('click', async () => {
    // Gather all checked advisors
    const checkedBoxes = assignAdvisorsList.querySelectorAll('input[type="checkbox"]:checked');
    if (checkedBoxes.length === 0) {
      showAlert('warning', 'No advisors selected.');
      return;
    }
  
    // Convert to array
    const advisorIdsToAssign = Array.from(checkedBoxes).map(cb => cb.value);
  
    // Also determine which households are selected
    let householdIds = [];
    if (selectAllAcrossPages) {
      // Optionally fetch all households if user selected "all across pages"
      try {
        const resp = await fetch('/api/households?page=1&limit=all');
        if (!resp.ok) throw new Error('Failed to fetch all households');
        const allData = await resp.json();
        householdIds = allData.households.map(h => h._id);
      } catch (err) {
        console.error(err);
        showAlert('danger', 'Failed to retrieve all households for assignment.');
        return;
      }
    } else {
      // Otherwise, we only have our local "selectedHouseholds" set
      householdIds = Array.from(selectedHouseholds);
    }
  
    if (householdIds.length === 0) {
      showAlert('warning', 'No households selected. Please select at least one household.');
      return;
    }
  
    // Send to backend
    try {
      const resp = await fetch('/api/households/bulk-assign-leadAdvisors', {
        method: 'PUT', // or POST if you prefer
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdIds, advisorIds: advisorIdsToAssign }),
      });
      const result = await resp.json();
      if (!resp.ok) {
        showAlert('danger', result.message || 'Failed to assign advisors.');
      } else {
        showAlert('success', 'Advisors assigned successfully.');
        // Hide the modal
        assignAdvisorsModal?.hide();
        // Refresh the table or reload page
        fetchHouseholds();
      }
    } catch (err) {
      console.error('Error assigning advisors:', err);
      showAlert('danger', 'An error occurred while assigning advisors.');
    }
  });
  



// --- Insert at the end of DOMContentLoaded in public/js/households.js ---

// 1) Elements
const unlinkedAlert     = document.getElementById('unlinked-alert');
const unlinkedCount     = document.getElementById('unlinked-count');
const showUnlinkedBtn   = document.getElementById('show-unlinked-accounts');
const unlinkedModal     = new bootstrap.Modal(document.getElementById('unlinkedAccountsModal'));
const modalCount        = document.getElementById('modal-unlinked-count');
const unlinkedList      = document.getElementById('unlinked-accounts-list');

// async function fetchUnlinkedAccounts() {
//   try {
//     const resp = await fetch('/api/accounts/unlinked', { credentials: 'include' });
//     if (!resp.ok) throw new Error('Failed to fetch unlinked accounts');
//     const { count, accounts } = await resp.json();

//     // 1) Banner
//     if (count > 0) {
//       unlinkedCount.textContent = `You have ${count} unlinked accounts.`;
//       if (modalCount) modalCount.textContent = count;
//       unlinkedAlert.classList.remove('hidden');
//     } else {
//       unlinkedAlert.classList.add('hidden');
//     }

//     // 2) Table body
//     const tbody = document.querySelector('#unlinked-accounts-table tbody');
//     if (!tbody) return;
//     tbody.innerHTML = '';

//     accounts.forEach(acc => {
//       const tr = document.createElement('tr');

//       // Checkbox cell
//       const tdChk = document.createElement('td');
//       tdChk.className = 'ua-checkbox-cell';
//       const checkbox = document.createElement('input');
//       checkbox.type = 'checkbox';
//       checkbox.dataset.id = acc._id;
//       tdChk.appendChild(checkbox);
//       tr.appendChild(tdChk);

//       // Account Number
//       const tdNum = document.createElement('td');
//       tdNum.className = 'ua-acc-number-cell';
//       tdNum.textContent = acc.accountNumber;
//       tr.appendChild(tdNum);

//       // Account Type
//       const tdType = document.createElement('td');
//       tdType.className = 'ua-acc-type-cell';
//       tdType.textContent = acc.accountType || '—';
//       tr.appendChild(tdType);

//       // Account Value
//       const tdVal = document.createElement('td');
//       tdVal.className = 'ua-acc-value-cell text-end';
//       tdVal.textContent = new Intl.NumberFormat('en-US', {
//         style: 'currency',
//         currency: 'USD'
//       }).format(acc.accountValue || 0);
//       tr.appendChild(tdVal);

//       // Client Name
//       const tdClient = document.createElement('td');
//       tdClient.className = 'ua-client-cell';
//       tdClient.textContent = acc.accountOwnerName || '—';
//       tr.appendChild(tdClient);

//       // External Account Owner Name
//       const tdOwner = document.createElement('td');
//       tdOwner.className = 'ua-owner-cell';
//       tdOwner.textContent = acc.externalAccountOwnerName || '—';
//       tr.appendChild(tdOwner);

//       // Action Buttons
//       const tdActions = document.createElement('td');
//       tdActions.className = 'ua-actions-cell';
//       // ... if you have existing buttons, append them here, e.g.:
//       // tdActions.appendChild(document.querySelector('#some-template').cloneNode(true));
//       tr.appendChild(tdActions);

//       // Icons / Delete
//       const tdIcons = document.createElement('td');
//       tdIcons.className = 'ua-icons-cell';
//       // ... append icons
//       tr.appendChild(tdIcons);

//       tbody.appendChild(tr);
//     });

//   } catch (err) {
//     console.error(err);
//     // fail silently
//   }
// }




// // 3) Show modal when banner button clicked
// showUnlinkedBtn.addEventListener('click', e => {
//   e.preventDefault();
//   unlinkedModal.show();
// });

// // 4) Kick it off
// fetchUnlinkedAccounts();











    /**
     * Initial Fetch of Households
     * Fetches households when the page loads.
     */
    fetchHouseholds();
   
});
