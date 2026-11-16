import { RESUME_MAX_SEC, RESUME_SAVE_EVERY_SEC, type LessonPositionInput } from '@academy/shared';
import { PLAYER_STATE, type PlayerInfo } from './youtube-messages';

/** keepalive: the page is going away (pagehide, hidden tab), so the request must outlive it. */
export type SavePosition = (body: LessonPositionInput, opts: { keepalive: boolean }) => void;

/**
 * Decides when the player saves where the student is in the video: at most every 15 s while it
 * plays, at once on pause and at the end, and on flush() (leaving the page or the lesson).
 * Nothing is saved before the student has played the video in this visit, so opening a lesson
 * and leaving never overwrites where they stopped last time. An unchanged second isn't sent twice.
 */
export function createPositionTracker(save: SavePosition, now: () => number = Date.now, everyMs = RESUME_SAVE_EVERY_SEC * 1000) {
  let time: number | null = null;
  let duration: number | null = null;
  let state: number | null = null;
  let played = false;
  let lastSaveAt = 0;
  let lastSaved: number | null = null;

  const flush = (keepalive = false): void => {
    if (!played || time === null) return;
    const positionSec = Math.min(RESUME_MAX_SEC, Math.max(0, Math.floor(time)));
    if (positionSec === lastSaved) return;
    lastSaved = positionSec;
    lastSaveAt = now();
    const d = duration === null ? 0 : Math.round(duration);
    save(d >= 1 && d <= RESUME_MAX_SEC ? { positionSec, durationSec: d } : { positionSec }, { keepalive });
  };

  return {
    update(info: PlayerInfo): void {
      if (info.currentTime !== undefined) time = info.currentTime;
      if (info.duration !== undefined && info.duration > 0) duration = info.duration;
      const changed = info.playerState !== undefined && info.playerState !== state;
      if (info.playerState !== undefined) state = info.playerState;
      if (state === PLAYER_STATE.PLAYING && !played) {
        // The 15 s start from the first play, not from when the page opened.
        played = true;
        lastSaveAt = now();
        return;
      }
      if (!played) return;
      if (changed && (state === PLAYER_STATE.PAUSED || state === PLAYER_STATE.ENDED)) {
        // At the end the player may still report a second short of the duration: save the end.
        if (state === PLAYER_STATE.ENDED && duration !== null) time = Math.max(time ?? 0, duration);
        return flush();
      }
      if (state === PLAYER_STATE.PLAYING && now() - lastSaveAt >= everyMs) flush();
    },
    flush,
  };
}
