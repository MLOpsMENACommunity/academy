/**
 * Only same-origin relative paths are accepted as `returnTo`, so a crafted
 * login link can't bounce a user to another site after sign-in.
 */
export function safeReturnTo(value: unknown, fallback = '/dashboard'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // Reject control characters and backslashes anywhere (some browsers treat `\` as `/`).
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001f\\]/.test(value)) return fallback;
  return value;
}

/** Tracking parameters copied from the course page URL onto the application. */
export const SOURCE_PARAMS = [
  'ref',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;
export type SourceParams = Partial<Record<(typeof SOURCE_PARAMS)[number], string>> & {
  /** Set by the server, never copied from a URL: 'admin' = enrolled directly by the course team ("Enrol by email"). */
  via?: 'admin';
};

export function pickSourceParams(params: Record<string, unknown>): SourceParams {
  const out: SourceParams = {};
  for (const key of SOURCE_PARAMS) {
    const v = params[key];
    if (typeof v === 'string' && v.length > 0) out[key] = v.slice(0, 100);
  }
  return out;
}
