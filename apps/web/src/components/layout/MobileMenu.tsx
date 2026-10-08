'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useI18n } from '@/i18n/client';
import { buttonClass } from '../ui/Button';
import { LanguageSwitcher } from './LanguageSwitcher';
import { isActive, PRIMARY_NAV } from './nav';

const itemClass =
  'flex min-h-12 w-full items-center rounded-xl px-3 text-base text-fg hover:bg-muted-bg aria-[current=page]:font-medium aria-[current=page]:bg-muted-bg';

/**
 * Phone navigation: a disclosure button that opens a panel under the header with
 * the primary nav, the account links and the language switch. Escape or a click
 * outside closes it and returns focus to the button.
 */
export function MobileMenu() {
  const { locale, t } = useI18n();
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // A navigation closes the menu.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const account: [string, string][] = user
    ? [
        [`/${locale}/dashboard`, t('nav.dashboard')],
        [`/${locale}/profile`, t('nav.profile')],
        ...(user.role === 'ADMIN' ? ([[`/${locale}/admin`, t('nav.admin')]] as [string, string][]) : []),
      ]
    : [];

  return (
    <div className="md:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t('nav.menu')}
        onClick={() => setOpen((o) => !o)}
        className="grid size-11 place-items-center rounded-full text-fg hover:bg-muted-bg"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      <div
        ref={panel}
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full border-b border-line bg-card px-5 pt-2 pb-5 shadow-[0_12px_24px_-16px_rgba(19,35,63,0.25)]"
      >
        <nav aria-label={t('nav.primary')}>
          <ul>
            {PRIMARY_NAV.map((item) => (
              <li key={item.path}>
                <Link
                  href={`/${locale}${item.path}`}
                  aria-current={isActive(pathname, locale, item.path) ? 'page' : undefined}
                  className={itemClass}
                  onClick={() => setOpen(false)}
                >
                  {t(item.label)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-2 border-t border-line pt-2">
          {user ? (
            <>
              <p className="truncate px-3 py-2 text-sm text-muted ltr-embed">{user.email}</p>
              <ul>
                {account.map(([href, label]) => (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={pathname === href ? 'page' : undefined}
                      className={itemClass}
                      onClick={() => setOpen(false)}
                    >
                      {label}
                    </Link>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className={`${itemClass} text-start text-danger`}
                    onClick={async () => {
                      setOpen(false);
                      await logout();
                      router.replace(`/${locale}`);
                    }}
                  >
                    {t('nav.logout')}
                  </button>
                </li>
              </ul>
            </>
          ) : loading ? null : (
            <div className="flex flex-col gap-2 pt-2">
              <Link href={`/${locale}/login`} className={buttonClass('secondary', 'lg', 'w-full')} onClick={() => setOpen(false)}>
                {t('nav.login')}
              </Link>
              <Link href={`/${locale}/register`} className={buttonClass('primary', 'lg', 'w-full')} onClick={() => setOpen(false)}>
                {t('nav.register')}
              </Link>
            </div>
          )}
        </div>
        <div className="mt-3 border-t border-line pt-2">
          <LanguageSwitcher className="min-h-12 w-full px-3 text-base" />
        </div>
      </div>
    </div>
  );
}
