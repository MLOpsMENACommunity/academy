'use client';

import { useRef, useState } from 'react';
import type { SavePosition } from './position-tracker';
import { useYouTubePlayer } from './use-youtube-player';
import { youtubeEmbedUrl } from './youtube-messages';

/**
 * A self-paced lesson's video: YouTube's own player, loaded without autoplay, so the student
 * presses YouTube's play button and the view counts on the channel (unlike YouTubeFacade, which
 * autoplays after a click on our thumbnail). Reports when the video reaches its end, starts at
 * `start` seconds (where they stopped last time) and saves where they are with `onPosition`.
 *
 * It talks to the embed with postMessage instead of loading YouTube's API script, so the CSP
 * doesn't change. If YouTube ever changes these messages, "Mark as complete" still works.
 */
export function LessonPlayer({
  id,
  title,
  start = 0,
  onEnded,
  onPosition,
}: {
  id: string;
  title: string;
  /** Seconds to start at (0: the beginning). Read once: a later refresh of the course never reloads the player. */
  start?: number;
  onEnded: () => void;
  onPosition?: SavePosition;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [src] = useState(() => youtubeEmbedUrl(id, window.location.origin, { start }));
  useYouTubePlayer(frame, id, true, { onEnded, onPosition });

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-ink">
      <iframe
        ref={frame}
        className="absolute inset-0 size-full"
        src={src}
        title={title}
        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}
