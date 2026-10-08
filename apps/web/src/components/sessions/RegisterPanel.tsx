'use client';

import { googleCalendarLink, type PublicEventDto } from '@academy/shared';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { LocalTime } from '@/components/course/LocalTime';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api, ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { msUntilLink, registerState } from '@/lib/sessions';
import { forgetMySessions } from './MySessions';

const SESSION_ERRORS = ['EVENT_FULL', 'EVENT_CLOSED', 'EMAIL_NOT_VERIFIED'];

/**
 * Register / cancel for one live session. The page is cached and public; the
 * viewer's own registration (and the join link near the start) is fetched here.
 * Logged-out visitors log in first and come back with ?register=1, which only
 * brings the register button into view: registering always takes a click.
 */
export function RegisterPanel({ initial, title, pageUrl }: { initial: PublicEventDto; title: string; pageUrl: string }) {
  const { locale, t } = useI18n();
  const { user, loading } = useAuth();
  const [event, setEvent] = useState(initial);
  const [now, setNow] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [returned, setReturned] = useState(false);
  const registeredRef = useRef<HTMLParagraphElement>(null);
  const registerRef = useRef<HTMLButtonElement>(null);
  const focusRegistered = useRef(false);
  const slug = initial.slug;
  const path = `/events/${slug}`;

  const refresh = useCallback(() => api<PublicEventDto>(path).then(setEvent).catch(() => undefined), [path]);

  // A clock for "ended" and the join link, ticking once a minute.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (user) void refresh();
    else setEvent(initial);
  }, [user, refresh, initial]);

  // Registered and waiting: fetch again when the join link is due.
  useEffect(() => {
    const ms = msUntilLink(event);
    if (ms === null) return;
    const id = setTimeout(() => void refresh(), ms + 1_000);
    return () => clearTimeout(id);
  }, [event, refresh]);

  // Until hydrated, trust only the server's "past" flag so server and client render the same.
  const state = registerState(event, now ?? new Date(0));
  const registered = state === 'registered' || state === 'live';

  // The register button disappears on success: put focus on the result instead of <body>.
  useEffect(() => {
    if (registered && focusRegistered.current) {
      focusRegistered.current = false;
      registeredRef.current?.focus();
    }
  }, [registered]);

  // Back from login with ?register=1: bring the button into view, but never register without a click.
  useEffect(() => {
    if (!user || !event.me) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('register') !== '1') return;
    params.delete('register');
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    if (state === 'open') {
      setReturned(true);
      registerRef.current?.scrollIntoView({ block: 'center' });
      registerRef.current?.focus();
    }
  }, [user, event.me, state]);

  const fail = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : undefined;
    setError(code && SESSION_ERRORS.includes(code) ? t(`sessions.errors.${code}`) : errorMessage(err, t));
  };

  async function register() {
    setBusy(true);
    setStatus('');
    setError('');
    try {
      const next = await api<PublicEventDto>(`${path}/registration`, { method: 'POST' });
      focusRegistered.current = true;
      setEvent(next);
      forgetMySessions();
      setStatus(t('sessions.registeredNow'));
    } catch (err) {
      fail(err);
      void refresh();
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm(t('sessions.cancelConfirm'))) return;
    setBusy(true);
    setStatus('');
    setError('');
    try {
      setEvent(await api<PublicEventDto>(`${path}/registration`, { method: 'DELETE' }));
      forgetMySessions();
      setStatus('');
      // The register button is back: keep keyboard users in the panel.
      requestAnimationFrame(() => registerRef.current?.focus());
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  // Always in the DOM, so screen readers announce what we put in them.
  const liveRegions = (
    <>
      <div role="status" aria-live="polite" className={status ? 'rounded-lg border border-success/30 bg-success-soft p-4 text-sm text-success' : 'sr-only'}>
        {status}
      </div>
      <div role="alert" className={error ? 'rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm text-danger' : 'sr-only'}>
        {error}
      </div>
    </>
  );

  if (state === 'cancelled' || state === 'ended') {
    return (
      <Alert tone={state === 'cancelled' ? 'warning' : 'info'} title={t(`sessions.${state}`)}>
        <p>{t(state === 'cancelled' ? 'sessions.cancelledBody' : 'sessions.endedBody')}</p>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {state === 'ended' && event.recordingUrl && (
            <a href={event.recordingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold underline">
              {t('sessions.recording')}
            </a>
          )}
          <Link href={`/${locale}/sessions`} className="inline-flex min-h-11 items-center font-semibold underline">
            {t('sessions.allSessions')}
          </Link>
        </p>
      </Alert>
    );
  }

  const here = `/${locale}/sessions/${slug}`;
  const linkDue = event.me && now && new Date(event.me.liveUrlFrom).getTime() <= now.getTime();
  const [before, after] = t('sessions.linkFrom', { time: '\u0000' }).split('\u0000');

  return (
    <div className="space-y-3">
      {liveRegions}

      {registered && (
        <p ref={registeredRef} tabIndex={-1} className="flex items-center gap-2 font-semibold text-primary focus:outline-none">
          <span aria-hidden>✓</span>
          {t('sessions.registered')}
        </p>
      )}

      {state === 'live' && event.me?.liveUrl && (
        <a href={event.me.liveUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('accent', 'lg', 'w-full')}>
          {t('sessions.join')}
        </a>
      )}

      {state === 'registered' && event.me && (
        <p className="text-sm text-muted">
          {linkDue ? (
            t('sessions.linkSoon')
          ) : (
            <>
              {before}
              <LocalTime iso={event.me.liveUrlFrom} style="weekday-datetime" />
              {after}
            </>
          )}{' '}
          {t('sessions.reminderNote')}
        </p>
      )}

      {state === 'open' && (
        <>
          {returned && <p className="text-sm text-body">{t('sessions.confirmHint')}</p>}
          {user ? (
            <Button ref={registerRef} variant="accent" size="lg" className="w-full" onClick={register} loading={busy}>
              {t('sessions.registerFree')}
            </Button>
          ) : loading ? (
            <Button variant="accent" size="lg" className="w-full" disabled>
              {t('sessions.registerFree')}
            </Button>
          ) : (
            <Link href={`/${locale}/login?returnTo=${encodeURIComponent(`${here}?register=1`)}`} className={buttonClass('accent', 'lg', 'w-full')}>
              {t('sessions.registerFree')}
            </Link>
          )}
          <p className="text-center text-xs text-muted">{user || loading ? t('sessions.freeNote') : t('sessions.loginNote')}</p>
        </>
      )}

      {state === 'full' && <p className="rounded-lg bg-muted-bg p-3 text-center font-semibold text-fg">{t('sessions.full')}</p>}

      {/* Calendar entries point at the public page, never at the join link. */}
      <a
        href={googleCalendarLink({
          title,
          start: event.startsAt,
          end: new Date(new Date(event.startsAt).getTime() + event.durationMin * 60_000),
          details: `${t('sessions.calendarDetails')}\n${pageUrl}`,
          location: pageUrl,
        })}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClass('secondary', 'md', 'w-full')}
      >
        {t('sessions.addToGoogle')}
      </a>
      <a href={`/api${path}/calendar.ics?locale=${locale}`} className={buttonClass('ghost', 'md', 'w-full')} download>
        {t('sessions.addToCalendar')}
      </a>

      {registered && (
        <Button variant="ghost" size="md" className="w-full text-muted" onClick={cancel} disabled={busy}>
          {t('sessions.cancelRegistration')}
        </Button>
      )}
    </div>
  );
}
