'use client';

import type { CourseSummaryDto } from '@academy/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { CourseCard } from './CourseCard';

/**
 * Private courses shared with the signed-in account, shown at the top of the catalog. The catalog
 * page itself is cached and the same for everyone, so these are fetched here with the visitor's
 * session; the API returns only courses whose list includes the account's confirmed email, so
 * everyone else (and signed-out visitors) sees nothing.
 */
export function PrivateCatalogCourses() {
  const { locale, t } = useI18n();
  const { user, loading } = useAuth();
  const [list, setList] = useState<CourseSummaryDto[]>([]);

  useEffect(() => {
    if (loading || !user) {
      setList([]);
      return;
    }
    let cancelled = false;
    // no-store: never reuse an answer from another account or from before signing in.
    api<CourseSummaryDto[]>('/me/private-courses', { cache: 'no-store' })
      .then((courses) => !cancelled && setList(courses))
      .catch(() => !cancelled && setList([]));
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  if (!list.length) return null;
  return (
    <section aria-labelledby="catalog-for-you" className="mb-10">
      <h2 id="catalog-for-you" className="text-2xl">
        {t('dashboard.coursesForYou')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('dashboard.coursesForYouHint')}</p>
      <ul className="mt-5 grid gap-5 sm:gap-7 md:grid-cols-2">
        {list.map((c) => (
          <li key={c.id} className="flex">
            <CourseCard course={c} locale={locale} priceTag />
          </li>
        ))}
      </ul>
    </section>
  );
}
