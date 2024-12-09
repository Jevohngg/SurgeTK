// public/js/households.js
import ProgressManager from './progressManager.js';

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
    const addMemberButton = document.getElementById('add-household-member');
    const membersSection = document.querySelector('.household-members-section');
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

    console.log('Showing selection container');
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
    importHouseholdsModal.show(); 

});



/**
 * Function to hide the selection container with opacity and margin-bottom transitions.
 */
function hideSelectionContainer() {
    if (isTransitioning) return;
    isTransitioning = true;

    console.log('Hiding selection container');
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

    // Confirm Deletion
    confirmDeleteButton?.addEventListener('click', async () => {
        // Prepare the list of household IDs to delete
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

        // Send DELETE request to the server
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
                
                // Refresh the households list
                fetchHouseholds();
            } else {
                // If specific invalid IDs are returned, handle them
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
     * Fetch Households Function
     * Fetches households from the server with pagination, search, and sorting.
     */
    const fetchHouseholds = async () => {
        try {
            const response = await fetch(`/api/households?page=${currentPage}&limit=${selectAllAcrossPages ? 'all' : 10}&search=${encodeURIComponent(currentSearch)}&sortField=${currentSortField}&sortOrder=${currentSortOrder}`, {
                credentials: 'include', // Ensure cookies are sent for session authentication
                cache: 'no-store',      // Prevent caching of the response
            });
    
            if (!response.ok) {
                throw new Error('Failed to fetch households.');
            }
    
            const data = await response.json();
    
            // Update totalHouseholdsCount from API response
            totalHouseholdsCount = data.totalHouseholds;
    
            renderHouseholds(data.households);
            setupPagination(data.currentPage, data.totalPages, data.totalHouseholds);
    
            updateSelectionContainer();
        } catch (error) {
            console.error('Error fetching households:', error);
            showAlert('danger', 'Failed to load households.');
        }
    };
    
/**
 * Render Households
 * Dynamically toggles the table/pagination and empty state visibility.
 * @param {Array} households - Array of household objects to render.
 */
const renderHouseholds = (households) => {
    const tableContainer = document.querySelector('.table-and-pagination-container');
    const emptyStateContainer = document.querySelector('.empty-state-container');
    const tableBody = document.querySelector('#households-body');
    
    if (!tableContainer || !emptyStateContainer || !tableBody) return;

    if (!households || households.length === 0) {
        // Show the empty state container and hide the table container
        tableContainer.classList.add('hidden');
        emptyStateContainer.classList.remove('hidden');
    } else {
        // Show the table container and hide the empty state container
        tableContainer.classList.remove('hidden');
        emptyStateContainer.classList.add('hidden');

        // Populate the table
        tableBody.innerHTML = ''; // Clear existing rows
        households.forEach(({ _id, headOfHouseholdName, totalAccountValue }) => {
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
            nameTd.textContent = headOfHouseholdName;
            nameTd.classList.add('household-name-cell');

            // Total account value cell
            const valueTd = document.createElement('td');
            valueTd.textContent = totalAccountValue;
            valueTd.classList.add('household-value-cell');

            // Append cells to the row
            tr.appendChild(checkboxTd);
            tr.appendChild(nameTd);
            tr.appendChild(valueTd);

            // Add event listener for row click
            tr.addEventListener('click', (e) => {
                if (e.target.type !== 'checkbox') {
                    window.location.href = `/households/${_id}`;
                }
            });

            // Append the row to the table body
            tableBody.appendChild(tr);
        });
    }
};


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

    /**
     * Handle Add Household Modal Submission
     */
    addHouseholdForm?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(addHouseholdForm);
        const data = Object.fromEntries(formData.entries());

        // Ensure head of household DOB is set to null if empty
        const dob = formData.get('dob');
        data.dob = dob ? dob : null;

        // Collect additional household members' data
        const memberForms = document.querySelectorAll('.household-member-form');
        const additionalMembers = Array.from(memberForms).map((form) => {
            const memberDob = form.querySelector('input[name="memberDob[]"]')?.value;

            return {
                firstName: form.querySelector('input[name="memberFirstName[]"]')?.value,
                lastName: form.querySelector('input[name="memberLastName[]"]')?.value,
                dob: memberDob ? memberDob : null, // Set DOB to null if empty
                ssn: form.querySelector('input[name="memberSsn[]"]')?.value || null,
                taxFilingStatus: form.querySelector('select[name="memberTaxFilingStatus[]"]')?.value || null,
                mobileNumber: form.querySelector('input[name="memberMobileNumber[]"]')?.value || null,
                email: form.querySelector('input[name="memberEmail[]"]')?.value || null,
                homeAddress: form.querySelector('input[name="memberHomeAddress[]"]')?.value || null,
            };
        });

        // Add additional members to the data payload
        data.additionalMembers = additionalMembers;

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

    /**
     * Event Listener: Add Household Member
     * Allows users to dynamically add additional household member forms.
     */
    addMemberButton.addEventListener('click', () => {
        const memberIndex = membersSection.querySelectorAll('.household-member-form').length + 1;

        const memberForm = document.createElement('div');
        memberForm.classList.add('household-member-form', 'mb-4');

        memberForm.innerHTML = `
            <h6 class="formModalHeadersTwo">Additional Household Member ${memberIndex}</h6>
            <div class="mb-3">
                <label class="form-label">First Name *</label>
                <input type="text" class="form-control" name="memberFirstName[]" placeholder="Enter first name" required>
            </div>
            <div class="mb-3">
                <label class="form-label">Last Name *</label>
                <input type="text" class="form-control" name="memberLastName[]" placeholder="Enter last name" required>
            </div>
            <div class="mb-3">
                <label class="form-label">Date of Birth</label>
                <input type="date" class="form-control" name="memberDob[]" placeholder="MM/DD/YYYY">
            </div>
            <div class="mb-3">
                <label class="form-label">Social Security Number (SSN)</label>
                <input type="text" class="form-control" name="memberSsn[]" placeholder="123-45-6789">
            </div>
            <div class="mb-3">
                <label class="form-label">Tax Filing Status</label>
                <select class="form-select" name="memberTaxFilingStatus[]">
                    <option value="">Select Tax Filing Status</option>
                    <option value="Married Filing Jointly">Married Filing Jointly</option>
                    <option value="Married Filing Separately">Married Filing Separately</option>
                    <option value="Single">Single</option>
                    <option value="Head of Household">Head of Household</option>
                    <option value="Qualifying Widower">Qualifying Widower</option>
                </select>
            </div>
            <div class="mb-3">
                <label class="form-label">Mobile Number</label>
                <input type="tel" class="form-control" name="memberMobileNumber[]" placeholder="123-456-7890">
            </div>
            <div class="mb-3">
                <label class="form-label">Email</label>
                <input type="email" class="form-control" name="memberEmail[]" placeholder="example@domain.com">
            </div>
            <div class="mb-3">
                <label class="form-label">Home Address</label>
                <input type="text" class="form-control" name="memberHomeAddress[]" placeholder="Enter home address">
            </div>
            <button type="button" class="btn btn-danger remove-member-btn">Remove</button>
        `;

        // Insert the member form above the "Add Household Member" button
        membersSection.insertBefore(memberForm, addMemberButton);

        // Event Listener: Remove Household Member
        memberForm.querySelector('.remove-member-btn').addEventListener('click', () => {
            memberForm.remove();
            updateMemberIndices();
        });
    });

    /**
     * Function to update the indices of additional household member forms.
     * Ensures that member numbers remain sequential after removal.
     */
    function updateMemberIndices() {
        const memberForms = membersSection.querySelectorAll('.household-member-form');
        memberForms.forEach((form, index) => {
            const header = form.querySelector('h6.formModalHeadersTwo');
            if (header) {
                header.textContent = `Additional Household Member ${index + 1}`;
            }
        });
    }

    // Event Listener: Import Households
    if (importHouseholds && importHouseholdsModalElement) {
        importHouseholds.addEventListener('click', (e) => {
            e.preventDefault();
            if (uploadHouseholdsForm) {
                uploadHouseholdsForm.reset(); // Reset the form
                resetUploadState(); // Ensure the modal starts in 'idle' state
            }
            importHouseholdsModal.show(); // Show the modal
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

    console.log('Received Headers:', headers);
    console.log('Uploaded Data:', uploadedData);
    console.log('S3 Key:', s3Key); // Debugging

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
            console.log(`File "${fileName}" uploaded successfully.`);
        }, remainingTime);
    } else {
        // Set the completed state immediately
        setUploadState('completed', { name: fileName, type: getFileType(fileName) });
        console.log(`File "${fileName}" uploaded successfully.`);
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

    /**
     * Event Listener: Mapping Form Submission
     * Handles mapping and initiates the import process.
     */
    document.getElementById('mapping-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!uploadedData || uploadedData.length === 0) {
            showAlert('danger', 'No uploaded data available. Please re-upload the file.');
            return;
        }

        const formData = new FormData(e.target);
        const mapping = {};

        // Normalize headers for comparison
        const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());

        // Map selected columns, skipping empty or "None" values
        let invalidMapping = false; // Flag for invalid mappings
        formData.forEach((value, key) => {
            if (value && value !== 'None') {
                const normalizedValue = value.trim().toLowerCase();
                const index = normalizedHeaders.indexOf(normalizedValue);
                if (index === -1) {
                    console.warn(`Mapping failed for field: ${key} with value: ${value}`);
                } else {
                    mapping[key] = index;
                }
            } else if (['mapping[Client First]', 'mapping[Client Last]'].includes(key) && value === 'None') {
                // Check if required fields are set to "None"
                invalidMapping = true;
            }
        });

        // Debugging: Log final mapping object
        console.log('Final Mapping Object:', mapping);

        // Validate required fields explicitly
        const requiredFields = ['mapping[Client First]', 'mapping[Client Last]'];
        const missingFields = requiredFields.filter((field) => !(field in mapping));

        if (invalidMapping) {
            console.warn('First Name or Last Name mapping set to "None".');
            showAlert('danger', 'First Name and Last Name are required and cannot be set to "None".');
            return;
        }

        if (missingFields.length > 0) {
            console.warn('Missing required fields:', missingFields);
            showAlert('danger', `Missing required fields: ${missingFields.join(', ')}`);
            return;
        }

        // Close the mapping modal immediately
        mappingModal.hide();
        importHouseholdsModal.hide();

        try {
            // Initiate the import process asynchronously
            initiateImportProcess(mapping, uploadedData);
        } catch (err) {
            console.error('Error initiating import process:', err);
            showAlert('danger', 'An error occurred while initiating the import process.');
        }
    });

   /**
 * Function: Initiate Import Process
 * Sends the mapping and uploaded data to the server to start the import.
 * @param {Object} mapping - The mapping of CSV columns to fields.
 * @param {Array} uploadedData - The uploaded household data.
 */
function initiateImportProcess(mapping, uploadedData) {
    // Send mapping and uploaded data to the server to start import
    fetch('/api/households/import/mapped', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapping, uploadedData, s3Key }), // Include s3Key here
    })
    .then(response => response.json())
    .then(data => {
        console.log('Import process initiated:', data.message);
        showAlert('success', 'Records import complete');
        // The progress updates will be handled via Socket.io
    })
    .catch(err => {
        console.error('Error initiating import process:', err);
        showAlert('danger', 'Failed to start the import process.');
    });
}


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

    /**
     * Initial Fetch of Households
     * Fetches households when the page loads.
     */
    fetchHouseholds();
});
