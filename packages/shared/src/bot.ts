import { z } from 'zod';
import type { AttendanceStatus } from './enums';

/**
 * What the community bot (MLOpsMENACommunity/community-bot) reads for its weekly leaderboard.
 * The academy only reports what happened; the points live in the bot's own rules file.
 */
export const BOT_ACTIVITY_KINDS = ['WEEKLY_QUIZ', 'MIDPOINT_QUIZ', 'ATTENDANCE', 'PRACTICAL_TASK'] as const;
export type BotActivityKind = (typeof BOT_ACTIVITY_KINDS)[number];

/** A longer window would make one response too large to send without paging. */
export const BOT_ACTIVITY_MAX_DAYS = 186;
const DAY_MS = 86_400_000;

export const botActivityQuerySchema = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((q) => q.from.getTime() < q.to.getTime(), { path: ['to'], message: 'Must be after from' })
  .refine((q) => q.to.getTime() - q.from.getTime() <= BOT_ACTIVITY_MAX_DAYS * DAY_MS, {
    path: ['to'],
    message: `At most ${BOT_ACTIVITY_MAX_DAYS} days`,
  });
export type BotActivityQuery = z.infer<typeof botActivityQuerySchema>;

export interface BotActivityItem {
  /** Stable across syncs: the same activity always has the same id. */
  id: string;
  academyUserId: string;
  /** Without the @. Null when the student hasn't added one to their profile. */
  telegramUsername: string | null;
  courseSlug: string;
  kind: BotActivityKind;
  occurredAt: string;
  /** Practical tasks only: submitted before this is on time. Null when there is no deadline. */
  deadlineAt: string | null;
}

export interface BotActivityResponse {
  items: BotActivityItem[];
}

/** Which kind of bot activity an assessment produces; null for work the leaderboard ignores (the capstone). */
export function botActivityKind(type: 'QUIZ' | 'LAB' | 'ASSIGNMENT', hasSession: boolean): BotActivityKind | null {
  if (type === 'QUIZ') return hasSession ? 'WEEKLY_QUIZ' : 'MIDPOINT_QUIZ';
  return hasSession ? 'PRACTICAL_TASK' : null;
}

/**
 * A practical task is on time when it arrives before the next session of its course. After the
 * last session, the assessment's own due date applies, if it has one.
 */
export function practicalTaskDeadline(sessionStart: Date, courseSessionStarts: readonly Date[], dueAt: Date | null): Date | null {
  const later = courseSessionStarts.filter((s) => s.getTime() > sessionStart.getTime());
  if (later.length === 0) return dueAt;
  return new Date(Math.min(...later.map((s) => s.getTime())));
}

export const BOT_ATTENDED_STATUSES: readonly AttendanceStatus[] = ['PRESENT', 'PARTIAL'];
