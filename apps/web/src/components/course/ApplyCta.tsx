'use client';

import { applicationStatusLabels, pickSourceParams, type CourseAvailability, type MyCourseStatusDto } from '@academy/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { trackFunnel } from '@/lib/funnel';
import { buttonClass } from '../ui/Button';
import { NotifyMe } from './NotifyMe';

/**
 * The served availability, turned to CLOSED once the deadline passes in the browser: the
 * course page is cached (ISR), so without this "Apply now" stays up to a minute too long.
 */
function useDeadline(served: CourseAvailability, deadline: string | null): CourseAvailability {
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    if (served !== 'OPEN' || !deadline) return;
    const ms = new Date(deadline).getTime() - Date.now();
    if (ms <= 0) return setPassed(true);
    // setTimeout overflows past ~24.8 days; a page is rarely open that long.
    if (ms > 2 ** 31 - 1) return;
    const timer = setTimeout(() => setPassed(true), ms);
    return () => clearTimeout(timer);
  }, [served, deadline]);
  return passed ? 'CLOSED' : served;
}

/** Shared across the two CTA instances on a page so my-status is fetched once. */
const statusCache = new Map<string, Promise<MyCourseStatusDto>>();

/**
 * Forgets the cached status for a course, e.g. right after applying, so the
 * (ISR-cached) course page swaps "Apply now" for "View my application" at once
 * instead of after the 30-second cache expires.
 */
export function invalidateCourseStatus(slug: string): void {
  for (const key of statusCache.keys()) if (key.endsWith(`:${slug}`)) statusCache.delete(key);
}

interface Props {
  slug: string;
  availability: CourseAvailability;
  /** The page is cached for a minute: the button closes at the deadline itself. */
  applicationDeadline?: string | null;
  isFree: boolean;
  requiresApproval: boolean;
  full: boolean;
  priceText: string;
  /** A past cohort (status COMPLETED). */
  completed?: boolean;
  /** The phone bar: shorter copy. */
  compact?: boolean;
}

/**
 * The one primary call to action. Logged-out visitors go through
 * login/register and come back here (returnTo); tracking params (?ref, utm_*)
 * travel with them to the application. Signed-in users who already applied
 * see their status instead.
 */
export function ApplyCta({ slug, availability: served, applicationDeadline = null, isFree, requiresApproval, full, priceText, completed = false, compact = false }: Props) {
  const { locale, t } = useI18n();
  const availability = useDeadline(served, applicationDeadline);
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
      <Link href={`/${locale}/learn/${slug}`} className={buttonClass('accent', 'lg', 'w-full')}>
        {t('course.goToCourse')}
      </Link>
    );
  } else if (status?.status && !(status.status === 'WITHDRAWN' && availability === 'OPEN' && !completed)) {
    const needsPayment = status.status === 'AWAITING_PAYMENT' || status.status === 'PAYMENT_REJECTED';
    action = (
      <Link
        href={`/${locale}/dashboard/applications/${status.applicationId}`}
        className={buttonClass(needsPayment ? 'accent' : 'secondary', 'lg', 'w-full')}
      >
        {needsPayment ? t('course.completePayment') : t('course.viewApplication')}
      </Link>
    );
  } else if (availability === 'OPEN' && !completed) {
    action = (
      <Link
        href={`/${locale}/courses/${slug}/apply${query}`}
        // Signed out, the prefetch is only the middleware's redirect to login; don't keep it.
        prefetch={user ? undefined : false}
        onClick={() => trackFunnel(slug, 'APPLY_CLICKED')}
        className={buttonClass('accent', 'lg', 'w-full')}
      >
        {full ? t('course.full') : status?.status === 'WITHDRAWN' ? t('applications.applyAgain') : isFree && !requiresApproval ? t('course.enroll') : t('course.apply')}
      </Link>
    );
  } else {
    // Not open (coming soon, closed or a past cohort): join the waiting list instead.
    action = (
      <>
        {!compact && (
          <p className="text-center text-sm font-medium text-fg">
            {completed ? t('waitlist.headingCompleted') : availability === 'UPCOMING' ? t('course.upcoming') : t('course.closed')}
          </p>
        )}
        <NotifyMe slug={slug} interested={user ? (status ? status.interested : undefined) : undefined} compact={compact} />
      </>
    );
  }

  return (
    <div className="space-y-2">
      {status?.status && (
        <p className="text-sm">
          {t('course.statusPrefix')} <strong className="font-medium text-fg">{applicationStatusLabels[status.status][locale]}</strong>
        </p>
      )}
      {action}
      {(!status?.status || status.status === 'WITHDRAWN') && availability === 'OPEN' && !completed && (
        <p className="text-center text-sm leading-relaxed text-muted">
          {priceText} · {requiresApproval ? t('course.screened') : full ? t('course.fullInstant') : t('course.instant')}
        </p>
      )}
    </div>
  );
}
