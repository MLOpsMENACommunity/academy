/** Maximum rows in one CSV export; one extra is fetched to detect truncation. */
export const EXPORT_LIMIT = 5000;

/** Drops the probe row and, when the export was cut, says so in the file itself. */
export function capRows<T>(rows: T[], toRow: (r: T) => unknown[]): unknown[][] {
  const out = rows.slice(0, EXPORT_LIMIT).map(toRow);
  if (rows.length > EXPORT_LIMIT) out.push([`Truncated: more than ${EXPORT_LIMIT} rows. Narrow the filters and export again.`]);
  return out;
}
