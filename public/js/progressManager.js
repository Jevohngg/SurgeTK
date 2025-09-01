/**
 * progressManager.js
 *
 * This file contains the ProgressManager class, which handles real-time
 * updates of the import progress via Socket.io.
 */
class ProgressManager {
  constructor(socket) {
    this.socket = socket;
    this.progressContainer = document.getElementById('progress-container');

    // Always scope to the container ↓
    this.loadingIndicator    = this.progressContainer?.querySelector('#progress-loading-indicator') || null;
    this.importedCounterEl   = this.progressContainer?.querySelector('#imported-counter') || null;
    this.estimatedTimeEl     = this.progressContainer?.querySelector('#estimated-time') || null;
    this.progressBar         = this.progressContainer?.querySelector('.progress-bar') || null;
    this.createdList         = this.progressContainer?.querySelector('#created-list') || null;
    this.updatedList         = this.progressContainer?.querySelector('#updated-list') || null;
    this.failedRecordsList   = this.progressContainer?.querySelector('#failed-records-list') || null;
    this.duplicateRecordsList= this.progressContainer?.querySelector('#duplicate-records-list') || null;
    this.closeButton         = this.progressContainer?.querySelector('.close-button') || null;
    this.getReportButton     = this.progressContainer?.querySelector('#get-report-button') || null;

    // Badges (also scoped)
    this.createdBadge   = this.progressContainer?.querySelector('#progressTabs .nav-link[href="#created-tab"] .badge-count') || null;
    this.updatedBadge   = this.progressContainer?.querySelector('#progressTabs .nav-link[href="#updated-tab"] .badge-count') || null;
    this.failedBadge    = this.progressContainer?.querySelector('#progressTabs .nav-link[href="#failed-records-tab"] .badge-count') || null;
    this.duplicateBadge = this.progressContainer?.querySelector('#progressTabs .nav-link[href="#duplicate-records-tab"] .badge-count') || null;

    this.displayedFailedRecords = [];
    this.displayedDuplicateRecords = [];

    this.checkLocalStorageForImport();
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
        // Make tabs standalone + immune to Bootstrap/global handlers
        this.ensureStandaloneTabs();
      
        // Existing socket listeners...
        this.socket.on('importProgress', (data) => {
          this.hideLoadingSpinner();
          this.updateProgress(data);
        });
        this.socket.on('importComplete', (data) => {
          this.hideLoadingSpinner();
          this.completeImport(data);
        });
        this.socket.on('importError', ({ message }) => {
          this.hideLoadingSpinner();
          if (typeof showAlert === 'function') showAlert('error', message || 'Import failed unexpectedly.');
          else alert(message || 'Import failed unexpectedly.');
          if (this.progressBar) {
            this.progressBar.classList.add('bg-danger');
            this.progressBar.innerHTML = 'Error';
          }
        });
        this.socket.on('connect', () => this.socket.emit('requestProgressData'));
      
        if (this.closeButton) {
          this.closeButton.addEventListener('click', () => {
            this.hideProgressContainer();
            this.socket.emit('progressClosed');
          });
        }
        if (this.getReportButton) {
          this.getReportButton.addEventListener('click', () => this.handleGetReport());
        }
      }
      
