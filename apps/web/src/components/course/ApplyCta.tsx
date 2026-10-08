'use client';

import { applicationStatusLabels, pickSourceParams, type CourseAvailability, type MyCourseStatusDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { trackFunnel } from '@/lib/funnel';
import { buttonClass } from '../ui/Button';

/** Shared across the two CTA instances on a page so my-status is fetched once. */
const statusCache = new Map<string, Promise<MyCourseStatusDto>>();

interface Props {
  slug: string;
  availability: CourseAvailability;
  isFree: boolean;
  requiresApproval: boolean;
  full: boolean;
  priceText: string;
}

/**
 * The one primary call to action. Logged-out visitors go through
 * login/register and come back here (returnTo); tracking params (?ref, utm_*)
 * travel with them to the application. Signed-in users who already applied
 * see their status instead.
 */
export function ApplyCta({ slug, availability, isFree, requiresApproval, full, priceText }: Props) {
  const { locale, t } = useI18n();
  const { user } = useAuth();
  const [status, setStatus] = useState<MyCourseStatusDto | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const params = Object.fromEntries(new URLSearchParams(window.location.search));
    const source = new URLSearchParams(pickSourceParams(params) as Record<string, string>).toString();
    setQuery(source ? `?${source}` : '');
  }, []);

  useEffect(() => {
    if (!user) return setStatus(null);
    const key = `${user.id}:${slug}`;
    if (!statusCache.has(key)) {
      statusCache.set(key, api<MyCourseStatusDto>(`/courses/${slug}/my-status`));
      // Short-lived: a status change shows up on the next visit.
      setTimeout(() => statusCache.delete(key), 30_000);
    }
    statusCache.get(key)!.then(setStatus).catch(() => setStatus(null));
  }, [user, slug]);

  let action: React.ReactNode;
  if (status?.enrolled) {
    action = (
      <Link href={`/${locale}/dashboard`} className={buttonClass('accent', 'lg', 'w-full')}>
        {t('course.goToCourse')}
      </Link>
    );
  } else if (status?.status) {
    const needsPayment = status.status === 'AWAITING_PAYMENT' || status.status === 'PAYMENT_REJECTED';
    action = (
      <Link
        href={`/${locale}/dashboard/applications/${status.applicationId}`}
        className={buttonClass(needsPayment ? 'accent' : 'secondary', 'lg', 'w-full')}
      >
        {needsPayment ? t('course.completePayment') : t('course.viewApplication')}
      </Link>
    );
  } else if (availability === 'OPEN') {
    action = (
      <Link
        href={`/${locale}/courses/${slug}/apply${query}`}
        onClick={() => trackFunnel(slug, 'APPLY_CLICKED')}
        className={buttonClass('accent', 'lg', 'w-full')}
      >
        {full ? t('course.full') : isFree && !requiresApproval ? t('course.enroll') : t('course.apply')}
      </Link>
    );
  } else {
    action = (
      <span className={buttonClass('secondary', 'lg', 'w-full pointer-events-none opacity-70')} aria-disabled>
        {availability === 'UPCOMING' ? t('course.upcoming') : t('course.closed')}
      </span>
    );
  }

  return (
    <div className="space-y-2">
      {status?.status && (
        <p className="text-sm">
          {t('course.statusPrefix')} <strong>{applicationStatusLabels[status.status][locale]}</strong>
        </p>
      )}
      {action}
      {!status?.status && availability === 'OPEN' && (
        <p className="text-center text-xs text-muted">
          {priceText} · {requiresApproval ? t('course.screened') : t('course.instant')}
        </p>
      )}
    </div>
  );
}
