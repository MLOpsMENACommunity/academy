import { z } from 'zod';

/** Funnel steps the browser may report; the rest are server-side only. */
export const CLIENT_FUNNEL_EVENTS = ['COURSE_VIEW', 'APPLY_CLICKED', 'PROFILE_COMPLETED'] as const;

export const clientFunnelEventSchema = z.object({
  courseSlug: z.string().regex(/^[a-z0-9-]{1,80}$/),
  event: z.enum(CLIENT_FUNNEL_EVENTS),
  anonymousId: z.string().max(64).optional(),
});
export type ClientFunnelEvent = z.infer<typeof clientFunnelEventSchema>;
