// public/js/progressManager.js

/**
 * ProgressManager handles real-time updates of the import progress.
 * It listens to Socket.io events and updates the UI accordingly.
 */
class ProgressManager {
    /**
     * Constructs the ProgressManager.
     * @param {Socket} socket - The Socket.io client instance.
     */
    constructor(socket) {
        this.socket = socket;
        this.progressContainer = document.getElementById('progress-container');
        this.importedCounterEl = document.getElementById('imported-counter');
        this.estimatedTimeEl = document.getElementById('estimated-time');
        this.progressBar = this.progressContainer.querySelector('.progress-bar');
        this.createdList = document.getElementById('created-list');
        this.updatedList = document.getElementById('updated-list');
        this.failedRecordsList = document.getElementById('failed-records-list');
        this.duplicateRecordsList = document.getElementById('duplicate-records-list');
        this.closeButton = this.progressContainer.querySelector('.close-button');
        this.getReportButton = document.getElementById('get-report-button'); // Reference to "Get Report" button

        // References to badge elements
        this.createdBadge = this.progressContainer.querySelector('#progressTabs .nav-link[href="#created-tab"] .badge-count');
        this.updatedBadge = this.progressContainer.querySelector('#progressTabs .nav-link[href="#updated-tab"] .badge-count');
        this.failedBadge = this.progressContainer.querySelector('#progressTabs .nav-link[href="#failed-records-tab"] .badge-count');
        this.duplicateBadge = this.progressContainer.querySelector('#progressTabs .nav-link[href="#duplicate-records-tab"] .badge-count');

        // Initialize arrays to track displayed records
        this.displayedFailedRecords = []; // To track displayed failed records
        this.displayedDuplicateRecords = []; // To track displayed duplicate records

        // Initialize event listeners
        this.init();
    }

    /**
     * Initializes the ProgressManager by setting up Socket.io event listeners
     * and the close button functionality.
     */
    init() {
        // Listen for progress updates
        this.socket.on('importProgress', (data) => {
            console.log('Received importProgress data:', data);
            this.updateProgress(data);
        });

        // Listen for import completion
        this.socket.on('importComplete', (data) => {
            console.log('Received importComplete data:', data);
            this.completeImport(data);
        });

        // Handle reconnection and receive existing progress data
        this.socket.on('connect', () => {
            console.log('Socket connected, requesting progress data.');
            this.socket.emit('requestProgressData');
        });

        // Handle progressClosed event from server
        this.socket.on('progressClosedAck', () => {
            console.log('Server acknowledged progress closure.');
        });

        // Handle close button click
        this.closeButton.addEventListener('click', () => {
            this.hideProgressContainer();
            console.log('Progress container closed by user.');
            // Notify the server to remove progress data
            this.socket.emit('progressClosed');
        });

        // Handle "Get Report" button click
        if (this.getReportButton) {
            this.getReportButton.addEventListener('click', () => {
                this.handleGetReport();
            });
        }

        // Initialize Bootstrap tooltips (if using tooltips for counts)
        this.initializeTooltips();
    }

