'use client';

import { googleCalendarSubscribeLink, webcalUrl, type CalendarFeedDto } from '@academy/shared';
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import { buttonClass } from '@/components/ui/Button';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { downloadViaApi } from '@/lib/download';

const item =
  'flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-start text-sm font-semibold text-fg hover:bg-muted-bg focus-visible:bg-muted-bg disabled:opacity-60';

/**
 * The student's private feed link. Opening the menu only reads it; `ensure()`
 * creates it (idempotently) when the student picks a subscribe or copy option.
 */
export function useCalendarFeed(enabled: boolean) {
  const [feed, setFeed] = useState<CalendarFeedDto | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || loaded) return;
    setLoaded(true);
    setState('loading');
    api<CalendarFeedDto>('/me/calendar-feed')
      .then((f) => {
        setFeed(f);
        setState('idle');
      })
      .catch(() => setState('error'));
  }, [enabled, loaded]);

  const ensure = useCallback(async (): Promise<string> => {
    if (feed?.url) return feed.url;
    setState('loading');
    try {
      const f = await api<CalendarFeedDto>('/me/calendar-feed', { method: 'POST' });
      if (!f.url) throw new Error('No calendar link');
      setFeed(f);
      setState('idle');
      return f.url;
    } catch (err) {
      setState('error');
      throw err;
    }
  }, [feed]);

  return { url: feed?.url ?? null, state, ensure };
}

/** Read-only field with the private link and a copy button. Render with `key={url}` so state resets per link. */
export function FeedLinkField({ url }: { url: string }) {
  const { t } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (copy !== 'copied') return;
    const timer = setTimeout(() => setCopy('idle'), 4000);
    return () => clearTimeout(timer);
  }, [copy]);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopy('copied');
    } catch {
      // Clipboard blocked (insecure context, old browser): select the text and say how to copy it.
      input.current?.focus();
      input.current?.setSelectionRange(0, url.length);
      setCopy('failed');
    }
  }
  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        {t('learn.calendar.linkLabel')}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          ref={input}
          id={id}
          readOnly
          dir="ltr"
          value={url}
          onFocus={(e) => e.currentTarget.setSelectionRange(0, url.length)}
          // 16px on phones keeps iOS from zooming on focus (same convention as other inputs).
          className="block min-h-11 w-full min-w-0 flex-1 rounded-xl border border-line-strong bg-muted-bg px-3 font-mono text-base text-fg focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none md:text-sm"
        />
        <button type="button" onClick={onCopy} className={buttonClass('secondary', 'md', 'shrink-0')}>
          {t('learn.calendar.copy')}
        </button>
      </div>
      <p role="status" className={`mt-1 min-h-4 text-xs ${copy === 'failed' ? 'text-fg' : 'text-success'}`}>
        {copy === 'copied' ? t('learn.calendar.copied') : copy === 'failed' ? t('learn.calendar.copyFailed') : ''}
      </p>
      <p className="text-xs text-muted">{t('learn.calendar.privateNote')}</p>
    </div>
  );
}

/**
 * "Add all sessions to your calendar": subscribe in Google, Apple or Outlook
 * Calendar through the student's private feed (all their course sessions and
 * live sessions, kept up to date). On a course page (`slug` set) it also offers
 * a one-off .ics download of that course.
 */
export function CalendarMenu({ slug, align = 'end' }: { slug?: string; /** Where the panel lines up from `sm` up (always the start on phones). */ align?: 'start' | 'end' }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { url, state, ensure } = useCalendarFeed(open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Close when keyboard focus moves to something outside the menu. (A null relatedTarget,
  // e.g. Safari not focusing clicked buttons, is left to the outside-click handler.)
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && !e.currentTarget.contains(next)) setOpen(false);
  };

  async function subscribeGoogle() {
    // Open the tab during the click so popup blockers allow it, then point it at Google.
    const tab = window.open('about:blank', '_blank');
    try {
      const target = googleCalendarSubscribeLink(await ensure());
      if (tab) {
        tab.opener = null;
        tab.location.href = target;
      } else {
        window.location.assign(target);
      }
    } catch {
      tab?.close();
    }
  }

  async function subscribeWebcal() {
    try {
      window.location.href = webcalUrl(await ensure());
    } catch {
      // The status line shows the error.
    }
  }

  async function toggleLink() {
    if (showLink) return setShowLink(false);
    try {
      await ensure();
      setShowLink(true);
    } catch {
      // The status line shows the error.
    }
  }

  return (
    <div ref={wrapper} className="relative inline-block" onBlur={onBlur}>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary underline"
      >
        {slug ? t('learn.wholeCourse') : t('learn.calendar.subscribe')}
        <span aria-hidden className={`text-xs transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          // Narrower than the viewport by the page and card padding, so it never overflows at 360px (LTR or RTL).
          className={`absolute start-0 z-40 mt-1 w-[min(22rem,calc(100vw-5rem))] rounded-card border border-line bg-card p-2 text-start shadow-lg ${align === 'end' ? 'sm:start-auto sm:end-0' : ''}`}
        >
          <p className="px-3 pt-1 pb-2 text-xs text-muted">{t('learn.calendar.subscribeHint')}</p>
          {url ? (
            <>
              <a href={googleCalendarSubscribeLink(url)} target="_blank" rel="noopener noreferrer" className={item}>
                {t('learn.calendar.google')}
              </a>
              <a href={webcalUrl(url)} className={item}>
                {t('learn.calendar.apple')}
              </a>
            </>
          ) : (
            <>
              <button type="button" className={item} onClick={subscribeGoogle} disabled={state === 'loading'}>
                {t('learn.calendar.google')}
              </button>
              <button type="button" className={item} onClick={subscribeWebcal} disabled={state === 'loading'}>
                {t('learn.calendar.apple')}
              </button>
            </>
          )}
          <button type="button" aria-expanded={showLink} onClick={toggleLink} className={item} disabled={state === 'loading'}>
            {t('learn.calendar.showLink')}
          </button>
          {showLink && url && (
            <div className="px-3 pb-2">
              <FeedLinkField key={url} url={url} />
            </div>
          )}
          {/* One live region, always mounted, so changes are announced. */}
          <p role="status" className={`px-3 text-sm ${state === 'error' || downloadFailed ? 'py-2 text-danger' : 'text-muted'} ${state === 'loading' ? 'py-2' : ''}`}>
            {state === 'loading' ? t('learn.calendar.loading') : state === 'error' ? t('learn.calendar.error') : downloadFailed ? t('learn.calendar.downloadError') : ''}
          </p>
          {slug && (
            <button
              type="button"
              className={item}
              onClick={() => {
                setDownloadFailed(false);
                downloadViaApi(`/learn/${slug}/calendar.ics`, `${slug}.ics`).catch(() => setDownloadFailed(true));
              }}
            >
              {t('learn.calendar.download')}
            </button>
          )}
          <div className="space-y-1 border-t border-line px-3 pt-2 pb-1 text-xs text-muted">
            <p>{t('learn.calendar.googleDelay')}</p>
            <p>{t('learn.calendar.phoneHint')}</p>
            <p>{t('learn.calendar.duplicatesNote')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
