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
 * Logged-out visitors log in first and come back with ?register=1, which
 * finishes the registration they started.
 */
export function RegisterPanel({ initial, title, pageUrl }: { initial: PublicEventDto; title: string; pageUrl: string }) {
  const { locale, t } = useI18n();
  const { user, loading } = useAuth();
  const [event, setEvent] = useState(initial);
  const [now, setNow] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const autoTried = useRef(false);
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

  const state = registerState(event, now ?? undefined);

  const fail = useCallback(
    (err: unknown) => {
      const code = err instanceof ApiError ? err.code : undefined;
      setMessage({ tone: 'danger', text: code && SESSION_ERRORS.includes(code) ? t(`sessions.errors.${code}`) : errorMessage(err, t) });
    },
    [t],
  );

  const register = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      setEvent(await api<PublicEventDto>(`${path}/registration`, { method: 'POST' }));
      forgetMySessions();
      setMessage({ tone: 'success', text: t('sessions.registeredNow') });
    } catch (err) {
      fail(err);
      void refresh();
    } finally {
      setBusy(false);
    }
  }, [path, t, fail, refresh]);

  async function cancel() {
    if (!window.confirm(t('sessions.cancelConfirm'))) return;
    setBusy(true);
    setMessage(null);
    try {
      setEvent(await api<PublicEventDto>(`${path}/registration`, { method: 'DELETE' }));
      forgetMySessions();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  // Back from login with ?register=1: finish what the visitor started, once.
  useEffect(() => {
    if (!user || !event.me || autoTried.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('register') !== '1') return;
    autoTried.current = true;
    params.delete('register');
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    if (state === 'open') void register();
  }, [user, event.me, state, register]);

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
  const registered = state === 'registered' || state === 'live';
  const [before, after] = t('sessions.linkFrom', { time: '\u0000' }).split('\u0000');

  return (
    <div className="space-y-3">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {registered && (
        <p className="flex items-center gap-2 font-semibold text-primary">
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
          {before}
          <LocalTime iso={event.me.liveUrlFrom} style="weekday-datetime" />
          {after} {t('sessions.reminderNote')}
        </p>
      )}

      {state === 'open' &&
        (user ? (
          <Button variant="accent" size="lg" className="w-full" onClick={register} loading={busy}>
            {t('sessions.registerFree')}
          </Button>
        ) : (
          <Link
            href={`/${locale}/login?returnTo=${encodeURIComponent(`${here}?register=1`)}`}
            aria-disabled={loading || undefined}
            className={buttonClass('accent', 'lg', 'w-full')}
          >
            {t('sessions.registerFree')}
          </Link>
        ))}

      {state === 'full' && (
        <span className={buttonClass('secondary', 'lg', 'pointer-events-none w-full opacity-70')} aria-disabled>
          {t('sessions.full')}
        </span>
      )}

      {state === 'open' && <p className="text-center text-xs text-muted">{user || loading ? t('sessions.freeNote') : t('sessions.loginNote')}</p>}

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
      <a href={`/api${path}/calendar.ics`} className={buttonClass('ghost', 'md', 'w-full')} download>
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
