'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { leaveAfterLogout } from '@/lib/forward';
import { useI18n } from '@/i18n/client';
import { buttonClass } from '../ui/Button';
import { accountLinks } from './account-links';
import { NotificationsBell } from './NotificationsBell';

/** "Nour Adel" -> "NA"; falls back to the email's first letter. */
export function initials(name: string | null | undefined, email: string): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const letters = words.length >= 2 ? `${words[0]![0]}${words[words.length - 1]![0]}` : (words[0]?.[0] ?? email.trim()[0] ?? '?');
  return letters.toUpperCase();
}

/**
 * Header account area (lg and up; phones use the drawer). Signed out: Log in and
 * Sign up. Signed in: notifications and the avatar menu (name and email,
 * Dashboard, Profile, Admin for admins, Log out). Loaded in the browser, so the
 * cached page HTML is the same for everyone.
 *
 * The avatar menu is an ARIA menu: it opens with focus on the first item, Up/Down/
 * Home/End move, Escape closes and returns focus to the avatar, Tab closes.
 */
export function UserNav() {
  const { locale, t } = useI18n();
  const { user, loading, logout } = useAuth();
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  if (loading) return <span className="hidden h-10 w-24 lg:inline-block" aria-hidden />;

  if (!user) {
    return (
      <div className="hidden items-center gap-2 lg:flex">
        <Link href={`/${locale}/login`} className="inline-flex min-h-10 items-center rounded-lg px-3 text-[0.9375rem] text-body hover:bg-hover-bg hover:text-fg">
          {t('nav.login')}
        </Link>
        <Link href={`/${locale}/register`} className={buttonClass('secondary', 'sm')}>
          {t('nav.register')}
        </Link>
      </div>
    );
  }

  const links = accountLinks(user, locale, t);

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  }

  const itemClass =
    'block w-full rounded-lg px-3 py-2.5 text-start text-[0.9375rem] text-body hover:bg-hover-bg focus-visible:bg-hover-bg aria-[current=page]:font-medium aria-[current=page]:text-fg';

  return (
    <>
      <NotificationsBell />
      <div className="relative hidden lg:block" ref={root}>
        <button
          ref={button}
          type="button"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !open) {
              e.preventDefault();
              setOpen(true);
            }
          }}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-controls={open ? menuId : undefined}
          aria-label={t('nav.account')}
          className={`grid size-10 place-items-center rounded-full bg-primary-soft text-[0.8125rem] font-semibold text-info hover:bg-primary-soft-hover ${
            open ? 'ring-2 ring-logo-cyan ring-offset-2 ring-offset-card' : ''
          }`}
        >
          {initials(user.name, user.email)}
        </button>
        {open && (
          <div
            ref={menu}
            id={menuId}
            role="menu"
            aria-label={t('nav.account')}
            onKeyDown={onMenuKey}
            className="absolute end-0 z-50 mt-2 w-64 rounded-xl border border-line bg-card p-2 shadow-pop"
          >
            <div className="mb-1.5 border-b border-line-soft px-3 pt-2 pb-3">
              {user.name && <p className="truncate font-medium text-fg">{user.name}</p>}
              <p className="truncate text-sm text-muted ltr-embed">{user.email}</p>
            </div>
            {links.map(([href, label]) => (
              <Link
                key={href}
                role="menuitem"
                tabIndex={-1}
                href={href}
                aria-current={pathname === href ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className={itemClass}
              >
                {label}
              </Link>
            ))}
            <div className="mt-1.5 border-t border-line-soft pt-1.5">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={itemClass}
                onClick={async () => {
                  setOpen(false);
                  await logout();
                  // A full page load: drops pages the router cached while signed in.
                  leaveAfterLogout(`/${locale}`);
                }}
              >
                {t('nav.logout')}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
