'use client';

import type { NextSessionDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LocalTime } from '@/components/course/LocalTime';
import { Card } from '@/components/ui/Card';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';

/** "What's next" on the dashboard: the upcoming sessions across the student's courses. */
export function NextSessions() {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<NextSessionDto[] | null>(null);
  useEffect(() => {
    api<NextSessionDto[]>('/me/next-sessions').then(setItems).catch(() => setItems([]));
  }, []);
  if (!items?.length) return null;
  return (
    <Card>
      <h3 className="text-lg">{t('learn.nextTitle')}</h3>
      <ul className="mt-3 space-y-3">
        {items.slice(0, 3).map((s) => (
          <li key={s.sessionId}>
            <Link href={`/${locale}/learn/${s.courseSlug}`} className="block rounded-lg p-2 hover:bg-muted-bg">
              <p className="font-semibold text-fg">{locale === 'ar' ? s.titleAr : s.titleEn}</p>
              <p className="text-xs text-muted">
                {locale === 'ar' ? s.courseTitleAr : s.courseTitleEn} · <LocalTime iso={s.startsAt} style="weekday-datetime" />
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
