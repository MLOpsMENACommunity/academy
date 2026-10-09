'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

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

const POLL_MS = 60_000;

/** In-app notifications: polls the unread count, loads the list when opened. */
export function NotificationsBell() {
  const { locale, t } = useI18n();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const poll = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    api<{ unread: number }>('/notifications/unread-count')
      .then((r) => setUnread(r.unread))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [poll]);

  useEffect(() => {
    if (!open) return;
    api<{ items: Item[]; unread: number }>('/notifications').then((r) => {
      setItems(r.items);
      setUnread(r.unread);
    });
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
    await api('/notifications/read-all', { method: 'POST' });
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
            {items === null && <li className="p-4 text-sm text-muted">{t('common.loading')}</li>}
            {items?.length === 0 && <li className="p-4 text-sm text-muted">{t('notifications.empty')}</li>}
            {items?.map((n) => {
              const content = (
                <>
                  <p className={`text-sm ${n.readAt ? 'text-body' : 'font-semibold text-fg'}`}>{locale === 'ar' ? n.titleAr : n.titleEn}</p>
                  <p className="mt-0.5 line-clamp-3 text-xs whitespace-pre-line text-muted">{locale === 'ar' ? n.bodyAr : n.bodyEn}</p>
                  <p className="mt-1 text-[11px] text-muted">{formatDateTime(n.createdAt, locale)}</p>
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
                        if (!n.readAt) void api(`/notifications/${n.id}/read`, { method: 'POST' }).then(poll);
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
