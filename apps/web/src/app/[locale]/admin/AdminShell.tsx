'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { useI18n } from '@/i18n/client';

/** Sections of the admin panel. */
export const ADMIN_NAV = ['dashboard', 'payments', 'applications', 'students', 'courses', 'sessions', 'settings', 'audit'] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const { locale, t } = useI18n();
  const pathname = usePathname() ?? '';
  return (
    <RequireAuth role="ADMIN">
      {() => (
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6 sm:px-6 sm:py-8 lg:flex-row lg:gap-10">
          <nav aria-label={t('admin.title')} className="lg:w-52 lg:shrink-0">
            <p className="mb-3 hidden px-3 text-sm font-medium text-muted lg:block">{t('admin.title')}</p>
            <ul className="-mx-5 flex gap-1 overflow-x-auto px-5 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:px-0 lg:pb-0">
              {ADMIN_NAV.map((key) => {
                const href = key === 'dashboard' ? `/${locale}/admin` : `/${locale}/admin/${key}`;
                const active = key === 'dashboard' ? pathname === href : pathname.startsWith(href);
                return (
                  <li key={key}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={`flex min-h-11 items-center rounded-full px-4 text-[0.9375rem] whitespace-nowrap lg:min-h-10 lg:rounded-xl lg:px-3 ${
                        active ? 'bg-primary-soft font-medium text-primary' : 'text-body hover:bg-muted-bg'
                      }`}
                    >
                      {t(`admin.nav.${key}`)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      )}
    </RequireAuth>
  );
}
