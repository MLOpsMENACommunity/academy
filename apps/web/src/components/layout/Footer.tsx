import type { Locale } from '@academy/shared';
import Image from 'next/image';
import Link from 'next/link';
import { createTranslator } from '@/i18n/translator';
import { community } from '@/lib/site';
import { PRIMARY_NAV } from './nav';

const linkBase = 'inline-flex min-h-10 items-center transition-colors hover:text-white hover:underline md:min-h-8';
const linkClass = `${linkBase} text-on-dark`;

export function Footer({ locale }: { locale: Locale }) {
  const t = createTranslator(locale);
  const policies = [
    ['privacy', 'footer.privacy'],
    ['terms', 'footer.terms'],
    ['refund-policy', 'footer.refund'],
    ['code-of-conduct', 'footer.conduct'],
    ['contact', 'footer.contact'],
  ] as const;
  const links = [
    ['mlopsmena.com', community.mainSite],
    ['LinkedIn', community.linkedin],
    ['YouTube', community.youtube],
    ['Discord', community.discord],
    ['Telegram', community.telegram],
    ['GitHub', community.github],
  ] as const;

  return (
    <footer className="on-dark bg-ink text-[0.9375rem] text-on-dark">
      <div className="mx-auto grid w-full max-w-[70rem] gap-10 px-5 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-[2fr_1fr_1fr]">
        <div className="sm:col-span-2 lg:col-span-1">
          <Link href={`/${locale}`} className="inline-flex min-h-11 items-center gap-2.5 font-semibold text-white">
            <Image src="/logo.svg" alt="" width={40} height={23} className="h-[23px] w-10" />
            {t('meta.siteName')}
          </Link>
          <p className="mt-3 max-w-sm leading-relaxed">{t('footer.about')}</p>
          <ul className="mt-4 flex flex-wrap gap-x-5">
            {PRIMARY_NAV.map((item) => (
              <li key={item.path}>
                <Link href={`/${locale}${item.path}`} className={`${linkBase} font-medium text-white`}>
                  {t(item.label)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <nav aria-labelledby="footer-policies">
          <h2 id="footer-policies" className="text-sm font-medium text-white">
            {t('footer.policies')}
          </h2>
          <ul className="mt-3 space-y-1">
            {policies.map(([slug, key]) => (
              <li key={slug}>
                <Link href={`/${locale}/${slug}`} className={linkClass}>
                  {t(key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-labelledby="footer-community">
          <h2 id="footer-community" className="text-sm font-medium text-white">
            {t('footer.community')}
          </h2>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
            {links.map(([name, href]) => (
              <li key={name}>
                <a href={href} className={linkClass} rel="noopener">
                  {name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto w-full max-w-[70rem] px-5 py-5 text-sm sm:px-6">{t('footer.rights', { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
