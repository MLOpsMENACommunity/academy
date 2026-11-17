'use client';

import type { ChallengePhase, MyChallengeDto, PublicChallengeDto } from '@academy/shared';
import { useEffect, useState } from 'react';
import { useHasSessionCookie } from '@/components/auth/SignedInForward';
import { Alert } from '@/components/ui/Alert';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { ChallengeCard } from './ChallengeCard';

const GROUPS: { phase: ChallengePhase; key: string }[] = [
  { phase: 'open', key: 'active' },
  { phase: 'upcoming', key: 'upcoming' },
  { phase: 'closed', key: 'past' },
];

/**
 * /challenges: every published challenge, active first. Loaded in the browser and never cached:
 * the list carries the names of finishers who chose to be shown, and hiding a name must take
 * effect at once. Signed in, each card also shows my entry's status.
 */
export function ChallengesBoard() {
  const { locale, t } = useI18n();
  const signedIn = useHasSessionCookie();
  const [list, setList] = useState<PublicChallengeDto[] | null>(null);
  const [mine, setMine] = useState<Map<string, MyChallengeDto>>(new Map());
  const [error, setError] = useState(false);

  useEffect(() => {
    api<PublicChallengeDto[]>('/challenges')
      .then(setList)
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    api<MyChallengeDto[]>('/me/challenges')
      .then((l) => setMine(new Map(l.map((c) => [c.slug, c]))))
      .catch(() => undefined);
  }, [signedIn]);

  if (error) return <Alert tone="danger">{t('errors.generic')}</Alert>;
  if (!list) return <PageSpinner />;
  if (!list.length) return <p className="text-muted">{t('challenges.empty')}</p>;

  return (
    <div className="space-y-10">
      {GROUPS.map(({ phase, key }) => {
        const items = list.filter((c) => c.phase === phase);
        if (!items.length) return null;
        return (
          <section key={phase} aria-labelledby={`group-${key}`}>
            <h2 id={`group-${key}`} className="text-xl sm:text-2xl">
              {t(`challenges.groups.${key}`)}
            </h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((c) => (
                <li key={c.slug}>
                  <ChallengeCard c={c} locale={locale} t={t} mine={mine.get(c.slug)?.entry?.status ?? null} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
