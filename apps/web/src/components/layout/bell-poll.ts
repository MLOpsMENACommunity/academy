/**
 * When the notifications bell may ask the API for the unread count. A tab left open with nobody
 * at it stops polling: every poll wakes the API container and the database, which would
 * otherwise never get to sleep (and are billed while awake).
 */

/** No pointer, key or scroll input for this long and the tab counts as unattended. */
export const IDLE_MS = 10 * 60_000;

export function isIdle(lastActivity: number, now: number): boolean {
  return now - lastActivity >= IDLE_MS;
}

/** Poll only while the tab is visible and someone has used it recently. */
export function shouldPoll(visible: boolean, lastActivity: number, now: number): boolean {
  return visible && !isIdle(lastActivity, now);
}
