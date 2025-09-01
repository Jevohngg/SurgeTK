// public/js/importHistoryManager.js

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Socket.io
    const socket = io();

    // DOM Elements
    const importHistoryTableBody = document.querySelector('#import-history table tbody');
    const paginationContainer = document.getElementById('import-pagination');
    const paginationInfo = document.getElementById('import-pagination-info');
    const searchInput = document.getElementById('search-imports');
    const mappingModalElement = document.getElementById('mappingModal');
    const mappingModal = mappingModalElement ? new bootstrap.Modal(mappingModalElement) : null;
    const mappingForm = document.getElementById('mapping-form');
    const submitUploadButton = document.getElementById('submitUploadButton');
    const showAlert = (type, message) => {
        // Implement a simple alert mechanism or reuse existing one
        // For better UX, consider using Bootstrap alerts or a toast library
        const alertContainer = document.getElementById('alert-container');
        if (alertContainer) {
            const alertDiv = document.createElement('div');
            alertDiv.classList.add('alert', `alert-${type}`, 'alert-dismissible', 'fade', 'show');
            alertDiv.setAttribute('role', 'alert');
            alertDiv.innerHTML = `
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            `;
            alertContainer.appendChild(alertDiv);
        } else {
            // Fallback to window.alert if no alert container is found
            window.alert(message);
        }
    };

    // Pagination State
    let currentPage = 1;
    const limit = 10; // Records per page
    let totalPages = 1;
    let currentSearch = '';
    let currentSortField = 'createdAt';
    let currentSortOrder = 'desc'; // Latest imports first

    // Keep one SSE per importId
const undoSSEs = {};

