'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useI18n } from '@/i18n/client';
import { buttonClass } from '../ui/Button';
import { NotificationsBell } from './NotificationsBell';

export function UserNav() {
  const { locale, t } = useI18n();
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menu.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (loading) return <span className="inline-block h-9 w-20" aria-hidden />;

  if (!user) {
    return (
      <>
        <Link
          href={`/${locale}/login`}
          className="hidden min-h-9 items-center rounded-lg px-3 text-sm font-semibold text-fg hover:bg-muted-bg sm:inline-flex"
        >
          {t('nav.login')}
        </Link>
        <Link href={`/${locale}/register`} className={buttonClass('primary', 'sm')}>
          {t('nav.register')}
        </Link>
      </>
    );
  }

  const initial = (user.name ?? user.email).trim().charAt(0).toUpperCase();
  const links: [string, string][] = [
    [`/${locale}/dashboard`, t('nav.dashboard')],
    [`/${locale}/profile`, t('nav.profile')],
    ...(user.role === 'ADMIN' ? ([[`/${locale}/admin`, t('nav.admin')]] as [string, string][]) : []),
  ];

  return (
    <>
      <NotificationsBell />
      <div className="relative" ref={menu}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={t('nav.menu')}
          className="grid size-10 place-items-center rounded-full bg-ink text-sm font-bold text-white"
        >
          {initial}
        </button>
        {open && (
          <div role="menu" className="absolute end-0 z-50 mt-2 w-56 rounded-card border border-line bg-card py-1 shadow-lg">
            <p className="truncate px-4 py-2 text-xs text-muted ltr-embed">{user.email}</p>
            {links.map(([href, label]) => (
              <Link key={href} role="menuitem" href={href} onClick={() => setOpen(false)} className="block px-4 py-2.5 text-sm hover:bg-muted-bg">
                {label}
              </Link>
            ))}
            <button
              type="button"
              role="menuitem"
              className="block w-full px-4 py-2.5 text-start text-sm text-danger hover:bg-muted-bg"
              onClick={async () => {
                setOpen(false);
                await logout();
                router.replace(`/${locale}`);
              }}
            >
              {t('nav.logout')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
