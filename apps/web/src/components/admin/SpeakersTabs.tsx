'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/i18n/client';

/** Speakers → Profiles · Applications · Availability. */
export function SpeakersTabs() {
  const { locale, t } = useI18n();
  const pathname = usePathname() ?? '';
  const base = `/${locale}/admin/speakers`;
  const tabs = [
    { href: base, label: t('admin.speakerApps.tabs.profiles'), active: !pathname.startsWith(`${base}/applications`) && !pathname.startsWith(`${base}/availability`) },
    { href: `${base}/applications`, label: t('admin.speakerApps.tabs.applications'), active: pathname.startsWith(`${base}/applications`) },
    { href: `${base}/availability`, label: t('admin.speakerApps.tabs.availability'), active: pathname.startsWith(`${base}/availability`) },
  ];
  return (
    <nav aria-label={t('admin.speakers.title')} className="mb-5 border-b border-line">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={tab.active ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center border-b-2 px-3 text-[0.9375rem] whitespace-nowrap ${
                tab.active ? 'border-primary font-medium text-primary' : 'border-transparent text-body hover:text-fg'
              }`}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
