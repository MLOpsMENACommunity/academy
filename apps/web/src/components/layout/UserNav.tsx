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

  if (loading) return <span className="hidden h-10 w-24 md:inline-block" aria-hidden />;

  if (!user) {
    return (
      <>
        <Link
          href={`/${locale}/login`}
          className="hidden min-h-10 items-center rounded-full px-3 text-[0.9375rem] font-medium text-fg hover:bg-muted-bg md:inline-flex"
        >
          {t('nav.login')}
        </Link>
        {/* Wrapped: buttonClass sets its own display, so `hidden` can't sit on the link itself. */}
        <span className="hidden md:inline-flex">
          <Link href={`/${locale}/register`} className={buttonClass('primary', 'sm')}>
            {t('nav.register')}
          </Link>
        </span>
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
      {/* On phones the account links live in the menu button instead (MobileMenu). */}
      <div className="relative hidden md:block" ref={menu}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={t('nav.menu')}
          className="grid size-10 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary hover:bg-primary-soft-hover hover:text-primary-hover"
        >
          {initial}
        </button>
        {open && (
          <div role="menu" className="absolute end-0 z-50 mt-2 w-60 rounded-card border border-line bg-card p-1.5 shadow-[0_12px_32px_-12px_rgba(19,35,63,0.2)]">
            <p className="truncate px-3 py-2 text-sm text-muted ltr-embed">{user.email}</p>
            {links.map(([href, label]) => (
              <Link key={href} role="menuitem" href={href} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2.5 text-[0.9375rem] hover:bg-muted-bg">
                {label}
              </Link>
            ))}
            <button
              type="button"
              role="menuitem"
              className="block w-full rounded-xl px-3 py-2.5 text-start text-[0.9375rem] text-danger hover:bg-muted-bg"
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
