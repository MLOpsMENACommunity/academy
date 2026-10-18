'use client';

import type { LearnAnnouncementDto } from '@academy/shared';
import { Fragment, useEffect, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;

/** Plain text with its http(s) links made clickable (no HTML is interpreted). */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RE).map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline" dir="ltr">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

// "New" is remembered per course in this browser only: the newest announcement the student has seen.
const seenKey = (slug: string) => `learn:announcements-seen:${slug}`;

function readSeen(slug: string): string | null {
  try {
    return window.localStorage.getItem(seenKey(slug));
  } catch {
    return null;
  }
}

/** Marks everything up to the newest announcement as seen. */
export function markAnnouncementsSeen(slug: string, items: LearnAnnouncementDto[]): void {
  const newest = items[0]?.at;
  if (!newest) return;
  try {
    window.localStorage.setItem(seenKey(slug), newest);
  } catch {
    // Private mode or blocked storage: the badge just stays.
  }
}

/** How many of the (newest-first) announcements arrived since the student last opened the tab. */
export function useNewAnnouncements(slug: string, items: LearnAnnouncementDto[], seenVersion: number): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const seen = readSeen(slug);
    setCount(seen ? items.filter((a) => a.at > seen).length : items.length);
  }, [slug, items, seenVersion]);
  return count;
}

/**
 * The Announcements tab: every message from the course team or one of its speakers
 * (study-group link, quiz links, schedule changes), newest first. Shows the learn page's
 * latest ones at once, then the full list.
 */
export function CourseAnnouncements({ slug, latest, headingId }: { slug: string; latest: LearnAnnouncementDto[]; headingId: string }) {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<LearnAnnouncementDto[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api<LearnAnnouncementDto[]>(`/learn/${slug}/announcements`)
      .then((all) => live && setItems(all))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [slug]);

  const list = items ?? latest;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} tabIndex={-1} className="text-2xl outline-none">
        {t('learn.announcements')}
      </h2>
      {failed && !items && latest.length > 0 && (
        <Alert tone="info" className="mt-4">
          {t('learn.announcementsPartial')}
        </Alert>
      )}
      {list.length === 0 ? (
        items || failed ? (
          <p className="mt-4 text-muted">{failed ? t('errors.generic') : t('learn.announcementsEmpty')}</p>
        ) : (
          <PageSpinner />
        )
      ) : (
        <ul className="mt-4 space-y-3">
          {list.map((a) => (
            <li key={a.id} className="rounded-card border border-line bg-card p-4">
              <h3 className="text-base font-semibold text-fg">{locale === 'ar' ? a.subjectAr : a.subjectEn}</h3>
              <p className="text-xs text-muted">
                {formatDateTime(a.at, locale)}
                {a.fromEn && <> · {t('learn.announcementFrom', { name: (locale === 'ar' ? a.fromAr : a.fromEn) ?? a.fromEn })}</>}
              </p>
              <p className="mt-2 text-sm whitespace-pre-line text-body">
                <Linkified text={locale === 'ar' ? a.bodyAr : a.bodyEn} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
