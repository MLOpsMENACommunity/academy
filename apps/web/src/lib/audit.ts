/** A value as one short readable token: strings as they are, lists joined, objects as compact JSON. */
function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.map(show).join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const isChange = (v: unknown): v is { from: unknown; to: unknown } =>
  Boolean(v) &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  'from' in (v as object) &&
  'to' in (v as object);

/**
 * The audit log's Details column as readable lines instead of raw JSON:
 * `{ from: 'SUBMITTED', to: 'ACCEPTED' }` -> "status: SUBMITTED → ACCEPTED",
 * `{ startsAt: { from, to } }` -> "startsAt: … → …", anything else "key: value".
 */
export function auditLines(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    return metadata == null ? [] : [show(metadata)];
  const m = metadata as Record<string, unknown>;
  const lines: string[] = [];
  // Status changes are logged as a top-level { from, to } (applications, courses).
  if (isChange(m)) lines.push(`status: ${show(m.from)} → ${show(m.to)}`);
  for (const [key, value] of Object.entries(m)) {
    if (isChange(m) && (key === 'from' || key === 'to')) continue;
    lines.push(
      isChange(value)
        ? `${key}: ${show(value.from)} → ${show(value.to)}`
        : `${key}: ${show(value)}`,
    );
  }
  return lines;
}
