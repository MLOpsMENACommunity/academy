'use client';

import { ADMIN_NAV_ITEMS, adminNavFor, adminSectionOf, hasAdminPermission, type AdminNavKey } from '@academy/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { Alert } from '@/components/ui/Alert';
import { PageSpinner } from '@/components/ui/Spinner';
import { useI18n } from '@/i18n/client';

/** Sections of the admin panel, in order (who sees each: ADMIN_NAV_ITEMS in @academy/shared). */
export const ADMIN_NAV = ADMIN_NAV_ITEMS.map((i) => i.key);

const hrefOf = (locale: string, key: AdminNavKey) => (key === 'dashboard' ? `/${locale}/admin` : `/${locale}/admin/${key}`);

/** The dashboard is not for everyone: an admin without it lands on their first section instead. */
function GoToFirst({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [router, href]);
  return <PageSpinner />;
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { locale, t } = useI18n();
  const pathname = usePathname() ?? '';
  return (
    <RequireAuth role="ADMIN">
      {(user) => {
        // Only hides what this admin can't use: the API checks every request.
        const nav = adminNavFor(user);
        const section = adminSectionOf(pathname.slice(`/${locale}/admin`.length));
        const allowed = section === null || hasAdminPermission(user, ADMIN_NAV_ITEMS.find((i) => i.key === section)!.permissions);
        let body: ReactNode = children;
        if (!allowed) {
          body =
            section === 'dashboard' && nav.length ? (
              <GoToFirst href={hrefOf(locale, nav[0]!)} />
            ) : (
              <Alert tone="warning" title={t('admin.noAccess.title')}>
                {t(nav.length ? 'admin.noAccess.body' : 'admin.noAccess.none')}
              </Alert>
            );
        }
        return (
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6 sm:px-6 sm:py-8 lg:flex-row lg:gap-10">
            <nav aria-label={t('admin.title')} className="lg:w-52 lg:shrink-0">
              <p className="mb-3 hidden px-3 text-sm font-medium text-muted lg:block">{t('admin.title')}</p>
              <ul className="-mx-5 flex gap-1 overflow-x-auto px-5 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-col lg:px-0 lg:pb-0">
                {nav.map((key) => {
                  const href = hrefOf(locale, key);
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
                        {key === 'points' ? t('admin.points.nav') : t(`admin.nav.${key}`)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <div className="min-w-0 flex-1">{body}</div>
          </div>
        );
      }}
    </RequireAuth>
  );
}
