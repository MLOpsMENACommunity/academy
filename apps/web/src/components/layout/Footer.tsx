import type { Locale } from '@academy/shared';
import Link from 'next/link';
import { createTranslator } from '@/i18n/translator';
import { community } from '@/lib/site';

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
    <footer className="mt-16 border-t border-line bg-card">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3 sm:px-6">
        <div>
          <p className="font-bold text-fg">{t('meta.siteName')}</p>
          <p className="mt-2 text-sm text-muted">{t('footer.about')}</p>
        </div>
        <nav aria-labelledby="footer-policies">
          <h2 id="footer-policies" className="text-sm font-semibold">
            {t('footer.policies')}
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {policies.map(([slug, key]) => (
              <li key={slug}>
                <Link href={`/${locale}/${slug}`} className="text-body hover:text-primary hover:underline">
                  {t(key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-labelledby="footer-community">
          <h2 id="footer-community" className="text-sm font-semibold">
            {t('footer.community')}
          </h2>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
            {links.map(([name, href]) => (
              <li key={name}>
                <a href={href} className="text-body hover:text-primary hover:underline" rel="noopener">
                  {name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <p className="border-t border-line py-4 text-center text-xs text-muted">
        {t('footer.rights', { year: new Date().getFullYear() })}
      </p>
    </footer>
  );
}
