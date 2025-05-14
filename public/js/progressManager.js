/**
 * progressManager.js
 *
 * This file contains the ProgressManager class, which handles real-time
 * updates of the import progress via Socket.io.
 */
class ProgressManager {
    /**
     * Constructs the ProgressManager.
     * @param {Socket} socket - The Socket.io client instance.
     */
    constructor(socket) {
        this.socket = socket;
        this.progressContainer = document.getElementById('progress-container');
        this.loadingIndicator = this.progressContainer.querySelector('#progress-loading-indicator');
        this.importedCounterEl = document.getElementById('imported-counter');
        this.estimatedTimeEl = document.getElementById('estimated-time');
        this.progressBar = this.progressContainer.querySelector('.progress-bar');
        this.createdList = document.getElementById('created-list');
        this.updatedList = document.getElementById('updated-list');
        this.failedRecordsList = document.getElementById('failed-records-list');
        this.duplicateRecordsList = document.getElementById('duplicate-records-list');
        this.closeButton = this.progressContainer.querySelector('.close-button');
        this.getReportButton = document.getElementById('get-report-button'); // "Get Report" button

        // References to badge elements
        this.createdBadge = this.progressContainer.querySelector('#progressTabs .nav-link[href="#created-tab"] .badge-count');
        this.updatedBadge = this.progressContainer.querySelector('#progressTabs .nav-link[href="#updated-tab"] .badge-count');
        this.failedBadge = this.progressContainer.querySelector('#progressTabs .nav-link[href="#failed-records-tab"] .badge-count');
        this.duplicateBadge = this.progressContainer.querySelector('#progressTabs .nav-link[href="#duplicate-records-tab"] .badge-count');

        // Arrays to track displayed records
        this.displayedFailedRecords = [];
        this.displayedDuplicateRecords = [];

        // Possibly restore from localStorage if user reloaded
        this.checkLocalStorageForImport();

        // Initialize event listeners
        this.init();
    }

    /**
     * If the user refreshes after finishing an import, we can restore the final data
     * from localStorage so the container reappears with final results.
     */
    checkLocalStorageForImport() {
        const savedData = localStorage.getItem('importCompleteData');
        if (savedData) {
            try {
                const data = JSON.parse(savedData);
                // Show container + final data, skip reload
                this.showProgressContainer();
                this.hideLoadingSpinner();
                this.completeImport(data, /* skipReload */ true);

                // Remove so we don't keep showing it on every refresh
                localStorage.removeItem('importCompleteData');
            } catch (err) {
                console.error('Error parsing saved import data:', err);
                localStorage.removeItem('importCompleteData');
            }
        }
    }

    /**
     * Set up Socket.io event listeners and the close button functionality.
     */
    init() {
        // Listen for progress updates
        this.socket.on('importProgress', (data) => {
            this.hideLoadingSpinner();
            this.updateProgress(data);
        });

        // Listen for import completion
        this.socket.on('importComplete', (data) => {
            this.hideLoadingSpinner();
            this.completeImport(data);
        });

        // On reconnect, ask server for current progress
        this.socket.on('connect', () => {
            this.socket.emit('requestProgressData');
        });

        // Close button => hide container
        this.closeButton.addEventListener('click', () => {
            this.hideProgressContainer();
            // Tell server we closed progress
            this.socket.emit('progressClosed');
        });

        // "Get Report" button
        if (this.getReportButton) {
            this.getReportButton.addEventListener('click', () => {
                this.handleGetReport();
            });
        }
    }

    /**
     * Update the progress container in real-time.
     * @param {Object} data - The progress data from server.
     */
    updateProgress(data) {
        this.showProgressContainer();

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
            createdRecordsData,
            updatedRecordsData,
            failedRecordsData,
            duplicateRecordsData,
        } = data;

        this.importedCounterEl.textContent = `Created: ${createdRecords} | Updated: ${updatedRecords} | Total: ${totalRecords}`;
        this.estimatedTimeEl.textContent = `Estimated Time: ${estimatedTime}`;

