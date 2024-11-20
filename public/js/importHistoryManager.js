// public/js/importHistoryManager.js

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Socket.io
    const socket = io();

    // Listen for newImportReport events
    socket.on('newImportReport', (data) => {
        console.log('Received newImportReport:', data);
        addImportReportToHistory(data);
    });

    /**
     * Adds a new Import Report entry to the Import History table.
     * @param {Object} report - The import report data.
     */
    function addImportReportToHistory(report) {
        const importHistoryTableBody = document.querySelector('#import-history table tbody');
        if (!importHistoryTableBody) {
            console.error('Import History table body not found.');
            return;
        }

        const tr = document.createElement('tr');

        // Import Type
        const tdType = document.createElement('td');
        tdType.textContent = report.importType;
        tr.appendChild(tdType);

        // Import Date
        const tdDate = document.createElement('td');
        const formattedDate = new Date(report.createdAt).toLocaleString();
        tdDate.textContent = formattedDate;
        tr.appendChild(tdDate);

        // Actions
        const tdActions = document.createElement('td');
        const getReportButton = document.createElement('button');
        getReportButton.classList.add('btn', 'btn-secondary', 'get-history-report-button');
        getReportButton.textContent = 'Get Report';
        getReportButton.setAttribute('data-report-id', report._id);

        // Attach event listener
        getReportButton.addEventListener('click', () => {
            const reportId = getReportButton.getAttribute('data-report-id');
            if (!reportId) {
                console.error('No reportId found for this button.');
                alert('Report ID is missing. Please try again.');
                return;
            }

            // Construct the URL to fetch the PDF
            const reportUrl = `/api/households/import/report?reportId=${reportId}`;

            // Open the PDF in a new tab
            window.open(reportUrl, '_blank');
        });

        tdActions.appendChild(getReportButton);
        tr.appendChild(tdActions);

        // Append the new row to the table body
        importHistoryTableBody.prepend(tr); // Add to the top
    }

    // Attach event listeners to all existing "Get Report" buttons in Import History
    const reportButtons = document.querySelectorAll('.get-history-report-button');

    reportButtons.forEach(button => {
        button.addEventListener('click', () => {
            const reportId = button.getAttribute('data-report-id');
            if (!reportId) {
                console.error('No reportId found for this button.');
                alert('Report ID is missing. Please try again.');
                return;
            }

            // Construct the URL to fetch the PDF
            const reportUrl = `/api/households/import/report?reportId=${reportId}`;

            // Open the PDF in a new tab
            window.open(reportUrl, '_blank');
        });
    });
});
