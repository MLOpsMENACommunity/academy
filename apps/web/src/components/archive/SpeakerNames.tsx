import type { Locale, SpeakerRefDto } from '@academy/shared';
import Link from 'next/link';
import { Fragment } from 'react';
import { speakerName, speakerPath } from '@/lib/archive';

/** Speaker names, each linked to their page when they have one. */
export function SpeakerNames({ speakers, locale, className = '' }: { speakers: SpeakerRefDto[]; locale: Locale; className?: string }) {
  return (
    <>
      {speakers.map((s, i) => (
        <Fragment key={`${s.slug ?? s.name}-${i}`}>
          {i > 0 && (locale === 'ar' ? '، ' : ', ')}
          {s.slug ? (
            <Link href={speakerPath(locale, s.slug)} className={`underline decoration-line-strong/60 underline-offset-4 hover:text-primary hover:decoration-primary ${className}`}>
              {speakerName(locale, s)}
            </Link>
          ) : (
            speakerName(locale, s)
          )}
        </Fragment>
      ))}
    </>
  );
}
