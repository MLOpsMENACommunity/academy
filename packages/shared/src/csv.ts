// ------------------------------------------------------------------ CSV import

/**
 * RFC 4180-ish CSV: quoted fields, doubled quotes, CRLF or LF, a leading BOM.
 * Rows with nothing in them are dropped, unless `keepEmpty` is set (to keep row
 * numbers in line with what a spreadsheet shows).
 */
export function parseCsv(text: string, opts: { keepEmpty?: boolean } = {}): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return opts.keepEmpty ? rows : rows.filter((r) => r.some((f) => f.trim() !== ''));
}
