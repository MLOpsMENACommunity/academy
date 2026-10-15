'use client';

import type { FeedbackDueDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { pick } from '@/lib/sessions';
import { Arrow } from '../ui/Icons';

/**
 * "Rate your last session": per course, the latest ended session the student hasn't rated
 * (computed by the API on page load). Links straight to the session's rating form.
 */
export function RateLastSession({ className }: { className: string }) {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<FeedbackDueDto[] | null>(null);
  useEffect(() => {
    api<FeedbackDueDto[]>('/me/feedback-due')
      .then(setItems)
      .catch(() => setItems([]));
  }, []);
  if (!items?.length) return null;
  return (
    <section aria-labelledby="rate-last" className={`${className} flex flex-col gap-3 p-5`}>
      <h2 id="rate-last" className="text-base">
        {t('dashboard.rateTitle')}
      </h2>
      <ul className="flex flex-col gap-3">
        {items.map((s) => (
          <li key={s.sessionId} className="flex flex-col gap-1">
            <span className="text-[0.8125rem] text-muted">{pick(locale, s.courseTitleEn, s.courseTitleAr)}</span>
            <span className="font-medium text-fg">{t('dashboard.rateBody', { n: s.order, title: pick(locale, s.titleEn, s.titleAr) })}</span>
            {s.courseFeedbackDue && <span className="text-sm text-muted">{t('dashboard.rateCourseToo')}</span>}
            <Link
              href={`/${locale}/learn/${s.courseSlug}#session-${s.order}-feedback`}
              className="inline-flex min-h-11 items-center gap-1.5 self-start font-medium text-primary hover:underline"
            >
              <span aria-hidden>★</span> {t('dashboard.rateCta')} <Arrow />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
