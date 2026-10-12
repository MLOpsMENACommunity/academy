'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { withReturnTo } from '@/lib/use-return-to';

/** Joined state per course, shared by the two copies of the CTA on a course page (side card and phone bar). */
const joined = new Map<string, boolean>();
/** Courses joined or left on this page visit: newer than a cached my-status answer. */
const changedHere = new Set<string>();
const listeners = new Set<() => void>();
function setJoined(slug: string, value: boolean) {
  joined.set(slug, value);
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Joined from elsewhere (the /notify page a signed-out visitor comes back to): show it on the course page at once. */
export function markWaitlistJoined(slug: string): void {
  changedHere.add(slug);
  setJoined(slug, true);
}

interface Props {
  slug: string;
  /** From my-status (signed in only). */
  interested?: boolean;
  /** Compact layout for the phone bar. */
  compact?: boolean;
}

/**
 * "Notify me when it opens": the waiting list for courses that aren't open. Like applying, it
 * needs an account with a confirmed email: visitors go to sign-up (or sign-in) and come back
 * through /courses/<slug>/notify, which adds them (see NotifyIntent).
 */
export function NotifyMe({ slug, interested, compact = false }: Props) {
  const { locale, t } = useI18n();
  const { user, loading } = useAuth();
  const isJoined = useSyncExternalStore(
    subscribe,
    () => joined.get(slug) ?? false,
    () => false,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) return setJoined(slug, false);
    if (interested !== undefined && !changedHere.has(slug)) setJoined(slug, interested);
  }, [slug, user, loading, interested]);

  async function join() {
    setError(null);
    setBusy(true);
    try {
      await api(`/courses/${slug}/interest`, { method: 'POST', json: { locale } });
      changedHere.add(slug);
      setJoined(slug, true);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED' ? t('waitlist.verifyFirst', { email: user?.email ?? '' }) : errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setError(null);
    setBusy(true);
    try {
      await api(`/courses/${slug}/interest`, { method: 'DELETE' });
      changedHere.add(slug);
      setJoined(slug, false);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  const errorBox = error && (
    <Alert tone="danger" className="text-sm">
      {error}
    </Alert>
  );

  if (user && isJoined) {
    return (
      <div className="space-y-2" aria-live="polite">
        <p className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-logo-green-soft px-4 text-center font-semibold text-success">
          <span aria-hidden>✓</span>
          {t('waitlist.joined')}
        </p>
        {!compact && <p className="text-center text-sm leading-relaxed text-muted">{t('waitlist.joinedNoteUser')}</p>}
        {errorBox}
        <div className="text-center">
          <button
            type="button"
            onClick={leave}
            disabled={busy}
            className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-muted underline underline-offset-4 hover:text-fg"
          >
            {t('waitlist.leave')}
          </button>
        </div>
      </div>
    );
  }

  if (user) {
    return (
      <div className="space-y-2">
        <Button variant="accent" size="lg" className="w-full" loading={busy} onClick={join}>
          {t('waitlist.cta')}
        </Button>
        {errorBox}
        {!compact && <p className="text-center text-sm leading-relaxed text-muted">{t('waitlist.noteUser')}</p>}
      </div>
    );
  }

  // Signed out: create an account (or sign in) first; they come back to /notify, which adds them.
  return (
    <div className="space-y-2">
      <Link
        href={withReturnTo(`/${locale}/register`, `/${locale}/courses/${slug}/notify`)}
        className={buttonClass('accent', 'lg', 'w-full')}
      >
        {t('waitlist.cta')}
      </Link>
      {!compact && <p className="text-center text-sm leading-relaxed text-muted">{t('waitlist.noteGuest')}</p>}
    </div>
  );
}
