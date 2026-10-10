/**
 * Per-visitor limit on lookups, kept in this web container (the API can't tell visitors apart:
 * it sees the web server's address). The Worker sets X-Forwarded-For from cf-connecting-ip, so
 * the key can't be chosen by the visitor. Each container counts on its own, which is fine for
 * a limit meant to stop scraping, not to be exact.
 */
const WINDOW_MS = 60_000;
const LIMIT = 30;
const MAX_KEYS = 10_000;
const hits = new Map<string, number[]>();
export function allowLookup(ip: string | null, now = Date.now()): boolean {
  if (!ip) return true;
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.delete(ip);
  hits.set(ip, recent);
  // Oldest visitors first: memory stays bounded however many addresses come by.
  while (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value!);
  return true;
}
