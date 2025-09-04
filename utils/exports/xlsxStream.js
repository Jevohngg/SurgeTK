// utils/exports/xlsxStream.js
const Excel = require('exceljs');

/**
 * Stream XLSX directly to a writable stream (e.g., Express res) using ExcelJS streaming writer.
 * - columns: array of column ids in output order
 * - headerLabels: array of friendly header labels (same length/order as columns)
 * - rowsAsyncIterator: async iterator yielding row objects keyed by column ids
 * - onRow: optional callback(rowIndex) for progress/metrics
 */
async function writeXlsxToStream({
  stream,
  sheetName = 'Export',
  columns,
  headerLabels,
  rowsAsyncIterator,
  onRow
}) {
  const wb = new Excel.stream.xlsx.WorkbookWriter({
    stream,
    useStyles: false,
    useSharedStrings: false
  });

  const ws = wb.addWorksheet(sheetName);

  // Header row with friendly labels (fallback to ids)
  const headers = (Array.isArray(headerLabels) && headerLabels.length === columns.length) ? headerLabels : columns;
  ws.addRow(headers).commit();

  let i = 0;
  for await (const row of rowsAsyncIterator) {
    ws.addRow(columns.map(c => row[c])).commit();
    if (onRow && (++i % 2000 === 0)) onRow(i);
  }

  await wb.commit();
}

module.exports = { writeXlsxToStream };
