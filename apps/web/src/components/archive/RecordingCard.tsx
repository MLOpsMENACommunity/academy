import type { Locale, RecordingDto } from '@academy/shared';
import Link from 'next/link';
import { createTranslator } from '@/i18n/translator';
import { durationLabel } from '@/lib/archive';
import { formatDate } from '@/lib/format';
import { pick } from '@/lib/sessions';
import { RecordingPlayer } from './RecordingPlayer';
import { SpeakerNames } from './SpeakerNames';
import { TopicList } from './TopicList';

/** One recording in the library: the video first, then what it is and who gave it. */
export function RecordingCard({ item: r, locale }: { item: RecordingDto; locale: Locale }) {
  const t = createTranslator(locale);
  const title = pick(locale, r.titleEn, r.titleAr);
  const href = `/${locale}${r.path}${r.course ? `#lesson-${r.course.order}` : ''}`;
  return (
    <article aria-labelledby={`rec-${r.id}`} className="flex w-full min-w-0 flex-col gap-4 rounded-card border border-line bg-card p-4 sm:p-5">
      <RecordingPlayer url={r.recordingUrl} youtubeId={r.youtubeId} title={title} locale={locale} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm font-medium text-primary">
          {r.course ? t('sessions.lesson', { course: pick(locale, r.course.titleEn, r.course.titleAr), n: r.course.order }) : t('sessions.liveSession')}
        </p>
        <h2 id={`rec-${r.id}`} className="text-lg leading-snug">
          <Link href={href} className="hover:text-primary">
            {title}
          </Link>
        </h2>
        {r.speakers.length > 0 && (
          <p className="text-[0.9375rem] text-body">
            <SpeakerNames speakers={r.speakers} locale={locale} />
          </p>
        )}
        <p className="text-sm text-muted">
          <time dateTime={r.startsAt}>{formatDate(r.startsAt, locale)}</time>
          <span aria-hidden> · </span>
          {durationLabel(r.durationMin, locale)}
        </p>
        <TopicList topics={r.topics} locale={locale} label={t('sessions.topics')} className="mt-auto pt-2" />
      </div>
    </article>
  );
}
