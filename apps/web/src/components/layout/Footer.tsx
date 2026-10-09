import type { Locale } from '@academy/shared';
import Image from 'next/image';
import Link from 'next/link';
import { createTranslator } from '@/i18n/translator';
import { blogUrl, community } from '@/lib/site';
import { LanguageSwitcher } from './LanguageSwitcher';

const linkClass = 'inline-flex min-h-11 items-center text-body transition-colors hover:text-primary hover:underline md:min-h-8';

type FooterLink = { href: string; label: string; external?: boolean };

/** Light footer: brand line, then Learn / Live / Community / Academy columns. */
export function Footer({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const l = (path: string) => `/${locale}${path}`;
  const columns: { id: string; heading: string; links: FooterLink[] }[] = [
    {
      id: 'learn',
      heading: t('menu.learn'),
      links: [
        { href: l('/courses'), label: t('nav.courses') },
        { href: l('/learning-paths'), label: t('menu.paths') },
        { href: l('/sessions/recordings'), label: t('menu.recordings') },
      ],
    },
    {
      id: 'live',
      heading: t('menu.live'),
      links: [
        { href: l('/sessions'), label: t('menu.upcoming') },
        { href: l('/speakers'), label: t('menu.speakers') },
        { href: l('/whats-new'), label: t('whatsNew.title') },
      ],
    },
    {
      id: 'community',
      heading: t('footer.community'),
      links: [
        { href: community.discord, label: 'Discord', external: true },
        { href: community.telegram, label: 'Telegram', external: true },
        { href: community.linkedin, label: 'LinkedIn', external: true },
        { href: community.youtube, label: 'YouTube', external: true },
        { href: community.github, label: 'GitHub', external: true },
        { href: blogUrl(locale), label: t('menu.blog'), external: true },
      ],
    },
    {
      id: 'academy',
      heading: t('footer.academy'),
      links: [
        { href: l('/privacy'), label: t('footer.privacy') },
        { href: l('/terms'), label: t('footer.terms') },
        { href: l('/refund-policy'), label: t('footer.refund') },
        { href: l('/code-of-conduct'), label: t('footer.conduct') },
        { href: l('/contact'), label: t('footer.contact') },
      ],
    },
  ];

  return (
    <footer className="border-t border-line bg-card text-[0.9375rem]">
      <div className="mx-auto grid w-full max-w-[75rem] gap-10 px-5 pt-14 pb-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-[2fr_repeat(4,minmax(0,1fr))] lg:gap-8 lg:px-10 lg:pt-18">
        <div className="flex flex-col gap-3 sm:col-span-2 lg:col-span-1">
          <Link href={`/${locale}`} className="inline-flex min-h-11 items-center gap-2.5 self-start font-semibold text-fg">
            <Image src="/logo.svg" alt="" width={40} height={23} className="h-[23px] w-10" />
            {t('meta.siteName')}
          </Link>
          <p className="max-w-xs leading-relaxed text-muted">{t('footer.about')}</p>
        </div>
        {columns.map((col) => (
          <nav key={col.id} aria-labelledby={`footer-${col.id}`}>
            <h2 id={`footer-${col.id}`} className="text-[0.9375rem] font-medium text-fg">
              {col.heading}
            </h2>
            <ul className={`mt-2 ${col.id === 'community' ? 'grid grid-cols-2 gap-x-4 sm:block' : ''}`}>
              {col.links.map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a href={link.href} className={linkClass} rel="noopener">
                      {link.label}
                    </a>
                  ) : (
                    <Link href={link.href} className={linkClass}>
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto flex w-full max-w-[75rem] flex-wrap items-center justify-between gap-3 px-5 pb-8 sm:px-6 lg:px-10">
        <p className="w-full border-t border-line-soft pt-6 text-sm text-muted sm:w-auto sm:border-0 sm:pt-0">{t('footer.rights', { year: new Date().getFullYear() })}</p>
        <LanguageSwitcher className="-ms-3 sm:ms-0" />
      </div>
    </footer>
  );
}
