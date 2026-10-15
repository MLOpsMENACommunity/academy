import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SpeakerTile } from '@/components/catalog/cards';
import { buttonClass } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { alternates, openGraph } from '@/lib/seo';
import { absoluteUrl } from '@/lib/site';
import { serverGet } from '@/lib/server-api';
import { loadSpeakers } from '@/lib/speakers';

type Props = { params: Promise<{ locale: string }> };

export const revalidate = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return {
    title: t('speakers.title'),
    description: t('speakers.intro'),
    alternates: alternates(locale, '/speakers'),
    openGraph: openGraph(locale, { title: t('speakers.title'), description: t('speakers.intro'), url: absoluteUrl(`/${locale}/speakers`) }),
  };
}

export default async function SpeakersPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);
  // The list itself through serverGet: an API failure fails the render instead of caching "no speakers".
  await serverGet<unknown>('/speakers', 300);
  const speakers = await loadSpeakers(60);

  return (
    <>
      <section className="border-b border-line bg-muted-bg">
        <Container className="py-10 sm:py-14">
          <h1 className="text-[2rem] sm:text-[2.5rem]">{t('speakers.title')}</h1>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">{t('speakers.intro')}</p>
          <p className="mt-5 flex flex-wrap items-center gap-3 text-muted">
            {t('speakers.portal.cta')}
            <Link href={`/${locale}/register?as=speaker`} className={buttonClass('secondary', 'md')}>
              {t('speakers.portal.ctaButton')}
            </Link>
          </p>
        </Container>
      </section>
      <Container className="py-10 sm:py-14">
        {speakers.length === 0 ? (
          <p className="text-muted">{t('speakers.empty')}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
            {speakers.map((s, i) => (
              <li key={s.slug} className="flex">
                <SpeakerTile speaker={s} locale={locale} index={i} size="lg" />
              </li>
            ))}
          </ul>
        )}
      </Container>
    </>
  );
}