    /**
     * Initializes Bootstrap tooltips for badges.
     */
    initializeTooltips() {
        var tooltipTriggerList = [].slice.call(this.progressContainer.querySelectorAll('[data-bs-toggle="tooltip"]'));
        var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });
    }

    /**
     * Updates the progress container with real-time data.
     * @param {Object} data - The progress data received from the server.
     */
    updateProgress(data) {
        // Show the progress container if it's hidden
        this.showProgressContainer();

        // Check if import is completed
        if (data.status === 'completed') {
            this.completeImport(data);
            return;
        }

        const {
            totalRecords,
            createdRecords,
            updatedRecords,
            failedRecords,
            duplicateRecords,
            percentage,
            estimatedTime,
            currentRecord,
            createdRecordsData,
            updatedRecordsData,
            failedRecordsData,
            duplicateRecordsData,
        } = data;

        // Update the record counter
        this.importedCounterEl.textContent = `Created: ${createdRecords} | Updated: ${updatedRecords} | Total: ${totalRecords}`;

        // Update the estimated time
        this.estimatedTimeEl.textContent = `Estimated Time: ${estimatedTime}`;

        // Update the progress bar's width and text
        this.progressBar.style.width = `${percentage}%`;
        this.progressBar.setAttribute('aria-valuenow', percentage);

        if (percentage < 100) {
            // Remove any existing innerHTML (like "Success!") and set textContent to percentage
            this.progressBar.innerHTML = `${percentage}%`;

            // Optionally, remove the 'success' class if previously added
            this.progressBar.classList.remove('success');
        }

        // Reconstruct the created records list
        this.populateRecordsList(this.createdList, createdRecordsData || [], 'No records have been created yet.');

        // Reconstruct the updated records list
        this.populateRecordsList(this.updatedList, updatedRecordsData || [], 'No records have been updated yet.', true);

        // Update the failed records list incrementally
        if (failedRecordsData && failedRecordsData.length > this.displayedFailedRecords.length) {
            // Get the new failed records
            const newFailedRecords = failedRecordsData.slice(this.displayedFailedRecords.length);

            // Update the displayed failed records list
            this.displayedFailedRecords = failedRecordsData;

            // Append new failed records to the list
            this.appendFailedRecords(newFailedRecords);
        }

        // Update the duplicate records list incrementally
        if (duplicateRecordsData && duplicateRecordsData.length > this.displayedDuplicateRecords.length) {
            // Get the new duplicate records
            const newDuplicateRecords = duplicateRecordsData.slice(this.displayedDuplicateRecords.length);

            // Update the displayed duplicate records list
            this.displayedDuplicateRecords = duplicateRecordsData;

            // Append new duplicate records to the list
            this.appendDuplicateRecords(newDuplicateRecords);
        }

        // Update badges based on records
        this.updateBadges(
            createdRecordsData || [],
            updatedRecordsData || [],
            failedRecordsData || [],
            duplicateRecordsData || []
        );
    }

    /**
     * Completes the import process by updating the UI with final data.
     * @param {Object} data - The completion data received from the server.
     */
    completeImport(data) {
        console.log('Handling importComplete with data:', data);

        // Update the record counter to reflect completion
        this.importedCounterEl.textContent = `Created: ${data.createdRecords} | Updated: ${data.updatedRecords} | Total: ${data.totalRecords}`;

        // Update the estimated time to "Completed"
        this.estimatedTimeEl.textContent = `Estimated Time: Completed`;

        // Update the progress bar to 100%
        this.progressBar.style.width = `100%`;
        this.progressBar.setAttribute('aria-valuenow', 100);

        // Add 'success' class for styling (optional)
        this.progressBar.classList.add('success');

        // Set innerHTML with separate containers for icon and text
        this.progressBar.innerHTML = `
            <div class="success-content d-flex align-items-center">
                <div class="success-icon me-2">
                    <span class="material-symbols-outlined">
                        check
                    </span>
                </div>
                <div class="progress-success-text">
                    Import Complete!
                </div>
            </div>
        `;

        // Show the progress container if it's hidden
        this.showProgressContainer();

        // Populate the Created Records tab
        this.populateRecordsList(this.createdList, data.createdRecordsData || [], 'No records have been created yet.');

        // Populate the Updated Records tab
        this.populateRecordsList(this.updatedList, data.updatedRecordsData || [], 'No records have been updated yet.', true);

        // Populate the Failed Records tab
        this.populateRecordsList(this.failedRecordsList, data.failedRecordsData || [], 'No failed records.');

        // Populate the Duplicate Records tab
        this.populateRecordsList(this.duplicateRecordsList, data.duplicateRecordsData || [], 'No duplicate records.');

        // Update badges based on records
        this.updateBadges(
            data.createdRecordsData || [],
            data.updatedRecordsData || [],
            data.failedRecordsData || [],
            data.duplicateRecordsData || []
        );

        // Show the "Get Report" button and set its reportId
        if (this.getReportButton && data.importReportId) {
            this.getReportButton.style.display = 'block';
            this.getReportButton.dataset.reportId = data.importReportId; // Set the report ID
        }

        // Optionally, display a success alert
        if (typeof showAlert === 'function') {
            showAlert('success', 'Import process completed successfully.');
        }
    }

    /**
     * Populates a records list with data or displays a fallback message if no data is present.
     * @param {HTMLElement} listElement - The ul element of the list to populate.
     * @param {Array} records - The array of records to populate.
     * @param {string} noRecordsMessage - The message to display if records are empty.
     * @param {boolean} isUpdated - Indicates if the list is for updated records.
     */
    populateRecordsList(listElement, records, noRecordsMessage, isUpdated = false) {
        if (!listElement) {
            console.error('populateRecordsList: listElement is null.');
            return;
        }

        console.log('Populating Records List with:', records);

        // Clear existing content
        listElement.innerHTML = '';

        if (records.length > 0) {
            records.forEach(record => {
                console.log('Processing Record:', record);

                // Access 'firstName' and 'lastName' directly
                const firstName = record.firstName || 'N/A';
                const lastName = record.lastName || 'N/A';

                // Create list item
                const li = document.createElement('li');
                li.classList.add('list-group-item', 'd-flex', 'align-items-center');

                // Create the icon
                const icon = document.createElement('span');
                let iconClass = 'material-symbols-outlined me-2';

                // Determine icon and color based on list type
                if (listElement === this.createdList) {
                    icon.classList.add(...iconClass.split(' '), 'text-success');
                    icon.textContent = 'check_circle';
                } else if (listElement === this.updatedList) {
                    icon.classList.add(...iconClass.split(' '), 'text-success');
                    icon.textContent = 'update';
                } else if (listElement === this.failedRecordsList) {
                    icon.classList.add(...iconClass.split(' '), 'text-danger');
                    icon.textContent = 'cancel';
                } else if (listElement === this.duplicateRecordsList) {
                    icon.classList.add(...iconClass.split(' '), 'text-warning');
                    icon.textContent = 'warning';
                } else {
                    icon.classList.add(...iconClass.split(' '));
                    icon.textContent = 'info';
                }

                // Create the record text
                const recordText = document.createElement('span');

                if (isUpdated && record.updatedFields) {
                    const updatedFields = record.updatedFields.join(', ');
                    recordText.textContent = `${firstName} ${lastName} - Updated fields: ${updatedFields}`;
                } else if (record.reason) {
                    // For failed or duplicate records
                    const reason = record.reason || 'No reason provided';
                    recordText.textContent = `${firstName} ${lastName} - ${reason}`;
                } else {
                    recordText.textContent = `${firstName} ${lastName}`;
                }

                // Append icon and text to the list item
                li.appendChild(icon);
                li.appendChild(recordText);

                // Append the list item to the list
                listElement.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.classList.add('list-group-item');
            li.textContent = noRecordsMessage;
            listElement.appendChild(li);
        }
    }

    /**
     * Appends new failed records to the failed records list.
     * @param {Array} newFailedRecords - Array of new failed records to append.
     */
    appendFailedRecords(newFailedRecords) {
        if (!this.failedRecordsList) {
            console.error('appendFailedRecords: failedRecordsList is null.');
            return;
        }

        // Remove "No failed records." message if present
        const firstListItem = this.failedRecordsList.querySelector('li');
        if (firstListItem && firstListItem.textContent.trim() === 'No failed records.') {
            this.failedRecordsList.removeChild(firstListItem);
        }

        newFailedRecords.forEach(record => {
            // Create list item
            const li = document.createElement('li');
            li.classList.add('list-group-item', 'd-flex', 'align-items-center');

            // Create the cancel icon
            const icon = document.createElement('span');
            icon.classList.add('material-symbols-outlined', 'text-danger', 'me-2');
            icon.textContent = 'cancel';

            // Create the record text
            const firstName = record.firstName || 'N/A';
            const lastName = record.lastName || 'N/A';
            const reason = record.reason || 'No reason provided';
            const recordText = document.createElement('span');
            recordText.textContent = `${firstName} ${lastName} - ${reason}`;

            // Append icon and text to the list item
            li.appendChild(icon);
            li.appendChild(recordText);

            // Append the list item to the failed records list
            this.failedRecordsList.appendChild(li);
        });
    }

    /**
     * Appends new duplicate records to the duplicate records list.
     * @param {Array} newDuplicateRecords - Array of new duplicate records to append.
     */
    appendDuplicateRecords(newDuplicateRecords) {
        if (!this.duplicateRecordsList) {
            console.error('appendDuplicateRecords: duplicateRecordsList is null.');
            return;
        }

        // Remove "No duplicate records." message if present
        const firstListItem = this.duplicateRecordsList.querySelector('li');
        if (firstListItem && firstListItem.textContent.trim() === 'No duplicate records.') {
            this.duplicateRecordsList.removeChild(firstListItem);
        }

        newDuplicateRecords.forEach(record => {
            // Create list item
            const li = document.createElement('li');
            li.classList.add('list-group-item', 'd-flex', 'align-items-center');

            // Create the warning icon
            const icon = document.createElement('span');
            icon.classList.add('material-symbols-outlined', 'text-warning', 'me-2');
            icon.textContent = 'warning';

            // Create the record text
            const firstName = record.firstName || 'N/A';
            const lastName = record.lastName || 'N/A';
            const reason = record.reason || 'No reason provided';
            const recordText = document.createElement('span');
            recordText.textContent = `${firstName} ${lastName} - ${reason}`;

            // Append icon and text to the list item
            li.appendChild(icon);
            li.appendChild(recordText);

            // Append the list item to the duplicate records list
            this.duplicateRecordsList.appendChild(li);
        });
    }

    /**
     * Updates the badge indicators based on the presence of records.
     * @param {Array} createdRecords - Array of created records.
     * @param {Array} updatedRecords - Array of updated records.
     * @param {Array} failedRecords - Array of failed records.
     * @param {Array} duplicateRecords - Array of duplicate records.
     */
    updateBadges(createdRecords, updatedRecords, failedRecords, duplicateRecords) {
        // Update Created Badge
        if (this.createdBadge) {
            const createdTabLink = this.progressContainer.querySelector('#progressTabs .nav-link[href="#created-tab"]');
            if (createdRecords.length > 0) {
                this.createdBadge.style.display = 'flex';
                this.createdBadge.textContent = createdRecords.length; // Set count
                if (createdTabLink) {
                    createdTabLink.classList.add('has-badge');
                }
            } else {
                this.createdBadge.style.display = 'none';
                this.createdBadge.textContent = ''; // Clear count
                if (createdTabLink) {
                    createdTabLink.classList.remove('has-badge');
                }
            }
        }

        // Update Updated Badge
        if (this.updatedBadge) {
            const updatedTabLink = this.progressContainer.querySelector('#progressTabs .nav-link[href="#updated-tab"]');
            if (updatedRecords.length > 0) {
                this.updatedBadge.style.display = 'flex';
                this.updatedBadge.textContent = updatedRecords.length; // Set count
                if (updatedTabLink) {
                    updatedTabLink.classList.add('has-badge');
                }
            } else {
                this.updatedBadge.style.display = 'none';
                this.updatedBadge.textContent = ''; // Clear count
                if (updatedTabLink) {
                    updatedTabLink.classList.remove('has-badge');
                }
            }
        }

        // Update Failed Badge
        if (this.failedBadge) {
            const failedTabLink = this.progressContainer.querySelector('#progressTabs .nav-link[href="#failed-records-tab"]');
            if (failedRecords.length > 0) {
                this.failedBadge.style.display = 'flex';
                this.failedBadge.textContent = failedRecords.length; // Set count
                if (failedTabLink) {
                    failedTabLink.classList.add('has-badge');
                }
            } else {
                this.failedBadge.style.display = 'none';
                this.failedBadge.textContent = ''; // Clear count
                if (failedTabLink) {
                    failedTabLink.classList.remove('has-badge');
                }
            }
        }

        // Update Duplicate Badge
        if (this.duplicateBadge) {
            const duplicateTabLink = this.progressContainer.querySelector('#progressTabs .nav-link[href="#duplicate-records-tab"]');
            if (duplicateRecords.length > 0) {
                this.duplicateBadge.style.display = 'flex';
                this.duplicateBadge.textContent = duplicateRecords.length; // Set count
                if (duplicateTabLink) {
                    duplicateTabLink.classList.add('has-badge');
                }
            } else {
                this.duplicateBadge.style.display = 'none';
                this.duplicateBadge.textContent = ''; // Clear count
                if (duplicateTabLink) {
                    duplicateTabLink.classList.remove('has-badge');
                }
            }
        }
    }

    /**
     * Shows the progress container by removing the 'hidden' class.
     */
    showProgressContainer() {
        if (this.progressContainer.classList.contains('hidden')) {
            this.progressContainer.classList.remove('hidden');
        }
    }

    /**
     * Hides the progress container by adding the 'hidden' class.
     */
    hideProgressContainer() {
        if (!this.progressContainer.classList.contains('hidden')) {
            this.progressContainer.classList.add('hidden');
        }
    }

    /**
     * Handles the "Get Report" button click.
     */
    handleGetReport() {
        const reportId = this.getReportButton.dataset.reportId;
    
        if (!reportId) {
            console.error('No reportId available for generating the report.');
            alert('Report ID is missing. Please try again.');
            return;
        }
    
        // Construct the URL to fetch the PDF
        const reportUrl = `/api/households/import/report?reportId=${reportId}`;
    
        // Attempt to open the PDF in a new tab
        const newWindow = window.open(reportUrl, '_blank');
    
        // Check if the window was blocked
        if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
            alert('Unable to open the report. Please allow pop-ups for this website and try again.');
        }
    }
    
    
}

// Initialize Socket.io
const socket = io();

// Instantiate ProgressManager
const progressManager = new ProgressManager(socket);

// Export the ProgressManager class as an ES6 module
export default ProgressManager;
