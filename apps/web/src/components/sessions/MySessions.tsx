'use client';

import type { PublicEventDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { pick } from '@/lib/sessions';
import { DateTile, DayTime } from './SessionDate';

/** One request per page for the signed-in person's upcoming registrations. */
const cache = new Map<string, Promise<PublicEventDto[]>>();

export function useMySessions(): PublicEventDto[] | null {
  const { user } = useAuth();
  const [items, setItems] = useState<PublicEventDto[] | null>(null);
  useEffect(() => {
    if (!user) return setItems(null);
    if (!cache.has(user.id)) {
      cache.set(user.id, api<PublicEventDto[]>('/me/events').catch(() => []));
      // Short-lived: a new registration shows up on the next visit.
      setTimeout(() => cache.delete(user.id), 30_000);
    }
    let live = true;
    void cache.get(user.id)!.then((list) => live && setItems(list));
    return () => {
      live = false;
    };
  }, [user]);
  return items;
}

/** Drops the cached list after (un)registering so other widgets on the page catch up. */
export function forgetMySessions(): void {
  cache.clear();
}

const Arrow = () => (
  <span aria-hidden className="inline-block rtl:-scale-x-100">
    →
  </span>
);

/** The end of a list row / featured card: "You're registered" or a way in. */
export function SessionAction({ slug, variant }: { slug: string; variant: 'link' | 'button' }) {
  const { locale, t } = useI18n();
  const mine = useMySessions();
  const href = `/${locale}/sessions/${slug}`;
  if (mine?.some((e) => e.slug === slug)) {
    return (
      <Link href={href} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary hover:underline">
        <span aria-hidden>✓</span>
        {t('sessions.registered')}
      </Link>
    );
  }
  if (variant === 'button') {
    return (
      <Link href={href} className={buttonClass('accent', 'lg', 'w-full sm:w-auto')}>
        {t('sessions.register')}
      </Link>
    );
  }
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-fg hover:text-primary hover:underline">
      {t('sessions.register')} <Arrow />
    </Link>
  );
}

/** Dashboard: the sessions I'm registered for. */
export function MySessionsList() {
  const { locale, t } = useI18n();
  const items = useMySessions();
  if (items === null) return <div aria-hidden className="h-24" />;
  if (items.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line-strong p-6">
        <p className="text-sm text-muted">{t('dashboard.noSessions')}</p>
        <Link href={`/${locale}/sessions`} className={buttonClass('secondary', 'md', 'mt-4')}>
          {t('dashboard.browseSessions')}
        </Link>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line rounded-card border border-line bg-card">
      {items.map((e) => (
        <li key={e.slug}>
          <Link href={`/${locale}/sessions/${e.slug}`} className="flex min-h-16 items-center gap-4 p-4 hover:bg-muted-bg">
            <DateTile iso={e.startsAt} />
            <span className="min-w-0">
              <span className="block font-semibold text-fg">{pick(locale, e.titleEn, e.titleAr)}</span>
              <span className="block text-sm text-muted">
                <DayTime iso={e.startsAt} />
                {e.status === 'CANCELLED' && <> · {t('sessions.cancelled')}</>}
              </span>
            </span>
            {e.me?.liveUrl && <span className="ms-auto shrink-0 text-sm font-semibold text-primary">{t('sessions.join')}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