      /**
       * Make tabs inside this.progressContainer standalone:
       *  - Disable Bootstrap's tab plugin for these links
       *  - Toggle visibility & ARIA within this component only
       *  - Ignore any external 'show/active' classes
       */
      ensureStandaloneTabs() {
        if (!this.progressContainer) return;
      
        const tablist = this.progressContainer.querySelector('#progressTabs');
        const links = Array.from(tablist?.querySelectorAll('.nav-link') || []);
        const panes = Array.from(this.progressContainer.querySelectorAll('#progressTabContent .tab-pane'));
      
        // Disable Bootstrap's auto-tab behavior for these links (prevents global plugin interference)
        links.forEach(a => {
          if (a.getAttribute('data-bs-toggle') === 'tab') a.removeAttribute('data-bs-toggle');
        });
      
        const activate = (link) => {
          // Resolve target pane via href or data-bs-target, but scope to THIS container
          const targetSel = link.getAttribute('href') || link.getAttribute('data-bs-target');
          const target = targetSel ? this.progressContainer.querySelector(targetSel) : null;
          if (!target) return;
      
          // Links: visually mark single active + ARIA
          links.forEach(l => {
            const isActive = l === link;
            l.classList.toggle('active', isActive);
            l.setAttribute('aria-selected', isActive ? 'true' : 'false');
            l.tabIndex = isActive ? 0 : -1;
          });
      
          // Panes: only our custom class controls visibility
          panes.forEach(p => {
            const isActive = p === target;
            p.classList.remove('show', 'active');   // neutralize external togglers
            p.classList.toggle('pc-active', isActive);
            p.setAttribute('aria-hidden', isActive ? 'false' : 'true');
          });
        };
      
        // Wire clicks to our local activator
        links.forEach(a => {
          a.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            activate(a);
          });
        });
      
        // Initial state: prefer the link already marked active; else fall back to the first
        const initial = links.find(l => l.classList.contains('active')) || links[0];
        if (initial) activate(initial);
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
            totalRecords = 0,
            createdRecords = 0,
            updatedRecords = 0,
            failedRecords = 0,
            duplicateRecords = 0,
            percentage = 0,
            estimatedTime = 'Calculating...',
            createdRecordsData = [],
            updatedRecordsData = [],
            failedRecordsData = [],
            duplicateRecordsData = [],
        } = data || {};

        if (this.importedCounterEl) {
            this.importedCounterEl.textContent =
                `Created: ${createdRecords} | Updated: ${updatedRecords} | Total: ${totalRecords}`;
        }
        if (this.estimatedTimeEl) {
            this.estimatedTimeEl.textContent = `Estimated Time: ${estimatedTime}`;
        }

        // Progress bar
        if (this.progressBar) {
            this.progressBar.style.width = `${percentage}%`;
            this.progressBar.setAttribute('aria-valuenow', percentage);
            if (percentage < 100) {
                this.progressBar.innerHTML = `${percentage}%`;
                this.progressBar.classList.remove('success');
                this.progressBar.classList.remove('bg-danger');
            }
        }

        // Rebuild Created list
        this.populateRecordsList(this.createdList, createdRecordsData, 'No records have been created yet.');
        // Rebuild Updated list
        this.populateRecordsList(this.updatedList, updatedRecordsData, 'No records have been updated yet.', true);

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
            createdRecordsData,
            updatedRecordsData,
            failedRecordsData,
            duplicateRecordsData
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
        if (this.importedCounterEl) {
            this.importedCounterEl.textContent =
                `Created: ${data.createdRecords || 0} | Updated: ${data.updatedRecords || 0} | Total: ${data.totalRecords || 0}`;
        }
        if (this.estimatedTimeEl) {
            this.estimatedTimeEl.textContent = `Estimated Time: Completed`;
        }

        // 100% progress
        if (this.progressBar) {
            this.progressBar.style.width = '100%';
            this.progressBar.setAttribute('aria-valuenow', 100);
            this.progressBar.classList.add('success');
            this.progressBar.classList.remove('bg-danger');

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
        }

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
            try {
                localStorage.setItem('importCompleteData', JSON.stringify(data));
            } catch (e) {
                // storage might be full; it's safe to ignore
            }
            setTimeout(() => {
                window.location.reload();
            }, 2500);
        }
    }

    /**
     * Populates a record list (Created, Updated, Failed, Duplicate) or shows a fallback message.
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

        const safeRecords = Array.isArray(records) ? records : [];
        listElement.innerHTML = '';

        if (safeRecords.length > 0) {
            safeRecords.forEach(record => {
                const displayName = this.getDisplayLabel(record);

                const li = document.createElement('li');
                li.classList.add('list-group-item', 'd-flex', 'align-items-center');

                const icon = document.createElement('span');
                const iconBase = 'material-symbols-outlined me-2';

                if (listElement === this.createdList) {
                    icon.classList.add(...iconBase.split(' '), 'text-success');
                    icon.textContent = 'check_circle';
                } else if (listElement === this.updatedList) {
                    icon.classList.add(...iconBase.split(' '), 'text-success');
                    icon.textContent = 'update';
                } else if (listElement === this.failedRecordsList) {
                    icon.classList.add(...iconBase.split(' '), 'text-danger');
                    icon.textContent = 'cancel';
                } else if (listElement === this.duplicateRecordsList) {
                    icon.classList.add(...iconBase.split(' '), 'text-warning');
                    icon.textContent = 'warning';
                } else {
                    icon.classList.add(...iconBase.split(' '));
                    icon.textContent = 'info';
                }

                const recordText = document.createElement('span');

                if (isUpdated) {
                    const fields = this.normalizeUpdatedFields(record?.updatedFields);
                    const updatedFields = fields.join(', ');
                    recordText.textContent = `${displayName} - Updated fields: ${updatedFields || '—'}`;
                } else if (record && record.reason) {
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

        (newFailedRecords || []).forEach(record => {
            const displayName = this.getDisplayLabel(record);

            const li = document.createElement('li');
            li.classList.add('list-group-item', 'd-flex', 'align-items-center');

            const icon = document.createElement('span');
            icon.classList.add('material-symbols-outlined', 'text-danger', 'me-2');
            icon.textContent = 'cancel';

            const reason = record?.reason || 'No reason provided';
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

        (newDuplicateRecords || []).forEach(record => {
            const displayName = this.getDisplayLabel(record);

            const li = document.createElement('li');
            li.classList.add('list-group-item', 'd-flex', 'align-items-center');

            const icon = document.createElement('span');
            icon.classList.add('material-symbols-outlined', 'text-warning', 'me-2');
            icon.textContent = 'warning';

            const reason = record?.reason || 'No reason provided';
            const recordText = document.createElement('span');
            recordText.textContent = `${displayName} - ${reason}`;

            li.appendChild(icon);
            li.appendChild(recordText);
            this.duplicateRecordsList.appendChild(li);
        });
    }

    /**
     * Normalize an "updatedFields" payload into a string array suitable for display.
     * Accepts arrays, objects (keys), or comma-separated strings. Removes noisy keys.
     * @param {Array|Object|string|null|undefined} updatedFields
     * @returns {string[]}
     */
    normalizeUpdatedFields(updatedFields) {
        const noisy = new Set(['__v', 'updatedAt', 'createdAt']);
        let fields = [];

        if (Array.isArray(updatedFields)) {
            fields = updatedFields.slice();
        } else if (updatedFields && typeof updatedFields === 'object') {
            fields = Object.keys(updatedFields);
        } else if (typeof updatedFields === 'string') {
            fields = updatedFields.split(',').map(s => s.trim()).filter(Boolean);
        }

        // Deduplicate + filter
        const seen = new Set();
        const clean = [];
        for (const f of fields) {
            const key = String(f || '').trim();
            if (!key || noisy.has(key)) continue;
            if (!seen.has(key)) {
                seen.add(key);
                clean.push(key);
            }
        }
        return clean;
    }

    /**
     * Figure out best label for the record (supports accounts, insurance, liabilities, assets).
     */
    getDisplayLabel(record) {
        const {
            firstName,
            lastName,
            clientId,
            householdId,
            accountNumber,
            accountLoanNumber,  // Liability
            assetNumber,        // Asset
            policyNumber,       // Insurance (fallback if accountNumber not present)
            display             // Any prebuilt display label from backend
        } = record || {};

        // Force each to be a string before trimming to avoid "trim is not a function" errors:
        const f = String(firstName || '').trim();
        const l = String(lastName || '').trim();
        const c = String(clientId || '').trim();
        const h = String(householdId || '').trim();
        const a = String(accountNumber || '').trim();
        const loan = String(accountLoanNumber || '').trim();
        const asset = String(assetNumber || '').trim();
        const pol = String(policyNumber || '').trim();
        const disp = String(display || '').trim();

        // Priority 1: first + last
        if (f && f !== 'N/A' && l && l !== 'N/A') {
            return `${f} ${l}`;
        }

        // Priority 2: generic accountNumber (used by accounts and we also send it for insurance as policyNumber)
        if (a && a !== 'N/A') {
            return a;
        }

        // Priority 3: insurance policyNumber (if not mapped to accountNumber)
        if (pol && pol !== 'N/A') {
            return pol;
        }

        // Priority 4: Liability / Loan number
        if (loan) {
            return loan;
        }

        // Priority 5: Asset number
        if (asset) {
            return asset;
        }

        // Priority 6: clientId
        if (c && c !== 'N/A') {
            return c;
        }

        // Priority 7: householdId
        if (h && h !== 'N/A') {
            return h;
        }

        // Priority 8: backend-provided display label
        if (disp) {
            return disp;
        }

        return 'N/A';
    }

    /**
     * Update badges for each tab
     */
    updateBadges(createdRecords, updatedRecords, failedRecords, duplicateRecords) {
        const createdLen = Array.isArray(createdRecords) ? createdRecords.length : 0;
        const updatedLen = Array.isArray(updatedRecords) ? updatedRecords.length : 0;
        const failedLen  = Array.isArray(failedRecords)  ? failedRecords.length  : 0;
        const dupLen     = Array.isArray(duplicateRecords) ? duplicateRecords.length : 0;

        // Created
        if (this.createdBadge) {
            const createdTabLink = this.progressContainer?.querySelector('#progressTabs .nav-link[href="#created-tab"]');
            if (createdLen > 0) {
                this.createdBadge.style.display = 'flex';
                this.createdBadge.textContent = createdLen;
                createdTabLink && createdTabLink.classList.add('has-badge');
            } else {
                this.createdBadge.style.display = 'none';
                this.createdBadge.textContent = '';
                createdTabLink && createdTabLink.classList.remove('has-badge');
            }
        }

        // Updated
        if (this.updatedBadge) {
            const updatedTabLink = this.progressContainer?.querySelector('#progressTabs .nav-link[href="#updated-tab"]');
            if (updatedLen > 0) {
                this.updatedBadge.style.display = 'flex';
                this.updatedBadge.textContent = updatedLen;
                updatedTabLink && updatedTabLink.classList.add('has-badge');
            } else {
                this.updatedBadge.style.display = 'none';
                this.updatedBadge.textContent = '';
                updatedTabLink && updatedTabLink.classList.remove('has-badge');
            }
        }

        // Failed
        if (this.failedBadge) {
            const failedTabLink = this.progressContainer?.querySelector('#progressTabs .nav-link[href="#failed-records-tab"]');
            if (failedLen > 0) {
                this.failedBadge.style.display = 'flex';
                this.failedBadge.textContent = failedLen;
                failedTabLink && failedTabLink.classList.add('has-badge');
            } else {
                this.failedBadge.style.display = 'none';
                this.failedBadge.textContent = '';
                failedTabLink && failedTabLink.classList.remove('has-badge');
            }
        }

        // Duplicate
        if (this.duplicateBadge) {
            const duplicateTabLink = this.progressContainer?.querySelector('#progressTabs .nav-link[href="#duplicate-records-tab"]');
            if (dupLen > 0) {
                this.duplicateBadge.style.display = 'flex';
                this.duplicateBadge.textContent = dupLen;
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
        if (this.progressContainer && this.progressContainer.classList.contains('hidden')) {
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
        if (this.progressContainer && !this.progressContainer.classList.contains('hidden')) {
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

        const reportId = this.getReportButton?.dataset?.reportId;
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
