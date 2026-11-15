'use client';

import { useEffect, useRef } from 'react';
import { isVideoEndedMessage, YOUTUBE_EMBED_ORIGIN, YOUTUBE_SUBSCRIBE_MESSAGES } from './youtube-messages';

/** The player can take a few seconds to start listening; stop asking after this many tries. */
const MAX_SUBSCRIBE_TRIES = 15;

/**
 * A self-paced lesson's video: YouTube's own player, loaded without autoplay, so the student
 * presses YouTube's play button and the view counts on the channel (unlike YouTubeFacade, which
 * autoplays after a click on our thumbnail). Reports when the video reaches its end.
 *
 * It talks to the embed with postMessage instead of loading YouTube's API script, so the CSP
 * doesn't change. If YouTube ever changes these messages, "Mark as complete" still works.
 */
export function LessonPlayer({ id, title, onEnded }: { id: string; title: string; onEnded: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ended = useRef(onEnded);
  useEffect(() => {
    ended.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    let tries = 0;
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
      if (isVideoEndedMessage(e.data)) ended.current();
    };
    el.addEventListener('load', onLoad);
    window.addEventListener('message', onMessage);
    return () => {
      stop();
      el.removeEventListener('load', onLoad);
      window.removeEventListener('message', onMessage);
    };
  }, [id]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-ink">
      <iframe
        ref={frame}
        className="absolute inset-0 size-full"
        src={`${YOUTUBE_EMBED_ORIGIN}/embed/${encodeURIComponent(id)}?enablejsapi=1&rel=0&origin=${encodeURIComponent(window.location.origin)}`}
        title={title}
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
