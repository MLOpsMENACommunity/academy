import { z } from 'zod';

/**
 * "Resume at the exact second": the learn page's player saves where the student stopped in a
 * session's video, and the next visit starts there (a few seconds earlier, for context).
 */

/** The longest video we keep a position for: 24 hours. */
export const RESUME_MAX_SEC = 86_400;
/** Nearer the end than this, the video counts as finished: the next play starts at the beginning. */
export const RESUME_END_MARGIN_SEC = 10;
/** Under this, there is nothing worth resuming. */
export const RESUME_MIN_SEC = 5;
/** Resume this many seconds before where they stopped, so the sentence they were hearing replays. */
export const RESUME_OVERLAP_SEC = 3;
/** The player saves at most this often while the video plays (and on pause and on leaving the page). */
export const RESUME_SAVE_EVERY_SEC = 15;

/** PUT /learn/:slug/sessions/:sessionId/position */
export const lessonPositionSchema = z
  .object({
    positionSec: z.number().int().min(0).max(RESUME_MAX_SEC),
    durationSec: z.number().int().min(1).max(RESUME_MAX_SEC).optional(),
  })
  .strict();
export type LessonPositionInput = z.infer<typeof lessonPositionSchema>;

/**
 * Where to start the video, in whole seconds: 0 (the beginning) when the lesson is completed, when
 * they stopped within RESUME_END_MARGIN_SEC of the end or under RESUME_MIN_SEC in; otherwise
 * RESUME_OVERLAP_SEC before where they stopped.
 */
export function resumeStart(positionSec: number, durationSec: number | null | undefined, completed: boolean): number {
  if (completed || !Number.isFinite(positionSec) || positionSec < RESUME_MIN_SEC) return 0;
  if (durationSec && durationSec > 0 && positionSec >= durationSec - RESUME_END_MARGIN_SEC) return 0;
  return Math.max(0, Math.floor(positionSec) - RESUME_OVERLAP_SEC);
}

/** A video time as m:ss, or h:mm:ss from an hour (42:10, 1:02:05). Digits stay Latin: wrap it in <bdi>. */
export function formatVideoTime(totalSec: number): string {
  const t = Math.max(0, Math.floor(Number.isFinite(totalSec) ? totalSec : 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Where they stopped, from a session's resumeAt (its exact inverse when above 0); 0 when it starts at the beginning. */
export function stoppedAtFromResume(resumeAt: number | null | undefined): number {
  return resumeAt && resumeAt > 0 ? resumeAt + RESUME_OVERLAP_SEC : 0;
}
