'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useI18n } from '@/i18n/client';

/**
 * Click-to-load YouTube embed: only a thumbnail until the student presses
 * play, then a privacy-enhanced (youtube-nocookie.com) iframe. Saves ~1 MB
 * of player JavaScript per video on mobile data.
 */
export function YouTubeFacade({ id, title }: { id: string; title: string }) {
  const { t } = useI18n();
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-ink">
      {playing ? (
        <iframe
          // Keyboard users keep their place: focus moves into the player that replaced the button.
          ref={(el) => el?.focus()}
          className="absolute inset-0 size-full"
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0 size-full" aria-label={t('learn.playVideo', { title })}>
          <Image
            src={`https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 640px"
            className="object-cover opacity-90 transition-opacity group-hover:opacity-100"
          />
          <span aria-hidden className="absolute inset-0 grid place-items-center">
            <span className="grid size-16 place-items-center rounded-2xl bg-[#ff0000] text-white shadow-lg transition-transform group-hover:scale-105">
              <svg viewBox="0 0 24 24" className="size-8 fill-current">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
