import type { Locale } from '@academy/shared';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { createTranslator } from '@/i18n/translator';

const tabClass =
  'inline-flex min-h-11 items-center rounded-full px-5 text-[0.9375rem] font-medium text-muted transition-colors hover:text-fg aria-[current=page]:bg-card aria-[current=page]:text-fg aria-[current=page]:shadow-sm';

/**
 * The /sessions hero with its two views, Upcoming and Recordings. Each view is its own
 * URL (/sessions, /sessions/recordings), so the switch is navigation: plain links with
 * aria-current, which work without JavaScript and in both directions.
 */
export function SessionsHeader({ locale, view }: { locale: Locale; view: 'upcoming' | 'recordings' }) {
  const t = createTranslator(locale);
  return (
    <section className="border-b border-line bg-card">
      <Container className="flex flex-col gap-4 pt-12 pb-8 sm:pt-16 sm:pb-10 lg:pt-20">
        <h1 className="text-[2rem] leading-tight sm:text-[2.75rem] sm:leading-[1.15]">{t('sessions.title')}</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted sm:text-[1.1875rem]">
          {view === 'upcoming' ? t('sessions.intro') : t('sessions.recordingsIntro')}
        </p>
        <nav aria-label={t('sessions.views')} className="mt-2">
          <ul className="inline-flex gap-1 rounded-full border border-line bg-muted-bg p-1">
            <li>
              <Link href={`/${locale}/sessions`} aria-current={view === 'upcoming' ? 'page' : undefined} className={tabClass}>
                {t('sessions.tabUpcoming')}
              </Link>
            </li>
            <li>
              <Link href={`/${locale}/sessions/recordings`} aria-current={view === 'recordings' ? 'page' : undefined} className={tabClass}>
                {t('sessions.tabRecordings')}
              </Link>
            </li>
          </ul>
        </nav>
      </Container>
    </section>
  );
}
