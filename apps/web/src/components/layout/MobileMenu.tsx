'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { leaveAfterLogout } from '@/lib/forward';
import { useI18n } from '@/i18n/client';
import { buttonClass } from '../ui/Button';
import { accountLinks } from './account-links';
import { IconChevron, IconClose, IconMenu } from '../ui/Icons';
import { LanguageSwitcher } from './LanguageSwitcher';
import { MenuItem } from './MegaNav';
import type { MenuData } from './menu';
import { menuSections, type MenuSection } from './sections';
import { ConsultationsLink } from './ConsultationsLink';
import { WhatsNewLink } from './WhatsNew';

const rowClass = 'flex min-h-12 w-full items-center justify-between gap-3 rounded-[10px] px-4 text-start text-fg';

/**
 * Phones and tablets (below lg): a menu button that opens a full-screen drawer with
 * the Learn / Live / Community sections (each a disclosure), What's new, the account
 * links and the language switch. It is a modal dialog: focus moves into it and stays
 * there, Escape or the close button closes it and returns focus to the menu button,
 * and the page behind doesn't scroll. Logical properties keep it right in Arabic (RTL).
 */
export function MobileMenu({ data }: { data: MenuData }) {
  const { locale, t } = useI18n();
  const { user, loading, logout } = useAuth();
  const pathname = usePathname() ?? '';
  const sections = useMemo(() => menuSections(t, locale, data), [t, locale, data]);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<MenuSection['id'] | null>('learn');
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const opener = button.current;
    dialog.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !dialog.current) return;
      // Keep Tab inside the drawer.
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')].filter((el) => el.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
  }, [open]);

  const close = () => setOpen(false);
  const account: [string, string][] = user ? accountLinks(user, locale, t) : [];

  return (
    <div className="lg:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('nav.menu')}
        onClick={() => setOpen(true)}
        className="grid size-11 place-items-center rounded-lg text-fg hover:bg-hover-bg"
      >
        <IconMenu size={22} />
      </button>

      {open && (
        <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-50 flex flex-col bg-card">
          <div className="flex min-h-16 items-center gap-2.5 border-b border-line px-4 sm:px-6">
            <Image src="/logo.svg" alt="" width={40} height={23} className="h-[23px] w-10 shrink-0" />
            <span id={titleId} className="text-[0.9375rem] font-semibold text-fg">
              {t('meta.siteName')}
            </span>
            <button
              type="button"
              data-autofocus
              onClick={close}
              aria-label={t('nav.closeMenu')}
              className="ms-auto grid size-11 place-items-center rounded-lg text-fg hover:bg-hover-bg"
            >
              <IconClose size={20} />
            </button>
          </div>

          <nav aria-label={t('nav.primary')} className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3 sm:px-6">
            {sections.map((s) => {
              const expanded = section === s.id;
              const panelId = `${titleId}-${s.id}`;
              const links = s.id === 'learn' ? s.columns[0]!.links : s.columns.flatMap((c) => c.links);
              return (
                <div key={s.id} className={expanded ? 'rounded-xl bg-muted-bg p-1.5 pb-2.5' : 'border-b border-line-soft'}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setSection(expanded ? null : s.id)}
                    className={`${rowClass} ${expanded ? 'font-semibold' : ''}`}
                  >
                    {s.label}
                    <IconChevron up={expanded} className={expanded ? 'text-primary' : 'text-muted'} />
                  </button>
                  <ul id={panelId} hidden={!expanded} className="flex flex-col gap-1">
                    {links.map((link) => (
                      <li key={link.href + link.label}>
                        <MenuItem link={link} compact onNavigate={close} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <ConsultationsLink onNavigate={close} className={`${rowClass} justify-start! gap-2 aria-[current=page]:font-medium`} />
            <WhatsNewLink onNavigate={close} className={`${rowClass} justify-start! gap-2 aria-[current=page]:font-medium`} />
          </nav>

          <div className="flex flex-col gap-2.5 border-t border-line px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
            {user ? (
              <>
                <div className="px-1">
                  {user.name && <p className="truncate font-medium text-fg">{user.name}</p>}
                  <p className="truncate text-sm text-muted ltr-embed">{user.email}</p>
                </div>
                <ul className="grid grid-cols-2 gap-2">
                  {account.map(([href, label]) => (
                    <li key={href}>
                      <Link href={href} onClick={close} aria-current={pathname === href ? 'page' : undefined} className={buttonClass('secondary', 'md', 'w-full')}>
                        {label}
                      </Link>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-lg px-5 text-[0.9375rem] font-medium text-danger hover:bg-hover-bg"
                      onClick={async () => {
                        close();
                        await logout();
                        // A full page load: drops pages the router cached while signed in.
                        leaveAfterLogout(`/${locale}`);
                      }}
                    >
                      {t('nav.logout')}
                    </button>
                  </li>
                </ul>
              </>
            ) : loading ? null : (
              <>
                <Link href={`/${locale}/register`} onClick={close} className={buttonClass('primary', 'lg', 'w-full')}>
                  {t('nav.register')}
                </Link>
                <Link href={`/${locale}/login`} onClick={close} className={buttonClass('secondary', 'lg', 'w-full')}>
                  {t('nav.login')}
                </Link>
              </>
            )}
            <LanguageSwitcher className="w-full justify-center" />
          </div>
        </div>
      )}
    </div>
  );
}
