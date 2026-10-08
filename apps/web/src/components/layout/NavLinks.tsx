'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { isActive, PRIMARY_NAV } from './nav';

/** Desktop primary navigation (the mobile menu renders the same items). */
export function NavLinks() {
  const { locale, t } = useI18n();
  const pathname = usePathname() ?? '';
  return (
    <ul className="flex items-center gap-1">
      {PRIMARY_NAV.map((item) => {
        const active = isActive(pathname, locale, item.path);
        return (
          <li key={item.path}>
            <Link
              href={`/${locale}${item.path}`}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-10 items-center rounded-full px-3 text-[0.9375rem] transition-colors hover:text-fg ${
                active ? 'font-medium text-fg' : 'text-muted'
              }`}
            >
              {t(item.label)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