function attachSSEToRow(importId) {
  if (undoSSEs[importId]) return; // already attached
  const es = new EventSource(`/api/new-import/${importId}/undo/stream`, { withCredentials: true });
  undoSSEs[importId] = es;

  es.onmessage = (evt) => {
    try {
      const { status, progress, error } = JSON.parse(evt.data);
      const span = document.querySelector(`.undo-inline-progress[data-import-id="${importId}"]`);
      if (span && typeof progress === 'number') {
        span.textContent = `Undo running... ${progress}%`;
      }
      // when done/failed, close and refresh list
      if (status === 'done' || status === 'failed') {
        if (span && status === 'failed' && error) span.textContent = `Undo failed: ${error}`;
        es.close();
        delete undoSSEs[importId];
        // refresh the table after a short delay
        setTimeout(() => {
          // refresh current page with latest statuses
          if (typeof fetchImportReports === 'function') fetchImportReports();
          else window.location.reload();
        }, 500);
      }
    } catch (_) {}
  };
  es.onerror = () => { /* allow manual refresh if dropped */ };
}


    // Fetch and Render Import Reports
    const fetchImportReports = async () => {
        try {
            showLoadingSpinner(true);
            const response = await fetch(`/api/new-import/history?page=${currentPage}&limit=${limit}&search=${encodeURIComponent(currentSearch)}&sortField=${currentSortField}&sortOrder=${currentSortOrder}`,
            {
                credentials: 'include',
                cache: 'no-store',
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to fetch import reports.');
            }

            const data = await response.json();

            // Update table
            renderImportReports(data.importReports);

            // Update pagination
            totalPages = data.totalPages;
            renderPagination(data.currentPage, data.totalPages, data.totalReports);

        } catch (error) {
            console.error('Error fetching import reports:', error);
            importHistoryTableBody.innerHTML = `<tr><td colspan="3" class="text-center text-danger">Failed to load import history: ${error.message}</td></tr>`;
            if (paginationContainer) {
                paginationContainer.innerHTML = '';
            }
            if (paginationInfo) {
                paginationInfo.textContent = '';
            }
            showAlert('danger', `An error occurred: ${error.message}`);
        } finally {
            showLoadingSpinner(false);
        }
    };

   /**
 * Renders import reports into the table body.
 * @param {Array} importReports - Array of import report objects.
 */
const renderImportReports = (importReports) => {
    if (!importReports || importReports.length === 0) {
        importHistoryTableBody.innerHTML = `<tr><td colspan="3" class="text-center">No import history available.</td></tr>`;
        return;
    }

    importHistoryTableBody.innerHTML = ''; // Clear existing rows

    importReports.forEach(report => {
        const tr = document.createElement('tr');

        // Import Type (Import Title) Cell
        const tdTitle = document.createElement('td');
        tdTitle.textContent = report.importType;
        tdTitle.classList.add('import-title'); // Assigned unique class
        tr.appendChild(tdTitle);

        // Import Date Cell
        const tdDate = document.createElement('td');
        const formattedDate = new Date(report.createdAt).toLocaleString();
        tdDate.textContent = formattedDate;
        tdDate.classList.add('import-date'); // Assigned unique class
        tr.appendChild(tdDate);

        // Actions Cell
        const tdActions = document.createElement('td');
        tdActions.classList.add('import-actions'); // Assigned unique class
        tdActions.classList.add('d-flex', 'align-items-center');

// Undo button (only show for the most recent firm import, or when an undo is running)
 // Undo / Reverted button logic
 const undoStatus = report.undo?.status || 'idle';
 
 if (undoStatus === 'done') {
   // Show a disabled "Reverted" button to indicate this import was undone
   const revertedBtn = document.createElement('button');
   revertedBtn.classList.add('btn', 'btn-outline-success', 'reverted-btn', 'ms-2');
   revertedBtn.textContent = 'Reverted';
   revertedBtn.disabled = true;
   revertedBtn.setAttribute('aria-disabled', 'true');
   if (report.undo?.finishedAt) {
     try {
       revertedBtn.title = `Reverted ${new Date(report.undo.finishedAt).toLocaleString()}`;
     } catch (_) {}
   }
   tdActions.appendChild(revertedBtn);
 } else if (undoStatus === 'running' || report.canUndo) {
   // Existing Undo button behavior
   const undoBtn = document.createElement('button');
   undoBtn.classList.add('btn', 'btn-outline-danger', 'undo-btn', 'ms-2', 'btn-undo-import');
   undoBtn.textContent = (undoStatus === 'running') ? 'Undo (running...)' : 'Undo';
   undoBtn.dataset.importId = report._id;
   undoBtn.disabled = (undoStatus === 'running');
   tdActions.appendChild(undoBtn);

   // If undo already running, show inline progress and attach SSE
   if (undoStatus === 'running') {
     const runningSpan = document.createElement('span');
     runningSpan.classList.add('ms-2', 'text-warning', 'undo-inline-progress');
     runningSpan.dataset.importId = report._id;
     runningSpan.textContent = `Undo running... ${report.undo?.progress || 0}%`;
     tdActions.appendChild(runningSpan);
     attachSSEToRow(report._id);
   }
 }
  
   // Get Report Button (Icon-Only)
const getReportButton = document.createElement('button');

// Assign Bootstrap button classes for consistent styling
getReportButton.classList.add('btn', 'btn-secondary', 'me-2', 'get-history-report-button');

// Add additional classes to define size and remove default padding if necessary
// You can customize these classes based on your design requirements
getReportButton.classList.add('btn-icon'); // Optional: Define this class in your CSS for specific icon button styles

// Set ARIA label for accessibility
getReportButton.setAttribute('aria-label', 'Get Report');

// Optionally, set type to "button" to prevent unintended form submissions
getReportButton.setAttribute('type', 'button');

// Set innerHTML to include the Material Symbol icon
getReportButton.innerHTML = `
    <span class="material-symbols-outlined">
        analytics
    </span>
`;

// Add click event listener
getReportButton.addEventListener('click', () => {
    const reportId = getReportButton.getAttribute('data-report-id');
    if (!reportId) {
        showAlert('danger', 'Report ID is missing.');
        return;
    }

    // Construct the URL to fetch the PDF
    const reportUrl = `/api/households/import/report?reportId=${reportId}`;

    // Open the PDF in a new tab
    const newWindow = window.open(reportUrl, '_blank');

    // Check if the window was blocked
    if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
        showAlert('danger', 'Unable to open the report. Please allow pop-ups for this website and try again.');
    }
});

// Assign the data-report-id attribute
getReportButton.setAttribute('data-report-id', report._id);

// Append the button to the Actions cell
tdActions.appendChild(getReportButton);


        tdActions.appendChild(getReportButton);

        // Download Original File Button (if available)
        if (report.originalFileKey) {
            const downloadLink = document.createElement('a');
            downloadLink.classList.add('btn', 'btn-outline-primary', 'download-import-file-button');
            downloadLink.href = `/api/new-import/history/${report._id}/download`;
            downloadLink.target = '_blank';
            downloadLink.title = 'Download Original File';

            // Determine file extension
            const fileKey = report.originalFileKey;
            const fileExtension = fileKey.split('.').pop().toLowerCase();

            const img = document.createElement('img');
            if (fileExtension === 'csv') {
                img.src = '/images/csv-icon.png';
                img.alt = 'CSV File Icon';
            } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
                img.src = '/images/excel-file-icon.png';
                img.alt = 'Excel File Icon';
            } else {
                const downloadIcon = document.createElement('i');
                downloadIcon.classList.add('fas', 'fa-download');
                downloadLink.appendChild(downloadIcon);
            }

            if (fileExtension === 'csv' || fileExtension === 'xlsx' || fileExtension === 'xls') {
                img.width = 24;
                img.height = 24;
                img.style.cursor = 'pointer';
                downloadLink.appendChild(img);
            }

            tdActions.appendChild(downloadLink);
        } else {
            const noFileSpan = document.createElement('span');
            noFileSpan.classList.add('text-muted', 'no-file-icon');
            noFileSpan.textContent = 'No file available';
            tdActions.appendChild(noFileSpan);
        }

        tr.appendChild(tdActions);

        importHistoryTableBody.appendChild(tr);
    });
};


    /**
     * Renders pagination controls.
     * @param {number} current - Current page number.
     * @param {number} total - Total number of pages.
     * @param {number} totalReports - Total number of import reports.
     */
    const renderPagination = (current, total, totalReports) => {
        if (!paginationContainer) return;
        paginationContainer.innerHTML = ''; // Clear existing pagination

        // Previous Button
        const prevLi = document.createElement('li');
        prevLi.classList.add('page-item');
        if (current === 1) {
            prevLi.classList.add('disabled');
        }
        const prevBtn = document.createElement('button');
        prevBtn.classList.add('page-link');
        prevBtn.textContent = 'Previous';
        prevBtn.addEventListener('click', () => {
            if (current > 1) {
                currentPage--;
                fetchImportReports();
            }
        });
        prevLi.appendChild(prevBtn);
        paginationContainer.appendChild(prevLi);

        // Page Numbers
        const maxVisiblePages = 5;
        let startPage = Math.max(1, current - Math.floor(maxVisiblePages / 2));
        let endPage = startPage + maxVisiblePages - 1;

        if (endPage > total) {
            endPage = total;
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        if (startPage > 1) {
            const firstPageLi = document.createElement('li');
            firstPageLi.classList.add('page-item');
            const firstPageBtn = document.createElement('button');
            firstPageBtn.classList.add('page-link');
            firstPageBtn.textContent = '1';
            firstPageBtn.addEventListener('click', () => {
                currentPage = 1;
                fetchImportReports();
            });
            firstPageLi.appendChild(firstPageBtn);
            paginationContainer.appendChild(firstPageLi);

            if (startPage > 2) {
                const ellipsisLi = document.createElement('li');
                ellipsisLi.classList.add('page-item', 'disabled');
                const ellipsisSpan = document.createElement('span');
                ellipsisSpan.classList.add('page-link');
                ellipsisSpan.textContent = '...';
                ellipsisLi.appendChild(ellipsisSpan);
                paginationContainer.appendChild(ellipsisLi);
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            const pageLi = document.createElement('li');
            pageLi.classList.add('page-item');
            if (i === current) {
                pageLi.classList.add('active');
            }
            const pageBtn = document.createElement('button');
            pageBtn.classList.add('page-link');
            pageBtn.textContent = i;
            pageBtn.addEventListener('click', () => {
                currentPage = i;
                fetchImportReports();
            });
            pageLi.appendChild(pageBtn);
            paginationContainer.appendChild(pageLi);
        }

        if (endPage < total) {
            if (endPage < total - 1) {
                const ellipsisLi = document.createElement('li');
                ellipsisLi.classList.add('page-item', 'disabled');
                const ellipsisSpan = document.createElement('span');
                ellipsisSpan.classList.add('page-link');
                ellipsisSpan.textContent = '...';
                ellipsisLi.appendChild(ellipsisSpan);
                paginationContainer.appendChild(ellipsisLi);
            }

            const lastPageLi = document.createElement('li');
            lastPageLi.classList.add('page-item');
            const lastPageBtn = document.createElement('button');
            lastPageBtn.classList.add('page-link');
            lastPageBtn.textContent = total;
            lastPageBtn.addEventListener('click', () => {
                currentPage = total;
                fetchImportReports();
            });
            lastPageLi.appendChild(lastPageBtn);
            paginationContainer.appendChild(lastPageLi);
        }

        // Next Button
        const nextLi = document.createElement('li');
        nextLi.classList.add('page-item');
        if (current === total) {
            nextLi.classList.add('disabled');
        }
        const nextBtn = document.createElement('button');
        nextBtn.classList.add('page-link');
        nextBtn.textContent = 'Next';
        nextBtn.addEventListener('click', () => {
            if (current < total) {
                currentPage++;
                fetchImportReports();
            }
        });
        nextLi.appendChild(nextBtn);
        paginationContainer.appendChild(nextLi);

        // Update Pagination Info
        if (paginationInfo) {
            const startItem = (currentPage - 1) * limit + 1;
            const endItem = Math.min(currentPage * limit, totalReports);
            paginationInfo.textContent = `Showing ${startItem} to ${endItem} of ${totalReports} import${totalReports !== 1 ? 's' : ''}`;
        }
    };

    /**
     * Shows or hides the loading spinner.
     * @param {boolean} show - Whether to show the spinner.
     */
    const showLoadingSpinner = (show) => {
        const spinner = document.getElementById('loading-spinner');
        if (spinner) {
            spinner.style.display = show ? 'block' : 'none';
        }
    };

    /**
     * Event Listener: Search Input with Debounce
     */
    let searchTimeout;
    searchInput?.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearch = searchInput.value.trim();
            currentPage = 1; // Reset to first page on new search
            fetchImportReports();
        }, 300); // 300ms debounce
    });

    /**
     * Listen for newImportReport via Socket.io and update the table accordingly.
     */
    socket.on('newImportReport', (data) => {
        console.log('Received newImportReport:', data);
        // Optionally, refresh the current page or prepend the new report
        // Here, we'll check if the current page is the first page and prepend
        if (currentPage === 1) {
            fetchImportReports();
        }
    });

    /**
     * Initial Fetch on Page Load
     */
    fetchImportReports();

    /**
     * Optional: Handle Sorting via Column Headers
     * You can implement click events on table headers to sort by different fields.
     * For simplicity, this example assumes sorting by createdAt in descending order.
     * Extend this as needed.
     */

    /**
     * Optional: Handle Import Form Submission
     * If the import process affects the import history, ensure to refresh the table after import.
     */
    const importForm = document.getElementById('import-form');
    if (importForm) {
        importForm.addEventListener('submit', (e) => {
            e.preventDefault();
            // Handle file upload and mapping as per your existing implementation
            // After successful import, the server should emit 'newImportReport' via Socket.io
            // which is already handled above to refresh the table if on the first page
        });
    }

    /**
     * Optional: Handle Other Actions (e.g., Delete Import Reports)
     * Implement additional functionalities as needed.
     */
});
