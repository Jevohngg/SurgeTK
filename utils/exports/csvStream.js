// utils/exports/csvStream.js
const { format } = require('@fast-csv/format');

/**
 * Stream CSV directly to a writable stream (e.g., Express res).
 * - columns: array of column ids in output order
 * - headerLabels: array of friendly header labels (same length/order as columns)
 * - rowsAsyncIterator: async iterator yielding row objects keyed by column ids
 * - includeHeaders: boolean
 * - delimiter: default ','
 * - onRow: optional callback(rowIndex) for progress/metrics
 */
async function writeCsvToStream({
  stream,
  columns,
  headerLabels,
  includeHeaders = true,
  delimiter = ',',
  rowsAsyncIterator,
  onRow
}) {
  return new Promise((resolve, reject) => {
    const headers = includeHeaders
      ? (Array.isArray(headerLabels) && headerLabels.length === columns.length ? headerLabels : columns)
      : undefined;

    const csv = format({
      headers,
      delimiter,
      quoteColumns: true
    });

    csv.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', resolve);

    csv.pipe(stream);

    (async () => {
      try {
        let i = 0;
        for await (const row of rowsAsyncIterator) {
          csv.write(columns.map(c => row[c]));
          if (onRow && (++i % 2000 === 0)) onRow(i);
        }
        csv.end();
      } catch (err) {
        try { csv.end(); } catch (_) {}
        reject(err);
      }
    })();
  });
}

module.exports = { writeCsvToStream };
