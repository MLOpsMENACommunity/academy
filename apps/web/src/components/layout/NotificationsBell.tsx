'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDateTime, viewerTimezone } from '@/lib/format';

interface Item {
  id: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Unread count refresh: every 2 minutes while the tab is visible. */
const POLL_MS = 120_000;
/** After a failure (busy API, offline) the next try waits twice as long, up to this. */
const MAX_BACKOFF_MS = 10 * 60_000;
/** Coming back to the tab refreshes only if the last answer is older than this. */
const FRESH_MS = 60_000;

/** In-app notifications: polls the unread count, loads the list when opened. */
export function NotificationsBell() {
  const { locale, t } = useI18n();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const lastOk = useRef(0);

  // One request at a time, never while the tab is hidden; resolves to whether it succeeded.
  const inFlight = useRef<Promise<boolean> | null>(null);
  const poll = useCallback((): Promise<boolean> => {
    if (document.visibilityState !== 'visible') return Promise.resolve(true);
    inFlight.current ??= api<{ unread: number }>('/notifications/unread-count')
      .then((r) => {
        setUnread(r.unread);
        lastOk.current = Date.now();
        return true;
      })
      .catch(() => false)
      .finally(() => {
        inFlight.current = null;
      });
    return inFlight.current;
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = POLL_MS;
    let stopped = false;
    const schedule = () => {
      if (stopped) return;
      // A little jitter so a room full of open tabs doesn't poll in lockstep.
      timer = setTimeout(tick, delay + Math.random() * 10_000);
    };
    const tick = () => {
      void poll().then((ok) => {
        delay = ok ? POLL_MS : Math.min(delay * 2, MAX_BACKOFF_MS);
        schedule();
      });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastOk.current > FRESH_MS) void poll();
    };
    void poll();
    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll]);

  useEffect(() => {
    if (!open) return;
    setLoadFailed(false);
    // A failed load says so instead of "Loading…" forever.
    api<{ items: Item[]; unread: number }>('/notifications')
      .then((r) => {
        setItems(r.items);
        setUnread(r.unread);
      })
      .catch(() => setLoadFailed(true));
    const close = (e: MouseEvent | globalThis.KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !panel.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  async function markAll() {
    const ok = await api('/notifications/read-all', { method: 'POST' }).then(() => true, () => false);
    if (!ok) return;
    setUnread(0);
    setItems((xs) => xs?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? null);
  }

  // Phones: the panel anchors to the (relative) header, full width under it; md+: under the bell.
  return (
    <div className="md:relative" ref={panel}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${t('nav.notifications')}${unread ? ` (${t('notifications.unread', { count: unread })})` : ''}`}
        className="relative grid size-11 place-items-center rounded-full text-body hover:bg-hover-bg hover:text-fg lg:size-10"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute end-0.5 top-0.5 grid min-w-5 place-items-center rounded-full bg-logo-orange px-1 text-[11px] font-semibold text-cta-text">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute inset-x-4 top-full z-50 mt-2 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-card md:inset-x-auto md:end-0 md:w-[22rem] border border-line bg-card shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm">{t('notifications.title')}</h2>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="text-xs font-semibold text-primary hover:underline">
                {t('notifications.markAll')}
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items === null && !loadFailed && <li className="p-4 text-sm text-muted">{t('common.loading')}</li>}
            {items === null && loadFailed && <li className="p-4 text-sm text-danger">{t('errors.generic')}</li>}
            {items?.length === 0 && <li className="p-4 text-sm text-muted">{t('notifications.empty')}</li>}
            {items?.map((n) => {
              const content = (
                <>
                  <p className={`text-sm ${n.readAt ? 'text-body' : 'font-semibold text-fg'}`}>{locale === 'ar' ? n.titleAr : n.titleEn}</p>
                  <p className="mt-0.5 line-clamp-3 text-xs whitespace-pre-line text-muted">{locale === 'ar' ? n.bodyAr : n.bodyEn}</p>
                  <p className="mt-1 text-[11px] text-muted">{formatDateTime(n.createdAt, locale, viewerTimezone())}</p>
                </>
              );
              return (
                <li key={n.id} className={`border-b border-line last:border-0 ${n.readAt ? '' : 'bg-primary-soft/40'}`}>
                  {n.link ? (
                    <Link
                      href={`/${locale}${n.link}`}
                      className="block px-4 py-3 hover:bg-hover-bg"
                      onClick={() => {
                        setOpen(false);
                        if (!n.readAt) void api(`/notifications/${n.id}/read`, { method: 'POST' }).then(() => poll());
                      }}
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="px-4 py-3">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
