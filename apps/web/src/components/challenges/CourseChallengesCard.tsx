'use client';

import type { MyChallengeDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { challengeDates, entryTone, localTitle, phaseTone } from './ChallengeCard';

/** Learn page: this course's challenges (open and upcoming first), with my entry's status. Hidden when there are none. */
export function CourseChallengesCard({ courseSlug }: { courseSlug: string }) {
  const { locale, t } = useI18n();
  const [list, setList] = useState<MyChallengeDto[]>([]);

  useEffect(() => {
    api<MyChallengeDto[]>('/me/challenges')
      .then((all) => setList(all.filter((c) => c.course?.slug === courseSlug)))
      .catch(() => undefined);
  }, [courseSlug]);

  if (!list.length) return null;
  return (
    <section aria-labelledby="course-challenges" className="rounded-card border border-line bg-card p-5">
      <h2 id="course-challenges" className="text-lg">
        {t('challenges.title')}
      </h2>
      <ul className="mt-3 space-y-3">
        {list.slice(0, 5).map((c) => (
          <li key={c.slug} className="text-sm">
            <Link href={`/${locale}/challenges/${c.slug}`} className="font-semibold text-primary hover:underline">
              {c.badge.icon} {localTitle(c, locale)}
            </Link>
            <span className="mt-1 flex flex-wrap items-center gap-2 text-muted">
              <Badge tone={phaseTone[c.phase]}>{t(`challenges.phase.${c.phase}`)}</Badge>
              {c.entry && <Badge tone={entryTone[c.entry.status]}>{t(`challenges.entryStatus.${c.entry.status}`)}</Badge>}
              {challengeDates(c, locale)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
