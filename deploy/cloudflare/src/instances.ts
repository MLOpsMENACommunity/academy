/**
 * Web container instances. The Worker spreads web requests over `WEB_INSTANCES` of them;
 * that can never exceed the WebContainer `max_instances` in wrangler.jsonc (a request for
 * an instance beyond it would fail), which a test keeps equal to MAX_WEB_INSTANCES.
 */
export const MAX_WEB_INSTANCES = 3;

/** The original single instance's name: instance 0 keeps it, so the existing container is reused. */
export const MAIN_INSTANCE = 'main';

/** How many instances to use: WEB_INSTANCES capped at the maximum; anything invalid means just `main`. */
export function webInstanceCount(value: string | undefined, max = MAX_WEB_INSTANCES): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, max);
}

export const webInstanceName = (i: number): string => (i === 0 ? MAIN_INSTANCE : `web-${i}`);