        // Progress bar
        this.progressBar.style.width = `${percentage}%`;
        this.progressBar.setAttribute('aria-valuenow', percentage);

        if (percentage < 100) {
            this.progressBar.innerHTML = `${percentage}%`;
            this.progressBar.classList.remove('success');
        }

        // Rebuild Created list
        this.populateRecordsList(this.createdList, createdRecordsData || [], 'No records have been created yet.');
        // Rebuild Updated list
        this.populateRecordsList(this.updatedList, updatedRecordsData || [], 'No records have been updated yet.', true);

        // Update "Failed" records incrementally
        if (failedRecordsData && failedRecordsData.length > this.displayedFailedRecords.length) {
            const newFailed = failedRecordsData.slice(this.displayedFailedRecords.length);
            this.displayedFailedRecords = failedRecordsData;
            this.appendFailedRecords(newFailed);
        }

        // Update "Duplicate" records incrementally
        if (duplicateRecordsData && duplicateRecordsData.length > this.displayedDuplicateRecords.length) {
            const newDups = duplicateRecordsData.slice(this.displayedDuplicateRecords.length);
            this.displayedDuplicateRecords = duplicateRecordsData;
            this.appendDuplicateRecords(newDups);
        }

        // Update badges
        this.updateBadges(
            createdRecordsData || [],
            updatedRecordsData || [],
            failedRecordsData || [],
            duplicateRecordsData || []
        );
    }

    /**
     * Once the import is complete, we show final data. Then we optionally reload the page
     * so user sees updated data, but keep container open by using localStorage.
     * 
     * @param {Object} data - The final summary data.
     * @param {boolean} skipReload - If true, skip reloading the page.
     */
    completeImport(data, skipReload = false) {
        this.importedCounterEl.textContent = `Created: ${data.createdRecords} | Updated: ${data.updatedRecords} | Total: ${data.totalRecords}`;
        this.estimatedTimeEl.textContent = `Estimated Time: Completed`;

        // 100% progress
        this.progressBar.style.width = '100%';
        this.progressBar.setAttribute('aria-valuenow', 100);
        this.progressBar.classList.add('success');

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

        this.showProgressContainer();

        // Populate final data
        this.populateRecordsList(this.createdList, data.createdRecordsData || [], 'No records have been created yet.');
        this.populateRecordsList(this.updatedList, data.updatedRecordsData || [], 'No records have been updated yet.', true);
        this.populateRecordsList(this.failedRecordsList, data.failedRecordsData || [], 'No failed records.');
        this.populateRecordsList(this.duplicateRecordsList, data.duplicateRecordsData || [], 'No duplicate records.');

        this.updateBadges(
            data.createdRecordsData || [],
            data.updatedRecordsData || [],
            data.failedRecordsData || [],
            data.duplicateRecordsData || []
        );

        if (this.getReportButton && data.importReportId) {
            this.getReportButton.style.display = 'block';
            this.getReportButton.dataset.reportId = data.importReportId;
        }

        if (typeof showAlert === 'function') {
            showAlert('success', 'Import process completed successfully.');
        }

        // If not skipping reload, store final data and refresh after a slight delay
        if (!skipReload) {
            localStorage.setItem('importCompleteData', JSON.stringify(data));
            setTimeout(() => {
                window.location.reload();
            }, 2500);
        }
    }

    /**
     * Populates a record list (Created, Updated, Failed, Duplicate) or shows fallback message.
     * @param {HTMLElement} listElement 
     * @param {Array} records 
     * @param {string} noRecordsMessage 
     * @param {boolean} isUpdated 
     */
    populateRecordsList(listElement, records, noRecordsMessage, isUpdated = false) {
        if (!listElement) {
            console.error('populateRecordsList: listElement is null.');
            return;
        }

        listElement.innerHTML = '';

        if (records.length > 0) {
            records.forEach(record => {
                const displayName = this.getDisplayLabel(record);

                const li = document.createElement('li');
                li.classList.add('list-group-item', 'd-flex', 'align-items-center');

                const icon = document.createElement('span');
                let iconClass = 'material-symbols-outlined me-2';

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

                const recordText = document.createElement('span');

                if (isUpdated && record.updatedFields) {
                    const updatedFields = record.updatedFields.join(', ');
                    recordText.textContent = `${displayName} - Updated fields: ${updatedFields}`;
                } else if (record.reason) {
                    const reason = record.reason || 'No reason provided';
                    recordText.textContent = `${displayName} - ${reason}`;
                } else {
                    recordText.textContent = displayName;
                }

                li.appendChild(icon);
                li.appendChild(recordText);
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
     * Append new failed records
     * @param {Array} newFailedRecords 
     */
    appendFailedRecords(newFailedRecords) {
        if (!this.failedRecordsList) {
            console.error('appendFailedRecords: failedRecordsList is null.');
            return;
        }

        const firstListItem = this.failedRecordsList.querySelector('li');
        if (firstListItem && firstListItem.textContent.trim() === 'No failed records.') {
            this.failedRecordsList.removeChild(firstListItem);
        }

        newFailedRecords.forEach(record => {
            const displayName = this.getDisplayLabel(record);

            const li = document.createElement('li');
            li.classList.add('list-group-item', 'd-flex', 'align-items-center');

            const icon = document.createElement('span');
            icon.classList.add('material-symbols-outlined', 'text-danger', 'me-2');
            icon.textContent = 'cancel';

            const reason = record.reason || 'No reason provided';
            const recordText = document.createElement('span');
            recordText.textContent = `${displayName} - ${reason}`;

            li.appendChild(icon);
            li.appendChild(recordText);
            this.failedRecordsList.appendChild(li);
        });
    }

    /**
     * Append new duplicate records
     * @param {Array} newDuplicateRecords 
     */
    appendDuplicateRecords(newDuplicateRecords) {
        if (!this.duplicateRecordsList) {
            console.error('appendDuplicateRecords: duplicateRecordsList is null.');
            return;
        }

        const firstListItem = this.duplicateRecordsList.querySelector('li');
        if (firstListItem && firstListItem.textContent.trim() === 'No duplicate records.') {
            this.duplicateRecordsList.removeChild(firstListItem);
        }

        newDuplicateRecords.forEach(record => {
            const displayName = this.getDisplayLabel(record);

            const li = document.createElement('li');
            li.classList.add('list-group-item', 'd-flex', 'align-items-center');

            const icon = document.createElement('span');
            icon.classList.add('material-symbols-outlined', 'text-warning', 'me-2');
            icon.textContent = 'warning';

            const reason = record.reason || 'No reason provided';
            const recordText = document.createElement('span');
            recordText.textContent = `${displayName} - ${reason}`;

            li.appendChild(icon);
            li.appendChild(recordText);
            this.duplicateRecordsList.appendChild(li);
        });
    }

    /**
     * Figure out best label for the record
     */
    getDisplayLabel(record) {
        const { firstName, lastName, clientId, householdId, accountNumber } = record || {};

        // Force each to be a string before trimming to avoid "trim is not a function" errors:
        const f = String(firstName || '').trim();
        const l = String(lastName || '').trim();
        const c = String(clientId || '').trim();
        const h = String(householdId || '').trim();
        const a = String(accountNumber || '').trim();

        // Priority 1: first + last
        if (f && f !== 'N/A' && l && l !== 'N/A') {
            return `${f} ${l}`;
        }

        // Priority 2: accountNumber
        if (a && a !== 'N/A') {
            return a;
        }

        // Priority 3: clientId
        if (c && c !== 'N/A') {
            return c;
        }

        // Priority 4: householdId
        if (h && h !== 'N/A') {
            return h;
        }

        return 'N/A';
    }

    /**
     * Update badges for each tab
     */
    updateBadges(createdRecords, updatedRecords, failedRecords, duplicateRecords) {
        // Created
        if (this.createdBadge) {
            const createdTabLink = this.progressContainer.querySelector('#progressTabs .nav-link[href="#created-tab"]');
            if (createdRecords.length > 0) {
                this.createdBadge.style.display = 'flex';
                this.createdBadge.textContent = createdRecords.length;
                createdTabLink && createdTabLink.classList.add('has-badge');
            } else {
                this.createdBadge.style.display = 'none';
                this.createdBadge.textContent = '';
                createdTabLink && createdTabLink.classList.remove('has-badge');
            }
        }

        // Updated
        if (this.updatedBadge) {
            const updatedTabLink = this.progressContainer.querySelector('#progressTabs .nav-link[href="#updated-tab"]');
            if (updatedRecords.length > 0) {
                this.updatedBadge.style.display = 'flex';
                this.updatedBadge.textContent = updatedRecords.length;
                updatedTabLink && updatedTabLink.classList.add('has-badge');
            } else {
                this.updatedBadge.style.display = 'none';
                this.updatedBadge.textContent = '';
                updatedTabLink && updatedTabLink.classList.remove('has-badge');
            }
        }

        // Failed
        if (this.failedBadge) {
            const failedTabLink = this.progressContainer.querySelector('#progressTabs .nav-link[href="#failed-records-tab"]');
            if (failedRecords.length > 0) {
                this.failedBadge.style.display = 'flex';
                this.failedBadge.textContent = failedRecords.length;
                failedTabLink && failedTabLink.classList.add('has-badge');
            } else {
                this.failedBadge.style.display = 'none';
                this.failedBadge.textContent = '';
                failedTabLink && failedTabLink.classList.remove('has-badge');
            }
        }

        // Duplicate
        if (this.duplicateBadge) {
            const duplicateTabLink = this.progressContainer.querySelector('#progressTabs .nav-link[href="#duplicate-records-tab"]');
            if (duplicateRecords.length > 0) {
                this.duplicateBadge.style.display = 'flex';
                this.duplicateBadge.textContent = duplicateRecords.length;
                duplicateTabLink && duplicateTabLink.classList.add('has-badge');
            } else {
                this.duplicateBadge.style.display = 'none';
                this.duplicateBadge.textContent = '';
                duplicateTabLink && duplicateTabLink.classList.remove('has-badge');
            }
        }
    }

    /**
     * Show container
     */
    showProgressContainer() {
        if (this.progressContainer.classList.contains('hidden')) {
            this.progressContainer.classList.remove('hidden');
        }
    }

    showLoadingSpinner() {
        if (this.loadingIndicator) {
            this.loadingIndicator.classList.remove('hidden');
        }
    }

    hideLoadingSpinner() {
        if (this.loadingIndicator) {
            this.loadingIndicator.classList.add('hidden');
        }
    }

    /**
     * Hide container
     */
    hideProgressContainer() {
        if (!this.progressContainer.classList.contains('hidden')) {
            this.progressContainer.classList.add('hidden');
        }
    }

    /**
     * "Get Report" button => open new tab
     */
    handleGetReport() {
        if (this.isGeneratingReport) {
            console.warn('Report generation already in progress.');
            return;
        }
        this.isGeneratingReport = true;

        const reportId = this.getReportButton.dataset.reportId;
        if (!reportId) {
            console.error('No reportId available for generating the report.');
            alert('Report ID is missing. Please try again.');
            this.isGeneratingReport = false;
            return;
        }

        const reportUrl = `/api/households/import/report?reportId=${reportId}`;
        const newWindow = window.open(reportUrl, '_blank');
        if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
            alert('Unable to open the report. Please allow pop-ups for this website and try again.');
        }

        this.isGeneratingReport = false;
    }
}
