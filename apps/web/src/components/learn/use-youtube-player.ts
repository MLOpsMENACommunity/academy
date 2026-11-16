'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { createPositionTracker, type SavePosition } from './position-tracker';
import { parsePlayerMessage, PLAYER_STATE, YOUTUBE_EMBED_ORIGIN, YOUTUBE_SUBSCRIBE_MESSAGES } from './youtube-messages';

/** The player can take a few seconds to start listening; stop asking after this many tries. */
const MAX_SUBSCRIBE_TRIES = 15;

/**
 * Listens to an embedded YouTube player through postMessage (no YouTube API script, so the CSP
 * doesn't change): reports the end of the video and, with `onPosition`, saves where the student
 * is (position-tracker.ts), including when they leave the page (keepalive) or the lesson. Active
 * while `active` is true and the iframe is mounted; `key` restarts it (another video).
 */
export function useYouTubePlayer(
  frame: RefObject<HTMLIFrameElement | null>,
  key: string,
  active: boolean,
  handlers: { onEnded?: () => void; onPosition?: SavePosition },
): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const el = frame.current;
    if (!active || !el) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    let tries = 0;
    const tracker = createPositionTracker((body, opts) => latest.current.onPosition?.(body, opts));
    const subscribe = () => YOUTUBE_SUBSCRIBE_MESSAGES.forEach((m) => el.contentWindow?.postMessage(m, YOUTUBE_EMBED_ORIGIN));
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const onLoad = () => {
      subscribe();
      stop();
      timer = setInterval(() => {
        if (++tries >= MAX_SUBSCRIBE_TRIES) stop();
        else subscribe();
      }, 1000);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== YOUTUBE_EMBED_ORIGIN || e.source !== el.contentWindow) return;
      stop();
      const info = parsePlayerMessage(e.data);
      if (!info) return;
      tracker.update(info);
      if (info.playerState === PLAYER_STATE.ENDED) latest.current.onEnded?.();
    };
    // Leaving the page (or hiding it: on phones that is often the last event a page gets).
    const onPageHide = () => tracker.flush(true);
    const onVisibility = () => document.visibilityState === 'hidden' && tracker.flush(true);
    el.addEventListener('load', onLoad);
    window.addEventListener('message', onMessage);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      // Another lesson, or another page of the app: the page stays, so a normal request will do.
      tracker.flush(false);
      el.removeEventListener('load', onLoad);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [frame, key, active]);
}
