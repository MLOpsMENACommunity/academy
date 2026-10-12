import { z } from 'zod';
import { FUNNEL_EVENTS, type FunnelEvent } from './enums';

/** Funnel steps the browser may report; the rest are server-side only. */
export const CLIENT_FUNNEL_EVENTS = ['COURSE_VIEW', 'APPLY_CLICKED', 'PROFILE_COMPLETED'] as const;

export const clientFunnelEventSchema = z.object({
  courseSlug: z.string().regex(/^[a-z0-9-]{1,80}$/),
  event: z.enum(CLIENT_FUNNEL_EVENTS),
  /** A random per-browser id (crypto.randomUUID): letters, digits and dashes only, so it can never hold an email. */
  anonymousId: z.string().regex(/^[\w-]{1,64}$/).optional(),
});
export type ClientFunnelEvent = z.infer<typeof clientFunnelEventSchema>;

/**
 * The admin dashboard's funnel: distinct people per step, each step counted on its own.
 * People skip steps (someone with an account never "registers"; an admin can enroll people
 * directly), so a step can hold more people than the one before it, and a step-to-step
 * percentage would read above 100%. The dashboard shows counts only; bar widths are
 * relative to the busiest step, so they never pass 100%.
 */
export function funnelBars(
  funnel: Partial<Record<FunnelEvent, number>>,
): { event: FunnelEvent; count: number; width: number }[] {
  const counts = FUNNEL_EVENTS.map((event) => ({ event, count: Math.max(0, funnel[event] ?? 0) }));
  const top = Math.max(1, ...counts.map((c) => c.count));
  return counts.map((c) => ({ ...c, width: Math.round((c.count / top) * 100) }));
}
