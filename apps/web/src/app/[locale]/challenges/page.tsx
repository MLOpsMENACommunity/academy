import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChallengesBoard } from '@/components/challenges/ChallengesBoard';
import { Container } from '@/components/ui/Container';
import { isLocale } from '@/i18n/config';
import { createTranslator } from '@/i18n/translator';
import { alternates, openGraph } from '@/lib/seo';
import { absoluteUrl } from '@/lib/site';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = createTranslator(locale);
  return {
    title: t('challenges.title'),
    description: t('challenges.intro'),
    alternates: alternates(locale, '/challenges'),
    openGraph: openGraph(locale, { title: t('challenges.title'), description: t('challenges.intro'), url: absoluteUrl(`/${locale}/challenges`) }),
  };
}

/** Cohort challenges. The page is the same for everyone; the list (with opted-in finisher names) loads in the browser, uncached. */
export default async function ChallengesPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = createTranslator(locale);
  return (
    <>
      <section className="border-b border-line bg-muted-bg">
        <Container className="py-10 sm:py-14">
          <h1 className="text-[2rem] sm:text-[2.5rem]">{t('challenges.title')}</h1>
          <p className="mt-3 max-w-2xl text-lg leading-relaxed text-muted">{t('challenges.intro')}</p>
        </Container>
      </section>
      <Container className="py-10 sm:py-14">
        <ChallengesBoard />
      </Container>
    </>
  );
}
