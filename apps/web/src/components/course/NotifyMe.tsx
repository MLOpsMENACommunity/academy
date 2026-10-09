'use client';

import { courseInterestSchema } from '@academy/shared';
import { useEffect, useId, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { inputClass } from '@/components/ui/input';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/**
 * Joined state per course, shared by the two copies of the CTA on a course page (side
 * card and phone bar). Visitors without an account are remembered in this browser only,
 * as a convenience: the list itself lives on the server.
 */
const joined = new Map<string, boolean>();
const listeners = new Set<() => void>();
const storageKey = (slug: string) => `academy.waitlist.${slug}`;
function setJoined(slug: string, value: boolean, remember: boolean) {
  joined.set(slug, value);
  if (remember) {
    try {
      if (value) localStorage.setItem(storageKey(slug), '1');
      else localStorage.removeItem(storageKey(slug));
    } catch {
      // Storage blocked: the state just isn't remembered across visits.
    }
  }
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

interface Props {
  slug: string;
  /** From my-status (signed in only). */
  interested?: boolean;
  /** Compact layout for the phone bar. */
  compact?: boolean;
}

/** "Notify me when it opens": the waiting list for courses that aren't open. */
export function NotifyMe({ slug, interested, compact = false }: Props) {
  const { locale, t } = useI18n();
  const { user, loading } = useAuth();
  const id = useId();
  const isJoined = useSyncExternalStore(
    subscribe,
    () => joined.get(slug) ?? false,
    () => false,
  );
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (user) {
      if (interested !== undefined) setJoined(slug, interested, false);
      return;
    }
    let remembered = false;
    try {
      remembered = localStorage.getItem(storageKey(slug)) === '1';
    } catch {
      // ignore
    }
    setJoined(slug, remembered, false);
  }, [slug, user, loading, interested]);

  async function join(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const body = user ? { locale, website } : { email, locale, website };
    const parsed = courseInterestSchema.safeParse(body);
    if (!parsed.success || (!user && !parsed.data.email)) {
      setError(t('waitlist.invalidEmail'));
      return;
    }
    setBusy(true);
    try {
      await api(`/courses/${slug}/interest`, { method: 'POST', json: parsed.data });
      setJoined(slug, true, !user);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setError(null);
    if (!user) {
      // Visitors leave through the link in their email; here we only forget this browser's note.
      setJoined(slug, false, true);
      return;
    }
    setBusy(true);
    try {
      await api(`/courses/${slug}/interest`, { method: 'DELETE' });
      setJoined(slug, false, false);
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

  if (isJoined) {
    return (
      <div className="space-y-2" aria-live="polite">
        <p className="flex min-h-12 items-center justify-center gap-2 rounded-full bg-logo-green-soft px-4 text-center font-semibold text-success">
          <span aria-hidden>✓</span>
          {t('waitlist.joined')}
        </p>
        {!compact && (
          <p className="text-center text-sm leading-relaxed text-muted">{user ? t('waitlist.joinedNoteUser') : t('waitlist.joinedNoteGuest')}</p>
        )}
        {errorBox}
        <div className="text-center">
          <button
            type="button"
            onClick={leave}
            disabled={busy}
            className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-muted underline underline-offset-4 hover:text-fg"
          >
            {user ? t('waitlist.leave') : t('waitlist.otherEmail')}
          </button>
        </div>
      </div>
    );
  }

  if (user) {
    return (
      <div className="space-y-2">
        <Button variant="accent" size="lg" className="w-full" loading={busy} onClick={() => join()}>
          {t('waitlist.cta')}
        </Button>
        {errorBox}
        {!compact && <p className="text-center text-sm leading-relaxed text-muted">{t('waitlist.noteUser')}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={join} noValidate className="space-y-2">
      <label htmlFor={`${id}-email`} className={compact ? 'sr-only' : 'block text-sm font-medium text-fg'}>
        {t('waitlist.emailLabel')}
      </label>
      <div className={compact ? 'flex gap-2' : 'space-y-2'}>
        <input
          id={`${id}-email`}
          type="email"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('waitlist.emailPlaceholder')}
          aria-invalid={Boolean(error) || undefined}
          className={`${inputClass} ${compact ? 'min-w-0 flex-1' : ''}`}
        />
        {/* Honeypot: hidden from people and screen readers; bots fill it in. */}
        <div aria-hidden className="absolute -start-[9999px] h-px w-px overflow-hidden">
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
          </label>
        </div>
        <Button type="submit" variant="accent" size="lg" className={compact ? 'shrink-0' : 'w-full'} loading={busy}>
          {compact ? t('waitlist.ctaShort') : t('waitlist.cta')}
        </Button>
      </div>
      {errorBox}
      {!compact && <p className="text-center text-sm leading-relaxed text-muted">{t('waitlist.noteGuest')}</p>}
    </form>
  );
}
