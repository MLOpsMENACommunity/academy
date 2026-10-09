'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { LATEST_CHANGE_ID, WHATS_NEW_STORAGE_KEY } from '@/lib/changelog';

const SEEN_EVENT = 'academy:whats-new-seen';

function readSeen(): string | null {
  try {
    return window.localStorage.getItem(WHATS_NEW_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** True once mounted when this browser hasn't opened /whats-new since the newest entry. Never in the server HTML. */
function useUnread(): boolean {
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    const update = () => setUnread(Boolean(LATEST_CHANGE_ID) && readSeen() !== LATEST_CHANGE_ID);
    update();
    window.addEventListener(SEEN_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(SEEN_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return unread;
}

/** "What's new" with an orange dot while there's something this visitor hasn't seen. */
export function WhatsNewLink({ className = '', onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { locale, t } = useI18n();
  const pathname = usePathname() ?? '';
  const href = `/${locale}/whats-new`;
  const unread = useUnread();
  return (
    <Link href={href} className={className} aria-current={pathname === href ? 'page' : undefined} onClick={onNavigate}>
      {t('whatsNew.title')}
      {unread && (
        <>
          <span aria-hidden className="size-[7px] rounded-full bg-logo-orange" />
          <span className="sr-only">({t('whatsNew.unread')})</span>
        </>
      )}
    </Link>
  );
}

/** On /whats-new: remembers (in this browser) that the newest entry has been seen. */
export function MarkWhatsNewSeen() {
  useEffect(() => {
    try {
      window.localStorage.setItem(WHATS_NEW_STORAGE_KEY, LATEST_CHANGE_ID);
    } catch {
      // Private mode or storage blocked: the dot simply stays.
    }
    window.dispatchEvent(new Event(SEEN_EVENT));
  }, []);
  return null;
}
