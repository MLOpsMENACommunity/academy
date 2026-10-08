'use client';

import type { LearnCourseDto } from '@academy/shared';
import { Fragment } from 'react';
import { useI18n } from '@/i18n/client';
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

/** Messages from the course team (study-group link, quiz links, schedule changes). */
export function CourseAnnouncements({ items }: { items: LearnCourseDto['announcements'] }) {
  const { locale, t } = useI18n();
  if (!items.length) return null;
  return (
    <section aria-labelledby="announcements" className="mt-8">
      <h2 id="announcements" className="text-2xl">
        {t('learn.announcements')}
      </h2>
      <ul className="mt-4 space-y-3">
        {items.map((a) => (
          <li key={a.id} className="rounded-card border border-line bg-card p-4">
            <p className="font-semibold text-fg">{locale === 'ar' ? a.subjectAr : a.subjectEn}</p>
            <p className="text-xs text-muted">{formatDateTime(a.at, locale)}</p>
            <p className="mt-2 text-sm whitespace-pre-line text-body">
              <Linkified text={locale === 'ar' ? a.bodyAr : a.bodyEn} />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
